import React from "react";

const FAILURE = {
  not_html: "Root content is not HTML, and no safe icon could be captured.",
  no_metadata: "No title or acceptable raster icon was found.",
  timeout: "The local listener exceeded the safe response time budget.",
  too_large: "A response exceeded the allowed byte limit.",
  external_redirect: "A redirect crossed the original HTTP origin.",
  tls_untrusted: "The HTTPS certificate could not be verified.",
  blocked_target: "The destination is not a private/loopback numeric IP.",
  network_error: "The container or host cannot reach this listener.",
};

function stamp(when) {
  return when ? new Date(when).toLocaleString() : "Not yet";
}

export function RegistryIconHelp({ http, docker }) {
  return (
    <details aria-label="Icon and metadata discovery help"
      className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
      <summary className="cursor-pointer font-semibold text-slate-800 hover:text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-slate-100">
        Icon and metadata discovery — setup and troubleshooting
      </summary>
      <div className="mt-3 space-y-3 text-xs text-slate-600 dark:text-slate-300">
        <div className="grid gap-2 sm:grid-cols-2">
          <p>HTTP probing: <strong>{!http.requested ? "Disabled explicitly" :
            http.configured ? "Enabled" : "On, but private host route unavailable"}</strong></p>
          <p>Route: {http.mode === "docker_gateway" ? "Detected private Docker bridge" :
            http.mode === "native_loopback" ? "Native host loopback" :
              http.mode === "explicit" ? "Explicit private IP" : "Not available"}</p>
          <p>Last attempt: {stamp(http.lastAttemptAt)}</p>
          <p>Last successful metadata: {stamp(http.lastSuccessAt)}</p>
          <p>Last successfully cached raster icon: {stamp(http.lastIconSuccessAt)}</p>
          <p>Last failure: {FAILURE[http.lastFailureCode] ||
            (http.lastFailureCode ? "An unavailable response was recorded." : "None recorded")}</p>
        </div>
        <p>Metadata discovery is enabled by default for likely-web local TCP listeners.
          It tries same-origin HTML icons, touch icons, a web manifest, and conventional
          favicon paths. Missing metadata never marks a listener offline or erases a cached icon.</p>
        <p><strong>Hermes, VS Code/code-server, and other apps:</strong> confirm that their
          root page exposes a public raster icon without login. Some apps put icons on deep
          paths, only inside an authenticated UI, or behind JavaScript; those are not scraped.
          An app-aware generic glyph is only a fallback, not a verified logo.</p>
        <p><strong>Native NixOS:</strong> HTTP checks use <code>127.0.0.1</code>.
          Leave <code> SERVICE_REGISTRY_HTTP_ENABLED=true</code> (default).
          Check the service root and favicon from its host, for example
          <code> curl -I http://127.0.0.1:PORT/favicon.ico</code>, then scan again.</p>
        <p><strong>Docker bridge:</strong> Portracker selects a private numeric gateway from
          the container route. A host service listening only on <code>127.0.0.1</code>
          is generally unreachable from the bridge. For those services prefer native
          Portracker; do not weaken your firewall. Only override the host with a private
          IP you have verified is reachable from the Portracker container.</p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-slate-100 p-2 text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200">
          {"# Optional: replace with YOUR verified private host gateway\n" +
            "export SERVICE_REGISTRY_HTTP_HOST=172.18.0.1\n" +
            "docker compose -f docker-compose.registry-fork.yml up -d --build portracker\n\n" +
            "# Optional: turn off metadata probes without deleting saved icons\n" +
            "export SERVICE_REGISTRY_HTTP_ENABLED=false\n" +
            "docker compose -f docker-compose.registry-fork.yml up -d --build portracker"}
        </pre>
        <p><strong>Rootless or absent Docker socket:</strong> Docker inventory is separate
          from HTTP metadata. Use a verified socket path such as
          <code> $XDG_RUNTIME_DIR/docker.sock</code> via
          <code> PORTRACKER_DOCKER_SOCK</code>, if present.
          Otherwise start only the <code>portracker</code> Compose service.
          Docker inventory is currently {docker.available ? "confirmed." : "not confirmed."}
          System discovery and safe metadata can still work.</p>
        <p>Metadata enrichment never uses browser cookies, external icon CDNs, JavaScript,
          untrusted SVG, public IP targets or privileged Docker mutations. Saved icons are
          verified raster bytes stored in SQLite behind authentication.</p>
      </div>
    </details>
  );
}
