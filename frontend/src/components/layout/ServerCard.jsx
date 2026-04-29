import React, { useState, useEffect } from "react";
import {
  Trash2,
  Server,
  HardDrive,
  Clock,
  Zap,
  Settings,
  Pencil,
  Container,
  MoreVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatBytes, formatUptime } from "@/lib/utils";

function useRelativeTime(timestamp) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!timestamp) return;
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, [timestamp]);
  if (!timestamp) return null;
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function LastRefreshedLabel({ timestamp }) {
  const label = useRelativeTime(timestamp);
  if (!label) return null;
  return (
    <p className="mt-1.5 text-[10px] text-slate-400 dark:text-slate-500 tracking-wide">
      Updated {label}
    </p>
  );
}

function ServerHealthDot({ ok, isUpdating }) {
  const tone = isUpdating
    ? "bg-blue-400 animate-pulse"
    : ok !== false
      ? "bg-green-500"
      : "bg-red-500";
  const label = isUpdating ? "Updating..." : ok !== false ? "Online" : "Unreachable";
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${tone}`} />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ServerCardActions({ server, onEdit, onDelete }) {
  const showDelete = server.id !== "local";
  return (
    <>
      <div className="hidden md:flex items-center space-x-2 opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(server.id); }}
          className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
          aria-label="Edit Server"
        >
          <Pencil className="h-4 w-4" />
        </button>
        {showDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(server); }}
            className="p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-500"
            aria-label="Delete Server"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
              aria-label="More options"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent onClick={(e) => e.stopPropagation()} align="end">
            <DropdownMenuItem onClick={() => onEdit(server.id)}>
              <Pencil className="mr-2 h-4 w-4" />
              <span>Edit</span>
            </DropdownMenuItem>
            {showDelete && (
              <DropdownMenuItem
                onClick={() => onDelete(server)}
                className="text-red-600 focus:text-red-600 dark:text-red-500 dark:focus:text-red-500"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                <span>Delete</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}

function ServerCardMetrics({ memory, uptime, portCount, typeIcon, typeCount, typeLabel }) {
  return (
    <>
      <div className="mt-3 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">
        <div className="flex items-center space-x-3">
          <HardDrive className="h-3 w-3 mr-1" />
          <span>{memory ? formatBytes(memory) : "N/A"}</span>
        </div>
        <div className="flex items-center space-x-3">
          <Clock className="h-3 w-3 mr-1" />
          <span>{uptime ? formatUptime(uptime, true) : "N/A"}</span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">
        <div className="flex items-center space-x-3">
          <Zap className="h-3 w-3 mr-1" />
          <span>{portCount} ports</span>
        </div>
        <div className="flex items-center space-x-3">
          {typeIcon}
          <span>{typeCount} {typeLabel}</span>
        </div>
      </div>
    </>
  );
}

function getHostDisplay(server, hostOverride) {
  if (!server.url) return hostOverride || window.location.host || "localhost";
  try {
    const url = new URL(server.url.startsWith("http") ? server.url : `http://${server.url}`);
    const portSuffix = url.port && url.port !== "80" && url.port !== "443" ? `:${url.port}` : "";
    return url.hostname + portSuffix;
  } catch {
    return server.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "") || "localhost";
  }
}

function getServerTypeMeta(server, portCount, containerCount, vmCount) {
  if (server.platform === "docker" || containerCount > 0) {
    return {
      label: containerCount === 1 ? "Container" : "Containers",
      icon: <Container className="h-3 w-3 mr-1" />,
      count: containerCount,
    };
  }
  if (vmCount > 0) {
    return { label: "VMs", icon: <Server className="h-3 w-3 mr-1" />, count: vmCount };
  }
  return { label: "Services", icon: <Settings className="h-3 w-3 mr-1" />, count: portCount };
}

export const ServerCard = React.memo(function ServerCard({
  server,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  hostOverride,
  lastRefreshedTs,
  children,
}) {
  const name = server.server || "Unknown Server";
  const portCount = server.data?.length || 0;
  const isUpdating = server.ok === null || server.loading;
  const systemInfo = server.systemInfo || {};
  const memory = systemInfo.physmem || systemInfo.total_mem || systemInfo.memory;
  const uptime = systemInfo.uptime_seconds;
  const containerCount = systemInfo.containers_running || 0;
  const vmCount = (server.vms || []).length;
  const typeMeta = getServerTypeMeta(server, portCount, containerCount, vmCount);
  const cardClass = `p-4 rounded-xl border-2 transition-all duration-200 group relative focus:outline-none ${
    isSelected
      ? "border-blue-500 bg-blue-50 dark:bg-slate-800 shadow-md hover:shadow-lg hover:border-blue-600"
      : "border-slate-200 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm"
  } ${isUpdating ? "opacity-75 cursor-not-allowed" : "cursor-pointer"}`;

  return (
    <div
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onSelect(server.id); }}
      className={cardClass}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-slate-800 dark:text-slate-200 truncate pr-2 group-hover:text-slate-900 dark:group-hover:text-slate-100 transition-colors flex items-center gap-2">
            {server.label || name}
            <ServerHealthDot ok={server.ok} isUpdating={isUpdating} />
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 font-mono">
            {getHostDisplay(server, hostOverride)}
          </p>
        </div>
        <ServerCardActions server={server} onEdit={onEdit} onDelete={onDelete} />
      </div>
      <ServerCardMetrics
        memory={memory}
        uptime={uptime}
        portCount={portCount}
        typeIcon={typeMeta.icon}
        typeCount={typeMeta.count}
        typeLabel={typeMeta.label}
      />
      {lastRefreshedTs && <LastRefreshedLabel timestamp={lastRefreshedTs} />}
      {children}
    </div>
  );
});
