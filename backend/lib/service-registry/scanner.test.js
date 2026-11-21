'use strict';

const Database = require('better-sqlite3');
const { describe, test, expect } = require('@jest/globals');
const { createServiceRegistry } = require('./registry');
const { createRegistryScanner, readRegistryConfig } = require('./scanner');

function fixture(run) {
  const db = new Database(':memory:');
  let result;
  try { result = run(db, createServiceRegistry(db)); }
  catch (error) { db.close(); throw error; }
  if (result && typeof result.then === 'function') return result.finally(() => db.close());
  db.close();
  return result;
}

const system = (port, pid = 101) => ({
  source: 'system', protocol: 'tcp', host_ip: '127.0.0.1',
  host_port: port, owner: 'node', pid, internal: false,
});
const docker = (port, containerId = 'abc12345') => ({
  source: 'docker', protocol: 'tcp', host_ip: '0.0.0.0',
  host_port: port, owner: 'api', container_id: containerId, internal: false,
});

describe('authoritative source-scoped listener reconciliation', () => {
  test('complete snapshots transition only missing endpoints in the same source offline', () => fixture((_db, registry) => {
    registry.reconcileSource({ source: 'system', at: 1000, complete: true,
      rows: [system(3000, 101), system(3001, 202)] });
    registry.reconcileSource({ source: 'docker', at: 1000, complete: true,
      rows: [docker(8000)] });
    const ids = registry.listServices().items;
    registry.reconcileSource({ source: 'system', at: 2000, complete: true,
      rows: [system(3000, 101)] });
    expect(registry.getService(ids.find(row => row.displayName === 'api').id).status)
      .toBe('listening');
    expect(registry.listServices({ status: 'offline' }).total).toBe(1);
    expect(registry.listServices({ status: 'listening' }).total).toBe(2);
    expect(registry.getScanStatus()).toHaveLength(2);
    expect(registry.getScanStatus().find(row => row.source === 'system').lastSuccessAt).toBe(2000);
  }));

  test('failed or partial Docker coverage never marks system records offline', () => fixture((_db, registry) => {
    registry.reconcileSource({ source: 'docker', at: 1000, complete: true,
      rows: [docker(8000), docker(8001, 'def12345')] });
    registry.reconcileSource({ source: 'system', at: 1000, complete: true,
      rows: [system(3000)] });
    registry.reconcileSource({ source: 'docker', at: 2000, complete: false,
      rows: [docker(8000)], errorCode: 'untrusted_scan_scope' });
    expect(registry.listServices({ status: 'offline' }).total).toBe(0);
    expect(registry.listServices({ status: 'unknown' }).total).toBe(1);
    expect(registry.listServices({ status: 'listening' }).total).toBe(2);
    const state = registry.getScanStatus().find(row => row.source === 'docker');
    expect(state.outcome).toBe('partial');
    expect(state.lastSuccessAt).toBe(1000);
    expect(state.lastAttemptAt).toBe(2000);
  }));

  test('confirmed empty snapshot is offline, failed empty snapshot stays unknown', () => fixture((_db, registry) => {
    registry.reconcileSource({ source: 'system', complete: true, rows: [system(3000)], at: 1000 });
    registry.reconcileSource({ source: 'system', complete: false, rows: [],
      at: 2000, errorCode: 'collector_unavailable' });
    expect(registry.listServices({ status: 'unknown' }).total).toBe(1);
    registry.reconcileSource({ source: 'system', complete: true, rows: [], at: 3000 });
    expect(registry.listServices({ status: 'offline' }).total).toBe(1);
  }));

  test('resumed native service starts a new provisional episode after confirmed absence', () => fixture((_db, registry) => {
    registry.reconcileSource({ source: 'system', complete: true, rows: [system(3000)], at: 1000 });
    const first = registry.listServices().items[0];
    registry.reconcileSource({ source: 'system', complete: true, rows: [], at: 2000 });
    registry.reconcileSource({ source: 'system', complete: true, rows: [system(3000)], at: 3000 });
    expect(registry.listServices().total).toBe(2);
    expect(registry.getService(first.id).status).toBe('offline');
    expect(registry.listServices({ status: 'listening' }).total).toBe(1);
  }));

  test('service remains listening as long as one proven endpoint still listens', () => fixture((_db, registry) => {
    registry.reconcileSource({ source: 'system', complete: true,
      rows: [system(3000), system(3001)], at: 1000 });
    registry.reconcileSource({ source: 'system', complete: true, rows: [system(3001)], at: 2000 });
    expect(registry.listServices().total).toBe(1);
    expect(registry.listServices({ status: 'listening' }).total).toBe(1);
    expect(registry.getService(registry.listServices().items[0].id).endpoints).toHaveLength(2);
  }));

  test('invalid snapshot rolls back observations and offline transitions', () => fixture((_db, registry) => {
    registry.reconcileSource({ source: 'system', complete: true, rows: [system(3000)], at: 1000 });
    expect(() => registry.reconcileSource({ source: 'system', complete: true,
      rows: [system(4000), { source: 'system', error: 'scan failed' }], at: 2000 })).toThrow();
    expect(registry.listServices().total).toBe(1);
    expect(registry.listServices({ status: 'listening' }).total).toBe(1);
    expect(registry.getScanStatus()[0].lastAttemptAt).toBe(1000);
  }));

  test('restart marks old listeners unknown without deleting historic evidence', () => fixture((_db, registry) => {
    registry.reconcileSource({ source: 'system', complete: true, rows: [system(3000)], at: 1000 });
    registry.markStale();
    expect(registry.listServices({ status: 'unknown' }).total).toBe(1);
    expect(registry.listServices().items[0].lastSeenAt).toBe(1000);
  }));
});

