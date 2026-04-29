import { useState, useEffect, useRef } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useServiceHealth } from "@/hooks/useServiceHealth";
import { WhyThisStatusPopover } from "./WhyThisStatusPopover";

const COLOR_CLASSES = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
  gray: "bg-gray-400",
};

function stopStatusEvent(event) {
  event.stopPropagation();
}

function deriveStatusesFromComponents(components, ports) {
  const out = {};
  if (!Array.isArray(components) || !Array.isArray(ports)) return out;
  const byContainer = new Map();
  components.forEach((c) => {
    if (c && c.containerId) byContainer.set(c.containerId, c);
  });
  const samePort = (a, b) => Number(a) === Number(b);
  const matchesEntry = (entry, port) => {
    if (!entry) return false;
    if (!samePort(entry.host_port, port.host_port)) return false;
    if (!entry.host_ip || !port.host_ip) return true;
    return entry.host_ip === port.host_ip;
  };
  ports.forEach((port) => {
    if (!port || port.host_ip == null || port.host_port == null) return;
    const key = `${port.host_ip}:${port.host_port}`;
    const comp = port.container_id ? byContainer.get(port.container_id) : null;
    if (!comp) return;
    const probe = comp.probe || {};
    const evidence = probe.evidence || {};
    const failures = Array.isArray(evidence.failures) ? evidence.failures : [];
    const suppressed = Array.isArray(evidence.suppressed) ? evidence.suppressed : [];
    const failure = failures.find((f) => matchesEntry(f, port));
    if (failure) {
      out[key] = { color: 'red', reason: failure.error || 'unreachable', isInternal: !!port.internal };
      return;
    }
    const supp = suppressed.find((s) => matchesEntry(s, port));
    if (supp) {
      out[key] = { color: 'gray', suppressed: true, suppressedReason: supp.reason || 'unknown', isInternal: !!port.internal };
      return;
    }
    out[key] = { color: probe.ok === true ? 'green' : 'red', isInternal: !!port.internal };
  });
  return out;
}

function shortStatusReason(reason, colorWord) {
  if (!reason) return colorWord;

  const legacyPartial = reason.match(/^HEALTHCHECK ok but (\d+) port\(s\) unreachable:/i);
  if (legacyPartial) {
    const count = Number(legacyPartial[1]);
    return `Service is running, but ${count} published port${count === 1 ? "" : "s"} aren't responding`;
  }

  return reason
    .replace(/\bdid not answer\b/gi, "aren't responding")
    .replace(/\bHEALTHCHECK\b/g, "health check")
    .replace(/\bcore component(s)?\b/gi, "main service$1")
    .replace(/\bcore service\(s\)\b/gi, "main service(s)");
}

