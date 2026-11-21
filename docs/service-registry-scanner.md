# Background service discovery (upstream issue #132)

Portracker can now **automatically remember TCP listeners** even when its web dashboard is closed. The scanner is disabled by default.

## Enable it

Set these **backend-wide** environment variables before starting Portracker:

```env
SERVICE_REGISTRY_ENABLED=true
SERVICE_REGISTRY_SCAN_INTERVAL_MS=30000
```

The interval must be between **10 seconds and one hour**. Restart Portracker after changing either variable. This is a backend setting, not a browser preference. A process that starts and exits between two snapshots may be missed.

History is stored in the existing SQLite `DATABASE_PATH`. To inspect it:

- `GET /api/service-registry`: saved services with status and last-seen timestamp.
- `GET /api/service-registry/scan-status`: enabled flag, source coverage and last attempt/success for host and Docker.
- `GET /api/service-registry/:id`: one saved service and its endpoints.
- `DELETE /api/service-registry/:id`: forget a saved record (does not stop a process).

When `ENABLE_AUTH=true`, all of these routes require an authenticated session. If authentication is disabled, do not expose the dashboard publicly.

## Status semantics

**Listening:** the exact process/container was seen in the latest successful observation. This does not guarantee an HTTP response or application health.

**Offline:** a previously seen endpoint was absent from a later **complete** observation of the same source.

**Unknown:** Portracker restarted, the collector failed, or the source was not fully observable; its last-seen timestamp is preserved.

The scanner checks native Linux TCP sockets and Docker-published TCP ports **separately**. Docker socket failure cannot turn native host listeners offline, and partial host coverage cannot turn Docker listeners offline. Stopped containers and Docker internal-only `ExposedPorts` are not host listeners.

The collector scans services at fixed, bounded intervals with a small randomized delay. Failed sources back off independently: a broken Docker socket does not slow host scans.

## Docker and NixOS

Portracker inside Docker may have access to the host PID namespace but **not** its host network namespace. For authoritative host-offline transitions, make host `/proc` available read-only and set `HOST_PROC=/host/proc`:

```yaml
volumes:
  - /proc:/host/proc:ro
environment:
  - SERVICE_REGISTRY_ENABLED=true
  - SERVICE_REGISTRY_SCAN_INTERVAL_MS=30000
  - HOST_PROC=/host/proc
```

Without a trusted host proc mount, Portracker may still record positive observations, but **will not use the incomplete scan to mark other host listeners offline**. On a native NixOS installation, local `/proc/net/tcp*` is the source. If `/proc` or Docker inspection is unavailable, the source is marked unknown.

When testing from a source checkout, build the local Dockerfile rather than
using the separately published image; confirm the running container contains
the code under test. A read-only Docker API proxy is preferable to exposing
the raw socket to the dashboard process.

## Limits and safeguards

- History collection is **off by default**; no automatic command execution, port knocking, browser tab inspection, or generic HTTP probing.
- Only genuine TCP listeners and published container bindings are saved. Host/source status requires a complete scan; invalid/error-shaped rows invalidate the snapshot.
- Scanner uses isolated per-source results and single-flight scheduling; it never consumes the dashboard's merged `/api/ports` payload.
- Unavailable collectors degrade to unknown. Short-lived servers between polling intervals cannot be reconstructed.
- Old observations remain indefinitely until explicitly forgotten. Boot IDs are included as part of **provisional native-process identity evidence**, not exposed as a secret or a permanent application ID.
- The historical UI, website titles/icons, rich process provenance, and restart hints are tracked in upstream issues #133–#136.

## Validation

The PR adds Jest tests for complete/partial/failed snapshots, source isolation, repeat observations, port reuse, network namespace trust, strict /proc reads, Docker inspection errors, scanner scheduling and API auth. Run the repository's existing test and Docker/image contracts on the contributed branch.
