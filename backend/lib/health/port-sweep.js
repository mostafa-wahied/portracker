'use strict';

const { probeTcp, DEFAULT_TIMEOUT_MS } = require('./probes');
const { containerListeners, publishedContainerPort } = require('./container-listeners');
const { getDockerHostIP } = require('../docker-host');

let cachedDockerHostIp;
function dockerHostIpFallback() {
  if (cachedDockerHostIp === undefined) {
    try {
      cachedDockerHostIp = getDockerHostIP() || '';
    } catch (_e) {
      cachedDockerHostIp = '';
    }
  }
  return cachedDockerHostIp;
}

function safeLower(v) {
  return typeof v === 'string' ? v.toLowerCase() : '';
}

function resolveProbeHost(hostIp) {
  const h = safeLower(hostIp);
  const override = (process.env.HOST_OVERRIDE || '').trim();
  if (h === '' || h === '0.0.0.0' || h === '::' || h === '[::]') {
    return override || dockerHostIpFallback() || '127.0.0.1';
  }
  if (h === '::1') return '::1';
  return hostIp;
}

function onDemandKeysFromDeps(deps) {
  const set = new Set();
  if (!deps) return set;
  const source = deps.onDemandPorts;
  if (!source) return set;
  const push = (v) => { if (typeof v === 'string' && v) set.add(v); };
  if (source instanceof Set) source.forEach(push);
  else if (Array.isArray(source)) source.forEach(push);
  return set;
}

function isOnDemandPort(port, onDemandSet) {
  if (!port || !onDemandSet || onDemandSet.size === 0) return false;
  const cid = port.container_id || '';
  const hp = port.host_port;
  if (cid) {
    if (onDemandSet.has(`${cid}:${hp}`)) return true;
    if (onDemandSet.has(`${cid.slice(0, 12)}:${hp}`)) return true;
  }
  return false;
}

function isLoopbackHost(hostIp) {
  const h = safeLower(hostIp || '');
  return h === '127.0.0.1' || h === '::1' || h === 'localhost';
}

async function tryLoopbackRescue(port, dockerApi, inspectionCache, options) {
  const containerId = port && port.container_id;
  if (!containerId || !dockerApi || typeof dockerApi.inspectContainer !== 'function') {
    return { applicable: false };
  }
  let inspection = inspectionCache.get(containerId);
  if (inspection === undefined) {
    try {
      inspection = await dockerApi.inspectContainer(containerId);
    } catch (_e) {
      void _e;
      inspection = null;
    }
    inspectionCache.set(containerId, inspection);
  }
  if (!inspection) return { applicable: false };
  const networkMode = safeLower(inspection.HostConfig && inspection.HostConfig.NetworkMode);
  if (networkMode === 'host' || networkMode === 'none') {
    return { applicable: false, reason: 'host-network', networkMode };
  }
  const networks = (inspection.NetworkSettings && inspection.NetworkSettings.Networks) || {};
  let containerIp = null;
  for (const info of Object.values(networks)) {
    const ip = info && info.IPAddress;
    if (ip && ip !== '0.0.0.0') { containerIp = ip; break; }
  }
  if (!containerIp) return { applicable: false, reason: 'no-bridge-ip' };
  const portsMap = (inspection.NetworkSettings && inspection.NetworkSettings.Ports) || {};
  const proto = safeLower(port.protocol || 'tcp');
  let containerPort = null;
  for (const [spec, bindings] of Object.entries(portsMap)) {
    if (!bindings) continue;
    const [cpStr, cproto] = String(spec).split('/');
    if (safeLower(cproto || 'tcp') !== proto) continue;
    const matched = bindings.some((b) => {
      const hp = parseInt(b && b.HostPort, 10);
      return Number.isFinite(hp) && hp === parseInt(port.host_port, 10);
    });
    if (matched) {
      const n = parseInt(cpStr, 10);
      if (Number.isFinite(n)) { containerPort = n; break; }
    }
  }
  if (containerPort == null) {
    const n = parseInt(port.host_port, 10);
    if (Number.isFinite(n)) containerPort = n;
  }
  if (containerPort == null) return { applicable: false, reason: 'no-container-port' };
  const r = await probeTcp(containerIp, containerPort, options);
  return { applicable: true, ok: r.ok, error: r.error || null, containerIp, containerPort };
}