export function AggregatedHealthDot({
  ports,
  serverId,
  serverUrl,
  hostOverride,
  serviceName,
  isDocker,
}) {
  const [portStatuses, setPortStatuses] = useState({});
  const [checking, setChecking] = useState(true);
  const abortControllerRef = useRef(null);
  const sh = useServiceHealth();
  const isLocal = !serverId || serverId === "local";
  const composeProject = (ports || []).find((p) => p && p.compose_project)?.compose_project || null;
  const containerIds = Array.from(
    new Set((ports || []).map((p) => p && p.container_id).filter(Boolean))
  );
  const anyContainerId = containerIds[0] || null;
  const shLookup = sh.enabled && isLocal
    ? sh.lookupCard({ isDocker, composeProject, serviceName, containerId: anyContainerId, containerIds })
    : null;
  const shHasVerdict = !!(shLookup && shLookup.color);

  useEffect(() => {
    if (!ports || ports.length === 0) {
      setChecking(false);
      return;
    }
    if (shHasVerdict) {
      setChecking(false);
      return;
    }

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    setChecking(true);
    setPortStatuses({});

    const checkPort = async (port) => {
      let pingApiUrl = `/api/ping?host_ip=${encodeURIComponent(
        port.host_ip
      )}&host_port=${port.host_port}`;

      if (port.internal) {
        pingApiUrl += `&internal=true`;
        if (port.container_id) {
          pingApiUrl += `&container_id=${encodeURIComponent(port.container_id)}`;
        }
        if (serverId) {
          pingApiUrl += `&server_id=${encodeURIComponent(serverId)}`;
        }
      }

      if (port.owner) {
        pingApiUrl += `&owner=${encodeURIComponent(port.owner)}`;
      }

      if (port.source) {
        pingApiUrl += `&source=${encodeURIComponent(port.source)}`;
      }

      if (
        serverId &&
        serverId !== "local" &&
        serverUrl &&
        (port.host_ip === "0.0.0.0" || port.host_ip === "127.0.0.1")
      ) {
        pingApiUrl += `&target_server_url=${encodeURIComponent(serverUrl)}`;
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(pingApiUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (signal.aborted) return null;

        if (res.ok) {
          const data = await res.json();
          return { 
            portKey: `${port.host_ip}:${port.host_port}`, 
            color: data.color || "gray",
            hasWebUI: data.hasWebUI !== false,
            isInternal: port.internal || false
          };
        }
        return { portKey: `${port.host_ip}:${port.host_port}`, color: "red", hasWebUI: true, isInternal: port.internal || false };
      } catch {
        if (signal.aborted) return null;
        return { portKey: `${port.host_ip}:${port.host_port}`, color: "red", hasWebUI: true, isInternal: port.internal || false };
      }
    };

    const checkAllPorts = async () => {
      const results = await Promise.all(ports.map(checkPort));
      if (signal.aborted) return;

      const statuses = {};
      results.forEach((result) => {
        if (result) {
          statuses[result.portKey] = { color: result.color, hasWebUI: result.hasWebUI, isInternal: result.isInternal };
        }
      });
      setPortStatuses(statuses);
      setChecking(false);
    };

    checkAllPorts();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [ports, serverId, serverUrl, shHasVerdict]);

  const getAggregatedState = () => {
    if (checking || Object.keys(portStatuses).length === 0) {
      return {
        color: "bg-blue-400 animate-pulse",
        title: "Checking health...",
        hasNoWebUI: false,
      };
    }

    const statuses = Object.values(portStatuses);
    const externalStatuses = statuses.filter(s => !s.isInternal);
    const externalColors = externalStatuses.map(s => s.color);
    const hasRed = externalColors.includes("red");
    const hasYellow = externalColors.includes("yellow");
    const allGreen = externalColors.length > 0 && externalColors.every((c) => c === "green");
    const hasNoWebUI = statuses.some(s => !s.hasWebUI);

    if (hasRed) {
      const redCount = externalColors.filter((c) => c === "red").length;
      return {
        color: "bg-red-500",
        title: `${redCount} port${redCount !== 1 ? "s" : ""} unreachable`,
        hasNoWebUI: false,
      };
    }

    if (hasYellow) {
      const yellowCount = externalColors.filter((c) => c === "yellow").length;
      return {
        color: "bg-yellow-500",
        title: `${yellowCount} port${yellowCount !== 1 ? "s" : ""} with issues`,
        hasNoWebUI: false,
      };
    }

    if (allGreen) {
      return {
        color: "bg-green-500",
        title: `All ${externalColors.length} port${externalColors.length !== 1 ? "s" : ""} healthy`,
        hasNoWebUI,
      };
    }

    if (externalColors.length === 0 && statuses.length > 0) {
      return {
        color: "bg-gray-400",
        title: "Internal ports only",
        hasNoWebUI: false,
      };
    }

    return {
      color: "bg-gray-400",
      title: "Status unknown",
      hasNoWebUI: false,
    };
  };

  const state = getAggregatedState();

  const [explainerOpen, setExplainerOpen] = useState(false);

  if (isLocal && sh.loading) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="relative flex-shrink-0">
              <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-[230px]">
            <p className="font-medium text-xs">Checking service health...</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (shLookup && shLookup.color) {
    const colorClass = COLOR_CLASSES[shLookup.color] || COLOR_CLASSES.gray;
    const colorWord = {
      green: "All reachable",
      yellow: "Partially reachable",
      red: "Main component unreachable",
      gray: "Status unclear",
    }[shLookup.color] || "Service health";
    const title = shortStatusReason(shLookup.reason, colorWord);
    return (
      <>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setExplainerOpen(true); }}
                onMouseDown={stopStatusEvent}
                onPointerDown={stopStatusEvent}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setExplainerOpen(true);
                  }
                }}
                className="relative flex flex-shrink-0 cursor-pointer items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
                aria-label={`Service status: ${title}. Open details.`}
              >
                <div className={`w-2 h-2 rounded-full ${colorClass}`} />
                <span aria-hidden="true" className="absolute -inset-2" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              className="max-w-[230px]"
              onClick={stopStatusEvent}
              onMouseDown={stopStatusEvent}
              onPointerDown={stopStatusEvent}
            >
              <p className="font-medium text-xs leading-snug">{title}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <WhyThisStatusPopover
          open={explainerOpen}
          onOpenChange={setExplainerOpen}
          serviceName={serviceName || (shLookup.services[0] && shLookup.services[0].name) || "service"}
          color={shLookup.color}
          reason={shLookup.reason}
          components={shLookup.components}
          ports={ports}
          portStatuses={deriveStatusesFromComponents(shLookup.components, ports)}
          updatedAt={sh.updatedAt}
          onRefresh={sh.refresh}
          serverId={serverId}
          serverUrl={serverUrl}
          hostOverride={hostOverride}
        />
      </>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative flex-shrink-0">
            <div className={`w-2 h-2 rounded-full ${state.color}`} />
            {state.hasNoWebUI && (
              <div className="absolute -top-0.5 -right-0.5 w-1 h-1 rounded-full bg-slate-400" />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent
          className="max-w-[230px]"
          onClick={stopStatusEvent}
          onMouseDown={stopStatusEvent}
          onPointerDown={stopStatusEvent}
        >
          <p className="font-medium text-xs">{state.title}</p>
          {state.hasNoWebUI && (
            <p className="text-xs text-slate-400">Some ports have no web UI</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
