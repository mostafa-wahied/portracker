import React from "react";
import { ExternalLink } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function getHostForPort(port, serverId, serverUrl, hostOverride) {
  if (port.host_ip === "0.0.0.0" || port.host_ip === "127.0.0.1") {
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
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-800/40 dark:text-indigo-200 text-xs font-medium">
              {port.host_port}
            </span>
            <ExternalLink className="h-3 w-3 text-indigo-600 dark:text-indigo-400 opacity-0 group-hover/badge:opacity-100 transition-opacity" />
          </a>
        </TooltipTrigger>
        <TooltipContent>{url}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
