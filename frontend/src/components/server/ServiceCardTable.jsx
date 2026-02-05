import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { generatePortKey, getAutoxposeData } from "../../lib/utils/portUtils";
import { formatCreatedDate, formatCreatedTooltip } from "@/lib/utils";
import ServiceIcon from "@/components/ui/ServiceIcon";
import { ClickablePortBadge } from "./service-card-utils";
import { GlobeIconBadge, ExternalUrlChip } from "@/components/autoxpose";
import { InlinePortRow } from "./ExpandedPortViews";
import { AggregatedHealthDot } from "./AggregatedHealthDot";

export function ServiceCardTableRow({
  serviceName,
  ports,
  serverId,
  serverUrl,
  hostOverride,
  actionFeedback,
  onCopy,
  onNote,
  onToggleIgnore,
  onRename,
  selectionMode,
  selectedPorts,
  onToggleSelection,
  isDocker,
  showIcons = true,
  autoxposeDisplayMode = "url",
  autoxposeUrlStyle = "compact",
  autoxposePorts,
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
        aria-expanded={isExpanded}
        className={`group cursor-pointer transition-all ${
          isExpanded 
            ? "bg-gradient-to-r from-teal-50/50 via-cyan-50/30 to-transparent dark:from-teal-950/30 dark:via-cyan-950/20 dark:to-transparent border-b border-teal-100/50 dark:border-teal-900/30 border-l-2 border-l-teal-400 dark:border-l-teal-500"
            : "border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"
        }`}
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
            <ChevronRight 
              className={`h-4 w-4 flex-shrink-0 transition-all duration-200 ${
                isExpanded 
                  ? "rotate-90 text-teal-500 dark:text-teal-400" 
                  : "text-slate-400"
              }`} 
            />
            {showIcons && <ServiceIcon name={serviceName} source={isDocker ? "docker" : "system"} size={20} className="flex-shrink-0" />}
            <AggregatedHealthDot ports={ports} serverId={serverId} serverUrl={serverUrl} />
            <span className="font-medium text-sm text-slate-900 dark:text-slate-100">
              {serviceName}
            </span>
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center space-x-1 flex-wrap gap-1">
            {publishedPorts.map((port) => (
              <React.Fragment key={generatePortKey(serverId, port)}>
                <ClickablePortBadge
                  port={port}
                  serverId={serverId}
                  serverUrl={serverUrl}
                  hostOverride={hostOverride}
                />
                {!isExpanded && (() => {
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
        <td className="px-4 py-3 text-center">
          <span className={`inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-xs font-medium ${
            isExpanded
              ? "bg-teal-100 text-teal-700 dark:bg-teal-800/40 dark:text-teal-300"
              : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
          }`}>
            {ports.length}
          </span>
        </td>
      </tr>

      {isExpanded && (
        <>
          {ports.map((port, idx) => (
            <InlinePortRow
              key={generatePortKey(serverId, port)}
              port={port}
              serverId={serverId}
              serverUrl={serverUrl}
              hostOverride={hostOverride}
              selectionMode={selectionMode}
              isSelected={selectedPorts?.has(generatePortKey(serverId, port))}
              onToggleSelection={onToggleSelection}
              onCopy={onCopy}
              onNote={onNote}
              onToggleIgnore={onToggleIgnore}
              onRename={onRename}
              actionFeedback={actionFeedback}
              showIcons={showIcons}
              autoxposeData={getAutoxposeData(autoxposePorts, port)}
              autoxposeDisplayMode={autoxposeDisplayMode}
              autoxposeUrlStyle={autoxposeUrlStyle}
              isLastInGroup={idx === ports.length - 1}
            />
          ))}
        </>
      )}
    </>
  );
}
