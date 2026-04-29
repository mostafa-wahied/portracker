'use strict';

const { extractSignals } = require('./signals');
const { classify, ROLES } = require('./classify');
const {
  probeHttp,
  probeHttps,
  probeTcp,
  probeUdp,
  probeContainerState,
  probeJobCompletion,
  DEFAULT_TIMEOUT_MS,
} = require('./probes');
const { aggregate } = require('./aggregate');

function safeLower(v) {
  return typeof v === 'string' ? v.toLowerCase() : '';
}

function resolveProbeHost(hostIp) {
  const h = safeLower(hostIp);
  const override = (process.env.HOST_OVERRIDE || '').trim();
  if (h === '' || h === '0.0.0.0' || h === '::' || h === '[::]') {
    return override || '127.0.0.1';
  }
  if (h === '::1') return '::1';
  return hostIp;
}

function pickRepresentativePort(ports) {
  const list = Array.isArray(ports) ? ports.filter(Boolean) : [];
  if (list.length === 0) return null;
  const score = (p) => {
    const host = safeLower(p.host_ip || '');
    const isLoopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
    const proto = safeLower(p.protocol || 'tcp');
    let s = 0;
    if (p.internal !== true) s += 1000;
    if (!isLoopback) s += 100;
    if (proto === 'tcp') s += 10;
    const n = parseInt(p.host_port, 10);
    if (Number.isFinite(n) && n > 0) s -= Math.min(n, 65535) / 70000;
    return s;
  };
  return list.slice().sort((a, b) => score(b) - score(a))[0];
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

function groupPortsByContainer(ports) {
  const map = new Map();
  (ports || []).forEach((p) => {
    if (!p) return;
    const key = p.container_id || `${p.owner || 'unknown'}::${p.host_ip || ''}:${p.host_port || ''}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  });
  return map;
}

function buildSiblingContext(servicePorts, componentSignals, allSignalsByContainer) {
  const siblingServices = [];
  allSignalsByContainer.forEach((sig) => {
    if (sig.composeService && sig.composeService !== componentSignals.composeService) {
      if (!siblingServices.includes(sig.composeService)) siblingServices.push(sig.composeService);
    }
  });

  let siblingDependsOnUs = false;
  allSignalsByContainer.forEach((sig) => {
    if (sig.composeService && componentSignals.composeService) {
      if (Array.isArray(sig.dependsOn) && sig.dependsOn.includes(componentSignals.composeService)) {
        siblingDependsOnUs = true;
      }
    }
  });

  let serviceHasHttpResponder = false;
  (servicePorts || []).forEach((p) => {
    if (safeLower(p.protocol || 'tcp') === 'tcp') {
      serviceHasHttpResponder = true;
    }
  });

  return {
    siblingServices,
    siblingDependsOnUs,
    serviceHasHttpResponder,
  };
}

function isLoopbackHost(hostIp) {
  const h = safeLower(hostIp || '');
  return h === '127.0.0.1' || h === '::1' || h === 'localhost';
}

async function tryLoopbackRescue(port, dockerApi, inspectionCache, timeoutMs) {
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
  const r = await probeTcp(containerIp, containerPort, { timeoutMs });
  return { applicable: true, ok: r.ok, error: r.error || null, containerIp, containerPort };
}

async function sweepExternalPorts(groupPorts, opts) {
  const timeoutMs = opts && Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const onDemandSet = opts && opts.onDemandSet ? opts.onDemandSet : new Set();
  const dockerApi = opts && opts.dockerApi ? opts.dockerApi : null;
  const inspectionCache = opts && opts.inspectionCache ? opts.inspectionCache : new Map();
  const externals = (groupPorts || []).filter((p) => p && p.internal !== true);
  const failures = [];
  const suppressed = [];
  for (const p of externals) {
    if (isOnDemandPort(p, onDemandSet)) continue;
    const host = resolveProbeHost(p.host_ip);
    const port = parseInt(p.host_port, 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) continue;
    const proto = safeLower(p.protocol || 'tcp');
    if (proto !== 'tcp') continue;
    const r = await probeTcp(host, port, { timeoutMs });
    if (r.ok) continue;
    if (isLoopbackHost(p.host_ip)) {
      const rescue = await tryLoopbackRescue(p, dockerApi, inspectionCache, timeoutMs);
      if (rescue.applicable && rescue.ok) {
        continue;
      }
      if (!rescue.applicable) {
        suppressed.push({
          host_ip: p.host_ip || null,
          host_port: p.host_port,
          reason: rescue.reason || 'loopback-only-by-design',
        });
        continue;
      }
      failures.push({
        host_ip: p.host_ip || null,
        host_port: p.host_port,
        error: rescue.error || r.error || 'unreachable',
        rescue: { containerIp: rescue.containerIp, containerPort: rescue.containerPort },
      });
      continue;
    }
    const bridgeRescue = await tryLoopbackRescue(p, dockerApi, inspectionCache, timeoutMs);
    if (bridgeRescue.applicable && bridgeRescue.ok) {
      continue;
    }
    failures.push({
      host_ip: p.host_ip || null,
      host_port: p.host_port,
      error: r.error || 'unreachable',
    });
  }
  return { failures, suppressed };
}

async function pickAndRunProbe(signals, representative, dockerApi, opts, groupPorts) {
  const timeoutMs = opts && Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const onDemandSet = opts && opts.onDemandSet ? opts.onDemandSet : onDemandKeysFromDeps(opts);
  const inspectionCache = opts && opts.inspectionCache ? opts.inspectionCache : new Map();
  const hasExternal = Array.isArray(groupPorts) && groupPorts.some((p) => p && p.internal !== true);

  if (signals.hasHealthcheck && signals.containerId) {
    const hc = await probeContainerState(dockerApi, signals.containerId, { timeoutMs });
    if (!hc.ok) return hc;
    if (hasExternal) {
      const sweep = await sweepExternalPorts(groupPorts, { timeoutMs, onDemandSet, dockerApi, inspectionCache });
      const failures = sweep.failures || [];
      const suppressed = sweep.suppressed || [];
      if (failures.length > 0) {
        return {
          ok: true,
          severity: 'yellow',
          latencyMs: hc.latencyMs,
          evidence: { kind: 'partial', healthcheck: hc.evidence, failures, suppressed },
          error: `Service is running, but ${failures.length} published port${failures.length === 1 ? " isn't" : "s aren't"} responding`,
        };
      }
      if (suppressed.length > 0) {
        return {
          ok: hc.ok,
          severity: hc.severity || null,
          latencyMs: hc.latencyMs,
          evidence: { ...hc.evidence, suppressed },
          error: hc.error || null,
        };
      }
    }
    return hc;
  }

  if (signals.containerState === 'exited') {
    return probeJobCompletion(dockerApi, signals.containerId, { timeoutMs });
  }

  if (!hasExternal && signals.containerId) {
    return probeContainerState(dockerApi, signals.containerId, { timeoutMs });
  }

  const host = resolveProbeHost(representative && representative.host_ip);
  const port = parseInt(representative && representative.host_port, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    return {
      ok: false,
      latencyMs: null,
      evidence: { kind: 'invalid-port' },
      error: 'no-valid-host-port',
    };
  }

  const proto = safeLower(signals.protocol || 'tcp');
  if (proto === 'udp') {
    return probeUdp(host, port, { timeoutMs });
  }

  const tcp = await probeTcp(host, port, { timeoutMs });
  if (!tcp.ok) return tcp;

  const https = await probeHttps(host, port, { timeoutMs });
  if (https.ok) return https;
  const http = await probeHttp(host, port, { timeoutMs });
  if (http.ok) return http;
  return tcp;
}

async function computeServiceHealth(service, deps) {
  const dockerApi = deps && deps.dockerApi ? deps.dockerApi : null;
  const overrides = deps && deps.overrides && typeof deps.overrides === 'object' ? deps.overrides : {};
  const ports = Array.isArray(service && service.ports) ? service.ports : [];

  if (dockerApi && typeof dockerApi._ensureConnected === 'function') {
    await dockerApi._ensureConnected().catch(() => null);
  }

  const groups = groupPortsByContainer(ports);
  const inspections = new Map();
  const signalsByContainer = new Map();
  const representativeByContainer = new Map();

  for (const [key, groupPorts] of groups.entries()) {
    const representative = pickRepresentativePort(groupPorts);
    representativeByContainer.set(key, representative);
    const containerId = representative && representative.container_id ? representative.container_id : null;
    let inspection = null;
    if (containerId && dockerApi && typeof dockerApi.inspectContainer === 'function') {
      try {
        inspection = await dockerApi.inspectContainer(containerId);
      } catch (_err) {
        inspection = null;
      }
      inspections.set(key, inspection);
    }
    const sig = extractSignals(representative, inspection, ports);
    signalsByContainer.set(key, sig);
  }

  const entries = [];
  for (const [key, sig] of signalsByContainer.entries()) {
    const representative = representativeByContainer.get(key);
    const siblingCtx = buildSiblingContext(ports, sig, signalsByContainer);
    const overrideKey = sig.containerId ? `${service.serviceId || ''}::${sig.containerId}` : null;
    const overrideRole = overrideKey && typeof overrides[overrideKey] === 'string' ? overrides[overrideKey] : null;
    const classification = classify(sig, {
      siblingServices: siblingCtx.siblingServices,
      siblingDependsOnUs: siblingCtx.siblingDependsOnUs,
      serviceHasHttpResponder: siblingCtx.serviceHasHttpResponder,
      override: overrideRole,
    });

    let probe;
    if (classification.role === ROLES.JOB_EXPECTED_EXIT) {
      probe = { ok: true, latencyMs: null, evidence: { kind: 'job-expected-exit', containerId: sig.containerId }, error: null };
    } else {
      const groupPorts = groups.get(key) || [];
      const probeOpts = Object.assign({}, deps || {}, {
        onDemandSet: onDemandKeysFromDeps(deps),
        inspectionCache: inspections,
      });
      probe = await pickAndRunProbe(sig, representative, dockerApi, probeOpts, groupPorts);
    }

    entries.push({
      componentId: sig.containerId || key,
      containerId: sig.containerId,
      signals: sig,
      classification,
      probe,
    });
  }

  const result = aggregate(entries);
  return {
    serviceId: service.serviceId || null,
    name: service.name || null,
    color: result.color,
    reason: result.reason,
    failingComponents: result.failingComponents,
    components: result.components,
    evidence: result.evidence,
  };
}

module.exports = {
  computeServiceHealth,
  pickRepresentativePort,
  groupPortsByContainer,
};
