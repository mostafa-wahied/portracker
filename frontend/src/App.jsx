import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AppHeader } from "./components/layout/AppHeader";
import { ServerSection } from "./components/server/ServerSection";
import { Sidebar } from "./components/layout/Sidebar";
import { Label } from "@/components/ui/label";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { MultipleServerSkeleton } from "./components/server/MultipleServerSkeleton";
import { WhatsNewModal } from "./components/ui/WhatsNewModal";
import { ServiceRenameModal } from "./components/server/ServiceRenameModal";
import { BatchOperationsBar } from "./components/server/BatchOperationsBar";
import { BatchRenameModal } from "./components/server/BatchRenameModal";
import { BatchHideModal } from "./components/server/BatchHideModal";
import { BatchNotesModal } from "./components/server/BatchNotesModal";
import { LoginPage } from "./components/auth/LoginPage";
import { ChangePasswordPage } from "./components/auth/ChangePasswordPage";
import { BarChart3 } from "lucide-react";
import Logger from "./lib/logger";
import { useWhatsNew } from "./lib/hooks/useWhatsNew";
import { saveCustomServiceName, deleteCustomServiceName, getCustomServiceNames, batchCustomServiceNames } from "./lib/api/customServiceNames";
import { batchNotes, saveNote } from "./lib/api/notes";
import { generatePortKey } from "./lib/utils/portUtils";
import { formatUptime } from "@/lib/utils";
import { useAuth } from "./contexts/AuthContext";
import { buildAutoRefreshMessages } from "@/lib/autoRefreshMessages";

const keyOf = (srvId, p) => generatePortKey(srvId, p);

const logger = new Logger('App');

const KONAMI_SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a"
];

const KONAMI_HINTS = ["↑", "Course input detected…", "gg, keyboard pilot."];


