import React, { useState, useEffect, useRef } from "react";
import {
  Trash2,
  Plus,
  Check,
  X,
  Server,
  HardDrive,
  Clock,
  Zap,
  BarChart3,
  Settings,
  Loader2,
  AlertCircle,
  Pencil,
  Container,
  MoreVertical,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBytes, formatUptime } from "@/lib/utils";
import { SidebarSkeleton } from "./SidebarSkeleton";

const generateServerId = (label) => {
  if (!label || !label.trim()) {
    return `server-${Date.now()}`;
  }
  const cleanId = label
    .trim()
    .toLowerCase()
    .replace(/[\s\-_.,;:!?()[\]{}'"]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleanId || cleanId.length === 0) {
    return `server-${Date.now()}`;
  }
  return cleanId.substring(0, 50);
};

const ServerCard = React.memo(function ServerCard({
  server,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  hostOverride,
  children,
}) {
  const name = server.server || "Unknown Server";
  const portCount = server.data?.length || 0;
  const isUpdating = server.ok === null || server.loading;
  const systemInfo = server.systemInfo || {};
  const vms = server.vms || [];
  const memory =
    systemInfo.physmem || systemInfo.total_mem || systemInfo.memory;
  const uptime = systemInfo.uptime_seconds;
  const containerCount = systemInfo.containers_running || 0;
  const vmCount = vms.length;

  const getHostDisplay = () => {
    if (!server.url) {
      return hostOverride || window.location.host || "localhost";
    }
    
    try {
      const url = new URL(server.url.startsWith('http') ? server.url : `http://${server.url}`);
      return url.hostname + (url.port && url.port !== '80' && url.port !== '443' ? `:${url.port}` : '');
    } catch {
      return server.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || "localhost";
    }
  };

  let typeLabel = "Services";
  let typeIcon = <Settings className="h-3 w-3 mr-1" />;
  let typeCount = portCount;
  if (server.platform === "docker" || containerCount > 0) {
    typeLabel = containerCount === 1 ? "Container" : "Containers";
    typeIcon = <Container className="h-3 w-3 mr-1" />;
    typeCount = containerCount;
  } else if (vmCount > 0) {
    typeLabel = "VMs";
    typeIcon = <Server className="h-3 w-3 mr-1" />;
    typeCount = vmCount;
  }

  return (
    <div
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(server.id);
      }}
      className={`p-4 rounded-xl border-2 transition-all duration-200 group relative focus:outline-none ${
        isSelected
          ? "border-blue-500 bg-blue-50 dark:bg-slate-800 shadow-md hover:shadow-lg hover:border-blue-600"
          : "border-slate-200 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm"
      } ${isUpdating ? "opacity-75 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-slate-800 dark:text-slate-200 truncate pr-2 group-hover:text-slate-900 dark:group-hover:text-slate-100 transition-colors flex items-center">
            {server.label || name}
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 font-mono">
            {getHostDisplay()}
          </p>
        </div>

        <div className="hidden md:flex items-center space-x-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(server.id);
            }}
            className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
            aria-label="Edit Server"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {server.id !== "local" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(server);
              }}
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
            <DropdownMenuContent
              onClick={(e) => e.stopPropagation()}
              align="end"
            >
              <DropdownMenuItem onClick={() => onEdit(server.id)}>
                <Pencil className="mr-2 h-4 w-4" />
                <span>Edit</span>
              </DropdownMenuItem>
        
              {server.id !== "local" && (
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
      </div>

        
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
          <span>
            {typeCount} {typeLabel}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
});

export function Sidebar({
  servers,
  selectedId,
  onSelect,
  onAdd,
  onDelete,
  loading,
  hostOverride,
}) {
  const [mode, setMode] = useState("list");
  const [form, setForm] = useState({
    label: "",
    url: "",
    parentId: "",
    type: "peer",
  });
  const [error, setError] = useState("");
  const [urlValid, setUrlValid] = useState(false);
  const [validating, setValidating] = useState(false);
  const [allowUnreachable, setAllowUnreachable] = useState(false);
  const [serverToDelete, setServerToDelete] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [validationStatus, setValidationStatus] = useState(null);
  const latestValidationRef = useRef(0);

  useEffect(() => {
    if (mode !== "add" && mode !== "list") {
      const srv = servers.find((s) => s.id === mode);
      if (srv) {
        setForm({
          label: srv.label || srv.server,
          url: srv.url || "",
          parentId: srv.parentId || "",
          type: srv.type || "peer",
        });
        setAllowUnreachable(srv.unreachable || false);
      }
    } else {
      setForm({
        label: "",
        url: "",
        parentId: "",
        type: "peer",
      });
      setAllowUnreachable(false);
    }
    setError("");
    setValidationStatus(null);
    setUrlValid(false);
  }, [mode, servers]);

  useEffect(() => {
    const originalUrl = form.url.trim();
    if (!originalUrl) {
      setUrlValid(false);
      setError("");
      setValidating(false);
      setValidationStatus(null);
      return;
    }
    const hasValidFormat =
      /^(https?:\/\/)?[\w-]+(\.[\w-]+)*([:\d]+)?(\/.*)?$/i.test(originalUrl);
    if (!hasValidFormat) {
      setValidationStatus({ type: "warning", message: "Invalid URL format" });
      setUrlValid(false);
      setValidating(false);
      return;
    }
    const validateUrl = async () => {
      const currentValidation = ++latestValidationRef.current;
      setValidating(true);
      setError("");
      setValidationStatus({
        type: "loading",
        message: "Checking server availability...",
      });
      let urlForCheck = originalUrl.startsWith("http")
        ? originalUrl
        : `http://${originalUrl}`;
      if (allowUnreachable) {
        if (currentValidation === latestValidationRef.current) {
          setUrlValid(true);
          setValidating(false);
          setValidationStatus({
            type: "success",
            message: "URL bypassed (unreachable allowed)",
          });
        }
        return;
      }
      try {
        const healthCheckUrl = `${urlForCheck.replace(/\/+$/, "")}/api/health`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(healthCheckUrl, {
          signal: controller.signal,
          mode: "cors",
        });
        clearTimeout(timeoutId);
        if (currentValidation === latestValidationRef.current) {
          if (response.ok) {
            setUrlValid(true);
            setValidationStatus({
              type: "success",
              message: "Server is reachable",
            });
          } else {
            setUrlValid(false);
            setValidationStatus({
              type: "error",
              message: `Server responded with ${response.status}`,
            });
          }
          setValidating(false);
        }
      } catch (e) {
        if (currentValidation === latestValidationRef.current) {
          setUrlValid(false);
          setValidating(false);
          if (e.name === "AbortError") {
            setValidationStatus({
              type: "error",
              message: "Connection timeout",
            });
          } else {
            setValidationStatus({
              type: "error",
              message: `Cannot reach server: ${e.message}`,
            });
          }
        }
      }
    };
    const debounce = setTimeout(validateUrl, 1200);
    return () => clearTimeout(debounce);
  }, [form.url, allowUnreachable]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.label.trim()) {
      setError("Server name is required");
      return;
    }
    if (form.type === "peer" && !allowUnreachable && !urlValid) {
      setError(
        "Please enter a valid, reachable URL or allow unreachable servers"
      );
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      let finalUrl = form.url.trim();
      if (
        finalUrl &&
        !finalUrl.startsWith("http://") &&
        !finalUrl.startsWith("https://")
      ) {
        finalUrl = `http://${finalUrl}`;
      }
      const serverData = {
        id: mode === "add" ? generateServerId(form.label.trim()) : mode,
        label: form.label.trim(),
        url: finalUrl,
        type: form.type,
        unreachable: allowUnreachable,
        parentId: form.parentId || null,
      };
      await onAdd(serverData, mode !== "add");
      setValidationStatus({
        type: "success",
        message:
          mode === "add"
            ? "Server added successfully!"
            : "Server updated successfully!",
      });
      setTimeout(() => {
        setMode("list");
        setValidationStatus(null);
      }, 1000);
    } catch (e) {
      setError(e.message || "Failed to save server");
      setValidationStatus({
        type: "error",
        message: e.message || "Operation failed",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = () => {
    if (serverToDelete) {
      onDelete(serverToDelete.id);
      setServerToDelete(null);
    }
  };

  const availableParents = servers.filter((s) => s.id !== mode);

  const ValidationStatus = () => {
    if (!validationStatus && !validating) return null;
    const { type, message } = validationStatus || {};
    const statusConfig = {
      loading: {
        icon: Loader2,
        className: "text-blue-500 animate-spin",
        bgColor: "bg-blue-50 dark:bg-blue-900/20",
      },
      success: {
        icon: Check,
        className: "text-green-500",
        bgColor: "bg-green-50 dark:bg-blue-900/20",
      },
      error: {
        icon: AlertCircle,
        className: "text-red-500",
        bgColor: "bg-red-50 dark:bg-red-900/20",
      },
      warning: {
        icon: AlertCircle,
        className: "text-amber-500",
        bgColor: "bg-amber-50 dark:bg-amber-900/20",
      },
    };
    if (validating) {
      const { icon: Icon, className, bgColor } = statusConfig.loading;
      return (
        <div
          className={`flex items-center space-x-2 p-2 rounded-md ${bgColor} mt-2`}
        >
          <Icon className={`h-4 w-4 ${className}`} />
          <span className="text-sm text-blue-700 dark:text-blue-300">
            Checking server availability...
          </span>
        </div>
      );
    }
    if (type && statusConfig[type]) {
      const { icon: Icon, className, bgColor } = statusConfig[type];
      return (
        <div
          className={`flex items-center space-x-2 p-2 rounded-md ${bgColor} mt-2`}
        >
          <Icon className={`h-4 w-4 ${className}`} />
          <span
            className={`text-sm ${
              type === "success"
                ? "text-green-700 dark:text-green-300"
                : type === "error"
                ? "text-red-700 dark:text-red-300"
                : "text-amber-700 dark:text-amber-300"
            }`}
          >
            {message}
          </span>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return <SidebarSkeleton />;
  }

  const serverMap = new Map(servers.map((s) => [s.id, s]));
  const topLevelServers = [];
  const childrenMap = new Map();

  servers.forEach((server) => {
    if (server.parentId && serverMap.has(server.parentId)) {
      const children = childrenMap.get(server.parentId) || [];
      children.push(server);
      childrenMap.set(server.parentId, children);
    } else {
      topLevelServers.push(server);
    }
  });

  const renderServerHierarchy = (server, level = 0) => {
    const children = childrenMap.get(server.id) || [];
    const maxIndentLevel = 3;
    return (
      <ServerCard
        key={server.id}
        server={server}
        isSelected={selectedId === server.id}
        onSelect={onSelect}
        onEdit={setMode}
        onDelete={setServerToDelete}
        hostOverride={hostOverride}
      >
        {children.length > 0 && level < maxIndentLevel && (
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700/50 space-y-3">
            {children.map((child) => renderServerHierarchy(child, level + 1))}
          </div>
        )}
      </ServerCard>
    );
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900">
      {mode === "list" ? (
        <>
          <div className="p-6 flex-shrink-0">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1 flex items-center">
                <BarChart3 className="h-5 w-5 mr-2 text-slate-600 dark:text-slate-400" />
                Dashboard
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Server Overview
              </p>
            </div>
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wider">
              Servers ({servers.length})
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto px-6 space-y-4 pb-4">
            {!loading &&
              topLevelServers.map((server) => renderServerHierarchy(server))}
          </div>
          <div className="p-6 mt-auto flex-shrink-0">
            <button
              onClick={() => setMode("add")}
              className="w-full p-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-600 hover:text-slate-600 dark:hover:text-slate-300 transition-colors flex flex-col items-center justify-center"
            >
              <Plus className="h-5 w-5 mb-1" />
              <span className="text-sm font-medium">Add Server</span>
            </button>
          </div>
        </>
      ) : (
        <div className="p-6 flex-1 overflow-y-auto">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-6">
            {mode === "add" ? "Add New Server" : "Edit Server"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="label">Server Name *</Label>
              <Input
                id="label"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="My Web Server"
                className="mt-1.5"
                disabled={submitting}
              />
            </div>
            <div>
              <Label htmlFor="url">Server URL</Label>
              <div className="relative">
                <Input
                  id="server-url"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="http://localhost:3000"
                  className={`pr-10 ${
                    urlValid
                      ? "border-green-500 focus:border-green-500"
                      : validationStatus?.type === "error"
                      ? "border-red-300 focus:border-red-500"
                      : ""
                  }`}
                  disabled={submitting}
                />
                {form.url && !validating && (
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    {urlValid ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : validationStatus?.type === "error" ? (
                      <X className="w-4 h-4 text-red-500" />
                    ) : null}
                  </div>
                )}
                {validating && (
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                  </div>
                )}
              </div>
              <ValidationStatus />
            </div>
            {availableParents.length > 0 && (
              <div>
                <Label htmlFor="parent">Parent Server (Optional)</Label>
                <select
                  id="parent"
                  value={form.parentId}
                  onChange={(e) =>
                    setForm({ ...form, parentId: e.target.value })
                  }
                  className="w-full mt-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 text-sm disabled:opacity-50"
                  disabled={submitting}
                >
                  <option value="">None (Top-level server)</option>
                  {availableParents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label || s.server}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center">
                <input
                  id="allow-unreachable"
                  type="checkbox"
                  checked={allowUnreachable}
                  onChange={(e) => setAllowUnreachable(e.target.checked)}
                  className="rounded border-gray-300"
                  disabled={submitting}
                />
                <Label
                  htmlFor="allow-unreachable"
                  className="ml-2 text-sm font-normal text-slate-600 dark:text-slate-400"
                >
                  Save even if unreachable
                </Label>
              </div>
            </div>
            {error && (
              <p className="mt-4 text-sm text-red-600 dark:text-red-500 bg-red-100 dark:bg-red-900/20 p-3 rounded-md">
                {error}
              </p>
            )}
            <div className="mt-6 flex flex-col sm:flex-row justify-end gap-2">
              <Button variant="outline" onClick={() => setMode("list")}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={
                  !form.label ||
                  (form.type === "peer" && !allowUnreachable && !urlValid) ||
                  submitting
                }
                className="min-w-[100px]"
              >
                {submitting ? (
                  <div className="flex items-center">
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {mode === "add" ? "Adding..." : "Saving..."}
                  </div>
                ) : mode === "add" ? (
                  "Add Server"
                ) : (
                  "Save Changes"
                )}
              </Button>
            </div>
          </form>
        </div>
      )}
      <AlertDialog
        open={!!serverToDelete}
        onOpenChange={() => setServerToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Server</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "
              {serverToDelete?.label || serverToDelete?.server}"? This action
              cannot be undone and will remove all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
            >
              Delete Server
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
