# Secure upstream service-registry deployment and migration

This guide is for **the official `mostafa-wahied/portracker` repository**, after the persistent-service-registry contribution stack is merged and published. It is not a guarantee that the current Docker Hub `latest` image contains those features.

## Prerequisites and release gate

- Wait for the service-registry and UI PR stack to merge, including the UX parity follow-up and this deployment contribution. Review the upstream Actions results on the exact accepted commits.
- Find the release tag or immutable Docker image digest that **actually includes** the stack. A PR merge does not by itself publish `mostafawahied/portracker:latest`; release tags and Docker Hub publication are separate.
- On a Linux/NixOS Docker Engine, use a Compose version supporting `name`, `internal` networks and variable interpolation.
- Use `SESSION_SECRET` from the **existing** installation when migrating. Generate a new high-entropy secret only for a fresh installation.

The optional secure profile is `docker-compose.registry-secure.yml`. It is intentionally **standalone**: do not combine it with the original `docker-compose.yml`, which may expose port 4999 beyond loopback or allow broader Docker socket access.

## Fresh installation

From a checkout of the official upstream source containing the secure profile:

```sh
export SESSION_SECRET="$(openssl rand -hex 32)"
# Strongly recommended once an upstream release digest is verified:
# export PORTRACKER_IMAGE='mostafawahied/portracker@sha256:YOUR_VERIFIED_DIGEST'
docker compose -f docker-compose.registry-secure.yml config --quiet
docker compose -f docker-compose.registry-secure.yml up -d
```

Open `http://127.0.0.1:4999` and complete the first-time authentication setup. The service saves `/data/portracker.db` in `${PORTRACKER_DATA_DIR:-./portracker-data}` on the host. Store your session secret in a secure password manager or a protected local environment file, not in version control or a public issue.

By default, this profile enables persistent History, bounded local HTTP title/favicon enrichment, authenticated Linux/systemd attribution, Docker/Compose provenance, and **copy-only** recovery notes. The app can function without the optional Docker API proxy or HTTP metadata; corresponding capability badges report degraded states. Nothing will automatically run a saved recovery command.

### Verify the published image

Before replacing the fork, confirm the chosen tag/digest was published from a commit **after the required PRs merged**. You can inspect the image revision label if it exists:

```sh
export PORTRACKER_IMAGE="${PORTRACKER_IMAGE:-mostafawahied/portracker:latest}"
docker pull "$PORTRACKER_IMAGE"
docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$PORTRACKER_IMAGE"
```

Use a verified `PORTRACKER_IMAGE` value rather than assuming that the current `latest` tag already includes the work. If using the profile's default image, omit the first command's variable or set `PORTRACKER_IMAGE=mostafawahied/portracker:latest` explicitly. A missing revision label is *not* evidence of parity; verify the release's source SHA through upstream GitHub releases/Actions.

## Migrate from `ash0x0/portracker` without losing SQLite data

1. **Record the old installation's absolute data-directory path**, actual database filename (`/data/portracker.db` for the fork Compose profile), `SESSION_SECRET`, and any overridden HTTP/Docker socket environment settings. Do not paste secrets into logs.
2. Verify the upstream image as described above. **Stop** the existing fork application and any other writers before backing up its database:

   ```sh
   # Run in your original fork checkout:
   docker compose -f docker-compose.registry-fork.yml stop portracker
   export PORTRACKER_DATA_DIR="$(realpath ./portracker-data)"
   test -f "$PORTRACKER_DATA_DIR/portracker.db" || { echo 'Database not found'; exit 1; }
   cp -a "$PORTRACKER_DATA_DIR" "${PORTRACKER_DATA_DIR}.before-upstream"
   ```

   This copies the **stopped** database and any companion SQLite files. If another process still writes to the database, stop that writer or create a consistent SQLite online backup instead. Keep the backup outside the application data directory.
3. From the official upstream checkout, point the secure profile at **that same absolute directory**, using the **same secret** and the verified upstream image:

   ```sh
   # Use your saved values; these are intentionally not echoed.
   export PORTRACKER_DATA_DIR=/absolute/path/to/existing/portracker-data
   export SESSION_SECRET='YOUR_PREVIOUS_SESSION_SECRET'
   export PORTRACKER_IMAGE='mostafawahied/portracker@sha256:YOUR_VERIFIED_DIGEST'
   docker compose -f docker-compose.registry-secure.yml config --quiet
   docker compose -f docker-compose.registry-secure.yml up -d
   ```

