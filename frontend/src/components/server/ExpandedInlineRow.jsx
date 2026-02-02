import React from "react";
import { ExternalLink, Lock, Tag } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PortStatusIndicator } from "./PortStatusIndicator";
import { PortActions } from "./PortActions";
import { ActionButton } from "./ActionButton";
import ServiceIcon from "@/components/ui/ServiceIcon";
import { GlobeIconBadge, ExternalUrlChip } from "@/components/autoxpose";
import { formatCreatedDate, formatCreatedTooltip } from "@/lib/utils";
import { generatePortKey } from "../../lib/utils/portUtils";
import { getDisplayHost } from "./expanded-view-utils";

export function InlinePortRow({
  port,
  serverId,
  serverUrl,
  hostOverride,
  selectionMode,
  isSelected,
  onToggleSelection,
  onCopy,
  onNote,
  onToggleIgnore,
  onRename,
  actionFeedback,
  showIcons,
  autoxposeData,
  autoxposeDisplayMode = "url",
  autoxposeUrlStyle = "compact",
  isLastInGroup = false,
}) {
  const hostForUi = getDisplayHost(port, serverId, serverUrl, hostOverride);
  const containerName = port.compose_service || port.owner || "Unknown";
  const itemKey = generatePortKey(serverId, port);

  return (
    <tr
      className={`group transition-all border-l-2 border-l-teal-400 dark:border-l-teal-500 ${
        isLastInGroup 
          ? "border-b-2 border-b-teal-200/60 dark:border-b-teal-800/40" 
          : "border-b border-b-teal-100/30 dark:border-b-teal-900/20"
      } ${
        isSelected
          ? "bg-gradient-to-r from-blue-100/70 via-teal-50/40 to-slate-50/20 dark:from-blue-900/30 dark:via-teal-950/30 dark:to-slate-900/15"
          : "bg-gradient-to-r from-teal-50/40 via-cyan-50/25 to-transparent dark:from-teal-950/30 dark:via-cyan-950/15 dark:to-transparent hover:from-teal-100/50 hover:via-cyan-100/30 dark:hover:from-teal-900/40 dark:hover:via-cyan-900/25"
      }`}
    >
      {selectionMode && (
        <td className="px-4 py-2 text-center">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelection?.(port, serverId)}
            className="h-3.5 w-3.5 text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 rounded cursor-pointer"
          />
        </td>
      )}

      <td className="px-4 py-2">
        <div className="flex items-center space-x-5 pl-8">
          <PortStatusIndicator serverId={serverId} serverUrl={serverUrl} port={port} />
          {showIcons && <ServiceIcon name={containerName} source="docker" size={14} className="flex-shrink-0" />}
          <span className="text-xs text-slate-700 dark:text-slate-300 truncate max-w-[150px]">
            {containerName}
          </span>
          <div className="opacity-40 group-hover:opacity-100 transition-opacity">
            <ActionButton
              type="rename"
              itemKey={itemKey}
              actionFeedback={actionFeedback}
              onClick={() => onRename?.(serverId, port)}
              icon={Tag}
              title="Rename service"
              size="sm"
            />
          </div>
        </div>
        {port.note && (
          <div className="pl-8 mt-0.5">
            <span className="text-[10px] text-slate-400 dark:text-slate-500 italic truncate">
              {port.note}
            </span>
          </div>
        )}
      </td>

      <td className="px-4 py-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {port.internal ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 text-xs font-medium">
              {port.host_port}
              <Lock className="h-2.5 w-2.5" />
            </span>
          ) : (
            <a
              href={`http://${hostForUi}:${port.host_port}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 dark:bg-teal-800/40 dark:text-teal-300 text-xs font-medium hover:bg-teal-200 dark:hover:bg-teal-700/50 transition-colors"
            >
              {port.host_port}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
            {hostForUi}
          </span>
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
        </div>
      </td>

      <td className="px-4 py-2">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
          port.source === "docker"
            ? "bg-blue-100 text-blue-700 dark:bg-blue-800/30 dark:text-blue-300"
            : "bg-green-100 text-green-700 dark:bg-green-800/30 dark:text-green-300"
        }`}>
          {port.source}
        </span>
      </td>

      <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
        {port.created ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>{formatCreatedDate(port.created)}</span>
              </TooltipTrigger>
              <TooltipContent>
                {formatCreatedTooltip(port.created)}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          "N/A"
        )}
      </td>

      <td className="px-4 py-2 text-right">
        <div className="opacity-40 group-hover:opacity-100 transition-opacity">
          <PortActions
            port={port}
            itemKey={itemKey}
            actionFeedback={actionFeedback}
            onCopy={() => onCopy?.(port, "http")}
            onEdit={() => onNote?.(serverId, port)}
            onHide={() => onToggleIgnore?.(serverId, port)}
            size="sm"
          />
        </div>
      </td>
    </tr>
  );
}
