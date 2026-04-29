import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useOverrides } from './useOverrides';

const ServiceHealthContext = createContext(null);

const ROLE_LABELS = {
  core_access: 'core',
  core_runtime: 'core',
  support: 'support',
  job_expected_exit: 'finished job',
  unknown: 'unknown',
};

const RULE_LABELS = {
  R1: 'container check',
  R2: 'you set this',
  R3: 'depended on',
  R4: 'only port',
  R5: 'loopback or UDP sibling',
  R6: 'finished job',
  R7: 'guessed from name',
  R8: 'unknown',
};

const COLOR_SEVERITY = { green: 0, gray: 1, yellow: 2, red: 3 };

function isCoreRole(role) {
  return role === 'core_runtime' || role === 'core_access';
}

function recomputeServiceColor(originalColor, components) {
  const list = Array.isArray(components) ? components : [];
  if (list.length === 0) return originalColor || 'gray';
  const cores = list.filter((c) => isCoreRole(c.effectiveRole || c.role));
  if (cores.length === 0) return originalColor || 'gray';
  const coreFailed = cores.some((c) => c.probe && c.probe.ok === false);
  if (coreFailed) return 'red';
  const supports = list.filter((c) => (c.effectiveRole || c.role) === 'support');
  const supportFailed = supports.some((c) => c.probe && c.probe.ok === false);
  if (supportFailed) return 'yellow';
  const allCoreOk = cores.every((c) => c.probe && c.probe.ok === true);
  return allCoreOk ? 'green' : (originalColor || 'gray');
}

function mergeColors(colors) {
  let worst = 'green';
  colors.forEach((c) => {
    if ((COLOR_SEVERITY[c] || 0) > (COLOR_SEVERITY[worst] || 0)) worst = c;
  });
  return worst;
}

