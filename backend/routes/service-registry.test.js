'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const { describe, test, expect, afterAll } = require('@jest/globals');
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = ':memory:';
const { createServiceRegistry } = require('../lib/service-registry/registry');
const { createHttpMetadataStore } = require('../lib/service-registry/http-store');
const { createLinuxProvenanceStore } = require('../lib/service-registry/linux-provenance-store');
const { createDockerProvenanceStore } = require('../lib/service-registry/docker-provenance-store');
const { createRegistryRouter } = require('./service-registry');
const sharedDb = require('../db');

afterAll(() => {
  sharedDb.close();
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

async function withServer(run) {
  const oldAuth = process.env.ENABLE_AUTH;
  const db = new Database(':memory:');
  const registry = createServiceRegistry(db);
  const httpStore = createHttpMetadataStore(db);
  const provenanceStore = createLinuxProvenanceStore(db);
  const dockerProvenanceStore = createDockerProvenanceStore(db);
  const app = express();
  app.use('/api/service-registry', createRegistryRouter(registry, { httpStore, provenanceStore, dockerProvenanceStore }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    return await run({
      registry,
      httpStore,
      provenanceStore,
      dockerProvenanceStore,
      url: 'http://127.0.0.1:' + server.address().port + '/api/service-registry',
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    if (oldAuth === undefined) delete process.env.ENABLE_AUTH;
    else process.env.ENABLE_AUTH = oldAuth;
  }
}

describe('registry REST API authorization and validation', () => {
  test('list/detail/forget are scoped to saved service IDs', async () => withServer(async ({ registry, url }) => {
    process.env.ENABLE_AUTH = 'false';
    const record = registry.observe({
      host_ip: '127.0.0.1', host_port: 3000, protocol: 'tcp', owner: 'node', pid: 123,
    });

    const list = await fetch(url);
    expect(list.status).toBe(200);
    expect((await list.json()).total).toBe(1);

    const detail = await fetch(url + '/' + record.id);
    expect(detail.status).toBe(200);
    expect((await detail.json()).endpoints[0].hostPort).toBe(3000);

    const scanStatus = await fetch(url + '/scan-status');
    expect(scanStatus.status).toBe(200);
    expect(await scanStatus.json()).toEqual({ enabled: false, sources: [] });

    const invalid = await fetch(url + '?limit=1000');
    expect(invalid.status).toBe(400);

    const deleted = await fetch(url + '/' + record.id, { method: 'DELETE' });
    expect(deleted.status).toBe(204);
    expect((await fetch(url + '/' + record.id)).status).toBe(404);
  }));

  test('history reads and destructive forget require auth when configured', async () => withServer(async ({ registry, url }) => {
    process.env.ENABLE_AUTH = 'true';
    const record = registry.observe({
      host_ip: '127.0.0.1', host_port: 3000, protocol: 'tcp', owner: 'node', pid: 123,
    });
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url + '/' + record.id)).status).toBe(401);
    expect((await fetch(url + '/scan-status')).status).toBe(401);
    expect((await fetch(url + '/icons/' + 'a'.repeat(64))).status).toBe(401);
    expect((await fetch(url + '/' + record.id, { method: 'DELETE' })).status).toBe(401);
    expect(registry.getService(record.id)).not.toBeNull();
  }));
});

describe('cached HTTP metadata routes', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WkW3+IAAAAASUVORK5CYII=',
    'base64'
  );
  test('history returns verified title and safely served local icon', async () => withServer(async ({ registry, httpStore, url }) => {
    process.env.ENABLE_AUTH = 'false';
    const service = registry.observe({
      host_ip: '127.0.0.1', host_port: 3000, owner: 'node', pid: 555, protocol: 'tcp',
    });
    const meta = httpStore.recordSuccess(service.id, {
      title: 'Real HTML Title',
      rootUrl: 'http://127.0.0.1:3000/',
      iconBytes: PNG,
      iconType: 'image/png',
    }, Date.now());
    const list = await fetch(url);
    expect((await list.json()).items[0].httpTitle).toBe('Real HTML Title');
    const details = await fetch(url + '/' + service.id);
    expect((await details.json()).iconHash).toBe(meta.iconHash);
    const image = await fetch(url + '/icons/' + meta.iconHash);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toContain('image/png');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await image.arrayBuffer()).equals(PNG)).toBe(true);
    const invalid = await fetch(url + '/icons/not-a-hash');
    expect(invalid.status).toBe(404);
  }));
});


describe('private Linux provenance API', () => {
  test('never leaks cwd or executable when global authentication is disabled', async () => withServer(
    async ({ registry, provenanceStore, url }) => {
      process.env.ENABLE_AUTH = 'false';
      const service = registry.observe({
        host_ip: '127.0.0.1', host_port: 3000, protocol: 'tcp',
        source: 'system', owner: 'node', pid: 987,
      });
      provenanceStore.record(service.id, {
        kind: 'systemd_user_service', confidence: 'observed',
        unitName: 'dev.service', unitScope: 'user',
        pid: 987, startTicks: '998877', uid: 1000,
        cwd: '/home/dev/private-project', executablePath: '/nix/store/secret/bin/node',
      }, Date.now());
      const response = await fetch(url + '/' + service.id);
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).not.toHaveProperty('linuxProvenance');
      expect(JSON.stringify(result)).not.toContain('private-project');
      const list = await fetch(url);
      expect(JSON.stringify(await list.json())).not.toContain('private-project');

      process.env.ENABLE_AUTH = 'true';
      expect((await fetch(url + '/' + service.id)).status).toBe(401);
    }
  ));
});


describe('private Docker/Compose provenance API', () => {
  test('anonymous history never exposes saved Docker host paths', async () => withServer(
    async ({ registry, dockerProvenanceStore, url }) => {
      process.env.ENABLE_AUTH = 'false';
      const service = registry.observe({
        host_ip: '0.0.0.0', host_port: 8080, protocol: 'tcp',
        source: 'docker', container_id: 'a'.repeat(12), owner: 'demo-web',
      });
      dockerProvenanceStore.record(service.id, {
        containerId: 'a'.repeat(64), containerName: 'demo-web-1',
        image: 'nginx:stable', networkMode: 'bridge',
        composeProject: 'demo', composeService: 'web',
        projectWorkingDir: '/home/private/secret project',
        configFilePaths: ['/home/private/secret project/docker-compose.yml'],
        hostFingerprint: 'b'.repeat(64),
      });
      const response = await fetch(url + '/' + service.id);
      expect(response.status).toBe(200);
      const details = await response.json();
      expect(details).not.toHaveProperty('dockerProvenance');
      expect(JSON.stringify(details)).not.toContain('secret project');
      expect(JSON.stringify(await (await fetch(url)).json())).not.toContain('secret project');
      process.env.ENABLE_AUTH = 'true';
      expect((await fetch(url + '/' + service.id)).status).toBe(401);
    }
  ));
});
