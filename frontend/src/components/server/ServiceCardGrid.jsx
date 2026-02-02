import React, { useState } from "react";
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

export function ServiceCardGrid({
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
  const internalPorts = ports.filter((p) => p.internal);
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

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      setIsExpanded(false);
    }
  };

  return (
    <>
      <div
        tabIndex="0"
        onClick={() => setIsExpanded(true)}
        className="group relative border border-slate-200 dark:border-slate-700 rounded-lg p-4 hover:shadow-lg hover:border-slate-300 dark:hover:border-slate-600 transition-all duration-200 min-h-[140px] flex flex-col justify-between bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
      >
        {selectionMode && (
          <div className="absolute top-3 left-3 z-10">
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
          </div>
        )}

        <div className={`flex items-start justify-between mb-3 ${selectionMode ? "ml-6" : ""}`}>
          <div className="flex items-center space-x-2 min-w-0 flex-1">
            {showIcons && <ServiceIcon name={serviceName} source={isDocker ? "docker" : "system"} size={24} className="flex-shrink-0" />}
            <AggregatedHealthDot ports={ports} serverId={serverId} serverUrl={serverUrl} />
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                {serviceName}
              </h4>
              <div className="flex items-center space-x-2 mt-0.5">
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                    isDocker
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-800/30 dark:text-blue-300"
                      : "bg-green-100 text-green-700 dark:bg-green-800/30 dark:text-green-300"
                  }`}
                >
                  {isDocker ? "docker" : "system"}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {ports.length} port{ports.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {publishedPorts.map((port) => (
            <React.Fragment key={port.host_port}>
              <ClickablePortBadge
                port={port}
                serverId={serverId}
                serverUrl={serverUrl}
                hostOverride={hostOverride}
              />
              {(() => {
                const autoxposeData = getAutoxposeData(autoxposePorts, port);
                if (!autoxposeData) return null;
                return autoxposeDisplayMode === "url" ? (
                  <ExternalUrlChip
                    url={autoxposeData.url}
                    hostname={autoxposeData.hostname}
                    sslStatus={autoxposeData.sslStatus}
                    compact={autoxposeUrlStyle === "compact"}
                  />
                ) : (
                  <GlobeIconBadge
                    url={autoxposeData.url}
                    hostname={autoxposeData.hostname}
                    sslStatus={autoxposeData.sslStatus}
                  />
                );
              })()}
            </React.Fragment>
          ))}
        </div>

        <div className="flex items-center justify-between text-xs mt-auto">
          {oldestCreated ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-block px-2 py-1 rounded-full font-medium bg-slate-100 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                    {formatCreatedDate(oldestCreated)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {formatCreatedTooltip(oldestCreated)}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <span />
          )}
          {internalPorts.length > 0 && (
            <span className="text-slate-400 dark:text-slate-500 text-xs">
              +{internalPorts.length} internal
            </span>
          )}
        </div>
      </div>

      {isExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={handleBackdropClick}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center space-x-3">
                {selectionMode && (
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={handleSelectAllInService}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 rounded cursor-pointer"
                  />
                )}
                {showIcons && <ServiceIcon name={serviceName} source={isDocker ? "docker" : "system"} size={28} />}
                <div>
                  <h3 className="font-semibold text-base text-slate-900 dark:text-slate-100">
                    {serviceName}
                  </h3>
                  <div className="flex items-center space-x-2 mt-0.5">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                        isDocker
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-800/30 dark:text-blue-300"
                          : "bg-green-100 text-green-700 dark:bg-green-800/30 dark:text-green-300"
                      }`}
                    >
                      {isDocker ? "docker" : "system"}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {publishedPorts.length} published
                      {internalPorts.length > 0 && `, ${internalPorts.length} internal`}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsExpanded(false)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
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
                  <div key={container.containerId || container.name}>
                    {containerGroups.size > 1 && (
                      <div className={`px-4 py-2 bg-slate-50 dark:bg-slate-800/40 border-l-2 border-slate-300 dark:border-slate-600 flex items-center space-x-2 ${idx > 0 ? 'border-t border-slate-150 dark:border-slate-700' : ''}`}>
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
                            deepLinkContainerId &&
                            port.container_id === deepLinkContainerId
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
          </div>
        </div>
      )}
    </>
  );
}
