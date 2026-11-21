import React from "react";
import { Pin, Trash2, X } from "lucide-react";
import { StatusBadge } from "./RegistryServiceDetails";

const FIELD_CLASS = "rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-3 py-2 text-sm";

export function RegistryHistoryActions({
  service, expanded, pinBusy, forgetting, onPinToggle, onForget, onClose,
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      <StatusBadge status={service.status} />
      <button type="button" onClick={() => onPinToggle(service)}
        disabled={pinBusy}
        aria-label={(service.pinned ? "Unpin " : "Pin ") + service.displayName}
        aria-pressed={service.pinned}
        title={service.pinned ? "Unpin service" : "Pin service"}
        className={"inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-50 " +
          (service.pinned
            ? "border-indigo-300 text-indigo-600 dark:text-indigo-300"
            : "border-slate-200 dark:border-slate-700 text-slate-500")}>
        <Pin className="w-4 h-4" fill={service.pinned ? "currentColor" : "none"} aria-hidden="true" />
        {expanded && <span className="hidden sm:inline">{service.pinned ? "Unpin" : "Pin"}</span>}
      </button>
      {expanded && (
        <>
          <button type="button" disabled={forgetting}
            aria-label={"Forget " + service.displayName} onClick={onForget}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-300 px-2.5 py-2 text-sm text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500">
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Forget</span>
          </button>
          <button type="button" aria-label="Close saved service details" onClick={onClose}
            className={FIELD_CLASS + " inline-flex shrink-0 items-center px-2.5 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"}>
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}