function buildIndex(services) {
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

function findServiceMatches({ index, isDocker, composeProject, serviceName, containerId, containerIds }) {
  if (!isDocker) return [];
  const uniqIds = Array.from(new Set(
    (Array.isArray(containerIds) && containerIds.length ? containerIds : [containerId]).filter(Boolean)
  ));
  const matches = [];
  const seen = new Set();
  uniqIds.forEach((id) => {
    const hit = index.byContainer.get(id) || index.byContainer.get(id.slice(0, 12));
    if (hit && !seen.has(hit.service.serviceId)) {
      seen.add(hit.service.serviceId);
      matches.push(hit.service);
    }
  });
  if (matches.length === 0 && composeProject) return index.byProject.get(composeProject) || [];
  if (matches.length === 0 && serviceName) return index.byServiceName.get(serviceName) || [];
  return matches;
}

function applyOverridesToMatches(matches, getOverride) {
  const components = [];
  const overrideAdjustedColors = new Map();
  matches.forEach((svc) => {
    let serviceHasOverride = false;
    const svcComps = (svc.components || []).map((comp) => {
      const ovRole = comp.containerId ? getOverride(svc.serviceId, comp.containerId) : null;
      const overridden = !!ovRole;
      if (overridden) serviceHasOverride = true;
      return { ...comp, _serviceName: svc.name, _serviceId: svc.serviceId, effectiveRole: ovRole || comp.role, overridden };
    });
    svcComps.forEach((c) => components.push(c));
    if (serviceHasOverride) {
      overrideAdjustedColors.set(svc.serviceId, recomputeServiceColor(svc.color, svcComps));
    }
  });
  return { components, overrideAdjustedColors };
}

function isAmbientGray(svc, effectiveColor) {
  if (effectiveColor !== 'gray') return false;
  const comps = svc.components || [];
  if (comps.length === 0) return false;
  return comps.every((c) => {
    if (c.ruleId === 'R6') return true;
    if (c.ruleId === 'R8' && c.probe && c.probe.ok === true) return true;
    return false;
  });
}

function describeMatches(matches, color, effectiveServiceColor) {
  if (matches.length === 1) return matches[0].reason || null;
  if (color === 'green') {
    const greens = matches.filter((s) => effectiveServiceColor(s) === 'green');
    const ambient = matches.length - greens.length;
    const names = greens.slice(0, 3).map((s) => s.name || s.serviceId).join(', ');
    const extraGreen = greens.length > 3 ? ` (+${greens.length - 3} more)` : '';
    return ambient > 0
      ? `${greens.length} main service${greens.length === 1 ? '' : 's'} reachable (${names}${extraGreen}); ${ambient} helper checked`
      : `${greens.length} main service${greens.length === 1 ? '' : 's'} reachable: ${names}${extraGreen}`;
  }
  const worst = matches.filter((s) => effectiveServiceColor(s) === color);
  const names = worst.slice(0, 3).map((s) => s.name || s.serviceId).join(', ');
  const extra = worst.length > 3 ? ` (+${worst.length - 3} more)` : '';
  const firstError = worst.flatMap((s) => s.components || [])
    .map((c) => (c && c.probe && c.probe.error) || c.reason).find(Boolean) || null;
  return `${color} via ${names}${extra}${firstError ? `: ${firstError}` : ''}`;
}

function buildLookupCard(state, index, getOverride) {
  return (args) => {
    if (!state.enabled) return null;
    const matches = findServiceMatches({ index, ...args });
    if (!matches.length) return null;
    const { components, overrideAdjustedColors } = applyOverridesToMatches(matches, getOverride);
    const effectiveServiceColor = (svc) =>
      overrideAdjustedColors.has(svc.serviceId) ? overrideAdjustedColors.get(svc.serviceId) : svc.color;
    const effective = matches.filter((m) => !isAmbientGray(m, effectiveServiceColor(m)));
    const colorSource = effective.length > 0 ? effective : matches;
    const color = mergeColors(colorSource.map(effectiveServiceColor).filter(Boolean));
    const reason = describeMatches(matches, color, effectiveServiceColor);
    return { color, reason, services: matches, components };
  };
}

export function ServiceHealthProvider({ children, refreshMs = 15000 }) {
  const [state, setState] = useState({ enabled: false, services: [], updatedAt: null, loading: true });
  const disabledRef = useRef(false);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch('/api/services', { credentials: 'include' });
      if (res.status === 404) {
        disabledRef.current = true;
        setState({ enabled: false, services: [], updatedAt: null, loading: false });
        return;
      }
      if (!res.ok) {
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }
      const data = await res.json();
      setState({
        enabled: true,
        services: Array.isArray(data.services) ? data.services : [],
        updatedAt: Date.now(),
        loading: false,
      });
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    fetchOnce();
  }, [fetchOnce]);

  useEffect(() => {
    if (disabledRef.current) return;
    const id = setInterval(fetchOnce, refreshMs);
    return () => clearInterval(id);
  }, [fetchOnce, refreshMs]);

  const index = useMemo(() => buildIndex(state.services), [state.services]);
  const { getOverride } = useOverrides();

  const value = useMemo(() => {
    const lookupCard = buildLookupCard(state, index, getOverride);

    const lookupPort = ({ container_id: containerId }) => {
      if (!state.enabled || !containerId) return null;
      const hit = index.byContainer.get(containerId) || index.byContainer.get(containerId.slice(0, 12));
      if (!hit) return null;
      return {
        component: hit.component,
        service: hit.service,
      };
    };

    return {
      enabled: state.enabled,
      loading: state.loading,
      updatedAt: state.updatedAt,
      services: state.services,
      refresh: fetchOnce,
      lookupCard,
      lookupPort,
    };
  }, [state, index, fetchOnce, getOverride]);

  return React.createElement(ServiceHealthContext.Provider, { value }, children);
}

export function useServiceHealth() {
  const ctx = useContext(ServiceHealthContext);
  if (!ctx) {
    return {
      enabled: false,
      loading: false,
      updatedAt: null,
      services: [],
      refresh: () => {},
      lookupCard: () => null,
      lookupPort: () => null,
    };
  }
  return ctx;
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || 'unknown';
}

export function ruleLabel(ruleId) {
  return RULE_LABELS[ruleId] || ruleId || '';
}

export { ROLE_LABELS, RULE_LABELS };
