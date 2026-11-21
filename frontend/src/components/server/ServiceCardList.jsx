import React, { useEffect, useState } from "react";
import {
  SERVICE_CARD_CLASS, SERVICE_CARD_HEADER_CLASS, SERVICE_CARD_BODY_CLASS,
  SERVICE_CARD_TITLE_CLASS, SERVICE_CARD_META_CLASS,
  ServiceListChevron, ServiceSourceBadge,
} from "@/components/ui/service-list-visuals";
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
  const hasDeepLink = !!deepLinkContainerId && ports.some(port => port.container_id === deepLinkContainerId);
  useEffect(() => {
    if (hasDeepLink) setIsExpanded(true);
  }, [hasDeepLink]);

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
    <div
      className={SERVICE_CARD_CLASS}
      data-service-list-surface="live"
      data-service-name={serviceName}
    >
      <div
        data-service-card-header="true"
        data-service-list-header
        onClick={() => setIsExpanded(!isExpanded)}
        className={SERVICE_CARD_HEADER_CLASS + " cursor-pointer"}
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
            <ServiceListChevron expanded={isExpanded} />
          </div>

          {showIcons && <ServiceIcon name={serviceName} source={isDocker ? "docker" : "system"} size={24} />}

          <AggregatedHealthDot ports={ports} serverId={serverId} serverUrl={serverUrl} hostOverride={hostOverride} serviceName={serviceName} isDocker={isDocker} />

          <div className="flex flex-col">
            <div className="flex items-center space-x-2">
              <span data-service-list-title className={SERVICE_CARD_TITLE_CLASS}>
                {serviceName}
              </span>
            </div>
            <div className={"flex items-center space-x-2 " + SERVICE_CARD_META_CLASS}>
              <ServiceSourceBadge sources={[isDocker ? "docker" : "system"]} />
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
              <React.Fragment key={`autoxpose-${generatePortKey(serverId, port)}`}>
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
              key={`badge-${generatePortKey(serverId, port)}`}
              port={port}
              serverId={serverId}
              serverUrl={serverUrl}
              hostOverride={hostOverride}
            />
          ))}
        </div>
      </div>

      {isExpanded && (
        <div className={SERVICE_CARD_BODY_CLASS + " animate-in fade-in-0 slide-in-from-top-1 duration-200"}>
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
