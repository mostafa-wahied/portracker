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
const { createRecoveryNotesStore } = require('../lib/service-registry/recovery-notes');
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
  const recoveryNotesStore = createRecoveryNotesStore(db);
  const app = express();
  app.use(express.json());
  app.use('/api/service-registry', createRegistryRouter(registry, { httpStore, provenanceStore, dockerProvenanceStore, recoveryNotesStore }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    return await run({
      registry,
      httpStore,
      provenanceStore,
      dockerProvenanceStore,
      recoveryNotesStore,
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

    const prefix = await fetch(url + '?portPrefix=30');
    expect(prefix.status).toBe(200);
    expect((await prefix.json()).total).toBe(1);
    expect((await fetch(url + '?portPrefix=4')).status).toBe(200);
    expect((await fetch(url + '?portPrefix=12%25')).status).toBe(400);
    expect((await fetch(url + '?port=3000&portPrefix=30')).status).toBe(400);

    const invalid = await fetch(url + '?limit=1000');
    expect(invalid.status).toBe(400);

    const deleted = await fetch(url + '/' + record.id, { method: 'DELETE' });
    expect(deleted.status).toBe(204);
    expect((await fetch(url + '/' + record.id)).status).toBe(404);
  }));

  test('pin API updates persisted record and filters pinned-only results', async () => withServer(
    async ({ registry, url }) => {
      process.env.ENABLE_AUTH = 'false';
      const first = registry.observe({
        host_ip: '127.0.0.1', host_port: 4177, protocol: 'tcp',
        owner: 'python3', source: 'system', pid: 111,
      });
      const other = registry.observe({
        host_ip: '127.0.0.1', host_port: 4180, protocol: 'tcp',
        owner: 'node', source: 'system', pid: 222,
      });
      expect((await (await fetch(url + '?pinnedOnly=true')).json()).total).toBe(0);
      const put = async (id, payload) => fetch(url + '/' + id + '/pin', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const response = await put(first.id, { pinned: true });
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toMatchObject({ id: first.id, pinned: true });
      expect(typeof result.pinnedAt).toBe('number');
      const repeat = await put(first.id, { pinned: true });
      expect((await repeat.json()).pinnedAt).toBe(result.pinnedAt);
      const listed = await (await fetch(url + '?pinnedOnly=true')).json();
      expect(listed.items.map(s => s.id)).toEqual([first.id]);
      expect(listed.items[0].pinned).toBe(true);
      expect((await (await fetch(url + '/' + first.id)).json()).pinned).toBe(true);
      expect((await (await fetch(url)).json()).total).toBe(2);
      expect((await fetch(url + '?pinnedOnly=yes')).status).toBe(400);
      expect((await put(first.id, { pinned: 'true' })).status).toBe(400);
      expect((await put(first.id, { pinned: null })).status).toBe(400);
      expect((await put('missing', { pinned: true })).status).toBe(404);
      expect((await put(first.id, { pinned: false })).status).toBe(200);
      expect((await (await fetch(url + '?pinnedOnly=true')).json()).total).toBe(0);
      expect(registry.getService(other.id).pinned).toBe(false);
    }
  ));

  test('manual POST requires authentication and opt-in; GET refresh never scans', async () => withServer(
    async ({ url }) => {
      process.env.ENABLE_AUTH = 'false';
      const denied = await fetch(url + '/scan', { method: 'POST' });
      expect(denied.status).toBe(403);
      const refresh = await fetch(url + '/scan-status');
      expect(refresh.status).toBe(200);
      expect((await refresh.json()).enabled).toBe(false);
      process.env.ENABLE_AUTH = 'true';
      expect((await fetch(url + '/scan', { method: 'POST' })).status).toBe(401);
    }
  ));

  test('history reads and destructive forget require auth when configured', async () => withServer(async ({ registry, url }) => {
    process.env.ENABLE_AUTH = 'true';
    const record = registry.observe({
      host_ip: '127.0.0.1', host_port: 3000, protocol: 'tcp', owner: 'node', pid: 123,
    });
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url + '/' + record.id)).status).toBe(401);
    expect((await fetch(url + '/scan-status')).status).toBe(401);
    expect((await fetch(url + '?pinnedOnly=true')).status).toBe(401);
    expect((await fetch(url + '/' + record.id + '/pin', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    })).status).toBe(401);
    expect((await fetch(url + '/icons/' + 'a'.repeat(64))).status).toBe(401);
    expect((await fetch(url + '/' + record.id, { method: 'DELETE' })).status).toBe(401);
    expect(registry.getService(record.id)).not.toBeNull();
  }));
});


