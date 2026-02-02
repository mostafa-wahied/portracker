import { useState, useEffect, useRef } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AggregatedHealthDot({
  ports,
  serverId,
  serverUrl,
}) {
  const [portStatuses, setPortStatuses] = useState({});
  const [checking, setChecking] = useState(true);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    if (!ports || ports.length === 0) {
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
            hasWebUI: data.hasWebUI !== false
          };
        }
        return { portKey: `${port.host_ip}:${port.host_port}`, color: "red", hasWebUI: true };
      } catch {
        if (signal.aborted) return null;
        return { portKey: `${port.host_ip}:${port.host_port}`, color: "red", hasWebUI: true };
      }
    };

    const checkAllPorts = async () => {
      const results = await Promise.all(ports.map(checkPort));
      if (signal.aborted) return;

      const statuses = {};
      results.forEach((result) => {
        if (result) {
          statuses[result.portKey] = { color: result.color, hasWebUI: result.hasWebUI };
        }
      });
      setPortStatuses(statuses);
      setChecking(false);
    };

    checkAllPorts();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [ports, serverId, serverUrl]);

  const getAggregatedState = () => {
    if (checking || Object.keys(portStatuses).length === 0) {
      return {
        color: "bg-blue-400 animate-pulse",
        title: "Checking health...",
        hasNoWebUI: false,
      };
    }

    const statuses = Object.values(portStatuses);
    const colors = statuses.map(s => s.color);
    const hasRed = colors.includes("red");
    const hasYellow = colors.includes("yellow");
    const allGreen = colors.every((c) => c === "green");
    const hasNoWebUI = statuses.some(s => !s.hasWebUI);

    if (hasRed) {
      const redCount = colors.filter((c) => c === "red").length;
      return {
        color: "bg-red-500",
        title: `${redCount} port${redCount !== 1 ? "s" : ""} unreachable`,
        hasNoWebUI: false,
      };
    }

    if (hasYellow) {
      const yellowCount = colors.filter((c) => c === "yellow").length;
      return {
        color: "bg-yellow-500",
        title: `${yellowCount} port${yellowCount !== 1 ? "s" : ""} with issues`,
        hasNoWebUI: false,
      };
    }

    if (allGreen) {
      return {
        color: "bg-green-500",
        title: `All ${colors.length} port${colors.length !== 1 ? "s" : ""} healthy`,
        hasNoWebUI,
      };
    }

    return {
      color: "bg-gray-400",
      title: "Status unknown",
      hasNoWebUI: false,
    };
  };

  const state = getAggregatedState();

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
        <TooltipContent>
          <p className="font-medium text-xs">{state.title}</p>
          {state.hasNoWebUI && (
            <p className="text-xs text-slate-400">Some ports have no web UI</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
