'use strict';

const { describe, expect, test } = require('@jest/globals');
const { createHttpMetadataWorker } = require('./http-worker');

describe('optional HTTP metadata worker', () => {
  test('disabled worker makes no network requests and leaves history untouched', async () => {
    const store = {
      getCandidates: () => { throw new Error('should never be called'); },
    };
    const worker = createHttpMetadataWorker({ store, enabled: false });
    expect(await worker.enrich()).toEqual({ attempted: 0 });
  });

  test('one HTTP failure is categorized without changing listener status', async () => {
    const calls = [];
    const store = {
      getCandidates: () => [{ service_id: 'one', host_port: 3000 },
        { service_id: 'two', host_port: 3001 }],
      recordFailure: (...args) => calls.push(['failed', ...args]),
      recordSuccess: (...args) => calls.push(['success', ...args]),
    };
    const worker = createHttpMetadataWorker({
      store, enabled: true, host: '127.0.0.1', now: () => 2000,
      probe: async ({ port }) => {
        if (port === 3000) throw Object.assign(new Error('SECRET_HOST_DATA'), { code: 'too_large' });
        return { title: 'Second Site', rootUrl: 'http://127.0.0.1:3001/' };
      },
    });
    expect(await worker.enrich()).toEqual({ attempted: 2 });
    expect(calls).toEqual([
      ['failed', 'one', 2000, 'too_large'],
      ['success', 'two', { title: 'Second Site', rootUrl: 'http://127.0.0.1:3001/' }, 2000],
    ]);
    expect(JSON.stringify(calls)).not.toContain('SECRET_HOST_DATA');
    expect(worker.getStatus()).toMatchObject({
      lastAttemptAt: 2000, lastSuccessAt: 2000,
      lastFailureCode: null,
    });
  });

  test('reports last successfully cached icon separately from title-only probes', async () => {
    const worker = createHttpMetadataWorker({
      enabled: true, host: '127.0.0.1', now: () => 46000,
      store: {
        getCandidates: () => [{ service_id: 'icon-service', host_port: 3000 }],
        recordSuccess: () => ({ iconHash: 'a'.repeat(64) }),
      },
      probe: async () => ({
        title: '', rootUrl: 'http://127.0.0.1:3000/',
        iconBytes: Buffer.from('icon-fixture'), iconType: 'image/png',
      }),
    });
    await worker.enrich();
    expect(worker.getStatus().lastIconSuccessAt).toBe(46000);
  });

  test('overlapping scan callbacks do not duplicate pending metadata requests', async () => {
    let resolve;
    const gate = new Promise(done => { resolve = done; });
    let calls = 0;
    const worker = createHttpMetadataWorker({
      store: {
        getCandidates: () => [{ service_id: 'one', host_port: 3000 }],
        recordFailure: () => {},
        recordSuccess: () => {},
      },
      enabled: true, host: '127.0.0.1',
      probe: async () => { calls++; await gate; return { title: 'Site',
        rootUrl: 'http://127.0.0.1:3000/' }; },
    });
    const first = worker.enrich();
    const second = worker.enrich();
    resolve();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

  test('unknown lower-level errors are replaced with stable codes', async () => {
    const failure = [];
    const worker = createHttpMetadataWorker({
      enabled: true, host: '127.0.0.1', now: () => 5000,
      store: {
        getCandidates: () => [{ service_id: 'one', host_port: 3000 }],
        recordFailure: (...args) => failure.push(args),
      },
      probe: async () => { throw new Error('http://localhost/private-secret?password=123'); },
    });
    await worker.enrich();
    expect(failure).toEqual([['one', 5000, 'network_error']]);
  });

  test('rejects unbounded concurrency and scan quotas', () => {
    const store = { getCandidates: () => [] };
    expect(() => createHttpMetadataWorker({ store, perCycle: 1000 })).toThrow();
    expect(() => createHttpMetadataWorker({ store, concurrency: 0 })).toThrow();
  });
});
