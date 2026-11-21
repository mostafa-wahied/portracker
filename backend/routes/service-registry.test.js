'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const { describe, test, expect, afterAll } = require('@jest/globals');
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = ':memory:';
const { createServiceRegistry } = require('../lib/service-registry/registry');
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
  const app = express();
  app.use('/api/service-registry', createRegistryRouter(registry));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    return await run({
      registry,
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
    expect((await fetch(url + '/' + record.id, { method: 'DELETE' })).status).toBe(401);
    expect(registry.getService(record.id)).not.toBeNull();
  }));
});
