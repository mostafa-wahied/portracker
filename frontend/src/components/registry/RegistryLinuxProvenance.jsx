import React from "react";
import { RegistryDetailSection } from "./RegistryDetailSection";
import { registryTimestamp } from "../../lib/registry-utils.mjs";

const KINDS = {
  systemd_system_service: "systemd system service",
  systemd_user_service: "systemd user service",
  session_scope: "Interactive or session scope",
  manual: "Manual/native process",
  container: "Container-managed process",
  unknown: "Unattributed process",
};

export function RegistryLinuxProvenance({ evidence }) {
  if (!evidence) return null;
  return (
    <RegistryDetailSection label="Linux launch provenance" title="Linux launch provenance">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {KINDS[evidence.kind] || "Unattributed process"} · {evidence.confidence} evidence
        {" · "}Captured {registryTimestamp(evidence.capturedAt)}
      </p>
      {evidence.unitName && (
        <p className="text-sm">Unit ({evidence.unitScope}):
          {" "}<code className="break-all">{evidence.unitName}</code>
        </p>
      )}
      {evidence.cwd && (
        <p className="text-sm">Working directory:
          {" "}<code className="break-all">{evidence.cwd}</code>
        </p>
      )}
      {evidence.executablePath && (
        <p className="text-sm">Executable observed:
          {" "}<code className="break-all">{evidence.executablePath}</code>
        </p>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        PID {evidence.pid} · UID {evidence.uid ?? "unavailable"} · Process start ticks
        {" "}{evidence.processStartTicks}. This is a saved observation, not a verified
        startup command; no action is executed.
      </p>
    </RegistryDetailSection>
  );
}