describe('grouped pinned service API', () => {
  test('groups verified Compose siblings after filtering; paginates groups, not ports', async () =>
    withServer(async ({ registry, dockerProvenanceStore, url }) => {
      process.env.ENABLE_AUTH = 'false';
      const daemon = 'd'.repeat(64);
      const create = (name, number, project = 'alpha') => {
        const item = registry.observe({
          host_ip: '127.0.0.1', host_port: number, protocol: 'tcp',
          source: 'docker', owner: name, container_id: String(number).repeat(12),
        });
        dockerProvenanceStore.record(item.id, {
          containerId: 'a'.repeat(64), containerName: name, image: 'nginx:stable',
          composeProject: project, composeService: name,
          hostFingerprint: daemon, projectWorkingDir: '/private/not-in-list',
        });
        registry.setPinned(item.id, true, 500);
        return item;
      };
      const a = create('web', 4181);
      const b = create('worker', 4183);
      const c = create('other', 4184, 'bravo');
      const one = await (await fetch(url + '/pinned-groups?limit=1')).json();
      const all = await (await fetch(url + '/pinned-groups')).json();
      expect(all).toMatchObject({ total: 2, serviceTotal: 3 });
      expect(one.items).toHaveLength(1);
      expect(all.items.find(g => g.name === 'alpha').services.map(s => s.id).sort())
        .toEqual([a.id, b.id].sort());
      expect(all.items.find(g => g.name === 'alpha').ports.map(p => p.port))
        .toEqual([4181, 4183]);
      expect(all.items.find(g => g.name === 'bravo').services[0].id).toBe(c.id);
      expect(JSON.stringify(all)).not.toContain('/private/not-in-list');
      expect((await (await fetch(url + '/pinned-groups?limit=1&offset=1')).json()).items)
        .toHaveLength(1);
      expect((await (await fetch(url + '/pinned-groups?portPrefix=4181')).json()).total)
        .toBe(1);
      expect((await (await fetch(url + '/pinned-groups?source=system')).json()).total)
        .toBe(0);
      expect((await fetch(url + '/pinned-groups?limit=101')).status).toBe(400);
      expect((await fetch(url + '/pinned-groups?portPrefix=oops')).status).toBe(400);
    }));

  test('group endpoint is private and preserves independent pin updates', async () =>
    withServer(async ({ registry, url }) => {
      process.env.ENABLE_AUTH = 'false';
      const a = registry.observe({
        host_ip: '127.0.0.1', host_port: 3777, protocol: 'tcp',
        source: 'system', owner: 'node', pid: 1,
      });
      const b = registry.observe({
        host_ip: '127.0.0.1', host_port: 3778, protocol: 'tcp',
        source: 'system', owner: 'node', pid: 2,
      });
      registry.setPinned(a.id, true, 1500);
      registry.setPinned(b.id, true, 1500);
      expect((await (await fetch(url + '/pinned-groups')).json()).total).toBe(2);
      registry.setPinned(a.id, false, 1600);
      expect((await (await fetch(url + '/pinned-groups')).json()).total).toBe(1);
      expect(registry.getService(b.id).pinned).toBe(true);
      process.env.ENABLE_AUTH = 'true';
      expect((await fetch(url + '/pinned-groups')).status).toBe(401);
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


describe('authenticated recovery notes API', () => {
  test('anonymous dashboard cannot read hints or submit notes', async () => withServer(
    async ({ registry, recoveryNotesStore, url }) => {
      process.env.ENABLE_AUTH = 'false';
      const service = registry.observe({
        host_ip: '127.0.0.1', host_port: 3000, protocol: 'tcp',
        source: 'system', owner: 'node', pid: 999,
      });
      recoveryNotesStore.saveNotes(service.id, 'private recovery command', 0);
      const read = await fetch(url + '/' + service.id);
      expect(read.status).toBe(200);
      const detail = await read.json();
      expect(detail).not.toHaveProperty('recovery');
      expect(JSON.stringify(detail)).not.toContain('private recovery command');

      const denied = await fetch(url + '/' + service.id + '/recovery-notes', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'new', version: 1 }),
      });
      expect(denied.status).toBe(403);
      expect(recoveryNotesStore.get(service.id).text).toBe('private recovery command');
      recoveryNotesStore.saveStart(service.id, 'cd /secret && pnpm dev', '/home/private', 0);
      const hidden = await (await fetch(url + '/' + service.id)).json();
      expect(JSON.stringify(hidden)).not.toContain('cd /secret');
      const startDenied = await fetch(url + '/' + service.id + '/recovery-start', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'echo test', cwd: '', version: 1 }),
      });
      expect(startDenied.status).toBe(403);
      expect(recoveryNotesStore.getStart(service.id).command).toContain('/secret');

      process.env.ENABLE_AUTH = 'true';
      expect((await fetch(url + '/' + service.id)).status).toBe(401);
      expect((await fetch(url + '/' + service.id + '/recovery-notes', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'new', version: 1 }),
      })).status).toBe(401);
      expect((await fetch(url + '/' + service.id + '/recovery-start', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'test', cwd: '', version: 1 }),
      })).status).toBe(401);
    }
  ));
});
