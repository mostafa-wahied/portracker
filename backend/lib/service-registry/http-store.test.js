'use strict';

const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, expect, test } = require('@jest/globals');
const { createServiceRegistry } = require('./registry');
const { createHttpMetadataStore, iconMime, verifiedRootUrl } = require('./http-store');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WkW3+IAAAAASUVORK5CYII=',
  'base64'
);

function fixture(run) {
  const db = new Database(':memory:');
  try {
    const registry = createServiceRegistry(db);
    return run(db, registry, createHttpMetadataStore(db));
  } finally { db.close(); }
}

function observe(registry, { pid = 123, port = 3000, at = 1000 } = {}) {
  return registry.observe({
    source: 'system', owner: 'node', pid, host_ip: '127.0.0.1',
    host_port: port, protocol: 'tcp',
  }, { at });
}

describe('persistent HTTP metadata and icon cache', () => {
  test('schema v3 is idempotent and isolated from port/notes history', () => fixture((db, registry) => {
    const entry = observe(registry);
    createServiceRegistry(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM registry_schema_versions').get().n).toBe(7);
    expect(registry.getService(entry.id).displayName).toBe('node');
  }));

  test('stores actual title and content-hashed PNG without overriding service name', () => fixture((db, registry, store) => {
    const original = observe(registry);
    const saved = store.recordSuccess(original.id, {
      title: 'My Next.js App',
      rootUrl: 'http://127.0.0.1:3000/',
      iconBytes: PNG, iconType: 'image/png',
    }, 2000);
    expect(saved.httpTitle).toBe('My Next.js App');
    expect(saved.httpRootUrl).toBe('http://127.0.0.1:3000/');
    expect(saved.iconHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.getIcon(saved.iconHash).mime).toBe('image/png');
    expect(store.getIcon(saved.iconHash).bytes.equals(PNG)).toBe(true);
    expect(registry.getService(original.id).displayName).toBe('node');
    expect(db.prepare('SELECT COUNT(*) AS n FROM registry_icons').get().n).toBe(1);
  }));

  test('title and favicon survive file-backed SQLite close and reopen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-http-'));
    const file = path.join(dir, 'registry.db');
    try {
      const firstDb = new Database(file);
      const registry = createServiceRegistry(firstDb);
      const original = observe(registry);
      const firstStore = createHttpMetadataStore(firstDb);
      const saved = firstStore.recordSuccess(original.id, {
        title: 'Persistent Web App', rootUrl: 'http://127.0.0.1:3000/',
        iconBytes: PNG, iconType: 'image/png',
      }, 2000);
      firstDb.close();

      const reopened = new Database(file);
      try {
        createServiceRegistry(reopened);
        const store = createHttpMetadataStore(reopened);
        expect(store.getMetadata(original.id).httpTitle).toBe('Persistent Web App');
        expect(store.getIcon(saved.iconHash).bytes.equals(PNG)).toBe(true);
      } finally { reopened.close(); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('failure preserves last good title, icon, and successful timestamp', () => fixture((_db, registry, store) => {
    const entry = observe(registry);
    store.recordSuccess(entry.id, {
      title: 'Previously Running', rootUrl: 'http://127.0.0.1:3000/',
      iconBytes: PNG, iconType: 'image/png',
    }, 2000);
    store.recordFailure(entry.id, 3000, 'network_error');
    registry.reconcileSource({ source: 'system', complete: true, rows: [], at: 4000 });
    const meta = store.getMetadata(entry.id);
    expect(meta.httpTitle).toBe('Previously Running');
    expect(meta.iconHash).toMatch(/^[a-f0-9]{64}$/);
    expect(meta.metadataFetchedAt).toBe(2000);
    expect(registry.getService(entry.id).status).toBe('offline');
  }));

  test('last attempt and TTL prevent hammering unreachable or unchanged servers', () => fixture((_db, registry, store) => {
    const entry = observe(registry);
    expect(store.getCandidates({ at: 2000 }).map(row => row.service_id)).toEqual([entry.id]);
    store.recordFailure(entry.id, 2000, 'timeout');
    expect(store.getCandidates({ at: 4000 })).toHaveLength(0);
    expect(store.getCandidates({ at: 303000 })).toHaveLength(1);
    store.recordSuccess(entry.id, {
      title: 'Active Site', rootUrl: 'http://127.0.0.1:3000/',
    }, 304000);
    expect(store.getCandidates({ at: 400000 })).toHaveLength(0);
    expect(store.getCandidates({ at: 304000 + 86400000 + 1 })).toHaveLength(1);
  }));

  test('same icon content is cached once across services', () => fixture((db, registry, store) => {
    const a = observe(registry, { pid: 1, port: 3000 });
    const b = observe(registry, { pid: 2, port: 3001 });
    for (const entry of [a, b]) {
      store.recordSuccess(entry.id, {
        title: 'Hello', rootUrl: 'http://127.0.0.1:3000/',
        iconBytes: PNG, iconType: 'image/png',
      }, 3000);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM registry_icons').get().n).toBe(1);
  }));

  test('rejects SVG and MIME confusion, oversized images and unverified URL', () => fixture((_db, registry, store) => {
    const entry = observe(registry);
    expect(iconMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(iconMime(Buffer.alloc(128 * 1024 + 1))).toBeNull();
    expect(verifiedRootUrl('http://example.com:3000/')).toBe(false);
    expect(verifiedRootUrl('file:///etc/passwd')).toBe(false);
    expect(verifiedRootUrl('http://127.0.0.1:3000/admin')).toBe(false);
    expect(() => store.recordSuccess(entry.id, {
      title: 'bad', rootUrl: 'http://example.com:3000/',
    }, 3000)).toThrow('Unverified metadata URL');
    store.recordSuccess(entry.id, {
      title: 'good', rootUrl: 'http://127.0.0.1:3000/',
      iconBytes: PNG, iconType: 'image/svg+xml',
    }, 3000);
    expect(store.getMetadata(entry.id).iconHash).toBeNull();
  }));

  test('forget deletes saved title but never stops service or deletes other entries', () => fixture((_db, registry, store) => {
    const a = observe(registry, { pid: 1 });
    const b = observe(registry, { pid: 2 });
    store.recordSuccess(a.id, { title: 'A', rootUrl: 'http://127.0.0.1:3000/' }, 1000);
    store.recordSuccess(b.id, { title: 'B', rootUrl: 'http://127.0.0.1:3000/' }, 1000);
    expect(registry.forgetService(a.id)).toBe(true);
    expect(store.getMetadata(a.id)).toBeNull();
    expect(store.getMetadata(b.id).httpTitle).toBe('B');
  }));

  test('only genuine TCP endpoints are considered for enrichment', () => fixture((db, registry, store) => {
    observe(registry, { pid: 1 });
    const nonWeb = observe(registry, { pid: 2, port: 5432 });
    const id = 'internal-example';
    const now = Date.now();
    db.prepare('INSERT INTO registry_services ' +
      '(id, server_id, identity_confidence, display_name, source, first_seen_at, last_seen_at, status, created_at, updated_at) ' +
      "VALUES (?, 'local', 'uncertain', 'internal', 'docker', ?, ?, 'listening', ?, ?)")
      .run(id, now, now, now, now);
    db.prepare('INSERT INTO registry_endpoints ' +
      '(id, service_id, host_ip, host_port, protocol, internal, source, first_seen_at, last_seen_at) ' +
      "VALUES ('int-endpoint', ?, '127.0.0.1', 9000, 'tcp', 1, 'docker', ?, ?)")
      .run(id, now, now);
    expect(store.getCandidates({ at: 2000 }).map(row => row.service_id)).not.toContain(id);
    expect(store.getCandidates({ at: 2000 }).map(row => row.service_id)).not.toContain(nonWeb.id);
  }));
});
