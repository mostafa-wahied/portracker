import React from "react";
import { Trash2, X } from "lucide-react";
import { RegistryPinButton } from "./RegistryPinButton";
import { RegistryRecoveryDetails } from "./RegistryRecoveryDetails";
import { RegistryDockerProvenance } from "./RegistryDockerProvenance";
import { RegistryLinuxProvenance } from "./RegistryLinuxProvenance";
import { RegistryDetailSection } from "./RegistryDetailSection";
import { RegistryServiceIcon } from "./RegistryServiceIcon";
import { registryStatusLabel, registryTimestamp } from "../../lib/registry-utils.mjs";

const STATUS_CLASSES = {
  listening: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  offline: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  unknown: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
};
const FIELD_CLASS = "rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-3 py-2 text-sm";

export function StatusBadge({ status }) {
  return (
    <span className={"rounded-full px-2.5 py-1 text-xs font-semibold " +
      (STATUS_CLASSES[status] || STATUS_CLASSES.unknown)}>
      {registryStatusLabel(status)}
    </span>
  );
}

export function RegistryServiceDetails({
  detail, detailError, onPinToggle, onClose, onForget, pinBusy, forgetting,
  showActions = true,
}) {
  return (
    <section aria-label="Saved service details"
      className="min-w-0 space-y-4" data-detail-layout="sections">
      <div className="flex flex-wrap justify-between gap-3 items-center">
        <h2 className="font-semibold text-lg text-slate-900 dark:text-white">Saved service details</h2>
        {showActions && <div className="flex flex-wrap items-center gap-2">
          {detail && (
            <>
              <button type="button" disabled={forgetting} onClick={onForget}
                aria-label={"Forget " + detail.displayName}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm border border-red-300 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50">
                <Trash2 className="w-4 h-4" aria-hidden="true" /> Forget
              </button>
              <RegistryPinButton service={detail} onToggle={onPinToggle} busy={pinBusy}
                ariaLabel={detail.pinned ? "Unpin selected service" : "Pin selected service"} />
            </>
          )}
          <button type="button" aria-label="Close saved service details" onClick={onClose}
            className={FIELD_CLASS}><X className="w-4 h-4" /></button>
        </div>}
      </div>
      {detailError && <p role="alert" className="text-red-600 text-sm">{detailError}</p>}
      {!detail && !detailError && <p role="status">Loading details…</p>}
      {detail && (
        <>
          <RegistryDetailSection title="Overview">
              <div className="flex flex-wrap gap-2 items-center">
                <RegistryServiceIcon iconHash={detail.iconHash} name={detail.displayName}
                  source={detail.source === "docker" ? "docker" : "system"} size={28} />
                <strong>{detail.displayName}</strong>
                <StatusBadge status={detail.status} />
                <span className="text-xs text-slate-500">{detail.identityConfidence} identity</span>
              </div>
              {detail.httpTitle && (
                <p className="font-medium text-sm">{detail.httpTitle}</p>
              )}
              {detail.httpRootUrl && (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  HTTP root seen at{" "}
                  <a className="underline hover:text-indigo-600" href={detail.httpRootUrl}
                    target="_blank" rel="noopener noreferrer">
                    {detail.httpRootUrl}
                  </a>
                  {" "}(may only be reachable from the Portracker host)
                </p>
              )}
              {detail.metadataFetchedAt && (
                <p className="text-xs text-slate-500">
                  Page metadata collected {registryTimestamp(detail.metadataFetchedAt)}
                </p>
              )}
              <p className="text-sm text-slate-600 dark:text-slate-400">
                First seen {registryTimestamp(detail.firstSeenAt)} · Last seen {registryTimestamp(detail.lastSeenAt)}
              </p>
              {detail.runCount > 1 && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Observed process runs: {detail.runCount} (logical service retained across restarts)
                </p>
              )}
          </RegistryDetailSection>
              <RegistryLinuxProvenance evidence={detail.linuxProvenance} />
              <RegistryDockerProvenance evidence={detail.dockerProvenance} />
              {detail.recovery && (
                <RegistryRecoveryDetails key={detail.id}
                  serviceId={detail.id} recovery={detail.recovery} />
              )}
              <RegistryDetailSection title="Remembered endpoints">
              <ul className="list-disc pl-5 text-sm space-y-1 text-slate-600 dark:text-slate-300">
                {detail.endpoints.slice(0, 20).map(ep => (
                  <li key={ep.id}>{ep.hostIp}:{ep.hostPort}/{ep.protocol} · {ep.source}
                    {" · "}Last seen {registryTimestamp(ep.lastSeenAt)}</li>
                ))}
              </ul>
              {detail.endpoints.length > 20 && (
                <p className="text-sm text-slate-500">Showing the 20 most recently seen endpoints.</p>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Title/favicon are captured from the HTTP root when enabled. Linux provenance and copy-only recovery suggestions require authenticated opt-in; no commands are executed.
              </p>
              </RegistryDetailSection>

        </>
      )}
    </section>
  );
}