const SWEEP_CONCURRENCY = 4;
const SWEEP_MAX_PORTS = 24;
const SWEEP_BUDGET_MS = 8000;

function portEntry(p, state, check, extra) {
  return Object.assign({
    host_ip: p.host_ip || null,
    host_port: p.host_port,
    protocol: safeLower(p.protocol || 'tcp'),
    state,
    check,
  }, extra || {});
}

function closedReason(error) {
  const e = safeLower(error || '');
  if (e.includes('econnrefused')) return 'refused';
  if (e.includes('timeout') || e.includes('etimedout')) return 'timeout';
  if (e.includes('econnreset')) return 'reset';
  return 'unreachable';
}

function probeKey(p) {
  return `${resolveProbeHost(p.host_ip)}|${parseInt(p.host_port, 10)}|${safeLower(p.protocol || 'tcp')}`;
}

const NO_LISTENER = 'no-listener';

async function inspectCached(containerId, ctx) {
  if (!ctx.inspectionCache.has(containerId)) {
    let inspection = null;
    try {
      inspection = await ctx.dockerApi.inspectContainer(containerId);
    } catch (_err) {
      inspection = null;
    }
    ctx.inspectionCache.set(containerId, inspection);
  }
  return ctx.inspectionCache.get(containerId);
}

async function nothingListening(p, ctx) {
  const containerId = p && p.container_id;
  if (!containerId || !ctx.dockerApi || typeof ctx.dockerApi.inspectContainer !== 'function') return false;
  const inspection = await inspectCached(containerId, ctx);
  if (!inspection) return false;
  const target = publishedContainerPort(inspection, parseInt(p.host_port, 10), safeLower(p.protocol || 'tcp'), p.host_ip);
  if (!target) return false;
  if (!ctx.listenerCache.has(containerId)) ctx.listenerCache.set(containerId, await containerListeners(inspection, ctx.procRoots));
  const listening = ctx.listenerCache.get(containerId);
  return !!listening && !listening.has(target);
}

async function checkOnePort(p, ctx) {
  const host = resolveProbeHost(p.host_ip);
  const port = parseInt(p.host_port, 10);
  const loopback = isLoopbackHost(p.host_ip);
  const unchecked = { entry: portEntry(p, 'not-checked', 'none', { reasonCode: 'time-limit' }) };
  const r = await runWithinBudget(ctx, (options) => probeTcp(host, port, options));
  if (!r) return unchecked;
  const absent = r.ok ? await runWithinBudget(ctx, () => nothingListening(p, ctx)) : false;
  if (r.ok && absent === true) {
    return {
      failure: { host_ip: p.host_ip || null, host_port: p.host_port, error: NO_LISTENER },
      entry: portEntry(p, 'closed', 'tcp', { reasonCode: NO_LISTENER }),
    };
  }
  if (r.ok) return { entry: portEntry(p, 'open', 'tcp') };
  const rescue = await runWithinBudget(ctx, (options) => tryLoopbackRescue(p, ctx.dockerApi, ctx.inspectionCache, options));
  if (!rescue) return unchecked;
  if (rescue.applicable && rescue.ok) return { entry: portEntry(p, 'open', 'tcp', { via: 'container-ip' }) };
  if (loopback && !rescue.applicable) {
    return {
      suppressed: { host_ip: p.host_ip || null, host_port: p.host_port, reason: rescue.reason || 'loopback-only-by-design' },
      entry: portEntry(p, 'host-only', 'tcp', { reasonCode: 'loopback-only' }),
    };
  }
  const error = loopback ? (rescue.error || r.error || 'unreachable') : (r.error || 'unreachable');
  const failure = { host_ip: p.host_ip || null, host_port: p.host_port, error };
  if (loopback) failure.rescue = { containerIp: rescue.containerIp, containerPort: rescue.containerPort };
  return { failure, entry: portEntry(p, 'closed', 'tcp', { reasonCode: closedReason(error) }) };
}

