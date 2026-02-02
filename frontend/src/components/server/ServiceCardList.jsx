import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PortCard } from "./PortCard";
import { generatePortKey, getAutoxposeData } from "../../lib/utils/portUtils";
import { formatCreatedDate, formatCreatedTooltip } from "@/lib/utils";
import ServiceIcon from "@/components/ui/ServiceIcon";
import { ClickablePortBadge } from "./service-card-utils";
import { GlobeIconBadge, ExternalUrlChip } from "@/components/autoxpose";
import { AggregatedHealthDot } from "./AggregatedHealthDot";

export function ServiceCardList({
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
  autoxposeDisplayMode = "url",
  autoxposeUrlStyle = "compact",
  autoxposePorts,
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const publishedPorts = ports.filter((p) => !p.internal);
  const _internalPorts = ports.filter((p) => p.internal);
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
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-800/50">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center space-x-3">
          {selectionMode && (
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
          )}

          <div className="flex items-center">
            {isExpanded ? (
              <ChevronDown className="h-5 w-5 text-slate-400" />
            ) : (
              <ChevronRight className="h-5 w-5 text-slate-400" />
            )}
          </div>

          {showIcons && <ServiceIcon name={serviceName} source={isDocker ? "docker" : "system"} size={24} />}

          <AggregatedHealthDot ports={ports} serverId={serverId} serverUrl={serverUrl} />

          <div className="flex flex-col">
            <div className="flex items-center space-x-2">
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {serviceName}
              </span>
            </div>
            <div className="flex items-center space-x-2 text-xs text-slate-500 dark:text-slate-400">
              <span
                className={`inline-block px-1.5 py-0.5 rounded ${isDocker ? "bg-blue-100 text-blue-700 dark:bg-blue-800/30 dark:text-blue-300" : "bg-green-100 text-green-700 dark:bg-green-800/30 dark:text-green-300"}`}
              >
                {isDocker ? "docker" : "system"}
              </span>
              <span>
                {ports.length} port{ports.length !== 1 ? "s" : ""}
              </span>
              {oldestCreated && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-slate-400">
                        {formatCreatedDate(oldestCreated)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {formatCreatedTooltip(oldestCreated)}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {publishedPorts.map((port) => {
            const autoxposeData = getAutoxposeData(autoxposePorts, port);
            return (
              <React.Fragment key={port.host_port}>
                {autoxposeData && autoxposeDisplayMode === "url" && (
                  <ExternalUrlChip
                    url={autoxposeData.url}
                    hostname={autoxposeData.hostname}
                    sslStatus={autoxposeData.sslStatus}
                    compact={autoxposeUrlStyle === "compact"}
                  />
                )}
                {autoxposeData && autoxposeDisplayMode === "badge" && (
                  <GlobeIconBadge
                    url={autoxposeData.url}
                    hostname={autoxposeData.hostname}
                    sslStatus={autoxposeData.sslStatus}
                  />
                )}
              </React.Fragment>
            );
          })}
          {publishedPorts.map((port) => (
            <ClickablePortBadge
              key={`port-${port.host_port}`}
              port={port}
              serverId={serverId}
              serverUrl={serverUrl}
              hostOverride={hostOverride}
            />
          ))}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-200 dark:border-slate-700">
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

            return Array.from(containerGroups.values()).map((container, idx) => (
              <div key={container.containerId || container.name} className={idx > 0 ? "border-t border-slate-150 dark:border-slate-700" : ""}>
                {containerGroups.size > 1 && (
                  <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/40 border-l-2 border-slate-300 dark:border-slate-600 flex items-center space-x-2">
                    {showIcons && <ServiceIcon name={container.name} source="docker" size={14} />}
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {container.name}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      ({container.ports.length} port{container.ports.length !== 1 ? 's' : ''})
                    </span>
                  </div>
                )}
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {container.ports.map((port) => (
                    <PortCard
                      key={generatePortKey(serverId, port)}
                      port={port}
                      itemKey={generatePortKey(serverId, port)}
                      serverId={serverId}
                      serverUrl={serverUrl}
                      hostOverride={hostOverride}
                      searchTerm={searchTerm}
                      actionFeedback={actionFeedback}
                      onCopy={onCopy}
                      onEdit={onNote}
                      onToggleIgnore={onToggleIgnore}
                      onRename={onRename}
                      forceOpenDetails={
                        deepLinkContainerId && port.container_id === deepLinkContainerId
                      }
                      notifyOpenDetails={onOpenContainerDetails}
                      notifyCloseDetails={onCloseContainerDetails}
                      selectionMode={selectionMode}
                      isSelected={selectedPorts?.has(generatePortKey(serverId, port))}
                      onToggleSelection={onToggleSelection}
                      showIcons={showIcons}
                      autoxposeData={getAutoxposeData(autoxposePorts, port)}
                      autoxposeDisplayMode={autoxposeDisplayMode}
                      autoxposeUrlStyle={autoxposeUrlStyle}
                    />
                  ))}
                </ul>
              </div>
            ));
          })()}
        </div>
      )}
    </div>
  );
}
