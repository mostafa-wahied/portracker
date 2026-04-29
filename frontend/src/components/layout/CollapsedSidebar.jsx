import React from "react";
import { Plus, BarChart3 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

function ServerHealthDot({ server }) {
  const containerCount = server.systemInfo?.containers_running || 0;
  const portCount = server.data?.length || 0;
  const isOnline = server.ok !== false;

  if (!isOnline) {
    return <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-red-500 ring-1 ring-white dark:ring-slate-900" />;
  }
  if (containerCount > 0 || portCount > 0) {
    return <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-green-500 ring-1 ring-white dark:ring-slate-900" />;
  }
  return <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-gray-400 ring-1 ring-white dark:ring-slate-900" />;
}

export function CollapsedSidebar({
  servers,
  selectedId,
  onSelect,
  onAdd,
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col overflow-hidden bg-white dark:bg-slate-900">
        <div className="flex-shrink-0 px-3 pb-4 pt-5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                onClick={() => onSelect(selectedId || servers[0]?.id)}
                aria-label="Open dashboard"
              >
                <BarChart3 className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">All servers</TooltipContent>
          </Tooltip>

          <div className="mx-auto mt-4 h-px w-10 bg-slate-200 dark:bg-slate-700" />
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3 pt-1">
          <div className="space-y-3">
          {servers.map((server) => {
            const name = server.label || server.server || "Server";
            const initials = name.slice(0, 2).toUpperCase();
            const isSelected = selectedId === server.id;
            return (
              <Tooltip key={server.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onSelect(server.id)}
                    className={`relative mx-auto flex h-11 w-11 items-center justify-center rounded-2xl text-xs font-bold transition-all duration-200 ${
                      isSelected
                        ? "bg-blue-100 text-blue-700 ring-2 ring-blue-500 dark:bg-blue-900/40 dark:text-blue-300"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                    }`}
                  >
                    {initials}
                    <ServerHealthDot server={server} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <div>
                    <div className="font-medium">{name}</div>
                    <div className="text-xs text-slate-400">{server.data?.length || 0} ports</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
          </div>
        </div>

        <div className="flex-shrink-0 px-3 pb-5 pt-3">
          <div className="mx-auto mb-3 h-px w-10 bg-slate-200 dark:bg-slate-700" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onAdd()}
                className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 text-slate-400 transition-colors hover:border-slate-400 hover:text-slate-500 dark:border-slate-700 dark:text-slate-500 dark:hover:border-slate-600 dark:hover:text-slate-400"
                aria-label="Add server"
              >
                <Plus className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Add server</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
