import React from "react";
import { ExternalLink, Globe } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SslIcon, getSslTooltip } from "./SslIcon";

const bgClassesByStatus = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-800/40 dark:text-emerald-200",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-800/40 dark:text-amber-200",
  error: "bg-red-100 text-red-800 dark:bg-red-800/40 dark:text-red-200",
  none: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
};

export function ExternalUrlChip({ url, hostname, sslStatus = "active", compact = false }) {
  const bgClasses = bgClassesByStatus[sslStatus] || bgClassesByStatus.none;
  const displayName = compact ? hostname.split('.')[0] : hostname;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="group/url inline-flex items-center"
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${bgClasses}`}>
              <Globe className="h-3 w-3" />
              <span className="font-medium">{displayName}</span>
              <SslIcon status={sslStatus} className="h-3 w-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="flex flex-col gap-1">
              <span className="font-medium">{hostname}</span>
              <span className="text-xs opacity-80">{getSslTooltip(sslStatus)}</span>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {!compact && (
        <ExternalLink className="h-3 w-3 ml-1 text-emerald-600 dark:text-emerald-400 opacity-0 group-hover/url:opacity-100 transition-opacity" />
      )}
    </a>
  );
}

export default ExternalUrlChip;
