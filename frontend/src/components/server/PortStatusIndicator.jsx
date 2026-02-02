import { useState, useEffect } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function PortStatusIndicator({
  serverId,
  serverUrl,
  port,
  onProtocolChange,
}) {
  const [statusData, setStatusData] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

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

    fetch(pingApiUrl, { signal: controller.signal })
      .then((res) =>
        res.ok ? res.json() : Promise.reject(`API ping failed: ${res.status}`)
      )
      .then((data) => {
        setStatusData(data);
        if (onProtocolChange && data.protocol) {
          onProtocolChange(data.protocol);
        }
      })
      .catch(() => setStatusData({ 
        reachable: false, 
        status: 'unreachable',
        color: 'red',
        title: 'Connection failed',
        hasWebUI: true
      }))
      .finally(() => {
        clearTimeout(timeoutId);
        setChecking(false);
      });

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [port.host_ip, port.host_port, port.owner, port.internal, port.container_id, port.source, serverId, serverUrl, onProtocolChange]);

  const getDotState = () => {
    if (checking) {
      return {
        color: "bg-blue-400 animate-pulse",
        title: "Checking service status...",
        hasWebUI: true,
      };
    }
    
    if (!statusData) {
      return {
        color: "bg-gray-400",
        title: "Status unknown",
        hasWebUI: true,
      };
    }
    
    const colorMap = {
      green: "bg-green-500",
      yellow: "bg-yellow-500", 
      red: "bg-red-500",
      gray: "bg-gray-400"
    };
    
    return {
      color: colorMap[statusData.color] || "bg-gray-400",
      title: statusData.title || "Status unknown",
      hasWebUI: statusData.hasWebUI !== false,
    };
  };

  const dotState = getDotState();
  const showNoWebUIIndicator = !checking && statusData?.color === 'green' && !dotState.hasWebUI;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <div className="relative">
            <div className={`w-2.5 h-2.5 rounded-full ${dotState.color}`} />
            {showNoWebUIIndicator && (
              <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-slate-400" />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">{dotState.title}</p>
          {showNoWebUIIndicator && (
            <p className="text-xs text-slate-400">No web UI available</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
