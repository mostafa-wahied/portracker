'use strict';

const { extractSignals } = require('./signals');
const { classify, ROLES } = require('./classify');
const {
  probeHttp,
  probeHttps,
  probeTcp,
  probeContainerState,
  probeJobCompletion,
} = require('./probes');
const { aggregate } = require('./aggregate');
const { NO_LISTENER, runWithinBudget, safeLower, resolveProbeHost, onDemandKeysFromDeps, isOnDemandPort, portEntry, closedReason, probeKey, nothingListening, sweepPorts, sweepContext, sweepExternalPorts } = require('./port-sweep');


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


function portsClosedCode(count) {
  return `ports-closed-${count}`;
}

function uncheckedResult(ports, reasonCode = 'time-limit') {
  return { ok: null, latencyMs: null, error: null, evidence: { kind: 'not-checked',
    ports: (ports || []).map((port) => portEntry(port, 'not-checked', 'none', { reasonCode })) } };
}

async function probeWithHealthcheck(signals, groupPorts, ctx, hasExternal) {
  const hc = await runWithinBudget(ctx, (options) => probeContainerState(ctx.dockerApi, signals.containerId, options));
  if (!hc) return uncheckedResult(groupPorts);
  if (!hc.ok || !hasExternal) {
    const ports = (groupPorts || []).map((port) => portEntry(port, 'not-checked', 'none', { reasonCode: 'container-check' }));
    return { ...hc, evidence: { ...(hc.evidence || {}), ports } };
  }
  const sweep = await sweepExternalPorts(groupPorts, ctx);
  if (sweep.failures.length > 0) {
    return {
      ok: true,
      severity: 'yellow',
      latencyMs: hc.latencyMs,
      evidence: { kind: 'partial', healthcheck: hc.evidence, failures: sweep.failures, suppressed: sweep.suppressed, ports: sweep.entries },
      error: portsClosedCode(sweep.failures.length),
    };
  }
  const evidence = { ...hc.evidence, ports: sweep.entries };
  if (sweep.suppressed.length > 0) evidence.suppressed = sweep.suppressed;
  return { ok: hc.ok, severity: hc.severity || null, latencyMs: hc.latencyMs, evidence, error: hc.error || null };
}

function serverErrorStatus(result) {
  const evidence = (result && result.evidence) || {};
  const found = [evidence.getStatus, evidence.headStatus].find((s) => Number.isInteger(s) && s >= 500 && s <= 599);
  return found || null;
}

function degradedHttp(result, scheme, status, rep) {
  return {
    result: {
      ok: true,
      severity: 'yellow',
      latencyMs: result.latencyMs,
      evidence: { kind: 'http-error', protocol: scheme, statusCode: status, url: result.evidence && result.evidence.url },
      error: `http-status-${status}`,
    },
    entry: portEntry(rep, 'http-error', scheme, { statusCode: status }),
  };
}

async function probeRepresentative(rep, host, port, ctx) {
  const tcp = await runWithinBudget(ctx, (options) => probeTcp(host, port, options));
  if (!tcp) return { result: uncheckedResult([rep]), entry: portEntry(rep, 'not-checked', 'none', { reasonCode: 'time-limit' }) };
  if (!tcp.ok) return { result: tcp, entry: portEntry(rep, 'closed', 'tcp', { reasonCode: closedReason(tcp.error) }) };
  const open = { result: tcp, entry: portEntry(rep, 'open', 'tcp', { reasonCode: 'time-limit' }) };
  const absent = await runWithinBudget(ctx, () => nothingListening(rep, ctx));
  if (absent === true) {
    return {
      result: { ok: false, latencyMs: tcp.latencyMs, evidence: { ...(tcp.evidence || {}), listener: 'none' }, error: NO_LISTENER },
      entry: portEntry(rep, 'closed', 'tcp', { reasonCode: NO_LISTENER }),
    };
  }
  if (ctx.signal.aborted) return open;
  const https = await runWithinBudget(ctx, (options) => probeHttps(host, port, options));
  if (!https) return open;
  if (https.ok) return { result: https, entry: portEntry(rep, 'ok', 'https', { statusCode: https.evidence.statusCode }) };
  const httpsStatus = serverErrorStatus(https);
  if (httpsStatus) return degradedHttp(https, 'https', httpsStatus, rep);
  const http = await runWithinBudget(ctx, (options) => probeHttp(host, port, options));
  if (!http) return open;
  if (http.ok) return { result: http, entry: portEntry(rep, 'ok', 'http', { statusCode: http.evidence.statusCode }) };
  const httpStatus = serverErrorStatus(http);
  if (httpStatus) return degradedHttp(http, 'http', httpStatus, rep);
  return { result: tcp, entry: portEntry(rep, 'open', 'tcp+http') };
}

function mergeSiblingSweep(primary, sweep) {
  const result = primary.result;
  const evidence = { ...(result.evidence || {}), ports: [primary.entry].concat(sweep.entries) };
  if (sweep.suppressed.length > 0) evidence.suppressed = sweep.suppressed;
  if (sweep.failures.length === 0) return { ...result, evidence };
  evidence.failures = sweep.failures;
  if (!result.ok) return { ...result, evidence };
  return {
    ...result,
    severity: 'yellow',
    evidence,
    error: result.severity === 'yellow' ? result.error : portsClosedCode(sweep.failures.length),
  };
}

async function probePublishedTcp(representative, groupPorts, ctx) {
  const host = resolveProbeHost(representative.host_ip);
  const port = parseInt(representative.host_port, 10);
  const primary = await probeRepresentative(representative, host, port, ctx);
  const siblings = (groupPorts || []).filter((p) => p && p !== representative && p.internal !== true);
  const sweep = await sweepPorts(siblings, ctx, [probeKey(representative)]);
  return mergeSiblingSweep(primary, sweep);
}

