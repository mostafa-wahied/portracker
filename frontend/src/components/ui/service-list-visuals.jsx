import React from "react";
import { ChevronRight } from "lucide-react";

export const SERVICE_CARD_CLASS =
  "min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/50";
export const SERVICE_CARD_HEADER_CLASS =
  "flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800";
export const SERVICE_CARD_BODY_CLASS =
  "border-t border-slate-200 dark:border-slate-700";
export const SERVICE_CARD_TITLE_CLASS =
  "font-medium text-slate-900 dark:text-slate-100";
export const SERVICE_CARD_META_CLASS =
  "text-xs text-slate-500 dark:text-slate-400";
export const SERVICE_PORT_BADGE_CLASS =
  "inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-800/40 dark:text-indigo-200";
export const SERVICE_PORT_MUTED_CLASS =
  "inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700/70 dark:text-slate-300";

const SOURCE_CLASSES = {
  docker: "bg-blue-100 text-blue-700 dark:bg-blue-800/30 dark:text-blue-300",
  system: "bg-green-100 text-green-700 dark:bg-green-800/30 dark:text-green-300",
};
const STATUS_CLASSES = {
  listening: "bg-green-500",
  offline: "bg-slate-400",
  unknown: "bg-amber-500",
};

export function ServiceListChevron({ expanded }) {
  return (
    <ChevronRight aria-hidden="true"
      className={"h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 " +
        (expanded ? "rotate-90" : "")} />
  );
}

export function ServiceSourceBadge({ sources }) {
  const values = [...new Set((sources || []).filter(Boolean))];
  const isDocker = values.includes("docker");
  return (
    <span data-service-source-badge
      className={"inline-block rounded px-1.5 py-0.5 " +
        (isDocker ? SOURCE_CLASSES.docker : SOURCE_CLASSES.system)}>
      {values.join(" + ") || "system"}
    </span>
  );
}

export function ServicePortBadge({ port, active = true, title, internal = false }) {
  return (
    <span data-service-port-badge title={title}
      className={active ? SERVICE_PORT_BADGE_CLASS : SERVICE_PORT_MUTED_CLASS}>
      {port}{internal && <span className="ml-1" aria-label="internal port">·</span>}
    </span>
  );
}

export function SavedServiceStatusDot({ status }) {
  const safe = STATUS_CLASSES[status] ? status : "unknown";
  return (
    <span data-saved-service-status={safe} aria-hidden="true"
      title={"Last observed: " + safe}
      className={"h-2 w-2 shrink-0 rounded-full " + STATUS_CLASSES[safe]} />
  );
}
