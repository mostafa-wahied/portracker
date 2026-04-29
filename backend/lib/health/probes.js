'use strict';

const net = require('net');
const dgram = require('dgram');
const http = require('http');
const https = require('https');

const DEFAULT_TIMEOUT_MS = 2000;
const MAX_BODY_BYTES = 8192;

function normalizeResult(ok, latencyMs, evidence, error) {
  return {
    ok: Boolean(ok),
    latencyMs: latencyMs == null ? null : Math.max(0, Math.round(latencyMs)),
    evidence: evidence || {},
    error: error || null,
  };
}

function resolveTimeout(opts) {
  const v = opts && Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  return Math.max(50, Math.min(v, 30000));
}

function httpRequestOnce(scheme, host, port, path, method, timeoutMs, allowInsecure) {
  return new Promise((resolve) => {
    const started = Date.now();
    const lib = scheme === 'https' ? https : http;
    const opts = {
      host,
      port,
      path: path || '/',
      method,
      timeout: timeoutMs,
      headers: { 'User-Agent': 'PortTracker/1.0', 'Accept': '*/*' },
    };
    if (scheme === 'https' && allowInsecure) opts.rejectUnauthorized = false;
    let settled = false;
    const req = lib.request(opts, (res) => {
      const statusCode = res.statusCode || 0;
      let bytes = 0;
      const chunks = [];
      res.on('data', (c) => {
        bytes += c.length;
        if (chunks.length < 4 && bytes <= MAX_BODY_BYTES) chunks.push(c);
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        const latency = Date.now() - started;
        const headers = res.headers || {};
        const body = Buffer.concat(chunks).toString('utf8').slice(0, MAX_BODY_BYTES);
        resolve({ statusCode, latency, headers, body, bytes });
      });
      res.on('error', (err) => {
        if (settled) return;
        settled = true;
        resolve({ error: err.message, latency: Date.now() - started });
      });
      res.resume();
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ error: err.message, latency: Date.now() - started });
    });
    req.on('timeout', () => {
      if (settled) return;
      settled = true;
      try { req.destroy(new Error('timeout')); } catch (_e) { void _e; }
      resolve({ error: 'timeout', latency: Date.now() - started });
    });
    req.end();
  });
}

async function probeHttpLike(scheme, host, port, opts) {
  const timeoutMs = resolveTimeout(opts);
  const path = (opts && opts.path) || '/';
  const allowInsecure = scheme === 'https' && !(opts && opts.strictTls);
  const started = Date.now();

  const head = await httpRequestOnce(scheme, host, port, path, 'HEAD', timeoutMs, allowInsecure);
  if (head && head.statusCode && head.statusCode < 500 && head.statusCode !== 404) {
    return normalizeResult(true, head.latency, {
      protocol: scheme,
      method: 'HEAD',
      statusCode: head.statusCode,
      url: `${scheme}://${host}:${port}${path}`,
    }, null);
  }

  const remaining = Math.max(50, timeoutMs - (Date.now() - started));
  const get = await httpRequestOnce(scheme, host, port, path, 'GET', remaining, allowInsecure);
  if (get && get.statusCode && get.statusCode < 500) {
    return normalizeResult(true, get.latency, {
      protocol: scheme,
      method: 'GET',
      statusCode: get.statusCode,
      url: `${scheme}://${host}:${port}${path}`,
      bytes: get.bytes,
    }, null);
  }

  const err = (get && get.error) || (head && head.error) || 'No successful response';
  return normalizeResult(false, Date.now() - started, {
    protocol: scheme,
    url: `${scheme}://${host}:${port}${path}`,
    headStatus: head ? head.statusCode || null : null,
    getStatus: get ? get.statusCode || null : null,
  }, err);
}

function probeHttp(host, port, opts) {
  return probeHttpLike('http', host, port, opts);
}

function probeHttps(host, port, opts) {
  return probeHttpLike('https', host, port, opts);
}

function probeTcp(host, port, opts) {
  const timeoutMs = resolveTimeout(opts);
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    function finish(ok, error) {
      if (settled) return;
      settled = true;
      const latency = Date.now() - started;
      try { socket.destroy(); } catch (_e) { void _e; }
      resolve(normalizeResult(ok, latency, {
        protocol: 'tcp',
        host,
        port,
      }, error));
    }
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, null));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', (err) => finish(false, err && err.message ? err.message : 'error'));
    try {
      socket.connect({ host, port });
    } catch (err) {
      finish(false, err && err.message ? err.message : 'error');
    }
  });
}

