# Native Linux and systemd launch provenance (upstream issue #135)

Portracker can remember **where an observed native TCP service came from**,
including a systemd system or user unit, working directory and executable path.
These are historical observations, not guaranteed restart commands.

## Opt in — privacy and authentication

All three backend flags are required:

```env
ENABLE_AUTH=true
SERVICE_REGISTRY_ENABLED=true
SERVICE_REGISTRY_PROVENANCE_ENABLED=true
```

Restart Portracker after changing the flags. If `ENABLE_AUTH` is disabled,
provenance collection is **not started**, even if the provenance flag is set.
Previously stored private host paths are also omitted from API responses while
authentication is disabled. Do not expose the dashboard to the public Internet.
Provenance is shown **only in the authenticated service-detail view**; list
responses do not include paths, UIDs or process arguments.

The existing login/session mechanism governs access. There are no new systemd,
Docker or shell mutation endpoints. No external commands are executed.

## What is captured

For a PID that currently owns a discovered TCP socket, the collector attempts
read-only access to:

- `/proc/<PID>/stat`, twice, to obtain Linux process start ticks and detect a
  process that exited or a PID that was recycled between reads
- `/proc/<PID>/status` for UID, when permitted
- `/proc/<PID>/cgroup` to identify systemd **system**, systemd **user**,
  session/scope, container-managed, manual or unknown process ownership
- the `cwd` and `exe` symlink targets, if visible and safe to store
- the host boot identifier already sampled by the registry

**Never captured:** `cmdline`, full argv, process environment, arbitrary
cgroup content, private Docker labels, credentials, shell history or config
file contents. Only allowlisted, length-bounded fields are retained in SQLite
(table `registry_linux_provenance`, schema v4).

The unit name is **only** considered verified when supported by a cgroup
`*.service` path. `user@UID.service` is the per-user manager and is **not**
mistaken for the application's unit. Interactive scopes are distinguished from
user services. Docker-managed processes are labeled `container` rather than
claiming a systemd unit. Detailed Docker/Compose linkage is handled by the Docker/Compose portion of upstream #135.

Process PID alone does not provide reliable identity across process restarts.
The collector adds process start ticks plus the host boot ID to its provisional
identity fingerprint. Previously seen apps are never collapsed solely because
they reused the same PID and TCP port.

## NixOS / Docker limitations

On native NixOS, access depends on normal Linux `/proc` permissions. Reading
another user's process symlinks may be denied by the kernel; those fields are
shown as unavailable, and TCP status remains usable.

For Docker deployments, host PID namespace access **alone** does not guarantee
readable host `cwd`, `exe` or cgroup files. Existing read-only host `/proc`
mounts and `HOST_PROC=/host/proc` can improve visibility, without adding
privileged systemd controls. To avoid misattributing the container's own
processes to the host, provenance capture is skipped when Portracker runs
inside Docker without an explicitly trusted host `/proc` root.

A `/nix/store/...` executable path is a historical observation, **not** a
durable startup command. It may be stale after an upgrade/rebuild, and may
require a project-specific `nix develop`, `direnv`, flake or service
configuration that cannot be recovered from process sockets alone.

The collector uses a bounded per-scan list of 128 distinct PIDs, with up to
eight simultaneous read-only process metadata queries. Permission errors,
exited processes and missing files do **not** make a completed TCP scan fail.
Saved evidence remains available after the service stops until its specific
history record is deliberately forgotten.

## API and tests

- `GET /api/service-registry/:id`: adds `linuxProvenance` **only** when
  authentication is enabled and the feature is opted in.
- `GET /api/service-registry`: unchanged non-sensitive summaries.
- `DELETE /api/service-registry/:id`: also removes the related saved process
  evidence, without touching the process or its unit.

The tests include cgroup v1/v2, system/user services, manager-only and session
scopes, containers, PID reuse, process exit during read, permission errors,
database persistence, schema upgrade, API privacy and saved-service UI display.
Run native AMD64/ARM64 Docker/image/browser CI on the eventual upstream PR head.

Restart **instructions**, command quoting and user overrides will be added
separately in upstream #136 after Docker/Compose provenance in #135.
