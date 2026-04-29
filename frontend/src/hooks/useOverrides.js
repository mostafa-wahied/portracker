import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'portracker.componentOverrides.v1';
const VALID_ROLES = new Set(['core_runtime', 'core_access', 'support', 'job_expected_exit', 'unknown']);

const OverridesContext = createContext(null);

function makeKey(serviceId, containerId) {
  if (!serviceId || !containerId) return null;
  return String(serviceId) + '::' + String(containerId);
}

function readFromStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out = {};
    Object.keys(parsed).forEach((k) => {
      const v = parsed[k];
      if (typeof v === 'string' && VALID_ROLES.has(v)) out[k] = v;
    });
    return out;
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

export function OverridesProvider({ children }) {
  const [overrides, setOverrides] = useState(() => readFromStorage());

  useEffect(() => {
    writeToStorage(overrides);
  }, [overrides]);

  const getOverride = useCallback(
    (serviceId, containerId) => {
      const k = makeKey(serviceId, containerId);
      if (!k) return null;
      return overrides[k] || null;
    },
    [overrides]
  );

  const setOverride = useCallback((serviceId, containerId, role) => {
    const k = makeKey(serviceId, containerId);
    if (!k) return;
    setOverrides((prev) => {
      if (!role) {
        if (!(k in prev)) return prev;
        const next = { ...prev };
        delete next[k];
        return next;
      }
      if (!VALID_ROLES.has(role)) return prev;
      if (prev[k] === role) return prev;
      return { ...prev, [k]: role };
    });
  }, []);

  const clearOverride = useCallback((serviceId, containerId) => {
    setOverride(serviceId, containerId, null);
  }, [setOverride]);

  const clearAllForService = useCallback((serviceId) => {
    if (!serviceId) return;
    const prefix = String(serviceId) + '::';
    setOverrides((prev) => {
      const next = {};
      let changed = false;
      Object.keys(prev).forEach((k) => {
        if (k.startsWith(prefix)) {
          changed = true;
          return;
        }
        next[k] = prev[k];
      });
      return changed ? next : prev;
    });
  }, []);

  const clearAll = useCallback(() => {
    setOverrides((prev) => (Object.keys(prev).length === 0 ? prev : {}));
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