function probeUdp(host, port, opts) {
  const timeoutMs = resolveTimeout(opts);
  const payload = opts && Buffer.isBuffer(opts.payload)
    ? opts.payload
    : Buffer.from([0x00]);
  const isIPv6 = host && host.includes(':');
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = dgram.createSocket(isIPv6 ? 'udp6' : 'udp4');
    let settled = false;
    let timer = null;

    function finish(ok, error, extra) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { socket.close(); } catch (_e) { void _e; }
      resolve(normalizeResult(ok, Date.now() - started, Object.assign({
        protocol: 'udp',
        host,
        port,
      }, extra || {}), error));
    }

    socket.once('error', (err) => {
      const msg = err && err.message ? err.message : 'error';
      const code = err && err.code ? err.code : null;
      if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
        finish(false, msg, { code });
        return;
      }
      finish(false, msg, { code });
    });

    socket.once('message', (msg, rinfo) => {
      finish(true, null, { responded: true, fromPort: rinfo && rinfo.port, bytes: msg.length });
    });

    try {
      socket.send(payload, 0, payload.length, port, host, (err) => {
        if (err) {
          finish(false, err.message || 'send-failed', null);
          return;
        }
        timer = setTimeout(() => {
          finish(true, null, { responded: false, assumed: 'no-icmp-unreachable' });
        }, timeoutMs);
      });
    } catch (err) {
      finish(false, err && err.message ? err.message : 'send-threw', null);
    }
  });
}

async function probeContainerState(dockerApi, containerId, _opts) {
  const started = Date.now();
  if (!dockerApi || typeof dockerApi.getContainerHealth !== 'function') {
    return normalizeResult(false, Date.now() - started, { kind: 'container-state' }, 'docker-api-unavailable');
  }
  if (!containerId) {
    return normalizeResult(false, Date.now() - started, { kind: 'container-state' }, 'missing-container-id');
  }
  try {
    if (typeof dockerApi._ensureConnected === 'function') {
      await dockerApi._ensureConnected().catch(() => null);
    }
    const h = await dockerApi.getContainerHealth(containerId);
    const status = (h && h.status ? String(h.status) : 'unknown').toLowerCase();
    const health = (h && h.health ? String(h.health) : 'none').toLowerCase();
    const running = status === 'running';
    const healthy = running && (health === 'healthy' || health === 'none' || health === 'unknown' || health === 'starting');
    const evidence = {
      kind: 'container-state',
      containerId,
      status,
      health,
      startedAt: h && h.startedAt ? h.startedAt : null,
      restartCount: h && typeof h.restartCount === 'number' ? h.restartCount : null,
    };
    if (!running) {
      return normalizeResult(false, Date.now() - started, evidence, `container-${status}`);
    }
    if (health === 'unhealthy') {
      return normalizeResult(false, Date.now() - started, evidence, 'healthcheck-unhealthy');
    }
    return normalizeResult(healthy, Date.now() - started, evidence, null);
  } catch (err) {
    return normalizeResult(false, Date.now() - started, { kind: 'container-state', containerId }, err && err.message ? err.message : 'inspect-failed');
  }
}

async function probeJobCompletion(dockerApi, containerId, opts) {
  const started = Date.now();
  const maxAgeMs = opts && Number.isFinite(opts.maxAgeMs) ? opts.maxAgeMs : null;
  if (!dockerApi || typeof dockerApi.inspectContainer !== 'function') {
    return normalizeResult(false, Date.now() - started, { kind: 'job-completion' }, 'docker-api-unavailable');
  }
  if (!containerId) {
    return normalizeResult(false, Date.now() - started, { kind: 'job-completion' }, 'missing-container-id');
  }
  try {
    if (typeof dockerApi._ensureConnected === 'function') {
      await dockerApi._ensureConnected().catch(() => null);
    }
    const inspection = await dockerApi.inspectContainer(containerId);
    const state = inspection && inspection.State ? inspection.State : {};
    const status = String(state.Status || 'unknown').toLowerCase();
    const exitCode = Number.isFinite(state.ExitCode) ? state.ExitCode : null;
    const finishedAt = state.FinishedAt || null;
    const restartPolicy = inspection && inspection.HostConfig && inspection.HostConfig.RestartPolicy
      ? inspection.HostConfig.RestartPolicy.Name || 'no'
      : 'no';

    const evidence = {
      kind: 'job-completion',
      containerId,
      status,
      exitCode,
      finishedAt,
      restartPolicy,
    };

    if (status !== 'exited') {
      return normalizeResult(false, Date.now() - started, evidence, `not-exited-${status}`);
    }
    if (exitCode !== 0) {
      return normalizeResult(false, Date.now() - started, evidence, `exit-code-${exitCode}`);
    }
    if (maxAgeMs != null && finishedAt) {
      const finishedMs = Date.parse(finishedAt);
      if (Number.isFinite(finishedMs)) {
        const age = Date.now() - finishedMs;
        evidence.ageMs = age;
        if (age > maxAgeMs) {
          return normalizeResult(false, Date.now() - started, evidence, 'stale-completion');
        }
      }
    }
    return normalizeResult(true, Date.now() - started, evidence, null);
  } catch (err) {
    return normalizeResult(false, Date.now() - started, { kind: 'job-completion', containerId }, err && err.message ? err.message : 'inspect-failed');
  }
}

module.exports = {
  probeHttp,
  probeHttps,
  probeTcp,
  probeUdp,
  probeContainerState,
  probeJobCompletion,
  DEFAULT_TIMEOUT_MS,
};
