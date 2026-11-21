# Docker and Docker Compose provenance (upstream issue #135)

Portracker can remember the *logical* Docker Compose service behind a published
TCP port, even if the container is recreated or its host port changes.

## Identity vs sensitive metadata

The registry's existing Docker snapshot already calls `listContainers()` and
`inspectContainer()` for running containers. This feature **reuses that same
inspection** to read strictly allowlisted Compose labels; it does not invoke
Docker commands or modify containers.

A high-confidence logical identity requires:

1. Exact `com.docker.compose.project` and `com.docker.compose.service` labels
   from Docker's inspected `Config.Labels`, not guesses from network names.
2. A successfully read and hashed unique Docker daemon ID from read-only
   `getSystemInfo()`. The hash avoids persisting the raw daemon ID or
   connection credentials.

That identity is stable across container IDs, image changes and host-port
remapping for a service within the same Compose project and Docker daemon.
Different projects or daemons remain separate. If the Docker socket proxy
blocks `info` or labels are missing, the registry preserves the older
**provisional container-ID identity** instead of claiming a verified match.

Docker API failures and partial inspect results still follow #132's strict
source-scoped semantics: a failed Docker query cannot mark native Linux
listeners offline. An internal `EXPOSE` or Docker host-network process is
not evidence that a port is published, so no fake localhost URL is created.

## Optional private Compose details

The scanner can use trusted project/service labels for identity without storing
private host paths. To persist and show richer read-only Docker metadata:

```env
ENABLE_AUTH=true
SERVICE_REGISTRY_ENABLED=true
SERVICE_REGISTRY_DOCKER_PROVENANCE_ENABLED=true
```

When authentication is disabled, private metadata collection is disabled and
already saved Docker host paths are hidden from the API. Only an authenticated
saved-service **detail** response includes `dockerProvenance`. List responses
remain free of sensitive filesystem paths and raw Docker inspect data.

The allowlisted saved fields are: Docker-daemon fingerprint, most recently
observed container ID and name, image reference, network mode, Compose
project/service, Compose project working directory, up to eight Docker-host
Compose configuration paths, observation timestamp and confidence. Config
paths are labelled `pathScope: docker-host`, **not verified as files mounted
inside Portracker**. Docker labels besides those specific Compose keys,
Docker environment variables, mounts, commands and entrypoints are never
persisted. Paths with control characters or invalid syntax are excluded.

The snapshot is read-only and needs no write access to Docker. A stopped
container may no longer appear in `listContainers()` but its previously
captured metadata remains available in SQLite indefinitely until you
explicitly forget that history record. This feature does not make stopped
containers appear to be listening.

## NixOS and Docker socket access

On NixOS, Compose's working directory is a **path on the Docker host**. The
Docker container running Portracker may not have that directory mounted. Avoid
interpreting it as a usable working directory within the monitor. Images and
paths can become stale when containers are replaced or NixOS configurations
change. If the daemon's `info` endpoint is blocked by a restricted
Docker socket proxy, history continues using provisional container IDs.
Explicit host-port publication remains the criterion for a Docker listener.

The UI shows a confidence label and saved Compose paths, but **does not create
or execute a restart command**. Read-only, safely quoted recovery hints are
tracked separately in upstream #136.

## API and validation

- `GET /api/service-registry`: retains safe historical summaries, including
  `identityConfidence` for verified Compose identities.
- `GET /api/service-registry/:id`: adds `dockerProvenance` only with
  authenticated private provenance enabled.
- `DELETE /api/service-registry/:id`: forgets the stored provenance along with
  that service history record; it does not stop or remove a container.

Schema v5 is an idempotent addition to the existing SQLite registry.
Tests cover Compose recreation/remapping, duplicate service names across
projects and daemon identities, secret-label rejection, restricted Docker APIs,
host-network/internal-only ports, SQLite persistence, authentication gating,
and browser details. Run native AMD64/ARM64 CI on the eventual upstream PR head; validation of the historical fork milestone alone is not final-head validation.
