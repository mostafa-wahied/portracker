import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'portracker.componentOverrides.v1';
const VALID_ROLES = new Set(['core_runtime', 'core_access', 'support', 'job_expected_exit', 'unknown']);

const OverridesContext = createContext(null);

function normalizeFromStorage(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  Object.keys(raw).forEach((k) => {
    const v = raw[k];
    if (typeof v !== 'string' || !VALID_ROLES.has(v)) return;
    const idx = k.indexOf('::');
    const key = idx >= 0 ? k.slice(idx + 2) : k;
    if (key) out[key] = v;
  });
  return out;
}

function readFromStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return normalizeFromStorage(JSON.parse(raw));
  } catch {
    return {};
  }
}

function writeToStorage(map) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    return;
  }
}

async function fetchJsonOk(input, init) {
  const res = await fetch(input, init);
  if (!res.ok) {
    const err = new Error('HTTP ' + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export function OverridesProvider({ children }) {
  const [overrides, setOverrides] = useState(() => readFromStorage());
  const overridesRef = useRef(overrides);

  useEffect(() => {
    overridesRef.current = overrides;
    writeToStorage(overrides);
  }, [overrides]);

  useEffect(() => {
    let cancelled = false;
    fetchJsonOk('/api/overrides', { credentials: 'include' })
      .then((data) => {
        if (cancelled) return;
        const next = data && data.overrides && typeof data.overrides === 'object' ? data.overrides : {};
        setOverrides(next);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const getOverride = useCallback(
    (_serviceId, containerId) => (containerId ? overrides[containerId] || null : null),
    [overrides]
  );

  const setOverride = useCallback(async (serviceId, containerId, role) => {
    if (!serviceId || !containerId) return;
    if (role && !VALID_ROLES.has(role)) return;
    const prev = overridesRef.current;
    let next;
    if (role) {
      if (prev[containerId] === role) return;
      next = { ...prev, [containerId]: role };
    } else {
      if (!(containerId in prev)) return;
      next = { ...prev };
      delete next[containerId];
    }
    setOverrides(next);
    try {
      const url = '/api/services/' + encodeURIComponent(serviceId) + '/components/' + encodeURIComponent(containerId) + '/role';
      if (role) {
        await fetchJsonOk(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ role }),
        });
      } else {
        await fetchJsonOk(url, { method: 'DELETE', credentials: 'include' });
      }
    } catch {
      setOverrides(prev);
    }
  }, []);

  const clearOverride = useCallback((serviceId, containerId) => setOverride(serviceId, containerId, null), [setOverride]);

  const clearAllForService = useCallback(async (serviceId) => {
    if (!serviceId) return;
    const prev = overridesRef.current;
    try {
      await fetchJsonOk('/api/services/' + encodeURIComponent(serviceId) + '/overrides', {
        method: 'DELETE',
        credentials: 'include',
      });
      const fresh = await fetchJsonOk('/api/overrides', { credentials: 'include' });
      const map = fresh && fresh.overrides && typeof fresh.overrides === 'object' ? fresh.overrides : {};
      setOverrides(map);
    } catch {
      setOverrides(prev);
    }
  }, []);

  const clearAll = useCallback(async () => {
    const prev = overridesRef.current;
    setOverrides({});
    try {
      await fetchJsonOk('/api/overrides', { method: 'DELETE', credentials: 'include' });
    } catch {
      setOverrides(prev);
    }
  }, []);

  const value = useMemo(
    () => ({ overrides, getOverride, setOverride, clearOverride, clearAllForService, clearAll }),
    [overrides, getOverride, setOverride, clearOverride, clearAllForService, clearAll]
  );

  return React.createElement(OverridesContext.Provider, { value }, children);
}

export function useOverrides() {
  const ctx = useContext(OverridesContext);
  if (!ctx) {
    return {
      overrides: {},
      getOverride: () => null,
      setOverride: () => {},
      clearOverride: () => {},
      clearAllForService: () => {},
      clearAll: () => {},
    };
  }
  return ctx;
}
