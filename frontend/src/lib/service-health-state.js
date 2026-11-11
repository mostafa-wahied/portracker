const CORE_ROLES = new Set(['core_runtime', 'core_access']);
const OVERRIDE_LABELS = {
  core_runtime: 'main service',
  core_access: 'main service',
  support: 'helper',
  job_expected_exit: 'finished job',
  unknown: 'unknown',
};

export function overrideReason(role) {
  return `Marked as ${OVERRIDE_LABELS[role] || 'unknown'} by you.`;
}

export function resolveComponentOverride(comp, ovRole) {
  const overridden = typeof ovRole === 'string' && ovRole.length > 0;
  const baseRole = comp.autoRole || (comp.ruleId === 'R2' ? 'unknown' : comp.role) || 'unknown';
  const baseRuleId = comp.autoRuleId || (comp.ruleId === 'R2' ? 'R8' : comp.ruleId) || null;
  const baseReason = comp.autoReason ?? (comp.ruleId === 'R2'
    ? 'Component importance is not known. Set a role if needed.'
    : comp.reason) ?? null;
  return {
    ...comp,
    effectiveRole: overridden ? ovRole : baseRole,
    effectiveRuleId: overridden ? 'R2' : baseRuleId,
    reason: overridden ? overrideReason(ovRole) : baseReason,
    overridden,
  };
}

export function applyOverridesToMatches(matches, getOverride) {
  const components = [];
  const componentsByService = new Map();
  const overrideAdjustedColors = new Map();
  (matches || []).forEach((svc) => {
    const svcComps = (svc.components || []).map((comp) => {
      const ovRole = comp.containerId && getOverride ? getOverride(svc.serviceId, comp.containerId) : null;
      return { ...resolveComponentOverride(comp, ovRole), _serviceName: svc.name, _serviceId: svc.serviceId };
    });
    componentsByService.set(svc.serviceId, svcComps);
    svcComps.forEach((c) => components.push(c));
    if (svcComps.some((c) => c.overridden || c.effectiveRole !== c.role)) {
      overrideAdjustedColors.set(svc.serviceId, recomputeServiceColor(svc.color, svcComps));
    }
  });
  return { components, componentsByService, overrideAdjustedColors };
}

export function mergeColors(colors) {
  const known = (colors || []).filter((color) => ['green', 'yellow', 'red', 'gray'].includes(color));
  if (!known.length) return 'gray';
  if (known.every((color) => color === 'red')) return 'red';
  if (known.some((color) => color === 'red' || color === 'yellow')) return 'yellow';
  return known.includes('gray') ? 'gray' : 'green';
}

function roleOf(component) {
  return component.effectiveRole || component.role;
}

function probeOk(component) {
  return !!(component.probe && component.probe.ok === true);
}

function degraded(component) {
  return probeOk(component) && component.probe.severity === 'yellow';
}

function helperIssue(component) {
  const role = roleOf(component);
  if (CORE_ROLES.has(role)) return false;
  return component.probe?.ok === false || degraded(component);
}

export function recomputeServiceColor(originalColor, components) {
  const list = Array.isArray(components) ? components.filter(Boolean) : [];
  if (list.length === 0) return originalColor || 'gray';
  const cores = list.filter((c) => CORE_ROLES.has(roleOf(c)));
  if (cores.length === 0) return list.some((component) => roleOf(component) === 'job_expected_exit' && component.probe?.ok === false) ? 'yellow' : 'gray';
  if (cores.some((component) => component.probe?.ok === false)) return 'red';
  if (cores.some((component) => !probeOk(component))) return 'gray';
  if (cores.some(degraded)) return 'yellow';
  return list.some(helperIssue) ? 'yellow' : 'green';
}

export function expireStaleHealth(state, now, maxAgeMs) {
  if (!state || !state.enabled || state.updatedAt == null) return state;
  if (now - state.updatedAt < maxAgeMs) return state;
  return { ...state, enabled: false, services: [], stale: true, loading: false };
}

