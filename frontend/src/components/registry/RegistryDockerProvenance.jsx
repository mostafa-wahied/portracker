import React from "react";
import { registryTimestamp } from "../../lib/registry-utils.mjs";

export function RegistryDockerProvenance({ evidence }) {
  if (!evidence) return null;
  return (
    <section aria-label="Docker launch provenance" className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
      <h3 className="font-medium text-sm">Docker / Compose provenance</h3>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {evidence.identityConfidence} identity · Inspected {registryTimestamp(evidence.capturedAt)}
      </p>
      {evidence.composeProject && evidence.composeService && (
        <p className="text-sm">
          Compose: <code className="break-all">{evidence.composeProject}</code>
          {" / "}<code className="break-all">{evidence.composeService}</code>
        </p>
      )}
      {evidence.containerName && (
        <p className="text-sm">Container: <code className="break-all">{evidence.containerName}</code></p>
      )}
      {evidence.image && (
        <p className="text-sm">Image: <code className="break-all">{evidence.image}</code></p>
      )}
      {evidence.networkMode && (
        <p className="text-sm">Network mode: <code className="break-all">{evidence.networkMode}</code></p>
      )}
      {evidence.projectWorkingDir && (
        <p className="text-sm">Compose working directory:
          {" "}<code className="break-all">{evidence.projectWorkingDir}</code>
        </p>
      )}
      {evidence.configFilePaths?.length > 0 && (
        <>
          <p className="text-sm font-medium">Compose config files (Docker host paths):</p>
          <ul className="list-disc pl-5 text-sm">
            {evidence.configFilePaths.map(file => (
              <li key={file}><code className="break-all">{file}</code></li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Observed Docker metadata may be stale after container removal. Config paths are
        on the Docker host, not necessarily mounted into Portracker. No start or stop command is run.
      </p>
    </section>
  );
}
