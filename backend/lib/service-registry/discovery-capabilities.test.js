'use strict';

const { describe, expect, test } = require('@jest/globals');
const { readDiscoveryCapabilities } = require('./discovery-capabilities');

describe('safe discovery capability reporting', () => {
  const http = { requested: true, enabled: true, mode: 'docker_gateway', reason: null };

  test('distinguishes configured private probe from any confirmed success', () => {
    const cap = readDiscoveryCapabilities({
      scanEnabled: true, scanSources: [], http,
      dockerHost: 'tcp://docker-api-proxy:2375',
    });
    expect(cap.http).toMatchObject({
      requested: true, configured: true, available: null,
      lastSuccessAt: null, mode: 'docker_gateway',
    });
    expect(cap.docker).toMatchObject({
      requested: true, configured: true, available: false,
      reason: 'awaiting_first_scan', mode: 'restricted_proxy',
    });
    expect(JSON.stringify(cap)).not.toContain('172.18.0.1');
  });

  test('reports confirmed Docker and successful metadata independently', () => {
    const worker = { getStatus: () => ({
      lastAttemptAt: 200, lastSuccessAt: 190, lastFailureCode: 'network_error',
    }) };
    const cap = readDiscoveryCapabilities({
      scanEnabled: true, scanSources: [
        { source: 'system', outcome: 'failed' },
        { source: 'docker', outcome: 'complete', lastAttemptAt: 200, lastSuccessAt: 200 },
      ], http, httpWorker: worker,
    });
    expect(cap.docker).toMatchObject({ available: true, reason: null, lastSuccessAt: 200 });
    expect(cap.http).toMatchObject({ available: true, lastSuccessAt: 190 });
  });

  test('exposes a timestamp for cached icons without private paths or URLs', () => {
    const cap = readDiscoveryCapabilities({
      scanEnabled: true, http,
      httpWorker: { getStatus: () => ({
        lastAttemptAt: 230, lastSuccessAt: 225,
        lastIconSuccessAt: 220, lastFailureCode: 'no_metadata',
      }) },
    });
    expect(cap.http).toMatchObject({
      lastIconSuccessAt: 220, lastSuccessAt: 225,
      lastFailureCode: 'no_metadata',
    });
    expect(JSON.stringify(cap)).not.toContain('127.0.0.1');
  });

  test('a failed Docker scan cannot mark successful HTTP probes or native history unavailable', () => {
    const cap = readDiscoveryCapabilities({
      scanEnabled: true, scanSources: [
        { source: 'system', outcome: 'complete', lastSuccessAt: 300 },
        { source: 'docker', outcome: 'failed', lastSuccessAt: 100 },
      ], http, httpWorker: { getStatus: () => ({ lastSuccessAt: 200 }) },
      dockerHost: 'tcp://docker-api-proxy:2375',
    });
    expect(cap.docker).toMatchObject({
      available: false, reason: 'docker_api_unavailable', lastSuccessAt: 100,
    });
    expect(cap.http.available).toBe(true);
  });

  test('disabled and absent safe routes have useful reason without secret paths', () => {
    const cap = readDiscoveryCapabilities({
      scanEnabled: true,
      http: { requested: true, enabled: false, mode: 'docker_gateway',
        reason: 'gateway_unavailable' },
      dockerHost: 'tcp://username:secret@192.168.0.2:2375',
    });
    expect(cap.http).toMatchObject({
      requested: true, configured: false, reason: 'gateway_unavailable',
    });
    expect(cap.docker.mode).toBe('custom_endpoint');
    expect(JSON.stringify(cap)).not.toContain('secret');
  });
});