export function createHealthPoller({ refreshMs = 15000, onState, request = fetch }) {
  const interval = Number.isFinite(refreshMs) && refreshMs > 0 ? refreshMs : 15000;
  const maxAgeMs = interval * 4;
  let state = { enabled: false, services: [], updatedAt: null, loading: true, stale: false };
  let stopped = true;
  let blocked = null;
  let pending = null;
  let followUp = false;
  let nextTimer;
  let expiryTimer;
  let requestTimer;
  let controller;
  const publish = (next) => {
    state = next;
    if (!stopped) onState(state);
  };
  const clearTimers = () => {
    clearTimeout(nextTimer);
    clearTimeout(expiryTimer);
    clearTimeout(requestTimer);
  };
  const fetchOnce = async () => {
    controller = new AbortController();
    requestTimer = setTimeout(() => controller.abort(), maxAgeMs);
    try {
      const response = await request('/api/services', { credentials: 'include', signal: controller.signal });
      if (stopped) return;
      if (response.status === 404 || response.status === 401) {
        blocked = response.status;
        clearTimers();
        publish({ enabled: false, services: [], updatedAt: null, loading: false, stale: false });
        return;
      }
      if (!response.ok) throw new Error('Service health unavailable');
      const data = await response.json();
      if (stopped) return;
      clearTimeout(expiryTimer);
      publish({ enabled: true, services: Array.isArray(data.services) ? data.services : [], updatedAt: Date.now(), loading: false, stale: false });
      expiryTimer = setTimeout(() => publish(expireStaleHealth(state, Date.now(), maxAgeMs)), maxAgeMs);
    } catch {
      if (!stopped) publish({ ...expireStaleHealth(state, Date.now(), maxAgeMs), loading: false });
    } finally {
      clearTimeout(requestTimer);
    }
  };
  const refresh = (manual = true) => {
    if (stopped || blocked === 404 || (blocked === 401 && !manual)) return Promise.resolve();
    if (pending) return pending;
    blocked = null;
    clearTimeout(nextTimer);
    pending = fetchOnce().finally(() => {
      pending = null;
      if (!stopped && !blocked) {
        if (followUp) {
          followUp = false;
          refresh(true);
          return;
        }
        nextTimer = setTimeout(() => refresh(false), interval);
      }
    });
    return pending;
  };
  return {
    start: () => { stopped = false; return refresh(false); },
    refresh,
    revalidate: () => {
      if (pending) {
        followUp = true;
        return pending;
      }
      return refresh(true);
    },
    stop: () => { stopped = true; followUp = false; clearTimers(); controller?.abort(); },
  };
}

export function buildIndex(services) {
  const byProject = new Map();
  const byContainer = new Map();
  const byServiceName = new Map();
  (services || []).forEach((svc) => {
    const projectKey = svc.project || '__noproject__';
    if (!byProject.has(projectKey)) byProject.set(projectKey, []);
    byProject.get(projectKey).push(svc);
    if (svc.name) {
      if (!byServiceName.has(svc.name)) byServiceName.set(svc.name, []);
      byServiceName.get(svc.name).push(svc);
    }
    (svc.components || []).forEach((comp) => {
      if (comp.containerId) {
        byContainer.set(comp.containerId, { service: svc, component: comp });
        const short = comp.containerId.slice(0, 12);
        if (!byContainer.has(short)) byContainer.set(short, { service: svc, component: comp });
      }
    });
  });
  return { byProject, byContainer, byServiceName };
}

export function findServiceMatches({ index, isDocker, composeProject, serviceName, containerId, containerIds }) {
  if (!isDocker) return [];
  const uniqIds = Array.from(new Set(
    (Array.isArray(containerIds) && containerIds.length ? containerIds : [containerId])
      .filter((identity) => typeof identity === 'string' && identity.length > 0)
  ));
  if (uniqIds.some((identity) => !index.byContainer.has(identity) && !index.byContainer.has(identity.slice(0, 12)))) return [];
  const matches = [];
  const seen = new Set();
  uniqIds.forEach((id) => {
    const hit = index.byContainer.get(id) || index.byContainer.get(id.slice(0, 12));
    if (hit && !seen.has(hit.service.serviceId)) {
      seen.add(hit.service.serviceId);
      matches.push(hit.service);
    }
  });
  if (uniqIds.length > 0) return matches;
  if (composeProject) {
    const projectServices = index.byProject.get(composeProject) || [];
    return serviceName ? projectServices.filter((service) => service.name === serviceName) : projectServices;
  }
  if (serviceName) {
    const namedServices = index.byServiceName.get(serviceName) || [];
    return namedServices.length === 1 ? namedServices : [];
  }
  return matches;
}
