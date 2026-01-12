import { Eye, EyeOff, ChevronDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { generatePortKey } from "../../lib/utils/portUtils";
import { t } from "@/lib/i18n";

export function HiddenPortsDrawer({ hiddenPorts, onUnhide, onUnhideAll, serverId }) {
  if (hiddenPorts.length === 0) return null;

  const handleUnhideAll = () => {
    onUnhideAll(hiddenPorts);
  };

  return (
    <div className="p-4">
      <details className="group">
        <summary className="flex items-center cursor-pointer text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
          <EyeOff className="w-4 h-4 mr-2" />
          <span>{t('Hidden Ports')} ({hiddenPorts.length})</span>
          <ChevronDown className="w-4 h-4 ml-auto transition-transform group-open:rotate-180" />
        </summary>
        
        <div className="mt-3 pl-6 border-l border-slate-200 dark:border-slate-700 ml-2">
          {/**
           * Unhide all button
           */}
          <div className="mb-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleUnhideAll}
              className="text-xs h-7"
            >
              <Eye className="w-3 h-3 mr-1" />
              {t('Unhide All')} ({hiddenPorts.length})
            </Button>
          </div>
          
          <ul className="space-y-2">
            {hiddenPorts.map((p) => (
              <li
                key={generatePortKey(serverId, p)}
                className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-800/50 rounded-md"
              >
                <div className="text-sm text-slate-700 dark:text-slate-300">
                  <span className="font-mono">{p.host_port}</span> -{" "}
                  <span className="truncate">{p.owner}</span>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onUnhide(p)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t('Unhide port')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}