function queuePorts(candidates, onDemandSet, skipKeys) {
  const queue = [];
  const skipped = [];
  const seen = new Set(skipKeys || []);
  const remaining = Math.max(0, SWEEP_MAX_PORTS - seen.size);
  (candidates || []).forEach((p) => {
    const port = parseInt(p.host_port, 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) return;
    if (isOnDemandPort(p, onDemandSet)) {
      skipped.push(portEntry(p, 'not-checked', 'none', { reasonCode: 'on-demand' }));
      return;
    }
    if (safeLower(p.protocol || 'tcp') !== 'tcp') {
      skipped.push(portEntry(p, 'not-checked', 'none', { reasonCode: 'udp' }));
      return;
    }
    const key = probeKey(p);
    if (seen.has(key)) return;
    seen.add(key);
    if (queue.length >= remaining) {
      skipped.push(portEntry(p, 'not-checked', 'none', { reasonCode: 'limit' }));
      return;
    }
    queue.push(p);
  });
  return { queue, skipped };
}

async function sweepPorts(candidates, ctx, skipKeys) {
  const { queue, skipped } = queuePorts(candidates, ctx.onDemandSet, skipKeys);
  const results = new Array(queue.length);
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const i = next;
      next += 1;
      if (ctx.signal.aborted || Date.now() >= ctx.deadline) {
        results[i] = { entry: portEntry(queue[i], 'not-checked', 'none', { reasonCode: 'time-limit' }) };
      } else {
        results[i] = await checkOnePort(queue[i], ctx);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SWEEP_CONCURRENCY, queue.length) }, worker));
  const failures = [];
  const suppressed = [];
  const entries = skipped.slice();
  results.forEach((r) => {
    if (r.failure) failures.push(r.failure);
    if (r.suppressed) suppressed.push(r.suppressed);
    entries.push(r.entry);
  });
  return { failures, suppressed, entries };
}

function runWithinBudget(ctx, operation) {
  const remaining = ctx.deadline - Date.now();
  if (remaining <= 0 || ctx.signal.aborted) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      ctx.signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { cleanup(); resolve(null); };
    const timer = setTimeout(() => ctx.controller.abort(), remaining);
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    if (ctx.signal.aborted) { onAbort(); return; }
    Promise.resolve().then(() => operation({ timeoutMs: Math.min(ctx.timeoutMs, remaining), signal: ctx.signal }))
      .then((result) => { cleanup(); resolve(ctx.signal.aborted ? null : result); },
        (error) => { cleanup(); if (ctx.signal.aborted) resolve(null); else reject(error); });
  });
}

function sweepContext(opts) {
  const budgetMs = opts && Number.isFinite(opts.budgetMs) ? Math.max(0, Math.min(opts.budgetMs, SWEEP_BUDGET_MS)) : SWEEP_BUDGET_MS;
  const controller = new AbortController();
  return {
    controller,
    signal: controller.signal,
    deadline: Date.now() + budgetMs,
    timeoutMs: opts && Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS,
    onDemandSet: opts && opts.onDemandSet ? opts.onDemandSet : new Set(),
    dockerApi: opts && opts.dockerApi ? opts.dockerApi : null,
    inspectionCache: opts && opts.inspectionCache ? opts.inspectionCache : new Map(),
    procRoots: opts && Array.isArray(opts.procRoots) ? opts.procRoots : null,
    listenerCache: new Map(),
  };
}

async function sweepExternalPorts(groupPorts, opts) {
  const externals = (groupPorts || []).filter((p) => p && p.internal !== true);
  return sweepPorts(externals, opts && opts.signal ? opts : sweepContext(opts));
}

module.exports = {
  NO_LISTENER, runWithinBudget,
  safeLower, resolveProbeHost, onDemandKeysFromDeps, isOnDemandPort, portEntry, closedReason, probeKey, nothingListening, sweepPorts, sweepContext, sweepExternalPorts
};
