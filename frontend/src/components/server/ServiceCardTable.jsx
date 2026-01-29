import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PortTableRow } from "./PortTableRow";
import { generatePortKey } from "../../lib/utils/portUtils";
import { formatCreatedDate, formatCreatedTooltip } from "@/lib/utils";
import ServiceIcon from "@/components/ui/ServiceIcon";
import { ClickablePortBadge } from "./service-card-utils";

export function ServiceCardTableRow({
  serviceName,
  ports,
  serverId,
  serverUrl,
  hostOverride,
  searchTerm,
  actionFeedback,
  onCopy,
  onNote,
  onToggleIgnore,
  onRename,
  onOpenContainerDetails,
  onCloseContainerDetails,
  selectionMode,
  selectedPorts,
  onToggleSelection,
  isDocker,
  deepLinkContainerId,
  showIcons = true,
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const publishedPorts = ports.filter((p) => !p.internal);
  const oldestCreated = ports.reduce((oldest, p) => {
    if (!p.created) return oldest;
    if (!oldest) return p.created;
    return new Date(p.created) < new Date(oldest) ? p.created : oldest;
  }, null);

  const allSelected =
    ports.length > 0 &&
    ports.every((port) => selectedPorts?.has(generatePortKey(serverId, port)));

  const someSelected = ports.some((port) =>
    selectedPorts?.has(generatePortKey(serverId, port))
  );

  const handleSelectAllInService = (e) => {
    e.stopPropagation();
    ports.forEach((port) => {
      const isCurrentlySelected = selectedPorts?.has(
        generatePortKey(serverId, port)
      );
      if (allSelected && isCurrentlySelected) {
        onToggleSelection?.(port, serverId);
      } else if (!allSelected && !isCurrentlySelected) {
        onToggleSelection?.(port, serverId);
      }
    });
  };

  return (
    <>
      <tr
        onClick={() => setIsExpanded(!isExpanded)}
        className="group border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
      >
        {selectionMode && (
          <td className="px-4 py-3 text-center">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected && !allSelected;
              }}
              onChange={handleSelectAllInService}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 rounded cursor-pointer"
            />
          </td>
        )}
        <td className="px-4 py-3">
          <div className="flex items-center space-x-3">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
            )}
            {showIcons && <ServiceIcon name={serviceName} source={isDocker ? "docker" : "system"} size={20} className="flex-shrink-0" />}
            <span className="font-medium text-sm text-slate-900 dark:text-slate-100">
              {serviceName}
            </span>
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center space-x-1 flex-wrap">
            {publishedPorts.slice(0, 5).map((port) => (
              <ClickablePortBadge
                key={port.host_port}
                port={port}
                serverId={serverId}
                serverUrl={serverUrl}
                hostOverride={hostOverride}
              />
            ))}
            {publishedPorts.length > 5 && (
              <span className="text-xs text-slate-400">
                +{publishedPorts.length - 5}
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-block px-2 py-0.5 rounded font-medium ${
              isDocker
                ? "bg-blue-100 text-blue-800 dark:bg-blue-800/30 dark:text-blue-200"
                : "bg-green-100 text-green-800 dark:bg-green-800/30 dark:text-green-200"
            }`}
          >
            {isDocker ? "docker" : "system"}
          </span>
        </td>
        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
          {oldestCreated ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>{formatCreatedDate(oldestCreated)}</span>
                </TooltipTrigger>
                <TooltipContent>
                  {formatCreatedTooltip(oldestCreated)}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            "N/A"
          )}
        </td>
        <td className="px-4 py-3 text-center text-sm text-slate-600 dark:text-slate-300">
          {ports.length}
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-slate-50 dark:bg-slate-900/30">
          <td colSpan={selectionMode ? 7 : 6} className="p-0">
            <div className="border-t border-slate-200 dark:border-slate-700">
              <table className="min-w-full">
                <thead className="bg-slate-100/50 dark:bg-slate-800/30">
                  <tr>
                    {selectionMode && (
                      <th scope="col" className="px-4 py-2 text-center text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider"></th>
                    )}
                    <th scope="col" className="px-4 py-2 text-center text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Status</th>
                    <th scope="col" className="px-4 py-2 text-left text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Port</th>
                    <th scope="col" className="px-4 py-2 text-left text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Container</th>
                    <th scope="col" className="px-4 py-2 text-left text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Source</th>
                    <th scope="col" className="px-4 py-2 text-left text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Host</th>
                    <th scope="col" className="px-4 py-2 text-left text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Created</th>
                    <th scope="col" className="px-4 py-2 text-right text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(() => {
                    const containerGroups = new Map();
                    ports.forEach((port) => {
                      const containerKey = port.container_id || port.owner || 'unknown';
                      const containerName = port.compose_service || port.owner || 'Unknown';
                      if (!containerGroups.has(containerKey)) {
                        containerGroups.set(containerKey, {
                          name: containerName,
                          containerId: port.container_id,
                          ports: [],
                        });
                      }
                      containerGroups.get(containerKey).ports.push(port);
                    });

                    const rows = [];
                    Array.from(containerGroups.values()).forEach((container) => {
                      if (containerGroups.size > 1) {
                        rows.push(
                          <tr key={`header-${container.containerId || container.name}`} className="bg-slate-50 dark:bg-slate-800/40">
                            <td colSpan={selectionMode ? 8 : 7} className="px-4 py-1.5 border-l-2 border-slate-300 dark:border-slate-600">
                              <div className="flex items-center space-x-2">
                                {showIcons && <ServiceIcon name={container.name} source="docker" size={14} />}
                                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                                  {container.name}
                                </span>
                                <span className="text-xs text-slate-400 dark:text-slate-500">
                                  ({container.ports.length} port{container.ports.length !== 1 ? 's' : ''})
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      }
                      container.ports.forEach((port) => {
                        rows.push(
                          <PortTableRow
                            key={generatePortKey(serverId, port)}
                            port={port}
                            serverId={serverId}
                            serverUrl={serverUrl}
                            hostOverride={hostOverride}
                            searchTerm={searchTerm}
                            actionFeedback={actionFeedback}
                            onCopy={onCopy}
                            onNote={onNote}
                            onToggleIgnore={onToggleIgnore}
                            onRename={onRename}
                            forceOpenDetails={
                              deepLinkContainerId &&
                              port.container_id === deepLinkContainerId
                            }
                            notifyOpenDetails={onOpenContainerDetails}
                            notifyCloseDetails={onCloseContainerDetails}
                            selectionMode={selectionMode}
                            isSelected={selectedPorts?.has(
                              generatePortKey(serverId, port)
                            )}
                            onToggleSelection={onToggleSelection}
                          />
                        );
                      });
                    });
                    return rows;
                  })()}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
