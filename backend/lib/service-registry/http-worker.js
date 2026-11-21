'use strict';

const { probeWebMetadata } = require('./http-probe');

function createHttpMetadataWorker({
  store,
  enabled = false,
  host = null,
  probe = probeWebMetadata,
  now = Date.now,
  logger = { warn() {} },
  concurrency = 2,
  perCycle = 4,
}) {
  if (!store || typeof store.getCandidates !== 'function') {
    throw new TypeError('Metadata storage is required');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4 ||
      !Number.isInteger(perCycle) || perCycle < 1 || perCycle > 16) {
    throw new TypeError('Invalid metadata worker limits');
  }

  let running = null;
  const status = { lastAttemptAt: null, lastSuccessAt: null,
    lastIconSuccessAt: null, lastFailureCode: null };
  async function enrich() {
    if (!enabled || !host) return { attempted: 0 };
    if (running) return running;
    const job = (async () => {
      const candidates = store.getCandidates({ at: now(), limit: perCycle });
      let completed = 0;
      for (let cursor = 0; cursor < candidates.length; cursor += concurrency) {
        const batch = candidates.slice(cursor, cursor + concurrency);
        await Promise.all(batch.map(async ({ service_id: serviceId, host_port: port }) => {
          try {
            status.lastAttemptAt = now();
            const data = await probe({ host, port });
            const saved = store.recordSuccess(serviceId, data, now());
            status.lastSuccessAt = now();
            if (saved?.iconHash && data.iconBytes) status.lastIconSuccessAt = now();
            status.lastFailureCode = null;
          } catch (error) {
            // Only stable, allowlisted categories are saved; raw errors may
            // contain private host paths or URLs and are never exposed.
            const category = ['not_html', 'no_metadata', 'timeout', 'too_large',
              'external_redirect', 'tls_untrusted', 'blocked_target'].includes(error?.code)
              ? error.code : 'network_error';
            store.recordFailure(serviceId, now(), category);
            status.lastFailureCode = category;
          } finally {
            completed++;
          }
        }));
      }
      return { attempted: completed };
    })();
    running = job;
    try { return await job; }
    catch {
      logger.warn('HTTP metadata collector unavailable');
      return { attempted: 0 };
    } finally { running = null; }
  }

  return { enrich, getStatus: () => ({ ...status }) };
}

module.exports = { createHttpMetadataWorker };
