'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { describe, expect, test } = require('@jest/globals');
const { createServiceRegistry } = require('./registry');
const { createLinuxProvenanceStore } = require('./linux-provenance-store');

function fixture(run) {
  const db = new Database(':memory:');
  try {
    const registry = createServiceRegistry(db);
    return run(db, registry, createLinuxProvenanceStore(db));
  } finally { db.close(); }
}

const evidence = overrides => ({
  kind: 'systemd_user_service', confidence: 'observed',
  unitName: 'my-dev.service', unitScope: 'user',
  pid: 4321, uid: 1000, startTicks: '456789',
  bootId: 'a1b2c3d4-0000-4444-8888-eeeeffffffff',
  executablePath: '/nix/store/abc123/bin/node', cwd: '/home/dev/project',
  ...overrides,
});

const listener = processStartTicks => ({
  host_ip: '127.0.0.1', host_port: 3000, protocol: 'tcp',
  source: 'system', owner: 'node', pid: 4321,
  boot_id: 'a1b2c3d4-0000-4444-8888-eeeeffffffff',
  process_start_ticks: processStartTicks,
});

describe('private Linux provenance registry storage', () => {
  test('migrates alongside legacy registry without overwriting historical entries', () => fixture((db, registry) => {
    expect(db.prepare('SELECT COUNT(*) AS n FROM registry_schema_versions').get().n).toBe(5);
    const item = registry.observe(listener('456789'), { at: 1000 });
    const store = createLinuxProvenanceStore(db);
    store.record(item.id, evidence(), 2000);
    expect(store.get(item.id)).toMatchObject({
      kind: 'systemd_user_service', unitName: 'my-dev.service',
      unitScope: 'user', cwd: '/home/dev/project',
      executablePath: '/nix/store/abc123/bin/node',
    });
    expect(registry.getService(item.id)).not.toHaveProperty('linuxProvenance');
    expect(registry.listServices().items[0]).not.toHaveProperty('cwd');
  }));

  test('only stores approved structured fields, never command lines or environment', () => fixture((db, registry, store) => {
    const item = registry.observe(listener('456789'));
    const secret = 'DO_NOT_STORE_TOKEN_123';
    store.record(item.id, evidence({
      argv: ['node', '--api-token=' + secret],
      environment: { API_TOKEN: secret }, rawCgroup: '/user.slice/' + secret,
      cwd: '/home/dev/project',
    }), 2500);
    const raw = JSON.stringify(db.prepare('SELECT * FROM registry_linux_provenance').all());
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain('argv');
    expect(raw).not.toContain('environment');
    expect(store.get(item.id)).not.toHaveProperty('rawCgroup');
  }));

  test('older observations never overwrite newer captured paths or unit evidence', () => fixture((_db, registry, store) => {
    const item = registry.observe(listener('456789'));
    store.record(item.id, evidence(), 3000);
    store.record(item.id, evidence({
      kind: 'unknown', confidence: 'unavailable', unitName: null,
      executablePath: null, cwd: null,
    }), 2000);
    expect(store.get(item.id)).toMatchObject({
      kind: 'systemd_user_service', cwd: '/home/dev/project', capturedAt: 3000,
    });
    store.record(item.id, evidence({
      kind: 'unknown', confidence: 'unavailable', unitName: null,
      executablePath: null, cwd: null,
    }), 4000);
    expect(store.get(item.id)).toMatchObject({
      kind: 'systemd_user_service', cwd: '/home/dev/project', capturedAt: 4000,
    });
  }));

  test('recycled PID and start-time evidence create two separate historical identities', () => fixture((_db, registry, store) => {
    const first = registry.observe(listener('456789'), { at: 1000 });
    store.record(first.id, evidence(), 1000);
    const second = registry.observe(listener('999999'), { at: 2000 });
    expect(second.id).not.toBe(first.id);
    expect(store.get(first.id).startTicks).toBeUndefined();
    expect(store.get(first.id).processStartTicks).toBe('456789');
    expect(store.get(second.id)).toBeNull();
  }));

  test('forget removes only the provenance record for the chosen service ID', () => fixture((db, registry, store) => {
    const a = registry.observe(listener('123'), { at: 1000 });
    const b = registry.observe(listener('456'), { at: 2000 });
    store.record(a.id, evidence({ startTicks: '123' }), 1000);
    store.record(b.id, evidence({ startTicks: '456' }), 2000);
    expect(registry.forgetService(a.id)).toBe(true);
    expect(store.get(a.id)).toBeNull();
    expect(store.get(b.id)?.unitName).toBe('my-dev.service');
    expect(db.prepare('SELECT COUNT(*) AS n FROM registry_linux_provenance').get().n).toBe(1);
  }));

  test('provenance and historical last-seen survive database restart', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-provenance-'));
    const file = path.join(dir, 'registry.sqlite');
    try {
      const db = new Database(file);
      const registry = createServiceRegistry(db);
      const item = registry.observe(listener('456789'), { at: 1000 });
      createLinuxProvenanceStore(db).record(item.id, evidence(), 1000);
      db.close();
      const db2 = new Database(file);
      try {
        createServiceRegistry(db2);
        expect(createLinuxProvenanceStore(db2).get(item.id)).toMatchObject({
          unitName: 'my-dev.service', capturedAt: 1000, processStartTicks: '456789',
        });
      } finally { db2.close(); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('rejects invalid evidence rather than saving arbitrary data', () => fixture((_db, registry, store) => {
    const item = registry.observe(listener('456789'));
    expect(() => store.record(item.id, evidence({ pid: '../secret' }))).toThrow();
    expect(() => store.record(item.id, evidence({ startTicks: '-1' }))).toThrow();
    expect(() => store.record(item.id, evidence({ kind: 'made-up-unit' }))).toThrow();
    store.record(item.id, evidence({
      cwd: '/home/dev/project\nTOKEN', executablePath: '/home/dev/node\u0000secret',
      unitName: 'foo; rm -rf.service',
    }));
    expect(store.get(item.id)).toMatchObject({
      cwd: null, executablePath: null, unitName: null, kind: 'unknown',
    });
  }));
});