describe('backend registry worker', () => {
  test('daemon configuration is opt-in, bounded and system-wide', () => {
    expect(readRegistryConfig({})).toEqual({ enabled: false, intervalMs: 30000 });
    expect(readRegistryConfig({ SERVICE_REGISTRY_ENABLED: 'true',
      SERVICE_REGISTRY_SCAN_INTERVAL_MS: '60000' })).toEqual({ enabled: true, intervalMs: 60000 });
    expect(() => readRegistryConfig({ SERVICE_REGISTRY_SCAN_INTERVAL_MS: '5' })).toThrow();
    expect(() => readRegistryConfig({ SERVICE_REGISTRY_SCAN_INTERVAL_MS: 'oops' })).toThrow();
  });

  test('one source failure leaves the other live and schedules safe unknown status', async () => fixture(async (_db, registry) => {
    const worker = createRegistryScanner({
      registry, now: () => 1000,
      captureHost: async () => ({ source: 'system', complete: true, rows: [system(3000)] }),
      captureDocker: async () => { throw new Error('fake secret Docker socket error'); },
    });
    const results = await worker.scanOnce();
    expect(results.map(r => r.outcome)).toEqual(['complete', 'failed']);
    expect(registry.listServices({ status: 'listening' }).total).toBe(1);
    expect(registry.getScanStatus().find(r => r.source === 'docker').errorCode)
      .toBe('collector_unavailable');
  }));

  test('concurrent requests share a single scan and do not overlap collectors', async () => fixture(async (_db, registry) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let calls = 0;
    const worker = createRegistryScanner({
      registry, now: () => 1000,
      captureHost: async () => { calls++; await gate; return {
        source: 'system', complete: true, rows: [system(3000)],
      }; },
      captureDocker: async () => ({ source: 'docker', complete: true, rows: [] }),
    });
    const first = worker.scanOnce();
    const second = worker.scanOnce();
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(registry.listServices().total).toBe(1);
  }));

  test('disabled worker schedules nothing; enabled worker schedules and can stop', () => fixture((_db, registry) => {
    const scheduled = [];
    const cancelled = [];
    const create = enabled => createRegistryScanner({
      registry, enabled, schedule: (fn, ms) => {
        const timer = { fn, ms };
        scheduled.push(timer);
        return timer;
      }, cancel: timer => cancelled.push(timer),
    });
    expect(create(false).start()).toBe(false);
    expect(scheduled).toHaveLength(0);
    const enabled = create(true);
    expect(enabled.start()).toBe(true);
    expect(enabled.start()).toBe(false);
    expect(scheduled[0].ms).toBe(0);
    enabled.stop();
    expect(cancelled).toEqual([scheduled[0]]);
  }));
});
