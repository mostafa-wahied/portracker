import { useState, useEffect } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { t } from "@/lib/i18n";

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
        title: t('Connection failed')
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
        title: t('Checking service status...'),
      };
    }
    
    if (!statusData) {
      return {
        color: "bg-gray-400",
        title: t('Status unknown'),
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
      title: statusData.title || t('Status unknown'),
    };
  };

  const dotState = getDotState();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <div className={`w-2.5 h-2.5 rounded-full ${dotState.color}`} />
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">{dotState.title}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
