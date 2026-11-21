import React from "react";
import { RegistryIconHelp } from "./RegistryIconHelp";

const EXPLANATIONS = {
  disabled_by_user: "Disabled by configuration.",
  gateway_unavailable: "No safe private Docker gateway detected. Set SERVICE_REGISTRY_HTTP_HOST to a reachable private IP, or run natively.",
  invalid_configuration: "Invalid metadata configuration. Use a private numeric IP and a true/false toggle.",
  registry_disabled: "Historical discovery is disabled.",
  docker_api_unavailable: "Docker API unavailable. Check the private socket proxy, socket path and permissions; native scanning continues.",
  awaiting_first_scan: "Waiting for the first source scan.",
  untrusted_scan_scope: "Source scan incomplete; saved history remains available.",
};

function fmt(when) {
  return when ? new Date(when).toLocaleString() : "Not yet";
}

export function RegistryCapabilities({ scan }) {
  const capabilities = scan?.capabilities;
  if (!capabilities) return null;
  const { http, docker } = capabilities;
  const dockerText = docker.available
    ? "Connected — Docker inventory confirmed"
    : docker.reason && EXPLANATIONS[docker.reason] || "Docker inventory not yet confirmed";
  const httpText = !http.requested ? "Off (user setting)"
    : !http.configured ? EXPLANATIONS[http.reason] || "HTTP target unavailable"
      : http.lastSuccessAt ? "Enabled — successful HTTP metadata probe recorded"
        : "Enabled — no successful HTTP metadata probe yet";
  return (
    <section aria-label="Discovery capabilities"
      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 text-xs text-slate-600 dark:text-slate-300">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="font-semibold text-slate-800 dark:text-slate-100">HTTP titles and favicons</p>
          <p>{httpText}</p>
          {http.configured && (
            <p>Probe route: {http.mode === "docker_gateway" ? "Private Docker bridge" :
              http.mode === "native_loopback" ? "Native loopback" : "Explicit private host"}
              {" · "}Last success: {fmt(http.lastSuccessAt)}</p>
          )}
          {http.configured && http.lastFailureCode === "network_error" &&
            <p>Recent probe couldn't connect. Check host bind address and firewall; saved metadata is retained.</p>}
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-slate-800 dark:text-slate-100">Docker inventory</p>
          <p>{dockerText}</p>
          <p>Access mode: {docker.mode === "restricted_proxy" ? "Private read-only proxy" :
            docker.mode === "local_socket" ? "Local Docker socket" : "Configured Docker API"}
            {" · "}Last success: {fmt(docker.lastSuccessAt)}</p>
        </div>
      </div>
      <RegistryIconHelp http={http} docker={docker} />
    </section>
  );
}
