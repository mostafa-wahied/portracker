import React from "react";
import { RegistryServiceIcon } from "./RegistryServiceIcon";
import { RegistryHistoryActions } from "./RegistryHistoryActions";
import { RegistryServiceDetails } from "./RegistryServiceDetails";
import { registryTimestamp } from "../../lib/registry-utils.mjs";
import {
  SERVICE_CARD_CLASS, SERVICE_CARD_HEADER_CLASS, SERVICE_CARD_BODY_CLASS,
  SERVICE_CARD_TITLE_CLASS, SERVICE_CARD_META_CLASS,
  ServiceListChevron, ServiceSourceBadge, ServicePortBadge, SavedServiceStatusDot,
} from "@/components/ui/service-list-visuals";

export function RegistryHistoryCard({
  service, selected, detail, detailError, pinBusy, forgetting,
  onSelect, onPinToggle, onForget, onClose,
}) {
  const expanded = selected === service.id;
  const sources = service.sources || [service.source];
  const isDocker = sources.includes("docker");
  const morePorts = Math.max(0, (service.endpointCount || 0) - 1);
  return (
    <article data-history-service-card={service.id} data-service-list-surface="history"
      className={SERVICE_CARD_CLASS}>
      <div data-history-service-header data-service-list-header
        className={SERVICE_CARD_HEADER_CLASS}>
        <button type="button" onClick={() => onSelect(service.id)}
          aria-expanded={expanded}
          aria-controls={expanded ? "history-detail-" + service.id : undefined}
          aria-label={service.displayName + " service details"}
          className="flex w-full min-w-0 items-center gap-3 text-left lg:w-auto lg:flex-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">
          <ServiceListChevron expanded={expanded} />
          <RegistryServiceIcon iconHash={service.iconHash} name={service.displayName}
            source={isDocker ? "docker" : "system"} />
          <SavedServiceStatusDot status={service.status} />
          <span className="min-w-0 flex-1 space-y-1">
            <span data-service-list-title className={SERVICE_CARD_TITLE_CLASS + " block truncate"}>{service.displayName}</span>
            {service.httpTitle && (
              <span title={service.httpTitle}
                className="block truncate text-xs text-slate-600 dark:text-slate-300">
                {service.httpTitle}
              </span>
            )}
            <span className={"flex flex-wrap items-center gap-2 " + SERVICE_CARD_META_CLASS}>
              <ServiceSourceBadge sources={sources} />
              <span>{service.endpointCount || 0} port{service.endpointCount === 1 ? "" : "s"}</span>
              <span>Last seen {registryTimestamp(service.lastSeenAt)}</span>
            </span>
            <span className={"block truncate " + SERVICE_CARD_META_CLASS}>
              {service.previewHostIp || "Unknown host"}:{service.previewPort ?? "?"}
            </span>
            {service.identityConfidence === "uncertain" && (
              <span className="block text-xs text-amber-700 dark:text-amber-400">
                Identity uncertain: a port can be reused by a different app
              </span>
            )}
          </span>
        </button>
        <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 lg:w-auto">
          {service.previewPort != null && (
            <ServicePortBadge port={service.previewPort} active={service.status === "listening"}
              title="Last observed endpoint" />
          )}
          {morePorts > 0 && (
            <span className={SERVICE_CARD_META_CLASS}>+{morePorts} more</span>
          )}
          <RegistryHistoryActions service={service} expanded={expanded}
            pinBusy={pinBusy} forgetting={forgetting} onPinToggle={onPinToggle}
            onForget={onForget} onClose={onClose} />
        </div>
      </div>
      {expanded && (
        <div id={"history-detail-" + service.id}
          className={SERVICE_CARD_BODY_CLASS + " min-w-0 p-4"}>
          <RegistryServiceDetails detail={detail?.id === service.id ? detail : null}
            detailError={detailError} onPinToggle={onPinToggle} onForget={onForget}
            onClose={onClose} pinBusy={pinBusy} forgetting={forgetting}
            showActions={false} />
        </div>
      )}
    </article>
  );
}
