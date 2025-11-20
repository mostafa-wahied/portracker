import React, { useMemo, useEffect, useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronUp,
  List,
  Grid3x3,
  Table,
  Network,
  Activity,
  ArrowDownUp,
  Server as VmIcon,
  LayoutGrid,
  Rows,
  Info,
  Lock,
  CheckSquare,
  Sparkles,
  RefreshCw,
  Copy,
  Check,
} from "lucide-react";
import { PortCard } from "./PortCard";
import { PortGridItem } from "./PortGridItem";
import { PortTable } from "./PortTable";
import { HiddenPortsDrawer } from "./HiddenPortsDrawer";
import { SystemInfoCard } from "./SystemInfoCard";
import Logger from "../../lib/logger";
import { VMsCard } from "./VMsCard";
import { generatePortKey } from "../../lib/utils/portUtils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useClipboard } from "@/lib/hooks/useClipboard";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Renders a comprehensive server overview section, including system information, virtual machines, and port management with sorting, filtering, and multiple layout options.
 *
 * Displays server status, host details, and provides interactive controls for sorting and viewing ports in list, grid, card, or table formats. Allows toggling between expanded and collapsed views, managing hidden ports, and switching layouts for system info and VMs. Handles user actions such as copying, editing notes, and toggling port visibility.
 */
