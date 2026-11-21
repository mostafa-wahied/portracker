'use strict';

const { captureHostTcp, captureDockerPublished } = require('./snapshot');

function readRegistryConfig(env = process.env) {
  const enabled = env.SERVICE_REGISTRY_ENABLED === 'true';
  const rawInterval = env.SERVICE_REGISTRY_SCAN_INTERVAL_MS || '30000';
  if (!/^[1-9]\d*$/.test(rawInterval)) {
    throw new TypeError('Invalid SERVICE_REGISTRY_SCAN_INTERVAL_MS');
  }
  const intervalMs = Number(rawInterval);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 10000 || intervalMs > 3600000) {
    throw new TypeError('SERVICE_REGISTRY_SCAN_INTERVAL_MS must be 10000–3600000');
  }
  return { enabled, intervalMs };
}

/**
 * Backend-owned, single-flight scanner. Never takes collector data from the
 * browser or the merged /api/ports payload. A collector failure is source-
 * scoped; it never makes *another* source's services disappear.
 */
function createRegistryScanner({
  registry,
  captureHost = captureHostTcp,
  captureDocker = captureDockerPublished,
  enabled = false,
  intervalMs = 30000,
  logger = { info() {}, warn() {} },
  schedule = setTimeout,
  cancel = clearTimeout,
  now = Date.now,
  random = Math.random,
}) {
  if (!registry || typeof registry.reconcileSource !== 'function') {
    throw new TypeError('A service registry with reconciliation is required');
  }

  const sources = [
    { name: 'system', capture: captureHost },
    { name: 'docker', capture: captureDocker },
  ];
  let timer = null;
  let stopped = true;
  let running = null;
  const sourceFailures = new Map();
  const retryAfter = new Map();

  async function runOnce() {
    if (running) return running;
    const job = (async () => {
      const results = [];
      for (const source of sources) {
        const at = now();
        if (at < (retryAfter.get(source.name) || 0)) continue;
        try {
          const snapshot = await source.capture();
          if (!snapshot || snapshot.source !== source.name ||
              !Array.isArray(snapshot.rows) || typeof snapshot.complete !== 'boolean') {
            throw new TypeError('Malformed scan snapshot');
          }
          const result = registry.reconcileSource({
            serverId: 'local',
            source: source.name,
            rows: snapshot.rows,
            complete: snapshot.complete,
            at,
            errorCode: snapshot.complete ? null : 'untrusted_scan_scope',
          });
          results.push(result);
          sourceFailures.set(source.name, 0);
          retryAfter.delete(source.name);
        } catch {
          // Don't include raw collector errors; Docker or proc failures may
          // contain private filesystem paths and connection information.
          logger.warn('Service registry collection unavailable for ' + source.name);
          registry.reconcileSource({
            serverId: 'local',
            source: source.name,
            rows: [],
            complete: false,
            at,
            errorCode: 'collector_unavailable',
          });
          results.push({ source: source.name, outcome: 'failed', count: 0, at });
          const failures = Math.min((sourceFailures.get(source.name) || 0) + 1, 5);
          sourceFailures.set(source.name, failures);
          retryAfter.set(source.name, at + Math.min(intervalMs * Math.pow(2, failures), 3600000));
        }
      }
      return results;
    })();
    running = job;
    try { return await job; }
    finally { running = null; }
  }

  function queue(delay) {
    if (stopped) return;
    timer = schedule(async () => {
      timer = null;
      try { await runOnce(); }
      catch { logger.warn('Service registry scan cycle failed'); }
      if (!stopped) queue(intervalMs + Math.floor(intervalMs * 0.05 * random()));
    }, delay);
    timer?.unref?.();
  }

  function start() {
    if (!enabled || !stopped) return false;
    stopped = false;
    registry.markStale('local');
    logger.info('Service registry discovery enabled');
    queue(0);
    return true;
  }

  function stop() {
    stopped = true;
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  }

  return { start, stop, scanOnce: runOnce };
}

module.exports = { createRegistryScanner, readRegistryConfig };
