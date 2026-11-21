import React from "react";
import { registryTimestamp } from "../../lib/registry-utils.mjs";

export function RegistryScanSummary({ scan }) {
  if (!scan) return null;
  return (
    <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1" aria-label="Background discovery status">
      {!scan.enabled && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
          Automatic discovery is disabled. Set <code>SERVICE_REGISTRY_ENABLED=true</code> on the backend
          and restart Portracker to start recording listeners. Existing history is still available.
        </p>
      )}
      {scan.enabled && scan.sources.length === 0 && <p>Discovery enabled; waiting for the first scan.</p>}
      {scan.sources.map(item => (
        <p key={item.source}>
          <strong className="capitalize">{item.source}</strong>: {item.outcome}
          {item.lastSuccessAt
            ? " · Last complete scan " + registryTimestamp(item.lastSuccessAt)
            : " · No complete scan yet"}
        </p>
      ))}
    </div>
  );
}
