const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { parse } = require('@babel/parser');
const express = require('express');
const { afterAll, afterEach, describe, expect, jest: jestMock, test } = require('@jest/globals');

jestMock.mock('../db', () => {
  const Database = require('better-sqlite3');
  return new Database(':memory:');
});
jestMock.mock('../lib/api-key-manager', () => ({
  validateAnyApiKey: async key => ({ valid: key === 'synthetic-peer', serverId: 'local' }),
}));
const db = require('../db');
const auth = require('../middleware/auth');
const handlers = require('./services');
const dao = require('../lib/overrides');
const originalAuth = process.env.ENABLE_AUTH;
const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const registrations = parse(source, { sourceType: 'unambiguous' }).program.body
  .filter(node => node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression')
  .map(node => node.expression)
  .filter(call => call.callee.object?.name === 'app' &&
    (call.arguments[0]?.value === '/api/services' || call.arguments[0]?.value === '/api/overrides' ||
      call.arguments[0]?.value?.endsWith('/role') || call.arguments[0]?.value?.endsWith('/overrides')))
  .map(call => ({ method: call.callee.property.name, route: call.arguments[0].value,
    guard: call.arguments[1].name, factory: call.arguments[2].callee.property.name }));
const mutations = registrations.filter(entry => entry.method !== 'get');
const reads = registrations.filter(entry => entry.method === 'get');
const logger = { error: jestMock.fn(), debug: jestMock.fn(), setDebugEnabled: jestMock.fn() };
let server;

async function invoke(entry, identity) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.headers['x-test-session'] === 'owner') req.session = { userId: 'synthetic-owner' };
    next();
  });
  app.use(auth.requireAllowedOrigin);
  for (const route of registrations) app[route.method](route.route, auth[route.guard], handlers[route.factory]({
    logger, getLocalPortsUsingCollectors: async () => [], dockerApi: null, baseDebug: false,
  }));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const headers = { 'Content-Type': 'application/json' };
  if (identity === 'session') headers['x-test-session'] = 'owner';
  if (identity === 'peer') headers['x-api-key'] = 'synthetic-peer';
  if (identity === 'wrong') headers['x-api-key'] = 'synthetic-wrong-peer';
  const route = entry.route.replace(':serviceId', 'service-a').replace(':componentId', 'component-a');
  const response = await fetch('http://127.0.0.1:' + server.address().port + route, {
    method: entry.method.toUpperCase(), headers,
    ...(entry.method === 'put' ? { body: JSON.stringify({ role: 'job_expected_exit' }) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); server = null; }
  db.exec('DELETE FROM component_overrides');
  if (originalAuth === undefined) delete process.env.ENABLE_AUTH;
  else process.env.ENABLE_AUTH = originalAuth;
});
afterAll(() => db.close());

describe('health override authorization', () => {
  test('registered override mutations require sessions while peer reads remain available', () => {
    expect(mutations).toHaveLength(4);
    expect(reads).toHaveLength(2);
    for (const entry of mutations) expect(entry.guard).toBe('requireAuth');
    for (const entry of reads) expect(entry.guard).toBe('requireAuthOrApiKey');
  });
  for (const entry of mutations) {
    test.each(['anonymous', 'wrong', 'peer', 'session'])(entry.method + ' ' + entry.route + ' with %s', async identity => {
      process.env.ENABLE_AUTH = 'true';
      if (entry.method === 'delete') dao.setOverride('local', 'service-a', 'component-a', 'support');
      const before = dao.listOverridesForServer('local');
      const response = await invoke(entry, identity);
      if (identity === 'session') {
        expect(response.status).toBe(200);
        if (entry.method === 'put') expect(dao.getOverridesForServer('local')['component-a']).toBe('job_expected_exit');
        else expect(dao.listOverridesForServer('local')).toHaveLength(0);
      } else {
        expect(response.status).toBe(401);
        expect(dao.listOverridesForServer('local')).toEqual(before);
      }
    });
    test(entry.method + ' ' + entry.route + ' preserves auth-disabled operation', async () => {
      process.env.ENABLE_AUTH = 'false';
      if (entry.method === 'delete') dao.setOverride('local', 'service-a', 'component-a', 'support');
      expect((await invoke(entry, 'anonymous')).status).toBe(200);
    });
  }
  for (const entry of reads) {
    test.each(['anonymous', 'wrong', 'peer', 'session'])('read ' + entry.route + ' with %s', async identity => {
      process.env.ENABLE_AUTH = 'true';
      const response = await invoke(entry, identity);
      expect(response.status).toBe(['peer', 'session'].includes(identity) ? 200 : 401);
    });
  }
});
