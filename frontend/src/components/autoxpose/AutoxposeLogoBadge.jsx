import React from "react";
import { AutoxposeLogo } from "./AutoxposeLogo";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";

export function AutoxposeLogoBadge({ connected = false, className = "" }) {
  if (!connected) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-4 h-4 bg-slate-100 dark:bg-slate-800 rounded-full ring-1 ring-slate-200 dark:ring-slate-700 ${className}`}
        >
          <AutoxposeLogo
            size={10}
            className="text-emerald-500 dark:text-emerald-400"
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        Connected to Autoxpose
      </TooltipContent>
    </Tooltip>
  );
}

export default AutoxposeLogoBadge;
