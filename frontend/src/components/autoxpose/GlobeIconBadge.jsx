import React from "react";
import { Globe } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SslIcon } from "./SslIcon";

export function GlobeIconBadge({ url, hostname, sslStatus = "active" }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center justify-center h-6 w-6 rounded-full hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
          >
            <Globe className="h-4 w-4 text-emerald-500" />
          </a>
        </TooltipTrigger>
        <TooltipContent>
          <span className="flex items-center gap-1.5">
            <span className="font-medium">{hostname}</span>
            <SslIcon status={sslStatus} className="h-3 w-3" />
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default GlobeIconBadge;
