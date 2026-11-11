import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useOverrides } from './useOverrides';
import { applyOverridesToMatches, buildIndex, findServiceMatches, createHealthPoller, mergeColors, resolveComponentOverride } from '@/lib/service-health-state';
import { humanizeProbeError } from '@/lib/health-copy';

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


function isAmbientGray(comps, effectiveColor) {
  if (effectiveColor !== 'gray' || !comps || comps.length === 0) return false;
  return comps.every((c) => {
    const rule = c.effectiveRuleId || c.ruleId;
    if (rule === 'R6' && c.probe?.ok === true) return true;
    if (rule === 'R8' && c.probe?.ok === true && c.probe.severity !== 'yellow') return true;
    return false;
  });
}

function describeMatches(matches, color, effectiveServiceColor, componentsByService) {
  if (matches.length === 1) {
    return effectiveServiceColor(matches[0]) === matches[0].color ? (matches[0].reason || null) : null;
  }
  if (color === 'green') {
    const greens = matches.filter((s) => effectiveServiceColor(s) === 'green');
    const ambient = matches.length - greens.length;
    const names = greens.slice(0, 3).map((s) => s.name || s.serviceId).join(', ');
    const extraGreen = greens.length > 3 ? ` (+${greens.length - 3} more)` : '';
    return ambient > 0
      ? `${greens.length} main service${greens.length === 1 ? '' : 's'} reachable (${names}${extraGreen}); ${ambient} helper checked`
      : `${greens.length} main service${greens.length === 1 ? '' : 's'} reachable: ${names}${extraGreen}`;
  }
  const worst = matches.filter((service) => effectiveServiceColor(service) === color
    || (color === 'yellow' && effectiveServiceColor(service) === 'red'));
  const names = worst.slice(0, 3).map((s) => s.name || s.serviceId).join(', ');
  const extra = worst.length > 3 ? ` (+${worst.length - 3} more)` : '';
  const firstError = worst.flatMap((s) => componentsByService.get(s.serviceId) || s.components || [])
    .map((c) => humanizeProbeError(c && c.probe && c.probe.error) || c.reason).find(Boolean) || null;
  const available = matches.some((service) => effectiveServiceColor(service) === 'green');
  const label = color === 'yellow' ? (available ? 'Partially available' : 'Issues detected') : color === 'red' ? 'Unavailable' : 'Health not fully assessed';
  return `${label}${names ? `: ${names}${extra}` : ''}${firstError ? `: ${firstError}` : ''}`;
}

function buildLookupCard(state, index, getOverride) {
  return (args) => {
    if (!state.enabled) return null;
    const matches = findServiceMatches({ index, ...args });
    if (!matches.length) return null;
    const { components, componentsByService, overrideAdjustedColors } = applyOverridesToMatches(matches, getOverride);
    const effectiveServiceColor = (svc) => {
      const current = overrideAdjustedColors.has(svc.serviceId) ? overrideAdjustedColors.get(svc.serviceId) : svc.color;
      const comps = componentsByService.get(svc.serviceId) || svc.components || [];
      const issue = comps.some((component) => component.probe?.ok === false || component.probe?.severity === 'yellow');
      return matches.length > 1 && current === 'gray' && issue ? 'yellow' : current;
    };
    const effective = matches.filter((m) => !isAmbientGray(componentsByService.get(m.serviceId) || m.components, effectiveServiceColor(m)));
    const colorSource = effective.length > 0 ? effective : matches;
    const color = mergeColors(colorSource.map(effectiveServiceColor).filter(Boolean));
    const reason = describeMatches(matches, color, effectiveServiceColor, componentsByService);
    const checkedTimes = matches.map((service) => service.checkedAt).filter(Number.isFinite);
    const checkedAt = checkedTimes.length ? Math.min(...checkedTimes) : null;
    return { color, reason, services: matches, components, checkedAt };
  };
}

export function ServiceHealthProvider({ children, refreshMs = 15000 }) {
  const [state, setState] = useState({ enabled: false, services: [], updatedAt: null, loading: true });
  const pollerRef = useRef(null);
  const fetchOnce = useCallback(() => pollerRef.current?.refresh() || Promise.resolve(), []);
  const { getOverride, mutationVersion } = useOverrides();
  useEffect(() => {
    const poller = createHealthPoller({ refreshMs, onState: setState });
    pollerRef.current = poller;
    poller.start();
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [refreshMs]);

  useEffect(() => {
    if (mutationVersion > 0) pollerRef.current?.revalidate();
  }, [mutationVersion]);

  const index = useMemo(() => buildIndex(state.services), [state.services]);

  const value = useMemo(() => {
    const lookupCard = buildLookupCard(state, index, getOverride);

    const lookupPort = ({ container_id: containerId }) => {
      if (!state.enabled || !containerId) return null;
      const hit = index.byContainer.get(containerId) || index.byContainer.get(containerId.slice(0, 12));
      if (!hit) return null;
      const ovRole = getOverride(hit.service.serviceId, hit.component.containerId || containerId);
      return {
        component: resolveComponentOverride(hit.component, ovRole),
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
