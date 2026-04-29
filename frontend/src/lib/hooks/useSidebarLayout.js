import { useState, useEffect, useCallback } from "react";

const DEFAULT_SIDEBAR_WIDTH = 360;
const SIDEBAR_DISCOVERY_KEY = "portracker_sidebar_discovery_seen";
const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";
const SIDEBAR_WIDTH_KEY = "sidebarWidth";

function readBool(key, fallback = false) {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return fallback;
  }
}

function readWidth() {
  try {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

export function useSidebarLayout({
  pushHealthToast,
  isWhatsNewOpen,
  loading,
  groupCount,
  logger,
}) {
  const [isCollapsed, setCollapsed] = useState(() => readBool(SIDEBAR_COLLAPSED_KEY));
  const [width, setWidth] = useState(readWidth);
  const [requestedMode, setRequestedMode] = useState(null);
  const [discoverySeen, setDiscoverySeen] = useState(() => readBool(SIDEBAR_DISCOVERY_KEY));
  const [discoveryVisible, setDiscoveryVisible] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState({});

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, isCollapsed ? "true" : "false");
    } catch {
      void 0;
    }
  }, [isCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    } catch (error) {
      logger?.warn?.("Failed to save sidebar width:", error);
    }
  }, [width, logger]);

  const markDiscoverySeen = useCallback(() => {
    setDiscoverySeen(true);
    setDiscoveryVisible(false);
    try {
      localStorage.setItem(SIDEBAR_DISCOVERY_KEY, "true");
    } catch {
      void 0;
    }
  }, []);

  const onCollapseToggle = useCallback(() => {
    setCollapsed((prev) => !prev);
    markDiscoverySeen();
  }, [markDiscoverySeen]);

  const onWidthChange = useCallback((nextWidth) => {
    setWidth(nextWidth);
    if (Math.abs(nextWidth - DEFAULT_SIDEBAR_WIDTH) > 8) markDiscoverySeen();
  }, [markDiscoverySeen]);

  const onDiscoveryDismiss = useCallback((dontShowAgain) => {
    setDiscoveryVisible(false);
    if (dontShowAgain) markDiscoverySeen();
  }, [markDiscoverySeen]);

  const onDiscoveryTry = useCallback(() => onCollapseToggle(), [onCollapseToggle]);

  const onOpenAddServer = useCallback(() => {
    setCollapsed(false);
    setRequestedMode("add");
    markDiscoverySeen();
  }, [markDiscoverySeen]);

  const onSidebarMaxedOut = useCallback(() => {
    pushHealthToast?.({ type: "info", message: "Sidebar maxed. Hope you have ports." });
  }, [pushHealthToast]);

  const onRequestedModeHandled = useCallback(() => setRequestedMode(null), []);

  const stampRefreshed = useCallback((items) => {
    setLastRefreshedAt((prev) => {
      const now = Date.now();
      const next = { ...prev };
      items.forEach((s) => { next[s.id] = now; });
      return next;
    });
  }, []);

  useEffect(() => {
    if (discoverySeen || loading || !groupCount || isCollapsed || isWhatsNewOpen) {
      setDiscoveryVisible(false);
      return undefined;
    }
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      return undefined;
    }
    const timer = setTimeout(() => setDiscoveryVisible(true), 2200);
    return () => clearTimeout(timer);
  }, [discoverySeen, loading, groupCount, isCollapsed, isWhatsNewOpen]);

  return {
    isCollapsed,
    width,
    requestedMode,
    discoveryVisible,
    lastRefreshedAt,
    stampRefreshed,
    onCollapseToggle,
    onWidthChange,
    onDiscoveryDismiss,
    onDiscoveryTry,
    onOpenAddServer,
    onSidebarMaxedOut,
    onRequestedModeHandled,
  };
}