export default function App() {
  const auth = useAuth();
  const { shouldShowButton: shouldShowWhatsNewButton, handleShow: handleShowWhatsNew, getModalProps: getWhatsNewModalProps } = useWhatsNew();
  
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [modalSrvId, setModalSrvId] = useState("");
  const [modalPort, setModalPort] = useState(null);
  const [draftNote, setDraftNote] = useState("");

  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameSrvId, setRenameSrvId] = useState("");
  const [renamePort, setRenamePort] = useState(null);

  const [batchRenameModalOpen, setBatchRenameModalOpen] = useState(false);
  const [batchHideModalOpen, setBatchHideModalOpen] = useState(false);
  const [batchNotesModalOpen, setBatchNotesModalOpen] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [renameLoading, setRenameLoading] = useState(false);
  const [hackerMode, setHackerMode] = useState(() => {
    try {
      return localStorage.getItem("portracker_hacker_mode") === "true";
    } catch {
      return false;
    }
  });
  const [konamiHint, setKonamiHint] = useState(null);
  const konamiProgressRef = useRef(0);
  const konamiHintStageRef = useRef(0);
  const konamiHintTimeoutRef = useRef(null);
  const [healthToast, setHealthToast] = useState(null);
  const healthToastTimeoutRef = useRef(null);

  const showKonamiHint = useCallback((stage) => {
    const index = Math.min(stage, KONAMI_HINTS.length - 1);
    setKonamiHint(KONAMI_HINTS[index]);
    if (konamiHintTimeoutRef.current) {
      clearTimeout(konamiHintTimeoutRef.current);
    }
    konamiHintTimeoutRef.current = setTimeout(() => setKonamiHint(null), 1200);
  }, []);

  useEffect(() => () => {
    if (konamiHintTimeoutRef.current) {
      clearTimeout(konamiHintTimeoutRef.current);
    }
  }, []);

  useEffect(() => () => {
    if (healthToastTimeoutRef.current) {
      clearTimeout(healthToastTimeoutRef.current);
    }
  }, []);

  const pushHealthToast = useCallback((payload) => {
    setHealthToast(payload);
    if (healthToastTimeoutRef.current) {
      clearTimeout(healthToastTimeoutRef.current);
    }
    healthToastTimeoutRef.current = setTimeout(() => setHealthToast(null), 4000);
  }, []);

  const toggleHackerMode = useCallback(() => {
    setHackerMode(prev => {
      const next = !prev;
      pushHealthToast({
        type: "info",
        message: next
          ? "Hacker mode activated. Use Ctrl+Shift+H to toggle."
          : "Hacker mode disabled."
      });
      return next;
    });
    konamiHintStageRef.current = 0;
    konamiProgressRef.current = 0;
  }, [pushHealthToast]);

  const disableHackerMode = useCallback(() => {
    setHackerMode(prev => {
      if (!prev) return prev;
      pushHealthToast({
        type: "info",
        message: "Hacker mode disabled."
      });
      return false;
    });
    konamiHintStageRef.current = 0;
    konamiProgressRef.current = 0;
  }, [pushHealthToast]);

  useEffect(() => {
    try {
      localStorage.setItem("portracker_hacker_mode", hackerMode ? "true" : "false");
    } catch { void 0; }
    if (typeof document !== "undefined") {
      document.body.classList.toggle("hacker-mode", hackerMode);
    }
  }, [hackerMode]);

  const [actionFeedback, setActionFeedback] = useState({
    copy: null,
    edit: null,
    hide: null,
    unhide: null,
  });

  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (localStorage.theme === "dark") {
      return true;
    }
    if (localStorage.theme === "light") {
      return false;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState(
    () => localStorage.getItem("selectedServerId") || null
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [searchScope, setSearchScope] = useState(() => {
    try {
      const saved = localStorage.getItem("searchScope");
      if (saved === "all") return "all";
      return "server";
    } catch {
      return "server";
    }
  });
  const [searchHighlighting, setSearchHighlighting] = useState(() => {
    try {
      const saved = localStorage.getItem("searchHighlighting");
      return saved ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });
  const [filters, setFilters] = useState(() => {
    try {
      const saved = localStorage.getItem("portFilters");
      return saved
        ? JSON.parse(saved)
        : {
            docker: true,
            system: false,
          };
    } catch {
      return {
        docker: true,
        system: false,
      };
    }
  });

  const [expandedServers, setExpandedServers] = useState(() => {
    try {
      const saved = localStorage.getItem("expandedServers");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [openAccordions, setOpenAccordions] = useState(() => {
    try {
      const saved = localStorage.getItem("openAccordions");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [infoCardLayout, setInfoCardLayout] = useState(() => {
    try {
      const saved = localStorage.getItem("infoCardLayout");
      return saved || "grid";
    } catch {
      return "grid";
    }
  });

  const [portLayout, setPortLayout] = useState(() => {
    try {
      const saved = localStorage.getItem("portLayout");
      return saved || "list";
    } catch {
      return "list";
    }
  });

  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [deepLinkContainer, setDeepLinkContainer] = useState(null);
  const [deepLinkServer, setDeepLinkServer] = useState(null);
  const [appliedDeepLink, setAppliedDeepLink] = useState(false);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPorts, setSelectedPorts] = useState(new Set());

  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem("autoRefreshEnabled");
      return saved === "true";
    } catch {
      return false;
    }
  });
  const [portSuggestions, setPortSuggestions] = useState({});

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
      localStorage.theme = "dark";
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.theme = "light";
    }
  }, [isDarkMode]);

  useEffect(() => {
    try {
      localStorage.setItem("portFilters", JSON.stringify(filters));
    } catch (error) {
      logger.warn("Failed to save filter settings:", error);
    }
  }, [filters]);

  useEffect(() => {
    try {
      localStorage.setItem("expandedServers", JSON.stringify(expandedServers));
    } catch (error) {
      logger.warn("Failed to save expanded servers state:", error);
    }
  }, [expandedServers]);

  useEffect(() => {
    try {
      localStorage.setItem("openAccordions", JSON.stringify(openAccordions));
    } catch (error) {
      logger.warn("Failed to save open accordions state:", error);
    }
  }, [openAccordions]);

  useEffect(() => {
    try {
      localStorage.setItem("infoCardLayout", infoCardLayout);
    } catch (error) {
      logger.warn("Failed to save info card layout setting:", error);
    }
  }, [infoCardLayout]);

  useEffect(() => {
    try {
      localStorage.setItem("portLayout", portLayout);
    } catch (error) {
      logger.warn("Failed to save port layout setting:", error);
    }
  }, [portLayout]);

  useEffect(() => {
    if (selectedServer) {
      localStorage.setItem("selectedServerId", selectedServer);
    } else {
      localStorage.removeItem("selectedServerId");
    }
  }, [selectedServer]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "searchHighlighting",
        JSON.stringify(searchHighlighting)
      );
    } catch (error) {
      logger.warn("Failed to save search highlighting setting:", error);
    }
  }, [searchHighlighting]);

  useEffect(() => {
    try {
      localStorage.setItem("searchScope", searchScope);
    } catch (error) {
      logger.warn("Failed to save search scope setting:", error);
    }
  }, [searchScope]);

  useEffect(() => {
    try {
      localStorage.setItem("autoRefreshEnabled", autoRefreshEnabled.toString());
    } catch (error) {
      logger.warn("Failed to save auto-refresh setting:", error);
    }
  }, [autoRefreshEnabled]);

  const generatePortForServer = useCallback(async (serverId) => {
    setPortSuggestions((prev) => ({
      ...prev,
      [serverId]: { ...(prev[serverId] || {}), loading: true, error: null },
    }));

    try {
      const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/generate-port`, {
        method: "POST",
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `Failed to generate port (HTTP ${response.status})`);
      }

      const payload = await response.json();
      setPortSuggestions((prev) => ({
        ...prev,
        [serverId]: {
          port: payload.port,
          meta: payload.meta || null,
          generatedAt: Date.now(),
          loading: false,
          error: null,
        },
      }));
    } catch (error) {
      logger.error("Failed to generate unused port:", error);
      setPortSuggestions((prev) => ({
        ...prev,
        [serverId]: {
          ...(prev[serverId] || {}),
          loading: false,
          error: error.message || "Failed to generate port",
        },
      }));
    }
  }, []);

  const handleSelectServer = useCallback((serverId) => {
    setSelectedServer(serverId);
    if (window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, []);

  const toggleServerExpanded = useCallback((serverId) => {
    setExpandedServers((prev) => ({
      ...prev,
      [serverId]: !prev[serverId],
    }));
  }, []);

  const handleAccordionChange = useCallback((serverId, openItems) => {
    setOpenAccordions((prev) => ({
      ...prev,
      [serverId]: openItems,
    }));
  }, []);

  const transformCollectorData = useCallback(
    async (collectorData, serverId, serverUrl = null) => {
      if (!collectorData.ports || !Array.isArray(collectorData.ports)) {
        logger.warn(
          `transformCollectorData: No ports array in collectorData for serverId ${serverId}`,
          collectorData
        );
        return [];
      }

      const transformedPorts = collectorData.ports
        .filter((port) => {
          if (
            port.host_ip &&
            (port.host_ip.includes("::") || port.host_ip === "[::]")
          ) {
            return false;
          }
          if (!port.host_port || port.host_port <= 0) return false;
          return true;
        })
        .map((port) => ({
          source: port.source || null,
          owner: port.owner || null,
          protocol: port.protocol || null,
          host_ip: port.host_ip || null,
          host_port: port.host_port || null,
          target: port.target || null,
          container_id: port.container_id || null,
          vm_id: port.vm_id || null,
          app_id: port.app_id || null,
          note: port.note || null,
          ignored: !!port.ignored,
          created: port.created || null,
          internal: port.internal || false,
        }));

      const uniquePorts = [];
      const seenKeys = new Set();

      transformedPorts.forEach((port) => {
        const key = generatePortKey(serverId, port);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniquePorts.push(port);
        } else {
          logger.debug(`DUPLICATE DETECTED - Filtering out port with key: ${key}`, port);
        }
      });

      let customServiceNames = [];
      try {
        customServiceNames = await getCustomServiceNames(serverId, serverUrl);
        logger.debug(`Loaded ${customServiceNames.length} custom service names for ${serverId}`);
      } catch (error) {
        logger.warn(`Failed to load custom service names for ${serverId}:`, error);
      }

      const customNameMap = new Map();
      customServiceNames.forEach(item => {
        const key = `${item.host_ip}:${item.host_port}:${item.container_id || ''}:${item.internal || 0}`;
        customNameMap.set(key, {
          customServiceName: item.custom_name,
          originalServiceName: item.original_name
        });
      });

      const groupMap = new Map();

      uniquePorts.forEach((port) => {
        let customNameData = null;
        
        const customNameKey = `${port.host_ip}:${port.host_port}:${port.container_id || ''}:${port.internal || false ? 1 : 0}`;
        customNameData = customNameMap.get(customNameKey);
        
        if (!customNameData) {
          const fallbackKeys = [
            `0.0.0.0:${port.host_port}:${port.container_id || ''}:${port.internal || false ? 1 : 0}`,
            `[::]:${port.host_port}:${port.container_id || ''}:${port.internal || false ? 1 : 0}`,
            `host.docker.internal:${port.host_port}:${port.container_id || ''}:${port.internal || false ? 1 : 0}`
          ];
          
          for (const key of fallbackKeys) {
            customNameData = customNameMap.get(key);
            if (customNameData) {
              break;
            }
          }
        }
        
        if (customNameData) {
          port.customServiceName = customNameData.customServiceName;
          port.originalServiceName = customNameData.originalServiceName;
        }

        if (port.source === "docker") {
          const groupKey = `${port.container_id || port.app_id || port.owner}${port.internal ? '-internal' : ''}`;
          if (!groupMap.has(groupKey)) {
            groupMap.set(groupKey, []);
          }
          groupMap.get(groupKey).push(port);
        } else {
          const uniqueKey = `${port.source}-${port.host_ip}-${port.host_port}-${
            port.owner
          }-${port.pid || Math.random()}`;
          groupMap.set(uniqueKey, [port]);
        }
      });

      const portsWithGroupInfo = [];

      groupMap.forEach((portsInGroup) => {
        portsInGroup.sort((a, b) => a.host_port - b.host_port);

        portsInGroup.forEach((port, index) => {
          portsWithGroupInfo.push({
            ...port,
            groupId:
              port.source === "docker"
                ? port.container_id || port.app_id || port.owner
                : `${port.source}-${port.host_ip}-${port.host_port}-${
                    port.owner
                  }-${port.pid || Math.random()}`,
            groupIndex: index,
            groupCount: portsInGroup.length,
            groupSiblings: portsInGroup.map(
              (p) => `${p.host_ip}:${p.host_port}`
            ),
          });
        });
      });

      logger.debug(
        `Final result: Transformed ${collectorData.ports.length} raw ports into ${portsWithGroupInfo.length} unique valid ports with grouping`
      );
      return portsWithGroupInfo;
    },
    []
  );

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPortSuggestions({});

    try {
      const serversResponse = await fetch("/api/servers");
      if (!serversResponse.ok) {
        throw new Error(`Failed to fetch servers: ${serversResponse.status}`);
      }
      const currentServers = await serversResponse.json();

      const enrichedServers = await Promise.all(
        currentServers.map(async (server) => {
          if (server.id === "local") {
            try {
              const scanResponse = await fetch(
                `/api/servers/${server.id}/scan`
              );
              if (scanResponse.ok) {
                const scanData = await scanResponse.json();
                const transformedPorts = await transformCollectorData(
                  scanData,
                  server.id,
                  null
                );
                return {
                  id: server.id,
                  server: server.label,
                  ok: true,
                  platform: scanData.platform,
                  platformName: scanData.platformName,
                  data: transformedPorts,
                  systemInfo: scanData.systemInfo,
                  applications: scanData.applications,
                  vms: scanData.vms,
                  parentId: server.parentId,
                  platform_type: server.platform_type || scanData.platform,
                  enhancedFeaturesEnabled: scanData.enhancedFeaturesEnabled ?? true,
                };
              } else {
                const errorData = await scanResponse
                  .json()
                  .catch(() => ({
                    error: `Local scan failed with status ${scanResponse.status}`,
                  }));
                logger.warn(
                  `Local scan API for ${server.id} failed:`,
                  errorData.error
                );
                return {
                  id: server.id,
                  server: server.label,
                  ok: false,
                  error: errorData.error || "Local server data unavailable",
                  data: [],
                  parentId: server.parentId,
                  platform_type: server.platform_type || "unknown",
                };
              }
            } catch (error) {
              logger.error("Error scanning local server:", error);
              return {
                id: server.id,
                server: server.label,
                ok: false,
                error: error.message,
                data: [],
                parentId: server.parentId,
                platform_type: server.platform_type || "unknown",
              };
            }
          }

          if (server.type === "peer" && server.url) {
            try {
              const scanResponse = await fetch(
                `/api/servers/${server.id}/scan`
              );
              if (scanResponse.ok) {
                const scanData = await scanResponse.json();
                const transformedPorts = await transformCollectorData(
                  scanData,
                  server.id,
                  server.url
                );
                return {
                  id: server.id,
                  server: server.label,
                  ok: true,
                  url: server.url,
                  platform: scanData.platform,
                  platformName: scanData.platformName,
                  data: transformedPorts,
                  systemInfo: scanData.systemInfo,
                  applications: scanData.applications,
                  vms: scanData.vms,
                  parentId: server.parentId,
                  platform_type: server.platform_type || scanData.platform,
                  enhancedFeaturesEnabled: scanData.enhancedFeaturesEnabled ?? true,
                };
              } else {
                const errorData = await scanResponse.json().catch(() => ({
                  error: `Failed to scan peer '${server.label}' via backend. Status: ${scanResponse.status}`,
                }));
                logger.warn(
                  `Failed to scan peer ${server.id} (${server.label}):`,
                  errorData.details || errorData.error
                );
                return {
                  id: server.id,
                  server: server.label,
                  ok: false,
                  error:
                    errorData.details ||
                    errorData.error ||
                    `Scan failed (status ${scanResponse.status})`,
                  data: [],
                  parentId: server.parentId,
                  platform_type: server.platform_type || "unknown",
                };
              }
            } catch (error) {
              logger.error(
                `Error fetching scan for peer ${server.id} (${server.label}):`,
                error
              );
              return {
                id: server.id,
                server: server.label,
                ok: false,
                error: `Network error fetching scan: ${error.message}`,
                data: [],
                parentId: server.parentId,
                platform_type: server.platform_type || "unknown",
              };
            }
          }

          return {
            id: server.id,
            server: server.label,
            ok: false,
            error: "Server type not scannable or misconfigured",
            data: [],
            parentId: server.parentId,
            platform_type: server.platform_type || "unknown",
          };
        })
      );

      setGroups(enrichedServers);
      setTimeout(() => setLoading(false), 300);
    } catch (error) {
      logger.error("Error in fetchAll:", error);

      try {
        logger.warn(
          "Primary fetch failed, attempting complete fallback to legacy API"
        );
        const fallbackResponse = await fetch("/api/all-ports");
        if (fallbackResponse.ok) {
          const legacyData = await fallbackResponse.json();
          setGroups(legacyData);
          setTimeout(() => setLoading(false), 300);
          return;
        }
      } catch (fallbackError) {
        logger.error("Even fallback API failed:", fallbackError);
      }

      setError(error.toString());
      setLoading(false);
    }
  }, [transformCollectorData]);

  const handleLogoClick = useCallback(() => {
    fetchAll();
    if (window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, [fetchAll]);

  

  useEffect(() => {
    if (auth.loading || (auth.authEnabled && !auth.authenticated)) {
      return;
    }
    fetchAll();
  }, [fetchAll, auth.loading, auth.authEnabled, auth.authenticated]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const c = params.get('container');
      const s = params.get('server');
      if (c) setDeepLinkContainer(c);
      if (s) setDeepLinkServer(s);
  } catch { void 0; }
  }, []);

  useEffect(() => {
    if (auth.authenticated && !auth.loading && groups.length === 0) {
      fetchAll();
    }
  }, [auth.authenticated, auth.loading, fetchAll, groups.length]);

  useEffect(() => {
    if (!autoRefreshEnabled || auth.loading || (auth.authEnabled && !auth.authenticated)) {
      return;
    }

    const intervalId = setInterval(() => {
      logger.debug('Auto-refresh triggered');
      fetchAll();
    }, 30000);

    return () => clearInterval(intervalId);
  }, [autoRefreshEnabled, fetchAll, auth.loading, auth.authEnabled, auth.authenticated]);

  useEffect(() => {
    if (!loading && groups.length > 0) {
      const selectionIsValid =
        selectedServer && groups.some((g) => g.id === selectedServer);
      if (!selectionIsValid) {
        setSelectedServer(groups[0].id);
      }
      if (!appliedDeepLink && deepLinkServer && groups.some(g => g.id === deepLinkServer)) {
        setSelectedServer(deepLinkServer);
      }
    } else if (!loading && groups.length === 0 && selectedServer) {
      setSelectedServer(null);
    }
  }, [groups, loading, selectedServer, deepLinkServer, appliedDeepLink]);

  useEffect(() => {
    if (!appliedDeepLink && deepLinkServer && selectedServer === deepLinkServer) {
      setAppliedDeepLink(true);
    }
  }, [appliedDeepLink, deepLinkServer, selectedServer]);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (selectedServer) url.searchParams.set('server', selectedServer); else url.searchParams.delete('server');
      if (deepLinkContainer) url.searchParams.set('container', deepLinkContainer);
      window.history.replaceState({}, '', url.toString());
  } catch { void 0; }
  }, [selectedServer, deepLinkContainer]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleKeyDown = (event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "h") {
        event.preventDefault();
        toggleHackerMode();
        return;
      }

      if (event.key === "ArrowUp" && konamiProgressRef.current === 0) {
        const stage = konamiHintStageRef.current;
        if (stage < KONAMI_HINTS.length) {
          showKonamiHint(stage);
          konamiHintStageRef.current = stage + 1;
        }
      }

      const normalized = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const expected = KONAMI_SEQUENCE[konamiProgressRef.current];

      if (normalized === expected) {
        konamiProgressRef.current += 1;
        if (konamiProgressRef.current === KONAMI_SEQUENCE.length) {
          konamiProgressRef.current = 0;
          toggleHackerMode();
          return;
        }
        return;
      }

      konamiProgressRef.current = normalized === KONAMI_SEQUENCE[0] ? 1 : 0;
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showKonamiHint, toggleHackerMode]);

  const handleContainerOpen = useCallback((serverId, containerId) => {
    setDeepLinkContainer(containerId);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('container', containerId);
      url.searchParams.set('server', serverId);
      window.history.replaceState({}, '', url.toString());
  } catch { void 0; }
  }, []);

  const handleContainerClose = useCallback(() => {
    setDeepLinkContainer(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('container');
      window.history.replaceState({}, '', url.toString());
  } catch { void 0; }
  }, []);

  const toggleIgnore = useCallback(
    (srvId, p) => {
      
      const newIgnoredState = !p.ignored;
      const portKey = generatePortKey(srvId, p);
      const actionType = newIgnoredState ? 'hide' : 'unhide';
      
      if (actionFeedback[actionType]?.id === portKey) {
        return;
      }
      
      setActionFeedback(prev => ({ 
        ...prev, 
        [actionType]: { id: portKey, status: 'loading' } 
      }));

      setGroups((currentGroups) =>
        currentGroups.map((group) => {
          if (group.id === srvId) {
            const updatedData = group.data.map((port) => {
              if (
                port.host_ip === p.host_ip &&
                port.host_port === p.host_port &&
                (port.container_id || null) === (p.container_id || null) &&
                (port.internal || false) === (p.internal || false)
              ) {
                return { ...port, ignored: newIgnoredState };
              }
              return port;
            });
            return { ...group, data: updatedData };
          }
          return group;
        })
      );

      let targetUrl = "/api/ignores";
      let isPeer = false;

      if (srvId !== "local") {
        const server = servers.find((s) => s.id === srvId);
        if (server && server.url) {
          targetUrl = `${server.url.replace(/\/+$/, "")}/api/ignores`;
          isPeer = true;
        }
      }

      fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: isPeer ? "local" : srvId,
          host_ip: p.host_ip,
          host_port: p.host_port,
          protocol: p.protocol,
          container_id: p.container_id || null,
          internal: p.internal || false,
          ignored: newIgnoredState,
        }),
      })
        .then((response) => {
          if (!response.ok)
            throw new Error("Failed to update ignore status on backend.");
          
          setActionFeedback(prev => ({ 
            ...prev, 
            [actionType]: { id: portKey, status: 'success' } 
          }));
          
          setTimeout(() => setActionFeedback(prev => ({ 
            ...prev, 
            [actionType]: null 
          })), 2000);
        })
        .catch((error) => {
          logger.error("Error toggling ignore:", error);
          
          setActionFeedback(prev => ({ 
            ...prev, 
            [actionType]: { id: portKey, status: 'error' } 
          }));
          
          setTimeout(() => setActionFeedback(prev => ({ 
            ...prev, 
            [actionType]: null 
          })), 3000);
          
          setGroups((currentGroups) =>
            currentGroups.map((group) => {
              if (group.id === srvId) {
                const revertedData = group.data.map((port) => {
                  if (
                    port.host_ip === p.host_ip &&
                    port.host_port === p.host_port &&
                    (port.container_id || null) === (p.container_id || null) &&
                    (port.internal || false) === (p.internal || false)
                  ) {
                    return { ...port, ignored: p.ignored };
                  }
                  return port;
                });
                return { ...group, data: revertedData };
              }
              return group;
            })
          );
        });
    },
    [servers, actionFeedback, setGroups, setActionFeedback]
  );

  const openNoteModal = useCallback((srvId, p) => {
    setModalSrvId(srvId);
    setModalPort(p);
    setDraftNote(p.note || "");
    setNoteModalOpen(true);
  }, []);

  const openRenameModal = useCallback((srvId, p) => {
    setRenameSrvId(srvId);
    setRenamePort(p);
    setRenameModalOpen(true);
  }, []);

  const saveNoteModal = useCallback(() => {
    if (!modalPort) return;
    const originalNote = modalPort.note || "";

    setGroups((currentGroups) =>
      currentGroups.map((group) => {
        if (group.id === modalSrvId) {
          const updatedData = group.data.map((port) => {
            if (
              port.host_ip === modalPort.host_ip &&
              port.host_port === modalPort.host_port &&
              (port.container_id || null) === (modalPort.container_id || null) &&
              (port.internal || false) === (modalPort.internal || false)
            ) {
              return { ...port, note: draftNote };
            }
            return port;
          });
          return { ...group, data: updatedData };
        }
        return group;
      })
    );
    setNoteModalOpen(false);

    const currentServerIdForNote = modalSrvId;
    const serverForNote = servers.find((s) => s.id === currentServerIdForNote);
    const serverUrl = currentServerIdForNote !== "local" && serverForNote ? serverForNote.url : null;

    saveNote(currentServerIdForNote, modalPort.host_ip, modalPort.host_port, modalPort.protocol, draftNote, serverUrl, modalPort.container_id, modalPort.internal)
      .catch((error) => {
        logger.error("Error saving note:", error);
        setGroups((currentGroups) =>
          currentGroups.map((group) => {
            if (group.id === modalSrvId) {
              const revertedData = group.data.map((port) => {
                if (
                  port.host_ip === modalPort.host_ip &&
                  port.host_port === modalPort.host_port &&
                  (port.container_id || null) === (modalPort.container_id || null) &&
                  (port.internal || false) === (modalPort.internal || false)
                ) {
                  return { ...port, note: originalNote };
                }
                return port;
              });
              return { ...group, data: revertedData };
            }
            return group;
          })
        );
      });
  }, [modalSrvId, modalPort, draftNote, servers]);

  const handleServiceRename = useCallback(async (renameData) => {
    const { serverId, hostIp, hostPort, customName, originalName, serverUrl, isReset, containerId, internal } = renameData;
    
    setRenameLoading(true);

    try {
      if (isReset || !customName) {
        try {
          await deleteCustomServiceName(serverId, hostIp, hostPort, renameData.protocol, serverUrl, containerId, internal || false);
        } catch (error) {
          if (!error.message.includes('not found')) {
            throw error;
          }
          logger.info('Custom service name already deleted or did not exist, proceeding with reset');
        }
        
        setGroups((currentGroups) =>
          currentGroups.map((group) => {
            if (group.id === serverId) {
              const updatedData = group.data.map((port) => {
                const matchesPort = port.host_ip === hostIp && port.host_port === hostPort;
                const matchesContainer = containerId ? port.container_id === containerId : !port.container_id;
                const matchesInternal = (port.internal || false) === (internal || false);
                
                if (matchesPort && matchesContainer && matchesInternal) {
                  return { 
                    ...port, 
                    customServiceName: null,
                    originalServiceName: null
                  };
                }
                return port;
              });
              return { ...group, data: updatedData };
            }
            return group;
          })
        );
      } else {
        await saveCustomServiceName(serverId, hostIp, hostPort, renameData.protocol, customName, originalName, serverUrl, containerId, internal || false);
        
        setGroups((currentGroups) =>
          currentGroups.map((group) => {
            if (group.id === serverId) {
              const updatedData = group.data.map((port) => {
                const matchesPort = port.host_ip === hostIp && port.host_port === hostPort;
                const matchesContainer = containerId ? port.container_id === containerId : !port.container_id;
                const matchesInternal = (port.internal || false) === (internal || false);
                
                if (matchesPort && matchesContainer && matchesInternal) {
                  return { 
                    ...port, 
                    customServiceName: customName,
                    originalServiceName: originalName || port.owner
                  };
                }
                return port;
              });
              return { ...group, data: updatedData };
            }
            return group;
          })
        );
      }

      setRenameModalOpen(false);
    } catch (error) {
      logger.error("Error updating service name:", error);
    } finally {
      setRenameLoading(false);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPorts(new Set());
    setSelectionMode(false);
  }, []);

  const handleBatchRenameSave = useCallback(async (data) => {
    const { customName, selectedPorts, isReset } = data;
    setBatchLoading(true);

    try {
      const portsByServer = new Map();
      
      selectedPorts.forEach(portKey => {
        const parts = portKey.split('-');
        if (parts.length < 3) return;
        
        const serverId = parts[0];
        const isInternal = parts[parts.length - 1] === 'internal';
        const containerIdIndex = isInternal ? parts.length - 2 : parts.length - 1;
        const hostPortIndex = isInternal ? parts.length - 3 : parts.length - 2;
        
        const containerId = parts[containerIdIndex];
        const hostPort = parts[hostPortIndex];
        const hostIp = parts.slice(1, hostPortIndex).join('-');
        
        if (!portsByServer.has(serverId)) {
          portsByServer.set(serverId, []);
        }
        
        const server = groups.find(g => g.id === serverId);
        const port = server?.data.find(p => 
          p.host_ip === hostIp && 
          p.host_port === parseInt(hostPort) && 
          (p.container_id || '') === (containerId || '') &&
          (p.internal || false) === isInternal
        );
        
        if (port) {
          portsByServer.get(serverId).push({
            action: isReset ? "delete" : "set",
            host_ip: hostIp,
            host_port: parseInt(hostPort),
            protocol: port.protocol,
            custom_name: isReset ? null : customName,
            original_name: port.originalServiceName || port.owner,
            container_id: containerId || null,
            internal: isInternal,
          });
          
          if (!port.internal) {
            const relatedPorts = server.data.filter(p => 
              p.host_port === parseInt(hostPort) && 
              p.owner === port.owner &&
              (p.container_id || '') === (containerId || '') &&
              p.host_ip !== hostIp &&
              !p.internal
            );
            
            relatedPorts.forEach(relatedPort => {
              portsByServer.get(serverId).push({
                action: isReset ? "delete" : "set",
                host_ip: relatedPort.host_ip,
                host_port: parseInt(hostPort),
                protocol: relatedPort.protocol,
                custom_name: isReset ? null : customName,
                original_name: relatedPort.originalServiceName || relatedPort.owner,
                container_id: containerId || null,
                internal: false,
              });
            });
          }
        }
      });

      const serverUrl = groups.find(g => g.id !== 'local')?.serverUrl;
      
      for (const [serverId, operations] of portsByServer) {
        await batchCustomServiceNames(serverId, operations, serverUrl);
      }

      setGroups((currentGroups) =>
        currentGroups.map((group) => {
          const serverPorts = portsByServer.get(group.id);
          if (!serverPorts) return group;
          
          const updatedData = group.data.map((port) => {
            const operation = serverPorts.find(op => 
              op.host_ip === port.host_ip && 
              op.host_port === port.host_port &&
              op.protocol === port.protocol &&
              (op.container_id || '') === (port.container_id || '') &&
              (op.internal || false) === (port.internal || false)
            );
            
            if (operation) {
              return {
                ...port,
                customServiceName: isReset ? null : customName,
                originalServiceName: isReset ? null : (operation.original_name || port.owner)
              };
            }
            return port;
          });
          
          return { ...group, data: updatedData };
        })
      );

      setBatchRenameModalOpen(false);
      clearSelection();
    } catch (error) {
      logger.error("Error updating service names:", error);
    } finally {
      setBatchLoading(false);
    }
  }, [groups, clearSelection]);

  const handleBatchHideSave = useCallback(async (data) => {
    const { selectedPorts, action } = data;
    setBatchLoading(true);

    try {
      const portsByServer = new Map();
      
      selectedPorts.forEach(portKey => {
        const parts = portKey.split('-');
        if (parts.length < 3) return;
        
        const serverId = parts[0];
        const isInternal = parts[parts.length - 1] === 'internal';
        const containerIdIndex = isInternal ? parts.length - 2 : parts.length - 1;
        const hostPortIndex = isInternal ? parts.length - 3 : parts.length - 2;
        
        const containerId = parts[containerIdIndex];
        const hostPort = parts[hostPortIndex];
        const hostIp = parts.slice(1, hostPortIndex).join('-');
        
        if (!portsByServer.has(serverId)) {
          portsByServer.set(serverId, []);
        }
        
        const server = groups.find(g => g.id === serverId);
        const port = server?.data.find(p => 
          p.host_ip === hostIp && 
          p.host_port === parseInt(hostPort) && 
          (p.container_id || '') === (containerId || '') &&
          (p.internal || false) === isInternal
        );
        
        if (port) {
          portsByServer.get(serverId).push(port);
        }
      });

      setGroups((currentGroups) =>
        currentGroups.map((group) => {
          const serverPorts = portsByServer.get(group.id);
          if (!serverPorts) return group;
          
          const updatedData = group.data.map((port) => {
            const shouldHide = serverPorts.some(sp => 
              sp.host_ip === port.host_ip && 
              sp.host_port === port.host_port &&
              (sp.container_id || '') === (port.container_id || '') &&
              (sp.internal || false) === (port.internal || false)
            );
            
            if (shouldHide) {
              return {
                ...port,
                ignored: action === 'hide'
              };
            }
            return port;
          });
          
          return { ...group, data: updatedData };
        })
      );

      const promises = [];
      for (const [serverId, serverPorts] of portsByServer) {
        for (const port of serverPorts) {
          let targetUrl = "/api/ignores";
          let isPeer = false;

          if (serverId !== "local") {
            const server = servers.find((s) => s.id === serverId);
            if (server && server.url) {
              targetUrl = `${server.url.replace(/\/+$/, "")}/api/ignores`;
              isPeer = true;
            }
          }

          const promise = fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              server_id: isPeer ? "local" : serverId,
              host_ip: port.host_ip,
              host_port: port.host_port,
              protocol: port.protocol,
              container_id: port.container_id || null,
              internal: port.internal || false,
              ignored: action === 'hide',
            }),
          });
          promises.push(promise);
        }
      }

      await Promise.all(promises);
      
      setBatchHideModalOpen(false);
      clearSelection();
    } catch (error) {
      logger.error(`Error ${action}ing ports:`, error);
    } finally {
      setBatchLoading(false);
    }
  }, [groups, servers, clearSelection]);

  const handleBatchNotesSave = useCallback(async (data) => {
    const { note, selectedPorts, isClear } = data;
    setBatchLoading(true);

    try {
      const portsByServer = new Map();
      
      selectedPorts.forEach(portKey => {
        let matchedPort = null;
        let serverId = null;
        
        for (const group of groups) {
          const port = group.data.find(p => generatePortKey(group.id, p) === portKey);
          if (port) {
            matchedPort = port;
            serverId = group.id;
            break;
          }
        }
        
        if (!matchedPort || !serverId) return;
        
        if (!portsByServer.has(serverId)) {
          portsByServer.set(serverId, []);
        }
        
        portsByServer.get(serverId).push({
          action: isClear ? "delete" : "set",
          host_ip: matchedPort.host_ip,
          host_port: matchedPort.host_port,
          protocol: matchedPort.protocol || "tcp",
          note: isClear ? null : note,
          container_id: matchedPort.container_id || null,
          internal: matchedPort.internal || false,
        });
      });

      const serverUrl = groups.find(g => g.id !== 'local')?.serverUrl;
      
      for (const [serverId, operations] of portsByServer) {
        await batchNotes(serverId, operations, serverUrl);
      }

      setGroups((currentGroups) =>
        currentGroups.map((group) => {
          const serverPorts = portsByServer.get(group.id);
          if (!serverPorts) return group;
          
          const updatedData = group.data.map((port) => {
            const operation = serverPorts.find(op => 
              op.host_ip === port.host_ip && 
              op.host_port === port.host_port &&
              op.protocol === port.protocol &&
              (op.container_id || '') === (port.container_id || '') &&
              (op.internal || false) === (port.internal || false)
            );
            
            if (operation) {
              return {
                ...port,
                note: isClear ? null : note
              };
            }
            return port;
          });
          
          return { ...group, data: updatedData };
        })
      );
      
      setBatchNotesModalOpen(false);
      clearSelection();
    } catch (error) {
      logger.error("Error updating port notes:", error);
    } finally {
      setBatchLoading(false);
    }
  }, [groups, clearSelection]);

  const fetchServers = useCallback(() => {
    fetch("/api/servers")
      .then((r) => r.json())
      .then(setServers)
      .catch(logger.error);
  }, []);

  const addServer = useCallback(
    async (serverData, isUpdate = false) => {
      if (isUpdate) {
        const originalGroups = groups;
        const updatedGroups = groups.map((g) => {
          if (g.id === serverData.id) {
            return {
              ...g,
              server: serverData.label,
              label: serverData.label,
              url: serverData.url,
              parentId: serverData.parentId || null,
              platform_type: serverData.platform_type,
            };
          }
          return g;
        });
        setGroups(updatedGroups);

        try {
          const response = await fetch("/api/servers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: serverData.id,
              label: serverData.label,
              url: serverData.url,
              parentId: serverData.parentId || null,
              type: serverData.type || "peer",
              unreachable: serverData.unreachable || false,
              platform_type: serverData.platform_type || "unknown",
            }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Validation failed");
          }
        } catch (error) {
          setGroups(originalGroups);
          logger.error("Failed to save server:", error);
          throw error;
        }
      } else {
        const placeholderServer = {
          id: serverData.id,
          server: serverData.label,
          label: serverData.label,
          url: serverData.url,
          parentId: serverData.parentId || null,
          platform_type: serverData.platform_type,
          ok: null,
          data: [],
          systemInfo: {},
          vms: [],
        };

        setGroups((currentGroups) => [...currentGroups, placeholderServer]);

        try {
          const response = await fetch("/api/servers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: serverData.id,
              label: serverData.label,
              url: serverData.url,
              parentId: serverData.parentId || null,
              type: serverData.type || "peer",
              unreachable: serverData.unreachable || false,
              platform_type: serverData.platform_type || "unknown",
            }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Validation failed");
          }

          const scanResponse = await fetch(
            `/api/servers/${serverData.id}/scan`
          );
          if (scanResponse.ok) {
            const scanData = await scanResponse.json();
            const transformedPorts = await transformCollectorData(
              scanData,
              serverData.id,
              serverData.url
            );

            const finalServerData = {
              id: serverData.id,
              server: serverData.label,
              label: serverData.label,
              ok: true,
              url: serverData.url,
              platform: scanData.platform,
              platformName: scanData.platformName,
              data: transformedPorts,
              systemInfo: scanData.systemInfo,
              applications: scanData.applications,
              vms: scanData.vms,
              parentId: serverData.parentId,
              platform_type: serverData.platform_type || scanData.platform,
              enhancedFeaturesEnabled: scanData.enhancedFeaturesEnabled ?? true,
            };

            setGroups((currentGroups) =>
              currentGroups.map((g) =>
                g.id === serverData.id ? finalServerData : g
              )
            );
          } else {
            const errorData = await scanResponse
              .json()
              .catch(() => ({ error: `Scan failed` }));
            setGroups((currentGroups) =>
              currentGroups.map((g) => {
                if (g.id === serverData.id) {
                  return {
                    ...g,
                    ok: false,
                    error: errorData.details || errorData.error,
                  };
                }
                return g;
              })
            );
          }
        } catch (error) {
          logger.error("Failed to add server:", error);
          setGroups((currentGroups) =>
            currentGroups.filter((g) => g.id !== serverData.id)
          );
          throw error;
        }
      }
    },
    [groups, transformCollectorData]
  );

  const deleteServer = useCallback(
    async (id) => {
      const originalServers = servers;
      const originalGroups = groups;

      setServers((currentServers) => currentServers.filter((s) => s.id !== id));
      setGroups((currentGroups) => currentGroups.filter((g) => g.id !== id));

      if (selectedServer === id) {
        setSelectedServer(null);
      }

      try {
        const response = await fetch(`/api/servers/${id}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error(`Failed to delete server: ${response.status}`);
        }

        await fetchServers();
      } catch (error) {
        setServers(originalServers);
        setGroups(originalGroups);
        logger.error("Failed to delete server:", error);
      }
    },
    [servers, groups, selectedServer, fetchServers]
  );

  const toggleServerSelectionMode = useCallback((_serverId) => {
    if (selectionMode) {
      setSelectionMode(false);
      setSelectedPorts(new Set());
    } else {
      setSelectionMode(true);
    }
  }, [selectionMode]);

  const togglePortSelection = useCallback((port, serverId) => {
    const portKey = generatePortKey(serverId, port);
    setSelectedPorts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(portKey)) {
        newSet.delete(portKey);
      } else {
        newSet.add(portKey);
      }
      
      if (newSet.size === 0) {
        setSelectionMode(false);
      }
      
      return newSet;
    });
  }, []);

  const selectAllPortsForServer = useCallback((serverId, ports) => {
    const portKeys = ports.map(port => generatePortKey(serverId, port));
    setSelectedPorts(prev => {
      const newSet = new Set(prev);
      portKeys.forEach(key => newSet.add(key));
      return newSet;
    });
    setSelectionMode(true);
  }, []);

  const handleLogoHealthCheck = useCallback(async () => {
    const started = performance.now();
    try {
      const response = await fetch("/api/health");
      const latency = Math.round(performance.now() - started);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      const uptimeSeconds = data?.uptimeSeconds ?? Math.floor(data?.uptime || 0);
      const uptimeLabel = uptimeSeconds ? formatUptime(uptimeSeconds) : "unknown";
      pushHealthToast({
        type: "success",
        message: `Heartbeat steady: ${latency}ms - uptime ${uptimeLabel}`,
      });
    } catch (error) {
      pushHealthToast({
        type: "error",
        message: `Health check failed: ${error.message}`,
      });
    }
  }, [pushHealthToast]);

  const handleBatchRename = useCallback(() => {
    setBatchRenameModalOpen(true);
  }, []);

  const handleBatchHide = useCallback(() => {
    setBatchHideModalOpen(true);
  }, []);

  const handleBatchNote = useCallback(() => {
    setBatchNotesModalOpen(true);
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const selectedServerData = useMemo(() => {
    if (!selectedServer) return null;
    return groups.find((g) => g.id === selectedServer) || null;
  }, [groups, selectedServer]);

  const appPort = useMemo(() => {
    if (typeof window === "undefined") {
      return "4999";
    }
    return window.location.port || "4999";
  }, []);

  const autoRefreshMessages = useMemo(() => {
    const isTrueNAS = Boolean(
      selectedServerData?.platformName?.toLowerCase().includes("truenas")
    );
    return buildAutoRefreshMessages({
      isTrueNAS,
      currentPort: appPort || "4999",
    });
  }, [selectedServerData, appPort]);

  if (auth.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600 dark:text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (auth.authEnabled && !auth.authenticated) {
    return <LoginPage />;
  }

  if (auth.requirePasswordChange) {
    return <ChangePasswordPage />;
  }

  const filterPorts = (group) => {
    if (!group.ok || !group.data) return group;

    const filteredData = group.data.filter((port) => {
      const matchesSourceFilter =
        (port.source === "docker" && filters.docker) ||
        (port.source === "system" && filters.system);

      if (!matchesSourceFilter) return false;

      if (!searchTerm) return true;

      const searchLower = searchTerm.toLowerCase();
      return (
        port.host_port.toString().includes(searchLower) ||
        (port.owner && port.owner.toLowerCase().includes(searchLower)) ||
        (port.customServiceName && port.customServiceName.toLowerCase().includes(searchLower)) ||
        (port.host_ip && port.host_ip.includes(searchLower)) ||
        port.target?.includes?.(searchLower) ||
        (port.note && port.note.toLowerCase().includes(searchLower))
      );
    });

    return {
      ...group,
      data: filteredData,
    };
  };

  function renderServer(server) {
    const filteredServer = filterPorts(server);

    return (
  <ServerSection
        key={server.id}
        id={server.id}
        server={server.server}
        ok={server.ok}
        data={filteredServer.data || []}
        error={server.error}
        errorType={server.errorType}
        searchTerm={searchHighlighting ? searchTerm : ""}
        actionFeedback={actionFeedback}
        onNote={openNoteModal}
        onToggleIgnore={toggleIgnore}
        onRename={openRenameModal}
        onCopy={(p, portProtocol) => {
          let hostForCopy;
          if (server.id === "local" &&
              (p.host_ip === "0.0.0.0" ||
               p.host_ip === "127.0.0.1" ||
               p.host_ip === "[::]" ||
               p.host_ip === "[::1]")) {
            hostForCopy = window.location.hostname;
          }
          else if (
            server.id !== "local" &&
            server.url &&
            (p.host_ip === "0.0.0.0" ||
             p.host_ip === "127.0.0.1" ||
             p.host_ip === "[::]" ||
             p.host_ip === "[::1]")
          ) {
            try {
              hostForCopy = new URL(server.url).hostname;
            } catch {
              hostForCopy = "localhost";
            }
          }
          else {
            hostForCopy = p.host_ip;
          }

          const actualProtocol = portProtocol || "http";
          const urlToCopy = `${actualProtocol}://${hostForCopy}:${p.host_port}`;

          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard
              .writeText(urlToCopy)
              .then(() => {
                setActionFeedback(prev => ({ 
                  ...prev, 
                  copy: { id: keyOf(server.id, p) } 
                }));
                setTimeout(
                  () => setActionFeedback(prev => ({ 
                    ...prev, 
                    copy: null 
                  })),
                  1500
                );
              })
              .catch((err) => {
                logger.warn("Clipboard write failed, using fallback:", err);
                copyToClipboardFallback(urlToCopy, server.id, p);
              });
          } else {
            copyToClipboardFallback(urlToCopy, server.id, p);
          }
        }}
        serverUrl={server.url}
        platformName={server.platformName}
        systemInfo={server.systemInfo}
        vms={server.vms}
        enhancedFeaturesEnabled={server.enhancedFeaturesEnabled}
        infoCardLayout={infoCardLayout}
        onInfoCardLayoutChange={setInfoCardLayout}
        portLayout={portLayout}
        onPortLayoutChange={setPortLayout}
        isExpanded={!!expandedServers[server.id]}
        onToggleExpanded={() => toggleServerExpanded(server.id)}
        openAccordionItems={openAccordions[server.id] ?? ["system-info", "vms"]}
  onAccordionChange={(items) => handleAccordionChange(server.id, items)}
        deepLinkContainerId={selectedServer === server.id ? deepLinkContainer : null}
        onOpenContainerDetails={(containerId) => handleContainerOpen(server.id, containerId)}
        onCloseContainerDetails={handleContainerClose}
        selectionMode={selectionMode}
        selectedPorts={selectedPorts}
        onToggleSelection={togglePortSelection}
        onToggleServerSelectionMode={() => toggleServerSelectionMode(server.id)}
        onSelectAllPorts={(ports) => selectAllPortsForServer(server.id, ports)}
        portSuggestion={portSuggestions[server.id]}
        onGeneratePort={generatePortForServer}
      />
    );
  }

  function renderAllMatchingServers() {
    const matching = groups
      .map((srv) => filterPorts(srv))
      .filter((srv) => srv.ok && Array.isArray(srv.data) && srv.data.length > 0);

    if (matching.length === 0) {
      return (
        <div className="text-center py-12 text-gray-500 dark:text-slate-400">
          No matches across servers.
        </div>
      );
    }

    return matching.map((srv) => (
      <div key={srv.id} className="space-y-8">
        {renderServer(srv)}
      </div>
    ));
  }

  const serverToRender = selectedServerData;
  const noDataForSelection = selectedServer && !serverToRender && !loading;

  return (
    <TooltipProvider>
      {konamiHint && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg border backdrop-blur-sm pointer-events-none animate-in fade-in-0 slide-in-from-top-2 duration-200 bg-white/95 dark:bg-slate-800/95 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100">
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400 animate-pulse" />
            <span className="text-sm font-medium">{konamiHint}</span>
          </div>
        </div>
      )}
      {healthToast && (
        <div
          className={`fixed top-20 right-6 z-50 px-4 py-2.5 rounded-lg shadow-lg border backdrop-blur-sm animate-in fade-in-0 slide-in-from-top-2 duration-200 ${
            healthToast.type === "error"
              ? "bg-rose-50/95 dark:bg-rose-900/95 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-100"
              : "bg-white/95 dark:bg-slate-800/95 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
          }`}
        >
          <div className="flex items-center gap-2">
            {healthToast.type === "error" ? (
              <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-rose-500 dark:bg-rose-400" />
            ) : (
              <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400" />
            )}
            <span className="text-sm font-medium">{healthToast.message}</span>
          </div>
        </div>
      )}
      <div className={`flex flex-col h-screen bg-slate-50 dark:bg-slate-950 ${hackerMode ? "hacker-mode-active" : ""}`}>
        <AppHeader
          groups={groups}
          loading={loading}
          onRefresh={fetchAll}
          
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          searchScope={searchScope}
          onSearchScopeChange={setSearchScope}
          searchHighlighting={searchHighlighting}
          onSearchHighlightingChange={setSearchHighlighting}
          filters={filters}
          onFilterChange={setFilters}
          selectedServer={selectedServer}
          isDarkMode={isDarkMode}
          onThemeToggle={() => setIsDarkMode(!isDarkMode)}
          onGoHome={handleLogoClick}
          onToggleSidebar={() => setSidebarOpen(!isSidebarOpen)}
          onShowWhatsNew={shouldShowWhatsNewButton ? handleShowWhatsNew : null}
          hasNewFeatures={shouldShowWhatsNewButton}
          autoRefreshEnabled={autoRefreshEnabled}
          onAutoRefreshToggle={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
          onLogoLongPress={handleLogoHealthCheck}
          hackerMode={hackerMode}
          onDisableHackerMode={disableHackerMode}
          autoRefreshMessages={autoRefreshMessages}
        />
        <DashboardLayout
          isSidebarOpen={isSidebarOpen}
          onCloseSidebar={() => setSidebarOpen(false)}
          sidebar={
            <Sidebar
              servers={groups}
              selectedId={selectedServer}
              onSelect={handleSelectServer}
              onAdd={addServer}
              onDelete={deleteServer}
              loading={loading}
            />
          }
        >
          <main className="flex-1 overflow-auto">
            <div className="p-6">
              {loading && (
                <MultipleServerSkeleton count={selectedServer ? 1 : 2} />
              )}

              {error && !loading && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
                  <p className="text-red-800 dark:text-red-200">{error}</p>
                </div>
              )}

              {!loading && !selectedServer && (
                searchTerm && searchScope === "all" ? (
                  <div className="space-y-8">{renderAllMatchingServers()}</div>
                ) : (
                  <div className="text-center py-24 text-slate-500 dark:text-slate-400 flex flex-col items-center animate-in fade-in-0 duration-300">
                    <BarChart3 className="h-16 w-16 mb-4 text-slate-400" />
                    <h2 className="text-xl font-semibold text-slate-700 dark:text-slate-300">
                      Dashboard Home
                    </h2>
                    <p className="mt-2 max-w-md">
                      Select a server from the sidebar to view its ports, system
                      information, and more. Use the "Add Server" button to
                      connect to new local or remote environments.
                    </p>
                  </div>
                )
              )}

              {!loading && noDataForSelection && (
                <div className="text-center py-12 text-gray-500 dark:text-slate-400">
                  No data available for the selected server. It might be offline
                  or misconfigured.
                </div>
              )}

              {!loading && serverToRender && !(searchTerm && searchScope === "all") && (
                <div className="space-y-8 animate-in fade-in-0 duration-300">{renderServer(serverToRender)}</div>
              )}

              {!loading && selectedServer && searchTerm && searchScope === "all" && (
                <div className="space-y-8 animate-in fade-in-0 duration-300">{renderAllMatchingServers()}</div>
              )}
            </div>
          </main>
        </DashboardLayout>
      </div>

      <Dialog open={noteModalOpen} onOpenChange={setNoteModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Port Note</DialogTitle>
            <DialogDescription>
              Add or edit a note for this port to help remember its purpose or
              configuration.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="note">Note</Label>
              <Input
                id="note"
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                placeholder="Add a note..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveNoteModal}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WhatsNewModal
        {...getWhatsNewModalProps()}
      />

      <ServiceRenameModal
        isOpen={renameModalOpen}
        onClose={() => setRenameModalOpen(false)}
        port={renamePort}
        serverId={renameSrvId}
        serverUrl={groups.find(g => g.id === renameSrvId)?.url}
        onSave={handleServiceRename}
        loading={renameLoading}
      />

      <BatchRenameModal
        isOpen={batchRenameModalOpen}
        onClose={() => setBatchRenameModalOpen(false)}
        selectedPorts={selectedPorts}
        onSave={handleBatchRenameSave}
        loading={batchLoading}
      />

      <BatchHideModal
        isOpen={batchHideModalOpen}
        onClose={() => setBatchHideModalOpen(false)}
        selectedPorts={selectedPorts}
        onConfirm={handleBatchHideSave}
        loading={batchLoading}
        action="hide"
      />

      <BatchNotesModal
        isOpen={batchNotesModalOpen}
        onClose={() => setBatchNotesModalOpen(false)}
        selectedPorts={selectedPorts}
        onSave={handleBatchNotesSave}
        loading={batchLoading}
      />

      <BatchOperationsBar
        selectedCount={selectedPorts.size}
        onBatchRename={handleBatchRename}
        onBatchHide={handleBatchHide}
        onBatchNote={handleBatchNote}
        onClearSelection={clearSelection}
        onSelectAll={() => {
          const currentGroup = selectedServer 
            ? groups.find(g => g.id === selectedServer)
            : null;
          
          if (currentGroup) {
            let showInternal = false;
            try {
              const saved = localStorage.getItem(`showInternalPorts:${currentGroup.id}`);
              showInternal = saved ? JSON.parse(saved) : false;
            } catch {
              showInternal = false;
            }
            
            const filteredPorts = filterPorts(currentGroup).data || [];
            const visiblePorts = filteredPorts.filter(port => 
              !port.ignored && (showInternal || !port.internal)
            );
            
            const portKeys = visiblePorts.map(port => 
              generatePortKey(currentGroup.id, port)
            );
            setSelectedPorts(new Set(portKeys));
            setSelectionMode(true);
          }
        }}
        showSelectAll={(() => {
          const currentGroup = selectedServer 
            ? groups.find(g => g.id === selectedServer)
            : null;
          
          if (!currentGroup) return false;
          
          let showInternal = false;
          try {
            const saved = localStorage.getItem(`showInternalPorts:${currentGroup.id}`);
            showInternal = saved ? JSON.parse(saved) : false;
          } catch {
            showInternal = false;
          }
          
          const filteredPorts = filterPorts(currentGroup).data || [];
          const visiblePortsCount = filteredPorts.filter(port => 
            !port.ignored && (showInternal || !port.internal)
          ).length;
          
          return selectedPorts.size > 0 && selectedPorts.size < visiblePortsCount;
        })()}
        loading={false}
      />
    </TooltipProvider>
  );

  function copyToClipboardFallback(text, serverId, port) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand("copy");
      if (successful) {
        setActionFeedback(prev => ({ 
          ...prev, 
          copy: { id: keyOf(serverId, port) } 
        }));
        setTimeout(() => setActionFeedback(prev => ({ 
          ...prev, 
          copy: null 
        })), 1500);
      } else {
        prompt("Copy this URL:", text);
      }
    } catch (err) {
      logger.warn("Copy failed:", err);
      prompt("Copy this URL:", text);
    } finally {
      document.body.removeChild(textArea);
    }
  }
}



