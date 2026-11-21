'use strict';

const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, expect, test } = require('@jest/globals');
const { createServiceRegistry } = require('./registry');
const { createDockerProvenanceStore } = require('./docker-provenance-store');
const { daemonFingerprint } = require('./docker-provenance');

const daemon = daemonFingerprint({ ID: 'AAABBB:CCCDDD:EEEFGG:HHHIII' });
const docker = (container, port, project = 'demo', service = 'web') => ({
  source: 'docker', owner: project + '-' + service,
  host_ip: '0.0.0.0', host_port: port, protocol: 'tcp',
  container_id: container, compose_project: project, compose_service: service,
  docker_host_hash: daemon,
});

const provenance = overrides => ({
  containerId: 'a'.repeat(64), containerName: 'demo-web-1', image: 'nginx:stable',
  networkMode: 'bridge', hostFingerprint: daemon,
  composeProject: 'demo', composeService: 'web',
  projectWorkingDir: '/home/dev/project',
  configFilePaths: ['/home/dev/project/compose.yml'],
  pathScope: 'docker-host', identityConfidence: 'verified',
  ...overrides,
});

function fixture(run) {
  const db = new Database(':memory:');
  try {
    const registry = createServiceRegistry(db);
    return run(db, registry, createDockerProvenanceStore(db));
  } finally { db.close(); }
}

describe('persisted Docker/Compose service provenance', () => {
  test('Compose service survives container recreation and published port remap', () => fixture((_db, registry, store) => {
    const original = registry.observe(docker('a'.repeat(12), 3000), { at: 1000 });
    store.record(original.id, provenance(), 1000);
    const recreated = registry.observe(docker('b'.repeat(12), 9090), { at: 2000 });
    store.record(recreated.id, provenance({
      containerId: 'b'.repeat(64), containerName: 'demo-web-2', image: 'nginx:1.27',
    }), 2000);
    expect(recreated.id).toBe(original.id);
    expect(recreated.identityConfidence).toBe('verified');
    expect(registry.getService(original.id).endpoints).toHaveLength(2);
    expect(store.get(original.id)).toMatchObject({
      containerId: 'b'.repeat(64),
      containerName: 'demo-web-2',
      image: 'nginx:1.27',
      composeProject: 'demo',
      composeService: 'web',
      configFilePaths: ['/home/dev/project/compose.yml'],
    });
  }));

  test('same Compose service name in different projects or daemons never merges', () => fixture((_db, registry) => {
    const other = 'c'.repeat(64);
    const a = registry.observe(docker('a'.repeat(12), 3000, 'demo', 'web'));
    const b = registry.observe(docker('b'.repeat(12), 3000, 'other', 'web'));
    const c = registry.observe({ ...docker('c'.repeat(12), 3000), docker_host_hash: other });
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  }));

  test('same port and container name, different standalone container IDs stay distinct', () => fixture((_db, registry) => {
    const a = registry.observe({ ...docker('a'.repeat(12), 3000), compose_project: null,
      compose_service: null });
    const b = registry.observe({ ...docker('b'.repeat(12), 3000), compose_project: null,
      compose_service: null });
    expect(a.id).not.toBe(b.id);
    expect(a.identityConfidence).toBe('provisional');
  }));

  test('only allowlisted Docker fields reach the database', () => fixture((db, registry, store) => {
    const item = registry.observe(docker('a'.repeat(12), 3000));
    const secret = 'NEVER_PERSIST_DOCKER_SECRET_987';
    store.record(item.id, provenance({
      rawInspect: { Env: [secret], Mounts: [secret], Config: { Labels: { token: secret } } },
      command: '--password=' + secret, env: { KEY: secret },
    }), 1000);
    const raw = JSON.stringify(db.prepare('SELECT * FROM registry_docker_provenance').all());
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain('rawInspect');
    expect(store.get(item.id)).not.toHaveProperty('command');
  }));

  test('older inspect observations never overwrite new container details', () => fixture((_db, registry, store) => {
    const item = registry.observe(docker('a'.repeat(12), 3000));
    store.record(item.id, provenance({ containerName: 'new-web' }), 4000);
    store.record(item.id, provenance({ containerName: 'old-web' }), 2000);
    expect(store.get(item.id)).toMatchObject({
      containerName: 'new-web', capturedAt: 4000,
    });
  }));

  test('forget removes one saved Docker provenance record, not the process', () => fixture((db, registry, store) => {
    const a = registry.observe(docker('a'.repeat(12), 3000));
    const b = registry.observe(docker('b'.repeat(12), 3001, 'other', 'web'));
    store.record(a.id, provenance(), 1000);
    store.record(b.id, provenance({ composeProject: 'other' }), 1000);
    expect(registry.forgetService(a.id)).toBe(true);
    expect(store.get(a.id)).toBeNull();
    expect(store.get(b.id)?.composeProject).toBe('other');
    expect(db.prepare('SELECT COUNT(*) AS total FROM registry_docker_provenance').get().total).toBe(1);
  }));

  test('provenance persists after SQLite close/reopen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-docker-'));
    const file = path.join(dir, 'registry.sqlite');
    try {
      const db = new Database(file);
      const registry = createServiceRegistry(db);
      const item = registry.observe(docker('a'.repeat(12), 3000));
      createDockerProvenanceStore(db).record(item.id, provenance(), 2000);
      db.close();
      const reopened = new Database(file);
      try {
        createServiceRegistry(reopened);
        expect(createDockerProvenanceStore(reopened).get(item.id)).toMatchObject({
          composeProject: 'demo',
          projectWorkingDir: '/home/dev/project',
          configFilePaths: ['/home/dev/project/compose.yml'],
        });
      } finally { reopened.close(); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