4. Visit `http://127.0.0.1:4999`. Confirm the existing account still works, saved History/Offline records persist, Pinned entries appear immediately, notes and the **one-line recovery command** persist, and icons/titles remain cached. Verify the scan-status view before interpreting any missing services as offline.
5. Test a known TCP listener's appearance, disappearance and recovery; confirm failed host/Docker scans show **Unknown**, not false **Offline**, and Docker Compose app identity does not duplicate its `docker-proxy` port. Test Reload list separately from Scan now. Confirm the UI stays on the same service and scroll position during polling.
6. Keep the backup and original fork checkout until all checks pass. A new schema may not be safely readable by an older image. To roll back, stop upstream, restore the **pre-migration backup as a unit**, restore the old image/Compose configuration and reuse your previous secret.

**Do not run fork and upstream containers against the same SQLite file at the same time.** They both bind `127.0.0.1:4999` and may migrate the database at startup. Compose project names differ so old containers are not implicitly removed when you start the new project.

## Secure Docker inspection and optional dependencies

- Portracker binds its web UI only to `127.0.0.1:4999` in the profile. If you require remote access, configure your own authenticated reverse proxy or VPN with deliberate exposure; do not remove the binding casually.
- `pid: host`, a **read-only** host `/proc` mount and `SYS_PTRACE` support host listening-port and process metadata visibility on Linux. These do **not** place the application in the host's network namespace. Permissions, host firewall and NixOS procfs policies can still restrict metadata.
- Only the isolated `docker-api-proxy` has the Docker socket; its Docker API allows `CONTAINERS=1`, `INFO=1` and `POST=0`, and is attached to a Docker `internal: true` network with **no published port**. The application itself does not mount `docker.sock`. A `:ro` socket mount alone is *not* a read-only Docker API guarantee.
- This proxy restricts **methods and API prefixes**, not every individual Docker endpoint. Enabling the `CONTAINERS` section permits more read endpoints than the application currently needs, potentially including logs and attach WebSocket endpoints; `POST=0` does **not** make all GET responses harmless. Treat the restricted proxy as sensitive, connect no untrusted services to its internal network, and consider an endpoint-allowlisted proxy for stricter deployments. It can also expose private inspection data (including environment variables and mounts) to the trusted Portracker process. Keep the UI authenticated. Other Docker write features may fail by design.
- For rootless Docker, set `PORTRACKER_DOCKER_SOCK` to the actual socket path (often `$XDG_RUNTIME_DIR/docker.sock`). If no usable socket exists, start **just** the dashboard with `docker compose -f docker-compose.registry-secure.yml up -d portracker`; Docker capability then reports unavailable while native discovery can continue.
- The backend's HTTP title/favicon scanner only probes observed likely-HTTP TCP ports. In Docker bridge mode, an app bound only to the **host's** `127.0.0.1` may be unreachable from the container. The scanner uses a validated private numeric gateway, not arbitrary DNS/URLs; if that cannot reach an app, leave metadata degraded or deploy Portracker natively on Linux. Set `SERVICE_REGISTRY_HTTP_ENABLED=false` to opt out. Never disable TLS verification or open public port-forwarding merely to fetch icons.
- Never give Portracker unrestricted `SYS_ADMIN`, `apparmor:unconfined`, a public Docker API proxy port, or Docker POST permission just to make discovery work.

## NixOS and native-host alternatives

On NixOS, Docker bridge host-loopback isolation and user process-visibility restrictions may make a **native, authenticated, firewall-protected** Portracker service more suitable for localhost development services. Native use runs Node with access to your user namespace but the backend currently listens on `0.0.0.0` by default, so a NixOS firewall or carefully managed network namespace is required for security. The container profile is safer by default for network exposure but may miss loopback-only apps.

Native installation requires Node.js 22, build dependencies for `better-sqlite3`, a built frontend copied into the backend's public directory, a persistent `DATABASE_PATH`, stable `SESSION_SECRET` and explicit registry/provenance/recovery flags. Keep secrets in a root-readable or service-account-readable `EnvironmentFile` outside the Nix store; do not store them in a world-readable NixOS module or Git.

**Real NixOS, Docker rootless, cross-host procfs, and host-loopback cases require acceptance testing on your machine.** The CI/test contracts do not simulate every local NixOS systemd permission or namespace configuration.

## Contributor verification

Reviewing the profile: check the strict JSON Compose model as well as the YAML source. This command does **not** start containers:

```sh
SESSION_SECRET='ci-placeholder-do-not-reuse' docker compose -f docker-compose.registry-secure.yml config --format json | node scripts/validate-registry-compose.mjs
```

The validator uses Compose JSON from stdin and never prints environment secrets. Run `npm test -- --runInBand`, `npm run lint`, `npm run test:release`, and upstream image/browser contracts before publishing a release. Do not claim NixOS host coverage from these Linux CI checks alone.
