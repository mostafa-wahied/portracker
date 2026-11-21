'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { describe, expect, test } = require('@jest/globals');
const { createServiceRegistry } = require('./registry');
const { createDockerProvenanceStore } = require('./docker-provenance-store');
const { createRegistryScanner } = require('./scanner');

const DAEMON = 'f'.repeat(64);
const makeProxy = (port = 4183, overrides = {}) => ({
  source: 'system', protocol: 'tcp', host_ip: '127.0.0.1',
  host_port: port, owner: 'docker-proxy', pid: 30001, internal: false,
  ...overrides,
});
const makeDocker = (port = 4183, overrides = {}) => ({
  source: 'docker', protocol: 'tcp', host_ip: '127.0.0.1',
  host_port: port, owner: 'portracker-qa-a-web-1',
  container_id: 'a'.repeat(64), docker_host_hash: DAEMON,
  compose_project: 'portracker-qa-a', compose_service: 'web',
  internal: false, ...overrides,
});
const evidence = (overrides = {}) => ({
  containerId: 'a'.repeat(64), containerName: 'portracker-qa-a-web-1',
  image: 'nginx:alpine', networkMode: 'bridge',
  hostFingerprint: DAEMON, composeProject: 'portracker-qa-a',
  composeService: 'web', configFilePaths: ['/tmp/qa/compose.yaml'],
  projectWorkingDir: '/tmp/qa', ...overrides,
});

function fixture(callback) {
  const db = new Database(':memory:');
  try {
    const registry = createServiceRegistry(db);
    const provenance = createDockerProvenanceStore(db);
    return callback({ db, registry, provenance });
  } finally { db.close(); }
}

function observePair({ registry, provenance }, at = 100000, proxy = makeProxy(),
  docker = makeDocker()) {
  registry.reconcileSource({ source: 'system', rows: [proxy], complete: true, at });
  registry.reconcileSource({ source: 'docker', rows: [docker], complete: true, at });
  const service = registry.listServices({ source: 'docker' }).items[0];
  provenance.record(service.id, evidence({ containerId: docker.container_id }), at);
  return service;
}

