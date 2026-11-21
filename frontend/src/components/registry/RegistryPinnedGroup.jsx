import React from "react";
import { Pin } from "lucide-react";
import { RegistryServiceIcon } from "./RegistryServiceIcon";
import { RegistryServiceDetails } from "./RegistryServiceDetails";
import {
  SERVICE_CARD_CLASS, SERVICE_CARD_HEADER_CLASS, SERVICE_CARD_BODY_CLASS,
  SERVICE_CARD_TITLE_CLASS, SERVICE_CARD_META_CLASS,
  ServiceListChevron, ServiceSourceBadge, ServicePortBadge, SavedServiceStatusDot,
} from "@/components/ui/service-list-visuals";

function PortChip({ item }) {
  return (
    <ServicePortBadge port={item.port} active={item.active} internal={item.internal}
      title={(item.active ? "Current" : "Remembered") + " " +
        item.protocol.toUpperCase() + " endpoint" + (item.internal ? " · internal" : "")} />
  );
}

function SourceIndicator({ group }) {
  return (
    <span className={"flex flex-wrap items-center gap-2 " + SERVICE_CARD_META_CLASS}>
      <ServiceSourceBadge sources={group.sources} />
      {group.serviceCount > 1 && <span>{group.serviceCount} services</span>}
      <span>{group.ports.length} port{group.ports.length === 1 ? "" : "s"}</span>
    </span>
  );
}

function GroupMemberSelector({ group, selectedId, onSelect }) {
  if (group.services.length < 2) return null;
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-700"
      aria-label="Services in Compose project">
      {group.services.map(service => (
        <button key={service.id} type="button" onClick={() => onSelect(service.id)}
          aria-pressed={selectedId === service.id}
          className={"flex w-full flex-wrap items-center justify-between gap-2 px-3 py-3 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 " +
            (selectedId === service.id
              ? "border-l-2 border-indigo-500 bg-slate-50 dark:bg-slate-800/70"
              : "hover:bg-slate-50 dark:hover:bg-slate-800")}>
          <span className={SERVICE_CARD_TITLE_CLASS}>
            {service.composeService || service.displayName}
          </span>
          <span className="flex flex-wrap gap-1">
            {service.endpoints.slice(0, 5).map(endpoint =>
              <PortChip key={endpoint.id} item={{
                port: endpoint.hostPort, protocol: endpoint.protocol,
                active: service.status === "listening" &&
                  endpoint.lastSeenAt === service.lastSeenAt,
                internal: endpoint.internal,
              }} />)}
            {service.endpoints.length > 5 && <span>+{service.endpoints.length - 5}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function RegistryPinnedGroup({
  group, expanded, selectedId, detail, detailError, onToggle, onSelect,
  onPinToggle, onForget, onClose, pinBusy, forgetting,
}) {
  const selected = group.services.find(service => service.id === selectedId);
  return (
    <article data-pinned-group={group.id} data-service-list-surface="pinned"
      className={SERVICE_CARD_CLASS}>
      <button type="button" onClick={() => onToggle(group)}
        aria-expanded={expanded} aria-label={group.name + " service group"}
        data-service-list-header
        className={SERVICE_CARD_HEADER_CLASS +
          " w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"}>
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <ServiceListChevron expanded={expanded} />
          <RegistryServiceIcon iconHash={group.iconHash} name={group.name}
            source={group.sources.includes("docker") ? "docker" : "system"} />
          <SavedServiceStatusDot status={group.status} />
          <span className="min-w-0 flex-1">
            <span data-service-list-title className={SERVICE_CARD_TITLE_CLASS + " block truncate"}>{group.name}</span>
            <SourceIndicator group={group} />
          </span>
          <Pin className="h-3.5 w-3.5 shrink-0 text-indigo-400" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          {group.ports.slice(0, 5).map(item =>
            <PortChip key={item.protocol + ":" + item.port} item={item} />)}
          {group.ports.length > 5 && (
            <span className={SERVICE_CARD_META_CLASS}>+{group.ports.length - 5} more</span>
          )}
        </span>
      </button>
      {expanded && (
        <div className={SERVICE_CARD_BODY_CLASS + " min-w-0 space-y-4 p-4"}>
          {group.ports.length > 0 && (
            <div aria-label="All remembered group ports" className="flex flex-wrap items-center gap-2">
              <span className={SERVICE_CARD_META_CLASS}>Ports</span>
              {group.ports.map(item => (
                <PortChip key={item.protocol + ":" + item.port} item={item} />
              ))}
            </div>
          )}
          <GroupMemberSelector group={group} selectedId={selectedId} onSelect={onSelect} />
          {selected && (
            <RegistryServiceDetails
              detail={detail?.id === selected.id ? detail : null}
              detailError={detailError}
              onPinToggle={onPinToggle}
              onForget={onForget}
              onClose={onClose}
              pinBusy={pinBusy}
              forgetting={forgetting}
            />
          )}
        </div>
      )}
    </article>
  );
}
