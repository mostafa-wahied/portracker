import React from "react";
import { Pin } from "lucide-react";

const BASE_CLASS =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border " +
  "text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 " +
  "disabled:cursor-wait disabled:opacity-50";

// Match the existing outlined Unpin control in both states. Only the icon and label change.
const PIN_ACTION_CLASS =
  "border-indigo-300 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-400 " +
  "dark:border-indigo-300 dark:text-indigo-300 dark:hover:bg-indigo-400/10 " +
  "dark:hover:border-indigo-200";

/** A consistent, clearly actionable Pin/Unpin control in History and Pinned details. */
export function RegistryPinButton({
  service, onToggle, busy = false, ariaLabel, compact = false, labelClassName = "",
}) {
  const pinned = Boolean(service.pinned);
  return (
    <button type="button" onClick={() => onToggle(service)} disabled={busy}
      aria-label={ariaLabel || (pinned ? "Unpin service" : "Pin service")}
      aria-pressed={pinned} aria-busy={busy}
      data-registry-pin-state={pinned ? "pinned" : "unpinned"}
      title={pinned
        ? "Remove from Pinned without deleting service history"
        : "Keep this service in Pinned, even when offline"}
      className={BASE_CLASS + " " + (compact ? "px-2.5 py-2" : "px-3 py-2") + " " +
        PIN_ACTION_CLASS}>
      <Pin className="h-4 w-4" fill={pinned ? "currentColor" : "none"} aria-hidden="true" />
      <span className={labelClassName}>{pinned ? "Unpin" : "Pin"}</span>
    </button>
  );
}
