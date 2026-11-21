import React from "react";
import { ExternalLink } from "lucide-react";
import { ServicePortBadge } from "@/components/ui/service-list-visuals";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function getHostForPort(port, serverId, serverUrl, hostOverride) {
  if (port.host_ip === "127.0.0.1") {
    return "127.0.0.1";
  }
  if (port.host_ip === "0.0.0.0") {
    if (serverId === "local") {
      return hostOverride || window.location.hostname;
    } else if (serverUrl) {
      try {
        return new URL(serverUrl).hostname;
      } catch {
        return "localhost";
      }
    }
    return "localhost";
  }
  return port.host_ip;
}

export function ClickablePortBadge({ port, serverId, serverUrl, hostOverride }) {
  const host = getHostForPort(port, serverId, serverUrl, hostOverride);
  const url = `http://${host}:${port.host_port}`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="group/badge inline-flex items-center space-x-1"
          >
            <ServicePortBadge port={port.host_port} />
            <ExternalLink className="h-3 w-3 text-indigo-600 dark:text-indigo-400 opacity-0 group-hover/badge:opacity-100 transition-opacity" />
          </a>
        </TooltipTrigger>
        <TooltipContent>{url}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