describe('safe native docker-proxy and Docker history correlation', () => {
  test('one canonical card, accurate paging and both source filters', () =>
    fixture(({ registry, provenance, db }) => {
      const docker = observePair({ registry, provenance });
      expect(registry.listServices().total).toBe(2);
      expect(registry.linkDockerProxies(100000)).toBe(1);
      expect(registry.linkDockerProxies(100000)).toBe(0);
      expect(registry.listServices()).toMatchObject({
        total: 1, items: [{ id: docker.id, source: 'docker',
          sources: ['docker', 'system'] }],
      });
      expect(registry.listServices({ limit: 1, offset: 1 }).total).toBe(1);
      expect(registry.listServices({ limit: 1, offset: 1 }).items).toEqual([]);
      expect(registry.listServices({ portPrefix: '418' }).total).toBe(1);
      expect(registry.listServices({ source: 'docker' }).total).toBe(1);
      expect(registry.listServices({ source: 'system' }).total).toBe(1);
      expect(registry.getService(docker.id).sources).toEqual(['docker', 'system']);
      expect(db.prepare('SELECT COUNT(*) AS n FROM registry_source_links').get().n).toBe(1);
    }));

  test('complete shutdown and source failure never erase links or alter source status', () =>
    fixture(({ registry, provenance }) => {
      const docker = observePair({ registry, provenance });
      registry.linkDockerProxies(100000);
      registry.reconcileSource({ source: 'system', rows: [], complete: true, at: 110000 });
      registry.reconcileSource({ source: 'docker', rows: [], complete: true, at: 110000 });
      expect(registry.listServices({ status: 'offline' }).total).toBe(1);
      expect(registry.getService(docker.id).status).toBe('offline');
      expect(registry.listServices({ source: 'system', status: 'offline' }).total).toBe(1);
      registry.reconcileSource({
        source: 'docker', rows: [], complete: false, at: 120000,
        errorCode: 'collector_unavailable',
      });
      expect(registry.getService(docker.id).status).toBe('unknown');
      expect(registry.listServices({ status: 'unknown' }).total).toBe(1);
      expect(registry.listServices({ source: 'system', status: 'offline' }).total).toBe(1);
    }));

  test('pinned proxy or manually-authored recovery notes keep their own visible record', () =>
    fixture(({ registry, provenance, db }) => {
      const docker = observePair({ registry, provenance });
      registry.linkDockerProxies(100000);
      const system = registry.listServices({ source: 'system' }).items[0];
      registry.setPinned(system.id, true, 100001);
      expect(registry.listServices().total).toBe(2);
      expect(registry.listServices({ pinnedOnly: true }).items[0].id).toBe(system.id);
      registry.setPinned(system.id, false, 100002);
      expect(registry.listServices().total).toBe(1);
      db.prepare('INSERT INTO registry_recovery_notes (service_id, notes, revision) VALUES (?, ?, ?)')
        .run(system.id, 'important manual startup steps', 1);
      expect(registry.listServices().total).toBe(2);
      expect(registry.getService(docker.id).sources).toEqual(['docker', 'system']);
    }));

  test('unrelated process, mismatched IP and ambiguous Docker mappings never link', () =>
    fixture(({ registry, provenance }) => {
      observePair({ registry, provenance }, 100000, makeProxy(4183, { owner: 'python' }));
      expect(registry.linkDockerProxies(100000)).toBe(0);
      expect(registry.listServices().total).toBe(2);
    }));

  test('different binding IP and stale proxy observation cannot correlate', () =>
    fixture(({ registry, provenance }) => {
      observePair({ registry, provenance }, 100000,
        makeProxy(4183, { host_ip: '0.0.0.0' }));
      expect(registry.linkDockerProxies(100000)).toBe(0);
      expect(registry.listServices().total).toBe(2);
    }));

  test('two published ports belonging to one Docker app produce one card', () =>
    fixture(({ registry, provenance }) => {
      registry.reconcileSource({
        source: 'system', complete: true, at: 100000,
        rows: [makeProxy(4183), makeProxy(4184, { pid: 30002 })],
      });
      registry.reconcileSource({
        source: 'docker', complete: true, at: 100000,
        rows: [makeDocker(4183), makeDocker(4184)],
      });
      const docker = registry.listServices({ source: 'docker' }).items[0];
      provenance.record(docker.id, evidence(), 100000);
      expect(registry.linkDockerProxies(100000)).toBe(2);
      expect(registry.listServices().total).toBe(1);
      expect(registry.listServices({ source: 'system' }).total).toBe(2);
      expect(registry.getService(docker.id).endpoints.map(e => e.hostPort).sort())
        .toEqual([4183, 4184]);
    }));

  test('one Docker binding with multiple native proxy owners stays unlinked', () =>
    fixture(({ registry, provenance }) => {
      registry.reconcileSource({
        source: 'system', complete: true, at: 100000,
        rows: [makeProxy(4183), makeProxy(4183, { pid: 30002 })],
      });
      registry.reconcileSource({
        source: 'docker', complete: true, at: 100000,
        rows: [makeDocker()],
      });
      const docker = registry.listServices({ source: 'docker' }).items[0];
      provenance.record(docker.id, evidence(), 100000);
      expect(registry.linkDockerProxies(100000)).toBe(0);
      expect(registry.listServices().total).toBe(3);
    }));

  test('two Docker IDs on same endpoint are ambiguous and must not be linked', () =>
    fixture(({ registry, provenance }) => {
      registry.reconcileSource({
        source: 'system', rows: [makeProxy()], complete: true, at: 100000,
      });
      const rowA = makeDocker();
      const rowB = makeDocker(4183, {
        owner: 'another-container', container_id: 'b'.repeat(64),
        compose_project: 'another-project',
      });
      registry.reconcileSource({
        source: 'docker', rows: [rowA, rowB], complete: true, at: 100000,
      });
      for (const row of registry.listServices({ source: 'docker' }).items) {
        provenance.record(row.id, evidence({
          containerId: row.displayName === 'another-container' ? 'b'.repeat(64) : 'a'.repeat(64),
        }), 100000);
      }
      expect(registry.linkDockerProxies(100000)).toBe(0);
      expect(registry.listServices().total).toBe(3);
    }));

  test('scanner creates link after both complete source scans and keeps it across a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portracker-link-'));
    const filename = path.join(dir, 'test.sqlite');
    try {
      let db = new Database(filename);
      let registry = createServiceRegistry(db);
      let provenance = createDockerProvenanceStore(db);
      const scanner = createRegistryScanner({
        registry, dockerProvenanceStore: provenance, now: () => 100000,
        captureHost: async () => ({ source: 'system', complete: true, rows: [makeProxy()] }),
        captureDocker: async () => ({ source: 'docker', complete: true, rows: [
          { ...makeDocker(), docker_provenance: evidence() },
        ] }),
      });
      await scanner.scanOnce();
      expect(registry.listServices().total).toBe(1);
      const id = registry.listServices().items[0].id;
      expect(registry.getService(id).sources).toEqual(['docker', 'system']);
      db.close();
      db = new Database(filename);
      registry = createServiceRegistry(db);
      expect(registry.listServices().total).toBe(1);
      expect(registry.getService(id).sources).toEqual(['docker', 'system']);
      registry.forgetService(id);
      expect(registry.listServices().total).toBe(1);
      expect(registry.listServices().items[0].source).toBe('system');
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
