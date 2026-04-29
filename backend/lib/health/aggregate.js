'use strict';

const { ROLES } = require('./classify');

const CORE_ROLES = new Set([ROLES.CORE_RUNTIME, ROLES.CORE_ACCESS]);

function componentSucceeded(entry) {
  const probe = entry && entry.probe;
  if (!probe) return null;
  return probe.ok === true;
}

function summarizeComponent(entry) {
  const classification = entry && entry.classification ? entry.classification : {};
  const probe = entry && entry.probe ? entry.probe : {};
  return {
    componentId: entry && entry.componentId ? entry.componentId : null,
    role: classification.role || ROLES.UNKNOWN,
    ruleId: classification.ruleId || null,
    confidence: classification.confidence || null,
    reason: classification.reason || null,
    probe: {
      ok: probe.ok === true,
      severity: probe.severity || null,
      latencyMs: Number.isFinite(probe.latencyMs) ? probe.latencyMs : null,
      error: probe.error || null,
      evidence: probe.evidence || null,
    },
    containerId: entry && entry.signals && entry.signals.containerId
      ? entry.signals.containerId
      : (entry && entry.containerId) || null,
  };
}

function aggregate(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) {
    return {
      color: 'gray',
      reason: 'no components observed',
      failingComponents: [],
      components: [],
      evidence: [],
    };
  }

  const components = list.map(summarizeComponent);

  const core = [];
  const support = [];
  const jobs = [];
  const unknown = [];

  components.forEach((c) => {
    if (CORE_ROLES.has(c.role)) core.push(c);
    else if (c.role === ROLES.SUPPORT) support.push(c);
    else if (c.role === ROLES.JOB_EXPECTED_EXIT) jobs.push(c);
    else unknown.push(c);
  });

  const coreFailures = core.filter((c) => c.probe.ok !== true);
  const corePartial = core.filter((c) => c.probe.ok === true && c.probe.severity === 'yellow');
  const supportFailures = support.filter((c) => c.probe.ok !== true);
  const unknownFailures = unknown.filter((c) => c.probe.ok !== true);

  let color;
  let reason;

  if (core.length > 0 && coreFailures.length > 0) {
    color = 'red';
    reason = `main service${coreFailures.length > 1 ? 's' : ''} failing: ${coreFailures.map((c) => c.componentId || c.role).join(', ')}`;
  } else if (core.length > 0 && corePartial.length > 0) {
    color = 'yellow';
    const detail = corePartial.map((c) => c.probe.error).filter(Boolean).join('; ');
    reason = detail || `core partially reachable: ${corePartial.map((c) => c.componentId).join(', ')}`;
  } else if (core.length > 0 && (supportFailures.length > 0 || unknownFailures.length > 0)) {
    color = 'yellow';
    const degraded = supportFailures.concat(unknownFailures);
    reason = `main service reachable; helper issue: ${degraded.map((c) => c.componentId || c.role).join(', ')}`;
  } else if (core.length > 0) {
    color = 'green';
    reason = 'Main service is reachable';
  } else if (unknown.length > 0) {
    color = 'gray';
    reason = 'No main service identified; set a role if needed';
  } else if (jobs.length > 0 && support.length === 0) {
    color = 'gray';
    reason = 'only expected-exit jobs observed';
  } else if (support.length > 0 && supportFailures.length === 0) {
    color = 'gray';
    reason = 'No main service identified; helper services are reachable';
  } else {
    color = 'gray';
    reason = 'insufficient signal';
  }

  const failingComponents = coreFailures
    .concat(supportFailures)
    .concat(unknownFailures)
    .map((c) => c.componentId || c.role);

  const evidence = components.map((c) => ({
    componentId: c.componentId,
    role: c.role,
    ruleId: c.ruleId,
    ok: c.probe.ok,
    error: c.probe.error,
    reason: c.reason,
  }));

  return {
    color,
    reason,
    failingComponents,
    components,
    evidence,
  };
}

module.exports = {
  aggregate,
  componentSucceeded,
};