function ServerSectionComponent({
  server,
  ok,
  data,
  id,
  searchTerm,
  actionFeedback,
  onNote,
  onToggleIgnore,
  onRename,
  onCopy,
  serverUrl,
  platformName,
  systemInfo,
  vms,
  enhancedFeaturesEnabled,
  portLayout,
  onPortLayoutChange,
  isExpanded,
  onToggleExpanded,
  openAccordionItems,
  onAccordionChange,
  infoCardLayout,
  onInfoCardLayoutChange,
  deepLinkContainerId,
  onOpenContainerDetails,
  onCloseContainerDetails,
  selectionMode = false,
  selectedPorts,
  onToggleSelection,
  onToggleServerSelectionMode,
  onSelectAllPorts,
  portSuggestion,
  onGeneratePort,
}) {
  const logger = useMemo(() => new Logger('ServerSection'), []);
  const { copiedKey, copy } = useClipboard();
  const suggestionPort = portSuggestion?.port;
  const suggestionLoading = !!portSuggestion?.loading;
  const suggestionError = portSuggestion?.error;
  const [showPortModal, setShowPortModal] = useState(false);
  
  const [sortConfig, setSortConfig] = useState(() => {
    try {
      const saved = localStorage.getItem("portSortConfig");
      return saved
        ? JSON.parse(saved)
        : { key: "default", direction: "ascending" };
    } catch {
      return { key: "default", direction: "ascending" };
    }
  });

  const [showInternal, setShowInternal] = useState(() => {
    try {
      const saved = localStorage.getItem(`showInternalPorts:${id}`);
      return saved ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`showInternalPorts:${id}`);
      if (saved != null) setShowInternal(JSON.parse(saved));
      else setShowInternal(false);
    } catch {
      setShowInternal(false);
    }
  }, [id]);

  useEffect(() => {
    try {
      localStorage.setItem(`showInternalPorts:${id}`, JSON.stringify(showInternal));
  } catch { void 0; }
  }, [id, showInternal]);

  const visiblePorts = useMemo(
    () => (data ? data.filter((p) => !p.ignored && (showInternal || !p.internal)) : []),
    [data, showInternal]
  );
  const hiddenPorts = useMemo(
    () => (data ? data.filter((p) => p.ignored) : []),
    [data]
  );

  const counts = useMemo(() => {
    const list = Array.isArray(data) ? data.filter((p) => !p.ignored) : [];
    const internal = list.filter((p) => p.internal).length;
    const published = list.length - internal;
    return { internal, published, total: list.length };
  }, [data]);

  const portMood = useMemo(() => {
    const count = visiblePorts.length;
    if (count === 0) {
      return "It's empty in here.";
    }
    if (count < 10) {
      return `Feels lonely with ${count} service${count === 1 ? "" : "s"}.`;
    }
    if (count > 99) {
      return `Hoarder alert: Wow.. ${count} services.`;
    }
    return null;
  }, [visiblePorts.length]);

  useEffect(() => {
    const validKeys = ["default", "host_port", "owner", "created"];
    let { key, direction } = sortConfig;
    let changed = false;
    if (!validKeys.includes(key)) {
      key = "default";
      direction = "ascending";
      changed = true;
    }
    if (direction !== "ascending" && direction !== "descending") {
      direction = "ascending";
      changed = true;
    }
    if (changed) setSortConfig({ key, direction });
    
  }, [sortConfig]);

  const sortedPorts = useMemo(() => {
    let sortablePorts = [...visiblePorts];

    if (sortConfig.key === "default") {
      return sortablePorts.sort((a, b) => {
        const aWeight = a.internal ? 1 : 0;
        const bWeight = b.internal ? 1 : 0;
        if (aWeight !== bWeight) return aWeight - bWeight;
        const aPort = parseInt(a.host_port || a.container_port, 10) || 0;
        const bPort = parseInt(b.host_port || b.container_port, 10) || 0;
        return aPort - bPort;
      });
    }

    const asc = sortConfig.direction === "ascending";
    const normalizeForSort = (val) => {
      if (val == null) return "";
      if (Array.isArray(val)) return val.join(", ");
      if (typeof val === "number") return String(val);
      return String(val);
    };

    if (sortConfig.key) {
      sortablePorts.sort((a, b) => {
        if (sortConfig.key === "host_port") {
          const portA = parseInt(a.host_port, 10) || 0;
          const portB = parseInt(b.host_port, 10) || 0;
          return asc ? portA - portB : portB - portA;
        }
        if (sortConfig.key === "created") {
          const aNum = Number(a.created ?? 0);
          const bNum = Number(b.created ?? 0);
          return asc ? aNum - bNum : bNum - aNum;
        }

        const valA = normalizeForSort(a[sortConfig.key]).toLowerCase();
        const valB = normalizeForSort(b[sortConfig.key]).toLowerCase();

        if (valA < valB) return asc ? -1 : 1;
        if (valA > valB) return asc ? 1 : -1;
        return 0;
      });
    }
    return sortablePorts;
  }, [visiblePorts, sortConfig]);

  useEffect(() => {
    try {
      localStorage.setItem("portSortConfig", JSON.stringify(sortConfig));
    } catch (error) {
      logger.warn("Failed to save sort config:", error);
    }
  }, [logger, sortConfig]);

  const getSortDisplayName = (key) => {
    switch (key) {
      case "default":
        return "Default";
      case "host_port":
        return "Port";
      case "owner":
        return "Service";
      default:
        return key.charAt(0).toUpperCase() + key.slice(1);
    }
  };

  const portsToDisplay =
    isExpanded || portLayout === "grid" ? sortedPorts : sortedPorts.slice(0, 8);

  const hasSystemInfo = systemInfo && Object.keys(systemInfo).length > 0;
  const hasVMs = vms && vms.length > 0;
  const isTrueNAS = platformName?.toLowerCase().includes("truenas");
  const showVMSection = hasVMs || (isTrueNAS && enhancedFeaturesEnabled === false);

  const getHostDisplay = () => {
    if (!serverUrl) {
      return window.location.host || "localhost";
    }
    
    try {
      const url = new URL(
        serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`
      );
      return (
        url.hostname +
        (url.port && url.port !== "80" && url.port !== "443"
          ? `:${url.port}`
          : "")
      );
    } catch {
      return serverUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "") || "localhost";
    }
  };

  const handleCopySuggestedPort = useCallback(async () => {
    if (!suggestionPort) return;
    await copy(`suggested-port-${id}`, suggestionPort.toString());
  }, [copy, id, suggestionPort]);

  const handleOpenPortModal = useCallback(() => {
    setShowPortModal(true);
    if (!suggestionPort && !suggestionLoading) {
      onGeneratePort?.(id);
    }
  }, [id, onGeneratePort, suggestionLoading, suggestionPort]);

  const handleRegenerate = useCallback(() => {
    onGeneratePort?.(id);
  }, [id, onGeneratePort]);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200 truncate">
              {server}
            </h1>
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                ok
                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
              }`}
            >
              <Activity className="h-4 w-4 mr-1.5" />
              {ok ? "Online" : "Offline"}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-mono mt-1">
            {getHostDisplay()}
          </p>
        </div>
      </div>

      {(hasSystemInfo || showVMSection) && (
        <div>
          <div className="flex items-center justify-end mb-4">
            <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-900 rounded-lg p-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onInfoCardLayoutChange("grid")}
                      className={`p-1.5 sm:p-2 rounded-md transition-colors ${
                        infoCardLayout === "grid"
                          ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                      }`}
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Grid layout</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onInfoCardLayoutChange("stacked")}
                      className={`p-1.5 sm:p-2 rounded-md transition-colors ${
                        infoCardLayout === "stacked"
                          ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                      }`}
                    >
                      <Rows className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Stacked layout</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          <Accordion
            type="multiple"
            className={`w-full ${
              infoCardLayout === "grid"
                ? "grid grid-cols-1 lg:grid-cols-2 gap-6"
                : "space-y-6"
            }`}
            value={openAccordionItems}
            onValueChange={onAccordionChange}
          >
            {hasSystemInfo && (
              <AccordionItem
                value="system-info"
                className="border rounded-xl bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/50 shadow-sm"
              >
                <AccordionTrigger className="px-6 py-4 text-lg font-semibold text-slate-900 dark:text-slate-100 hover:no-underline">
                  <div className="flex items-center">
                    <Info className="h-5 w-5 mr-3 text-slate-600 dark:text-slate-400" />
                    System Information
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-6 pb-6">
                  <SystemInfoCard
                    systemInfo={systemInfo}
                    platformName={platformName}
                  />
                </AccordionContent>
              </AccordionItem>
            )}
            {showVMSection && (
              <AccordionItem
                value="vms"
                className="border rounded-xl bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/50 shadow-sm"
              >
                <AccordionTrigger className="px-6 py-4 text-lg font-semibold text-slate-900 dark:text-slate-100 hover:no-underline">
                  <div className="flex items-center">
                    <VmIcon className="h-5 w-5 mr-3 text-slate-600 dark:text-slate-400" />
                    Virtual Machines {hasVMs && `(${vms.length})`}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-6 pb-6">
                  <VMsCard vms={vms} enhancedFeaturesEnabled={enhancedFeaturesEnabled} />
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/50 shadow-sm">
        <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-700/50">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Network className="h-5 w-5 mr-2 text-slate-600 dark:text-slate-400" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {portMood
                      ? portMood
                      : `Published: ${counts.published}, Internal: ${counts.internal}${showInternal ? " (showing internal)" : " (hiding internal)"}`}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              Ports
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400 cursor-default">
                      ({visiblePorts.length})
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {`Published: ${counts.published}, Internal: ${counts.internal}${showInternal ? " (showing internal)" : " (hiding internal)"}`}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </h2>
            <div className="flex items-center justify-start sm:justify-end flex-wrap gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleOpenPortModal}
                      disabled={suggestionLoading}
                      className={`inline-flex items-center px-2 sm:px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${
                        suggestionLoading
                          ? "bg-blue-50 dark:bg-slate-700/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700 cursor-not-allowed"
                          : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700"
                      }`}
                    >
                      {suggestionLoading ? (
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      Generate port
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Generate an unused port for this server</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setShowInternal((v) => !v)}
                      className={`inline-flex items-center px-2 sm:px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${
                        showInternal
                          ? "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm"
                          : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700"
                      }`}
                      aria-pressed={showInternal}
                    >
                      <Lock className="h-4 w-4 mr-2" />
                      {showInternal ? "Internal: On" : "Internal: Off"}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {`${showInternal ? "Hide" : "Show"} internal ports`}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center px-2 sm:px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                    <ArrowDownUp className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">Sort By:&nbsp;</span>
                    {getSortDisplayName(sortConfig.key)}
                    {sortConfig.key !== "default" && (
                      <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                        ({sortConfig.direction === "ascending" ? "Asc" : "Desc"}
                        )
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      setSortConfig({ key: "default", direction: "ascending" })
                    }
                  >
                    <span
                      className={
                        sortConfig.key === "default"
                          ? "font-medium text-blue-600"
                          : ""
                      }
                    >
                      Default Order
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      setSortConfig({
                        key: "host_port",
                        direction: "ascending",
                      })
                    }
                  >
                    <span
                      className={
                        sortConfig.key === "host_port" &&
                        sortConfig.direction === "ascending"
                          ? "font-medium text-blue-600"
                          : ""
                      }
                    >
                      Port (Asc)
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      setSortConfig({
                        key: "host_port",
                        direction: "descending",
                      })
                    }
                  >
                    <span
                      className={
                        sortConfig.key === "host_port" &&
                        sortConfig.direction === "descending"
                          ? "font-medium text-blue-600"
                          : ""
                      }
                    >
                      Port (Desc)
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      setSortConfig({ key: "owner", direction: "ascending" })
                    }
                  >
                    <span
                      className={
                        sortConfig.key === "owner" &&
                        sortConfig.direction === "ascending"
                          ? "font-medium text-blue-600"
                          : ""
                      }
                    >
                      Service (A-Z)
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      setSortConfig({ key: "owner", direction: "descending" })
                    }
                  >
                    <span
                      className={
                        sortConfig.key === "owner" &&
                        sortConfig.direction === "descending"
                          ? "font-medium text-blue-600"
                          : ""
                      }
                    >
                      Service (Z-A)
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      setSortConfig({ key: "created", direction: "ascending" })
                    }
                  >
                    <span
                      className={
                        sortConfig.key === "created" &&
                        sortConfig.direction === "ascending"
                          ? "font-medium text-blue-600"
                          : ""
                      }
                    >
                      Created (Oldest)
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      setSortConfig({ key: "created", direction: "descending" })
                    }
                  >
                    <span
                      className={
                        sortConfig.key === "created" &&
                        sortConfig.direction === "descending"
                          ? "font-medium text-blue-600"
                          : ""
                      }
                    >
                      Created (Newest)
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onPortLayoutChange("list")}
                        className={`p-1.5 sm:p-2 rounded-md transition-colors ${
                          portLayout === "list"
                            ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                            : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                        }`}
                      >
                        <List className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>List view</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onPortLayoutChange("grid")}
                        className={`p-1.5 sm:p-2 rounded-md transition-colors ${
                          portLayout === "grid"
                            ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                            : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                        }`}
                      >
                        <Grid3x3 className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Grid view</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onPortLayoutChange("table")}
                        className={`p-1.5 sm:p-2 rounded-md transition-colors ${
                          portLayout === "table"
                            ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                            : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                        }`}
                      >
                        <Table className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Table view</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={onToggleServerSelectionMode}
                      className={`p-1.5 sm:p-2 rounded-md transition-colors ${
                        selectionMode
                          ? "bg-blue-100 dark:bg-blue-800/50 text-blue-700 dark:text-blue-300 shadow-sm"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-700 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 dark:hover:text-slate-200"
                      }`}
                    >
                      <CheckSquare className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {selectionMode ? "Exit selection mode" : "Select ports"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {sortedPorts.length > 8 && portLayout !== "grid" && (
                <button
                  onClick={onToggleExpanded}
                  className="inline-flex items-center px-2 sm:px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 mr-1" />
                  ) : (
                    <ChevronDown className="h-4 w-4 mr-1" />
                  )}
                  <span className="hidden sm:inline">
                    {isExpanded
                      ? "Show Less"
                      : `Show All (${sortedPorts.length})`}
                  </span>
                  <span className="sm:hidden">
                    {isExpanded ? "Less" : "All"}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {ok && visiblePorts.length > 0 && (
          <div className={selectionMode ? "pb-20" : ""}>
            {portLayout === "list" && (
              <>
                {/**
                 * Select all header for non-table views
                 */}
                {selectionMode && (
                  <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={portsToDisplay.length > 0 && portsToDisplay.every(port => 
                          selectedPorts?.has(generatePortKey(id, port))
                        )}
                        ref={input => {
                          if (input) {
                            const allSelected = portsToDisplay.length > 0 && portsToDisplay.every(port => 
                              selectedPorts?.has(generatePortKey(id, port))
                            );
                            const someSelected = portsToDisplay.some(port => 
                              selectedPorts?.has(generatePortKey(id, port))
                            );
                            input.indeterminate = someSelected && !allSelected;
                          }
                        }}
                        onChange={() => {
                          const allSelected = portsToDisplay.every(port => 
                            selectedPorts?.has(generatePortKey(id, port))
                          );
                          if (allSelected) {
                            portsToDisplay.forEach(port => {
                              if (selectedPorts?.has(generatePortKey(id, port))) {
                                onToggleSelection?.(port, id);
                              }
                            });
                          } else {
                            onSelectAllPorts?.(portsToDisplay);
                          }
                        }}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 rounded cursor-pointer"
                      />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Select All ({portsToDisplay.length})
                      </span>
                    </div>
                  </div>
                )}
                <ul className="space-y-2">
                {portsToDisplay.map((port) => (
                  <PortCard
                    key={generatePortKey(id, port)}
                    port={port}
                    itemKey={generatePortKey(id, port)}
                    searchTerm={searchTerm}
                    actionFeedback={actionFeedback}
                    onCopy={onCopy}
                    onEdit={onNote}
                    onToggleIgnore={onToggleIgnore}
                    onRename={onRename}
                    serverId={id}
                    serverUrl={serverUrl}
                    forceOpenDetails={deepLinkContainerId && port.container_id === deepLinkContainerId}
                    notifyOpenDetails={(cid) => onOpenContainerDetails && onOpenContainerDetails(cid)}
                    notifyCloseDetails={() => onCloseContainerDetails && onCloseContainerDetails()}
                    selectionMode={selectionMode}
                    isSelected={selectedPorts?.has(generatePortKey(id, port))}
                    onToggleSelection={onToggleSelection}
                  />)
                )}
                </ul>
              </>
            )}

            {portLayout === "grid" && (
              <>
                {/**
                 * Select all header for grid view
                 */}
                {selectionMode && (
                  <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 mb-4">
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={portsToDisplay.length > 0 && portsToDisplay.every(port => 
                          selectedPorts?.has(generatePortKey(id, port))
                        )}
                        ref={input => {
                          if (input) {
                            const allSelected = portsToDisplay.length > 0 && portsToDisplay.every(port => 
                              selectedPorts?.has(generatePortKey(id, port))
                            );
                            const someSelected = portsToDisplay.some(port => 
                              selectedPorts?.has(generatePortKey(id, port))
                            );
                            input.indeterminate = someSelected && !allSelected;
                          }
                        }}
                        onChange={() => {
                          const allSelected = portsToDisplay.every(port => 
                            selectedPorts?.has(generatePortKey(id, port))
                          );
                          if (allSelected) {
                            portsToDisplay.forEach(port => {
                              if (selectedPorts?.has(generatePortKey(id, port))) {
                                onToggleSelection?.(port, id);
                              }
                            });
                          } else {
                            onSelectAllPorts?.(portsToDisplay);
                          }
                        }}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 rounded cursor-pointer"
                      />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Select All ({portsToDisplay.length})
                      </span>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {portsToDisplay.map((port) => (
                  <PortGridItem
                    key={generatePortKey(id, port)}
                    port={port}
                    searchTerm={searchTerm}
                    actionFeedback={actionFeedback}
                    onCopy={onCopy}
                    onNote={onNote}
                    onToggleIgnore={onToggleIgnore}
                    onRename={onRename}
                    serverId={id}
                    serverUrl={serverUrl}
                    forceOpenDetails={deepLinkContainerId && port.container_id === deepLinkContainerId}
                    notifyOpenDetails={(cid) => onOpenContainerDetails && onOpenContainerDetails(cid)}
                    notifyCloseDetails={() => onCloseContainerDetails && onCloseContainerDetails()}
                    selectionMode={selectionMode}
                    isSelected={selectedPorts?.has(generatePortKey(id, port))}
                    onToggleSelection={onToggleSelection}
                  />
                ))}
                </div>
              </>
            )}
            {portLayout === "table" && (
              <PortTable
                ports={portsToDisplay}
                serverId={id}
                serverUrl={serverUrl}
                searchTerm={searchTerm}
                actionFeedback={actionFeedback}
                onCopy={onCopy}
                onNote={onNote}
                onToggleIgnore={onToggleIgnore}
                onRename={onRename}
                sortConfig={sortConfig}
                onSort={(key) =>
                  setSortConfig((prev) => ({
                    key,
                    direction:
                      prev.key === key && prev.direction === "ascending"
                        ? "descending"
                        : "ascending",
                  }))
                }
                deepLinkContainerId={deepLinkContainerId}
                onOpenContainerDetails={onOpenContainerDetails}
                onCloseContainerDetails={onCloseContainerDetails}
                selectionMode={selectionMode}
                selectedPorts={selectedPorts}
                onToggleSelection={onToggleSelection}
                onSelectAllPorts={onSelectAllPorts}
              />
            )}

            {!isExpanded && sortedPorts.length > 8 && portLayout !== "grid" && (
              <div className="p-4 text-center border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={onToggleExpanded}
                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm font-medium"
                >
                  + {sortedPorts.length - 8} more ports
                </button>
              </div>
            )}
          </div>
        )}

        {ok && visiblePorts.length === 0 && (
          <div className="p-6 text-center text-slate-500 dark:text-slate-400">
            No ports detected or all ports are hidden.
          </div>
        )}

        {!ok && (
          <div className="p-6 text-center text-red-500 dark:text-red-400">
            Server is offline or API is not reachable.
          </div>
        )}

        <Dialog open={showPortModal} onOpenChange={setShowPortModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Available Port Generator</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {suggestionLoading && (
                <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Checking for an available port...
                </div>
              )}

              {suggestionError && !suggestionLoading && (
                <div className="text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/60 rounded-md px-3 py-2 bg-red-50 dark:bg-red-900/20">
                  {suggestionError}
                </div>
              )}

              {suggestionPort && !suggestionLoading && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                    <span className="text-2xl font-mono font-semibold text-slate-900 dark:text-slate-100">{suggestionPort}</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={handleCopySuggestedPort}
                            className="inline-flex items-center justify-center p-2 rounded-md bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
                          >
                            {copiedKey === `suggested-port-${id}` ? (
                              <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{copiedKey === `suggested-port-${id}` ? "Copied!" : "Copy to clipboard"}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter className="flex flex-col sm:flex-row sm:justify-center sm:space-x-2 space-y-2 sm:space-y-0">
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowPortModal(false)}>
                  Close
                </Button>
                <Button onClick={handleRegenerate} disabled={suggestionLoading}>
                  {suggestionLoading ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Generating...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4" />
                      Regenerate
                    </span>
                  )}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {hiddenPorts.length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-700/50">
            <HiddenPortsDrawer
              hiddenPorts={hiddenPorts}
              onUnhide={(p) => onToggleIgnore(id, p)}
              onUnhideAll={(ports) => ports.forEach(p => onToggleIgnore(id, p))}
              serverId={id}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export const ServerSection = React.memo(ServerSectionComponent);