async function pickAndRunProbe(signals, representative, dockerApi, opts, groupPorts) {
  const ctx = opts && opts.probeContext ? opts.probeContext : sweepContext({
    timeoutMs: opts && opts.timeoutMs,
    onDemandSet: opts && opts.onDemandSet ? opts.onDemandSet : onDemandKeysFromDeps(opts),
    dockerApi,
    inspectionCache: opts && opts.inspectionCache,
    procRoots: opts && opts.procRoots,
    budgetMs: opts && opts.budgetMs,
  });
  const hasExternal = Array.isArray(groupPorts) && groupPorts.some((p) => p && p.internal !== true);
  if (signals.hasHealthcheck && signals.containerId) return probeWithHealthcheck(signals, groupPorts, ctx, hasExternal);
  if (signals.containerState === 'exited') {
    const result = await runWithinBudget(ctx, (options) => probeContainerState(dockerApi, signals.containerId, options));
    return result ? { ...result, evidence: { ...(result.evidence || {}), ports: uncheckedResult(groupPorts, 'stopped').evidence.ports } } : uncheckedResult(groupPorts);
  }
  if (!hasExternal && signals.containerId) {
    const result = await runWithinBudget(ctx, (options) => probeContainerState(dockerApi, signals.containerId, options));
    if (!result) return uncheckedResult(groupPorts);
    return { ...result, evidence: { ...(result.evidence || {}), ports: (groupPorts || []).map((entry) => portEntry(entry, 'not-checked', 'none', { reasonCode: 'internal' })) } };
  }
  const checkable = (groupPorts || []).filter((entry) => entry && entry.internal !== true
    && safeLower(entry.protocol || 'tcp') === 'tcp' && !isOnDemandPort(entry, ctx.onDemandSet));
  const primary = checkable.includes(representative) ? representative : pickRepresentativePort(checkable);
  if (!primary) {
    const sweep = await sweepExternalPorts(groupPorts, ctx);
    return { ok: null, latencyMs: null, evidence: { kind: 'not-checked', ports: sweep.entries }, error: null };
  }
  const port = parseInt(primary.host_port, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    return { ok: false, latencyMs: null, evidence: { kind: 'invalid-port' }, error: 'no-valid-host-port' };
  }
  return probePublishedTcp(primary, groupPorts, ctx);
}

async function computeServiceHealth(service, deps) {
  const dockerApi = deps && deps.dockerApi ? deps.dockerApi : null;
  const overrides = deps && deps.overrides && typeof deps.overrides === 'object' ? deps.overrides : {};
  const ports = Array.isArray(service && service.ports) ? service.ports : [];
  const inspections = new Map();
  const probeContext = sweepContext({ ...(deps || {}), dockerApi, inspectionCache: inspections, onDemandSet: onDemandKeysFromDeps(deps) });

  if (dockerApi && typeof dockerApi._ensureConnected === 'function') {
    await runWithinBudget(probeContext, () => dockerApi._ensureConnected().catch(() => null));
  }

  const groups = groupPortsByContainer(ports);
  const signalsByContainer = new Map();
  const representativeByContainer = new Map();

  for (const [key, groupPorts] of groups.entries()) {
    const representative = pickRepresentativePort(groupPorts);
    representativeByContainer.set(key, representative);
    const containerId = representative && representative.container_id ? representative.container_id : null;
    let inspection = null;
    if (containerId && dockerApi && typeof dockerApi.inspectContainer === 'function') {
      try {
        inspection = await runWithinBudget(probeContext, () => dockerApi.inspectContainer(containerId));
      } catch (_err) {
        inspection = null;
      }
      inspections.set(key, inspection);
    }
    const sig = extractSignals(representative, inspection, ports);
    sig.expectedCompletion = sig.expectedCompletion || !!(deps?.expectedCompletionServices?.has(`${sig.composeProject}::${sig.composeService}`));
    signalsByContainer.set(key, sig);
  }

  const entries = [];
  for (const [key, sig] of signalsByContainer.entries()) {
    const representative = representativeByContainer.get(key);
    const siblingCtx = buildSiblingContext(ports, sig, signalsByContainer);
    const overrideRole = sig.containerId && typeof overrides[sig.containerId] === 'string' ? overrides[sig.containerId] : null;
    const autoContext = {
      siblingServices: siblingCtx.siblingServices,
      siblingDependsOnUs: siblingCtx.siblingDependsOnUs,
      serviceHasHttpResponder: siblingCtx.serviceHasHttpResponder,
    };
    const autoClassification = classify(sig, autoContext);
    const classification = overrideRole
      ? classify(sig, { ...autoContext, override: overrideRole })
      : autoClassification;

    let probe;
    if (classification.role === ROLES.JOB_EXPECTED_EXIT) {
      const completion = await runWithinBudget(probeContext, (options) => probeJobCompletion(dockerApi, sig.containerId, options));
      const reason = completion && completion.ok === true ? 'finished-job' : 'job-pending';
      const skipped = uncheckedResult(groups.get(key), reason).evidence.ports;
      probe = completion ? { ...completion, evidence: { ...completion.evidence, ports: skipped } } : uncheckedResult(groups.get(key));
    } else {
      const groupPorts = groups.get(key) || [];
      const probeOpts = Object.assign({}, deps || {}, {
        onDemandSet: onDemandKeysFromDeps(deps),
        inspectionCache: inspections,
        probeContext,
      });
      probe = await pickAndRunProbe(sig, representative, dockerApi, probeOpts, groupPorts);
    }

    entries.push({
      componentId: sig.containerId || key,
      containerId: sig.containerId,
      signals: sig,
      classification,
      autoClassification,
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
