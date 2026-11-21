'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { describe, expect, test } = require('@jest/globals');
const { createServiceRegistry } = require('./registry');

function fixture(run) {
  const db = new Database(':memory:');
  try { return run(db, createServiceRegistry(db)); }
  finally { db.close(); }
}

function port(overrides = {}) {
  return {
    host_ip: '127.0.0.1', host_port: 3000, protocol: 'tcp', source: 'system',
    owner: 'node', pid: 101, ...overrides,
  };
}

describe('persistent localhost registry storage', () => {
  test('idempotent schema migration does not alter legacy tables', () => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE notes_legacy_fixture (note TEXT)');
      db.prepare('INSERT INTO notes_legacy_fixture VALUES (?)').run('my manual notes');
      createServiceRegistry(db);
      createServiceRegistry(db);
      expect(db.prepare('SELECT COUNT(*) AS n FROM registry_schema_versions').get().n).toBe(10);
      expect(db.prepare('SELECT note FROM notes_legacy_fixture').get().note)
        .toBe('my manual notes');
    } finally { db.close(); }
  });

  test('same observation is idempotent and preserves earliest timestamp', () => fixture((_db, registry) => {
    const first = registry.observe(port(), { at: 1000 });
    const again = registry.observe(port(), { at: 2000 });
    expect(again.id).toBe(first.id);
    expect(again.firstSeenAt).toBe(1000);
    expect(again.lastSeenAt).toBe(2000);
    expect(again.status).toBe('listening');
    expect(again.endpoints).toHaveLength(1);
    expect(again.endpoints[0].lastSeenAt).toBe(2000);
    expect(registry.listServices().total).toBe(1);
    registry.observe(port(), { at: 1500 });
    expect(registry.getService(first.id).lastSeenAt).toBe(2000);
  }));

  test('one observed process can have multiple endpoints', () => fixture((_db, registry) => {
    const a = registry.observe(port(), { at: 1000 });
    const b = registry.observe(port({ host_port: 3001 }), { at: 1100 });
    expect(a.id).toBe(b.id);
    expect(registry.getService(a.id).endpoints.map(e => e.hostPort)).toEqual([3001, 3000]);
  }));

  test('detectably different processes reusing a port remain separate', () => fixture((_db, registry) => {
    const a = registry.observe(port({ pid: 101 }), { at: 1000 });
    const b = registry.observe(port({ pid: 202 }), { at: 2000 });
    const c = registry.observe(port({ pid: 303, owner: 'python' }), { at: 3000 });
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(registry.listServices({ port: 3000 }).total).toBe(3);
  }));

  test('unidentifiable observations can be explicitly split into uncertain episodes', () => fixture((_db, registry) => {
    const unknown = port({ owner: 'unknown', pid: null });
    const a = registry.observe(unknown, { at: 1000 });
    const sameEpisode = registry.observe(unknown, { at: 1100 });
    const b = registry.observe(unknown, { at: 4000, startNewEpisode: true });
    expect(a.id).toBe(sameEpisode.id);
    expect(b.id).not.toBe(a.id);
    expect(a.identityConfidence).toBe('uncertain');
    expect(b.identityConfidence).toBe('uncertain');
  }));

  test('same Python dev service after confirmed exit reuses logical identity and notes', () => fixture((db, registry) => {
    const { createRecoveryNotesStore } = require('./recovery-notes');
    const notes = createRecoveryNotesStore(db);
    const make = (pid, startTicks, cwd = '/home/dev/site', executablePath = '/nix/store/python/bin/python3') => ({
      ...port({ owner: 'python3', host_port: 4177, pid }),
      boot_id: 'a1b2c3d4-0000-4444-8888-eeeeffffffff',
      process_start_ticks: startTicks,
      provenance: { kind: 'session_scope', confidence: 'observed', uid: 1000,
        pid, startTicks, cwd, executablePath },
    });
    registry.reconcileSource({ source: 'system', rows: [make(101, '1')], complete: true, at: 1000 });
    const first = registry.listServices().items[0];
    notes.saveNotes(first.id, 'cd /home/dev/site && python3 -m http.server 4177', 0);
    registry.reconcileSource({ source: 'system', rows: [], complete: true, at: 2000 });
    expect(registry.getService(first.id).status).toBe('offline');
    registry.reconcileSource({ source: 'system', rows: [make(202, '2')], complete: true, at: 3000 });
    expect(registry.listServices().total).toBe(1);
    expect(registry.getService(first.id)).toMatchObject({
      status: 'listening', firstSeenAt: 1000, lastSeenAt: 3000, runCount: 2,
    });
    expect(notes.get(first.id).text).toContain('python3');
    registry.reconcileSource({ source: 'system', rows: [], complete: true, at: 4000 });
    registry.reconcileSource({ source: 'system', rows: [make(303, '3', '/home/dev/another-site')], complete: true, at: 5000 });
    expect(registry.listServices().total).toBe(2);
    expect(notes.get(first.id).text).toContain('python3');
  }));

  test('fast restart between complete scans retains one logical record', () => fixture((_db, registry) => {
    const make = (pid, ticks) => ({
      ...port({ owner: 'python3', host_port: 4177, pid }),
      process_start_ticks: ticks,
      provenance: { kind: 'session_scope', confidence: 'observed', uid: 1000,
        pid, startTicks: ticks, cwd: '/home/dev/site',
        executablePath: '/usr/bin/python3' },
    });
    registry.reconcileSource({ source: 'system', rows: [make(100, '11')],
      complete: true, at: 1000 });
    const original = registry.listServices().items[0];
    // No scan observed the brief stopped interval; the old record is still Listening.
    registry.reconcileSource({ source: 'system', rows: [make(200, '22')],
      complete: true, at: 2000 });
    expect(registry.listServices().total).toBe(1);
    expect(registry.getService(original.id)).toMatchObject({
      status: 'listening', firstSeenAt: 1000, lastSeenAt: 2000, runCount: 2,
    });
  }));

  test('simultaneous same executable does not merge distinct active processes', () => fixture((_db, registry) => {
    const make = (pid, ticks) => ({ ...port({ owner: 'python', pid, host_port: 4177 }),
      process_start_ticks: ticks,
      provenance: { kind: 'manual', confidence: 'inferred', uid: 1000,
        cwd: '/home/dev/site', executablePath: '/usr/bin/python', pid, startTicks: ticks } });
    registry.reconcileSource({ source: 'system', rows: [make(101, '1'), make(202, '2')], complete: true, at: 1000 });
    expect(registry.listServices().total).toBe(2);
  }));

  test('different monitored hosts are isolated', () => fixture((_db, registry) => {
    const a = registry.observe(port(), { serverId: 'local', at: 1000 });
    const b = registry.observe(port(), { serverId: 'peer-1', at: 1000 });
    expect(a.id).not.toBe(b.id);
    expect(registry.listServices().total).toBe(1);
    expect(registry.listServices({ serverId: 'peer-1' }).total).toBe(1);
  }));

  test('list API uses literal search, safe filters, pagination and stable ordering', () => fixture((_db, registry) => {
    registry.observe(port({ owner: 'node_foo', pid: 1 }), { at: 1000 });
    registry.observe(port({ owner: 'python', pid: 2 }), { at: 2000 });
    registry.observe(port({ owner: 'node%bar', pid: 3 }), { at: 3000 });
    expect(registry.listServices({ limit: 1, offset: 1 }).items[0].displayName).toBe('python');
    expect(registry.listServices({ search: '_' }).total).toBe(1);
    expect(registry.listServices({ search: '%' }).total).toBe(1);
    expect(registry.listServices({ source: 'system', port: 3000 }).total).toBe(3);
    expect(registry.listServices({ seenSince: 2000 }).total).toBe(2);
    expect(registry.listServices({ seenSince: 3001 }).total).toBe(0);
    expect(() => registry.listServices({ seenSince: '-1' })).toThrow('Invalid seenSince');
    expect(registry.listServices({ port: 3000 }).items[0]).toMatchObject({
      previewHostIp: '127.0.0.1', previewPort: 3000, previewProtocol: 'tcp',
    });
    expect(() => registry.listServices({ limit: 101 })).toThrow('Invalid limit');
    expect(() => registry.listServices({ offset: '-1' })).toThrow('Invalid offset');
    expect(() => registry.listServices({ search: 'x'.repeat(101) })).toThrow('Invalid search');
    expect(() => registry.listServices({ port: '3000 OR 1=1' })).toThrow('Invalid port');
  }));

  test('pinning is idempotent, scoped to service ID, sortable, and filterable', () => fixture((db, registry) => {
    const a = registry.observe(port({ host_port: 4177, pid: 111 }), { at: 1000 });
    const b = registry.observe(port({ host_port: 4180, pid: 222 }), { at: 2000 });
    const c = registry.observe(port({ host_port: 4999, pid: 333 }), { at: 3000 });
    expect(registry.listServices({ pinnedOnly: 'true' }).total).toBe(0);
    expect(registry.setPinned(a.id, true, 5000)).toMatchObject({
      id: a.id, pinned: true, pinnedAt: 5000,
    });
    expect(registry.setPinned(a.id, true, 9000).pinnedAt).toBe(5000);
    registry.setPinned(b.id, true, 6000);
    registry.setPinned(c.id, true, 7000);
    // A complete scan confirms A is gone. B is uncertain; C still listens.
    db.prepare("UPDATE registry_services SET status = 'offline' WHERE id = ?").run(a.id);
    db.prepare("UPDATE registry_services SET status = 'unknown' WHERE id = ?").run(b.id);
    const pinned = registry.listServices({ pinnedOnly: true });
    expect(pinned.total).toBe(3);
    expect(pinned.items.map(item => item.id)).toEqual([a.id, b.id, c.id]);
    expect(registry.listServices({ pinnedOnly: true, status: 'offline' }).total).toBe(1);
    expect(registry.listServices({ pinnedOnly: true, portPrefix: '41' }).total).toBe(2);
    expect(registry.listServices({ pinnedOnly: 'true', limit: 1, offset: 1 }).items)
      .toHaveLength(1);
    expect(registry.listServices({ pinnedOnly: false }).total).toBe(3);
    for (const invalid of ['', '1', 'yes', 1, null]) {
      expect(() => registry.listServices({ pinnedOnly: invalid })).toThrow('Invalid pinnedOnly');
    }
    expect(() => registry.setPinned(a.id, 'true')).toThrow('Invalid pin');
    expect(() => registry.setPinned(a.id, true, -1)).toThrow('Invalid pin');
    expect(registry.setPinned('missing-id', true)).toBeNull();
    expect(registry.setPinned(b.id, false).pinnedAt).toBeNull();
    expect(registry.listServices({ pinnedOnly: true }).total).toBe(2);
    expect(registry.forgetService(a.id)).toBe(true);
    expect(registry.listServices({ pinnedOnly: true }).total).toBe(1);
  }));

  test('pin remains on same logical process after a full offline/restart cycle', () => fixture((_db, registry) => {
    const make = (pid, ticks) => ({
      ...port({ host_port: 4177, pid, owner: 'python3' }),
      process_start_ticks: ticks,
      provenance: {
        kind: 'session_scope', confidence: 'observed', uid: 1000, pid,
        startTicks: ticks, cwd: '/home/dev/site', executablePath: '/usr/bin/python3',
      },
    });
    registry.reconcileSource({ source: 'system', complete: true, rows: [make(111, '11')], at: 1000 });
    const original = registry.listServices().items[0];
    registry.setPinned(original.id, true, 1200);
    registry.reconcileSource({ source: 'system', complete: true, rows: [], at: 2000 });
    expect(registry.listServices({ pinnedOnly: true }).items[0].status).toBe('offline');
    registry.reconcileSource({ source: 'system', complete: true, rows: [make(222, '22')], at: 3000 });
    expect(registry.listServices({ pinnedOnly: true }).items).toHaveLength(1);
    expect(registry.getService(original.id)).toMatchObject({
      pinned: true, pinnedAt: 1200, firstSeenAt: 1000, runCount: 2,
    });
    registry.reconcileSource({ source: 'system', complete: true, rows: [], at: 4000 });
    registry.reconcileSource({ source: 'system', complete: true, rows: [
      { ...make(333, '33'), provenance: { ...make(333, '33').provenance, cwd: '/home/dev/other' } },
    ], at: 5000 });
    expect(registry.listServices().total).toBe(2);
    expect(registry.listServices({ pinnedOnly: true }).items[0].id).toBe(original.id);
    expect(registry.listServices({ pinnedOnly: true }).items[0].status).toBe('offline');
  }));

  test('port prefix filters all historical endpoints and composes with status', () => fixture((_db, registry) => {
    const rows = [41, 410, 4177, 4180, 41000, 41999, 4999, 65535].map(
      (host_port, index) => registry.observe(port({ host_port, pid: 200 + index }), { at: index + 1 })
    );
    // Ensure a multi-endpoint service can be matched by an old endpoint too.
    registry.observe(port({ host_port: 7000, pid: 202 }), { at: 50 });
    expect(registry.listServices({ portPrefix: '41' }).total).toBe(6);
    expect(registry.listServices({ portPrefix: '417' }).total).toBe(1);
    expect(registry.listServices({ portPrefix: '4' }).total).toBe(7);
    expect(registry.listServices({ portPrefix: '65' }).total).toBe(1);
    expect(registry.listServices({ portPrefix: '65535' }).total).toBe(1);
    expect(registry.listServices({ portPrefix: '41', limit: 1 }).items).toHaveLength(1);
    registry.reconcileSource({ source: 'system', rows: [], complete: true, at: 200 });
    expect(registry.listServices({ portPrefix: '41', status: 'offline' }).total).toBe(6);
    expect(registry.listServices({ portPrefix: '41', status: 'listening' }).total).toBe(0);
    expect(registry.getService(rows[2].id).endpoints.map(e => e.hostPort))
      .toEqual([7000, 4177]);
    for (const bad of ['0', '041', '65536', '99999', '1 OR 1=1', '', '1%']) {
      expect(() => registry.listServices({ portPrefix: bad })).toThrow('Invalid portPrefix');
    }
    expect(() => registry.listServices({ port: 41, portPrefix: '41' }))
      .toThrow('Specify port or portPrefix');
  }));

  test('only allowlisted fields are persisted or returned', () => fixture((db, registry) => {
    const secret = 'DO_NOT_STORE_THIS_SECRET';
    const observed = registry.observe(port({
      environment: { API_KEY: secret }, command: 'node --token=' + secret,
      labels: { secret }, platform_data: { cmdline: secret }, args: [secret],
    }));
    const stored = JSON.stringify({
      services: db.prepare('SELECT * FROM registry_services').all(),
      endpoints: db.prepare('SELECT * FROM registry_endpoints').all(),
    });
    expect(stored).not.toContain(secret);
    expect(JSON.stringify(observed)).not.toContain(secret);
    expect(observed).not.toHaveProperty('identityKey');
  }));

  test('forget removes a specific registry record but not other services', () => fixture((_db, registry) => {
    const a = registry.observe(port({ pid: 101 }));
    const b = registry.observe(port({ pid: 202 }));
    expect(registry.forgetService(a.id)).toBe(true);
    expect(registry.forgetService(a.id)).toBe(false);
    expect(registry.getService(a.id)).toBeNull();
    expect(registry.getService(b.id)).not.toBeNull();
    expect(registry.listServices().total).toBe(1);
  }));

  test('malformed observations do not create rows', () => fixture((_db, registry) => {
    expect(() => registry.observe({ error: 'scanner failed', host_port: 3000 })).toThrow();
    expect(() => registry.observe(port({ host_ip: 'not-an-ip' }))).toThrow();
    expect(() => registry.observe(port({ host_port: 65536 }))).toThrow();
    expect(() => registry.observe(port({ protocol: 'javascript' }))).toThrow();
    expect(() => registry.observe(port(), { serverId: '../secret' })).toThrow();
    expect(registry.listServices().total).toBe(0);
  }));

  test('file-backed history survives database close/reopen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-history-'));
    const file = path.join(dir, 'registry.sqlite');
    try {
      const db = new Database(file);
      const initialRegistry = createServiceRegistry(db);
      const first = initialRegistry.observe(port(), { at: 1000 });
      initialRegistry.setPinned(first.id, true, 1200);
      db.close();

      const reopened = new Database(file);
      try {
        const registry = createServiceRegistry(reopened);
        expect(registry.getService(first.id).displayName).toBe('node');
        expect(registry.getService(first.id).lastSeenAt).toBe(1000);
        expect(registry.getService(first.id).pinned).toBe(true);
        expect(registry.getService(first.id).pinnedAt).toBe(1200);
      } finally { reopened.close(); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('schema upgrade fails transactionally if a preexisting registry table is incompatible', () => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE registry_services (id INTEGER PRIMARY KEY)');
      expect(() => createServiceRegistry(db)).toThrow();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'registry_endpoints'").get())
        .toBeUndefined();
    } finally { db.close(); }
  });
});
