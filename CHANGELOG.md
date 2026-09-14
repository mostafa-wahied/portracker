# Changelog

All notable changes to portracker will be documented in this file.

## [Unreleased]

## [1.3.14] - 2026-09-14

### Security

<!-- whatsnew:title=Better protection for your servers -->
<!-- whatsnew:description=Container details now hide sensitive settings. If you use connected servers, include the encryption key file with your database backups. -->
- **[Container Diagnostics]**: Omit environment values, commands, arbitrary labels, health-check output and raw application configuration from diagnostic responses and exports. Require a signed-in user for raw diagnostics when authentication is enabled, prevent submitted peer keys from reaching error logs, and validate external autoxpose links as HTTP(S). Reported privately through GitHub issue #116.

<!-- whatsnew:hide -->
- **[Peer Credentials]**: Encrypt saved outbound peer API keys with authenticated encryption bound to the peer ID and URL, migrate legacy values, and fail closed when encrypted data has no matching key file. Preserve keys for unchanged peer edits and clear them when the destination changes. Back up the database and peer-keys.key, or the file selected by PEER_KEY_FILE, together; see SECURITY.md for recovery and old-backup limitations.

<!-- whatsnew:hide -->
- **[Request Boundaries]**: Require authentication or a valid peer key for port generation when authentication is enabled. Restrict ping to discovered server/port inventory, validate and pin outbound addresses, reject unsafe peer URLs and redirects, and bound request time, response size and request rates. Private HTTP peers remain supported; HTTPS peer certificate verification remains enabled. Peer loopback, link-local and reserved destinations are rejected. Add route-guard inventory and regression checks across both image architectures.

## [1.3.13] - 2026-09-14

### Fixed

<!-- whatsnew:title=Correct memory sizes for TrueNAS containers -->
<!-- whatsnew:description=Container memory now shows the correct amount instead of unrealistically large values. -->
- **[TrueNAS Container Memory]**: Preserve byte-valued container memory from the TrueNAS API instead of applying the MiB conversion used for virtual machines. Ordinary VM memory conversion is unchanged.

## [1.3.12] - 2026-09-13

### Fixed

<!-- whatsnew:title=Fixed startup on Apple Silicon Macs -->
<!-- whatsnew:description=Portracker now starts correctly in Docker on Apple Silicon Macs and other ARM-based devices. -->
- **[ARM64 Startup]**: Prevent host-installed dependencies from overwriting target-platform dependencies during Docker builds, preserving the correct SQLite native binding in ARM64 images (#115).

## [1.3.11] - 2026-09-11

### Security

<!-- whatsnew:title=Sign-in protection for settings and autoxpose -->
<!-- whatsnew:description=With sign-in enabled, you must be signed in to access settings and autoxpose controls. Reconnect autoxpose once after upgrading. Reported by Mirko Benacci. -->
- **[Authentication Boundary]**: Protected settings and autoxpose routes when `ENABLE_AUTH=true`, preventing unauthenticated configuration changes, integration inventory access, and server-side URL requests. autoxpose requests are pinned to validated addresses, time/size bounded, and prevented from reaching loopback, link-local, reserved, or redirect destinations; intended private LAN destinations remain supported. Browser access is same-origin by default, and generic settings writes cannot change connection state. Existing saved autoxpose connections are intentionally cleared and must be reconnected once by a signed-in user. Reported by Mirko Benacci.

### Fixed

<!-- whatsnew:title=Fixed dashboard crashes with some apps -->
<!-- whatsnew:description=Apps that list thousands of internal ports no longer overwhelm the dashboard. Published ports remain visible. -->
- **[Large Port Count Crash]**: Oversized unpublished/internal port sets are filtered before they reach the dashboard. The limit (`MAX_INTERNAL_PORTS_PER_CONTAINER`, default 100) applies to Docker and TrueNAS collection, local API responses, peer scan responses, and local or remote container details (#108).

<!-- whatsnew:title=Faster recovery when TrueNAS is unavailable -->
<!-- whatsnew:description=Failed TrueNAS API connections no longer hold the dashboard on its loading screen for minutes. Available Docker and system port data is retained. -->
- **[TrueNAS Connection Recovery]**: Bounded discovery, connection, and authentication attempts; cancelled timed-out requests; preserved Docker and system port data when TrueNAS enrichment fails; and reported degraded enrichment instead of empty success.

### Changed

<!-- whatsnew:hide -->
- **[Dependency Security]**: Updated frontend, backend, and build dependencies to versions without known npm audit findings, including Dockerode 5 and React Router 7.18.2.

<!-- whatsnew:hide -->
- **[Node 22 Base Image]**: Updated the Docker base image from Node 20 to Node 22 LTS.

<!-- whatsnew:hide -->
- **[Release Pipeline]**: Added required tests before Docker tags are published, tested the exact built image, kept release jobs from cancelling each other, used the root version consistently, and created GitHub Releases only after verification.

## [1.3.10] - 2026-05-05

### Fixed

<!-- whatsnew:title=More reliable service status -->
<!-- whatsnew:description=Services using Docker's default network no longer incorrectly appear yellow or red because Portracker checked the wrong address. -->
- **[Probe Host Resolution]**: Service status probes fall back to the Docker host gateway for `0.0.0.0`/`::` ports instead of `127.0.0.1`, fixing false yellow/red statuses on default-bridge installs without `HOST_OVERRIDE`.
<!-- whatsnew:title=Correct keyboard shortcuts for your computer -->
<!-- whatsnew:description=The sidebar tip now shows the appropriate shortcuts for your operating system, without awkward line wrapping. -->
- **[Sidebar Shortcut Label]**: The "sidebar has knobs" tip now shows the correct keyboard shortcut for your OS (`⌘B`/`⌘K` on macOS, `Ctrl+B`/`Ctrl+K` elsewhere) instead of a combined string that could wrap mid-pair on narrow sidebars.

## [1.3.8] - 2026-05-04

### Dashboard & UX

<!-- whatsnew:title=Smarter, clearer service status -->
- **[Smarter Service Status]**: Service status with protocol-aware probes, helper-vs-main aggregation, and per-component overrides (resolves #88).
  - **[sub]** Protocol-aware probes for HTTP/HTTPS/TCP/UDP, container state, and finished jobs
  - **[sub]** Helper components degrade the service to yellow instead of turning the whole thing red
  - **[sub]** "Why this status?" popover shows the failing component, the rule that fired, and per-port evidence
  - **[sub]** Per-component role overrides; clear all from Settings > Advanced
  - **[sub]** Clearer port and rolled-up status wording
  - **[sub]** Soft pulsing dot while loading instead of briefly flashing red

<!-- whatsnew:title=Reorganized sidebar -->
- **[Sidebar Reorganization]**: Reorder, sort, resize, and collapse the sidebar, with per-server health and a refreshed timestamp.
  - **[sub]** Drag servers to reorder; order persists across reloads
  - **[sub]** Sort chip cycles Custom / A→Z / Z→A with an inline undo banner
  - **[sub]** Resizable, collapsible icon rail, one-time discovery coachmark
  - **[sub]** Per-server health dot (green / red / blue pulse)
  - **[sub]** Live "Updated Xm ago" label per server

<!-- whatsnew:title=Keyboard shortcuts -->
- **[Keyboard Shortcuts]**: `Cmd/Ctrl+K` focuses search, `Esc` clears, `Cmd/Ctrl+B` toggles the sidebar, `Cmd/Ctrl+R` refreshes, and `1`–`9` quick-switch between servers.

## [1.3.7] - 2026-04-02

### Fixed

<!-- whatsnew:title=Better service naming in stack deployments -->
<!-- whatsnew:description=Reduced false matches when containers share the same stack name. -->
- **[Container Heuristic]**: Fixed `_getContainerByProcessName` false-positive — now checks image name instead of container name to avoid misattribution in stacks named `portracker-*` (#102 by @leinardi)
<!-- whatsnew:hide -->
- **[Frontend Error Logging]**: Downgraded `ENOENT` log from error to debug when frontend is not built yet (#101 by @leinardi)
<!-- whatsnew:title=Better Docker service icons -->
<!-- whatsnew:description=Swarm services keep a recognizable Docker icon when the remote icon lookup fails. -->
- **[Swarm Fallback Icon]**: Docker Swarm services now fall back to the Docker whale icon when CDN lookup fails (#103 by @leinardi)

### Security

<!-- whatsnew:hide -->
- **[npm Vulnerabilities]**: Removed unused root dependencies `jq`, `sqlite3`, and `react-router-dom` that pulled in critical/high transitive vulnerabilities (#100 by @leinardi)

## [1.3.6] - 2026-04-02

### Docker Swarm

<!-- whatsnew:title=Docker Swarm ingress ports group correctly -->
<!-- whatsnew:description=Ingress-mode published ports now stay attached to the right Docker service instead of falling back to system ports. -->
- **[Swarm Ingress Support]**: Docker Swarm services using `mode: ingress` published ports are now correctly attributed as Docker services instead of system ports (#98, PR #99 by @leinardi)
  - **[sub]** Swarm port discovery via Docker Services API
  - **[sub]** Shared logic in BaseCollector for both Docker and TrueNAS collectors
  - **[sub]** Dedup keys now include protocol for consistency

### Fixed

<!-- whatsnew:hide -->
- **[Port Dedup Key Consistency]**: Fixed inconsistent dedup key format between Docker and TrueNAS collectors — both now include protocol in the key
<!-- whatsnew:hide -->
- **[CI]**: Fixed Docker build workflow failing on fork PRs due to missing secrets

## [1.3.5] - 2026-03-02

### Security

<!-- whatsnew:hide -->
- **Remove Vulnerable SQLite System Packages**: Removed unused `libsqlite3-dev` and `sqlite3` system packages from Docker image to address CVE-2025-7458. portracker uses `better-sqlite3` which bundles its own SQLite 3.49.2 (not affected) and never used the system libraries.

### Fixed

<!-- whatsnew:title=Safer TrueNAS API key transport -->
<!-- whatsnew:description=TrueNAS API key connections now stay on secure WebSocket endpoints. -->
- **TrueNAS API Key Transport Security**: Enforced secure WebSocket usage for TrueNAS API key authentication by restricting secure mode to `wss://` endpoints and skipping insecure `ws://` endpoints.
<!-- whatsnew:hide -->
- **TrueNAS WebSocket Base Handling**: In secure mode, `TRUENAS_WS_BASE` now upgrades insecure `ws://` values to `wss://` and ignores insecure explicit URLs.

## [1.3.4] - 2026-02-05

### Fixed

<!-- whatsnew:title=No more duplicate host-network services -->
<!-- whatsnew:description=Services using host networking no longer show up twice when discovered through multiple paths. -->
- **Host-Network Service Deduplication**: Added logical deduplication for services using host networking so the same listener is not shown multiple times when discovered through both Docker and process-based collection paths (addresses #82)
<!-- whatsnew:title=Cleaner service port chips -->
<!-- whatsnew:description=Services no longer show repeated port chips when entries share the same host port. -->
- **Service Port Rendering**: Updated service view port keys to use full port identity, avoiding repeated port chips when entries share the same host port number

## [1.3.3] - 2026-02-05

### Fixed

- **Duplicate Ports**: Skip internal Docker ports when a published binding exists, preventing duplicate rows for the same container port (addresses #82)

## [1.3.2] - 2026-02-03

### Fixed

- **Duplicate Ports**: Fixed duplicate port entries caused by IPv4/IPv6 wildcard addresses and internal port detection (resolves #82)

## [1.3.1] - 2026-02-03

### Fixed

<!-- whatsnew:title=Fresh installs work again -->
<!-- whatsnew:description=Fixed a missing column that broke brand-new installs on first launch. -->
- **Database Schema**: Fixed missing `remote_api_key` column in initial database creation that caused "no such column" errors for fresh installations (resolves #82)

## [1.3.0] - 2026-02-02

**Highlights**
- Service-Centric View - Ports organized by service with expandable cards (now default)
- API Key Authentication - Secure peer-to-peer communication between instances
- autoxpose Integration - See publicly exposed services directly in your dashboard

---

### Security

<!-- whatsnew:title=Secure peer-to-peer between instances -->
<!-- whatsnew:description=Generate API keys in Settings to securely connect portracker instances. -->
- **API Key Authentication**: Secure peer-to-peer communication between portracker instances
  - **[sub]** Generate unique API keys for external access from Settings
  - **[sub]** Backward compatible - only required when remote server has authentication enabled

<!-- whatsnew:title=Endpoints protected when auth is on -->
<!-- whatsnew:description=All data endpoints now require auth when authentication is enabled. -->
- **Endpoint Protection**: All data endpoints protected when authentication is enabled

### Integrations

<!-- whatsnew:title=See what's exposed publicly -->
<!-- whatsnew:description=Connect an autoxpose instance in Settings to see public URLs next to your internal ports. -->
- **autoxpose Integration**: See which services are publicly exposed by connecting to your autoxpose instance from Settings
  - **[sub]** Public URLs displayed alongside internal ports with SSL status indicators
  - **[sub]** Clickable links open your public endpoints directly

### Settings

<!-- whatsnew:title=One place for settings -->
<!-- whatsnew:description=Theme, refresh interval, autoxpose connection, and advanced options live in a single modal. -->
- **Settings Modal**: Centralized configuration accessible from header dropdown for theme, refresh intervals, autoxpose connection, and advanced options

### Added

<!-- whatsnew:title=Works behind a reverse proxy -->
<!-- whatsnew:description=Set HOST_OVERRIDE to control the hostname used in port links. -->
- **Reverse Proxy Support**: New `HOST_OVERRIDE` environment variable allows specifying the hostname used in port links when running behind a reverse proxy (fixes #51)

### Fixed

<!-- whatsnew:title=System ports detected in containers -->
<!-- whatsnew:description=Restored SSH, SMB, and other system port detection inside containerized deployments. -->
- **System Port Detection**: Restored system port detection (SSH, SMB, etc.) when running in containerized environments.

### Dashboard

<!-- whatsnew:title=Ports grouped by service -->
<!-- whatsnew:description=Ports are now grouped by service in expandable cards. This is the default view. -->
- **Service-Centric View**: View your ports organized by service name with expandable cards showing all ports per service (now the default view)
<!-- whatsnew:title=Service icons, theme-aware -->
<!-- whatsnew:description=Known services show icons that adapt to light and dark mode. -->
- **Service Icons**: Visual icons automatically loaded for known services with theme-aware variants for dark and light modes

### UI

<!-- whatsnew:title=Health at a glance when collapsed -->
<!-- whatsnew:description=Collapsed service cards now show an aggregated health indicator. -->
- **Collapsed Health Status**: Collapsed service cards now show an aggregated health indicator so you can see status at a glance without expanding

<!-- whatsnew:title=Favicon follows your theme -->
<!-- whatsnew:description=The favicon now adapts to light and dark system themes. -->
- **Favicon**: Dark mode support - favicon now adapts to system theme (black on light, white on dark)

## [1.2.2] - 2025-12-12

### Performance & Reliability

<!-- whatsnew:title=Faster, more reliable TrueNAS -->
<!-- whatsnew:description=Parallel API calls, per-call timeouts, and reused connections make TrueNAS collection steadier. -->
- **TrueNAS Integration**: Improved timeout handling with parallel API calls, granular per-call timeouts, and connection reuse for reliable VM and container collection

## [1.2.1] - 2025-11-21

### Performance & Reliability

<!-- whatsnew:title=TrueNAS VMs and LXCs from the UI -->
<!-- whatsnew:description=Add a TrueNAS API key from Settings to see VM and LXC containers in your dashboard. -->
- **TrueNAS Enhanced Features**: Fixed VM and LXC container cards disappearing after auto-refresh on resource-constrained systems

## [1.2.0] - 2025-11-20

### Security

<!-- whatsnew:title=Optional dashboard login -->
<!-- whatsnew:description=Turn on ENABLE_AUTH to protect the dashboard. Off by default. -->
- **Authentication**: Optional authentication to secure dashboard access using `ENABLE_AUTH=true`
  - **[sub]** Disabled by default for backward compatibility
  - **[sub]** Recovery mode accessible via `RECOVERY_MODE=true` if you lose your password
  - **[sub]** When recovery mode is enabled, a time-limited recovery code (valid 15 minutes) appears in the logs to use on the login page with any username

### Dashboard

<!-- whatsnew:title=Auto-refresh every 30s -->
<!-- whatsnew:description=Toggle auto-refresh from the header to keep ports and services live. -->
- **Auto-Refresh**: Added a toggle to auto-refresh ports and services every 30 seconds
<!-- whatsnew:title=Pick an unused port -->
<!-- whatsnew:description=One click to generate a port that isn't already taken. -->
- **Random Port Generator**: Generate an unused port with a single click

## [1.1.1] - 2025-01-17

### Server Integrations

<!-- whatsnew:title=TrueNAS VMs and LXCs from the UI -->
<!-- whatsnew:description=Add a TrueNAS API key from Settings to see VM and LXC containers in your dashboard. -->
- **TrueNAS Enhanced Features**: Add your TrueNAS API key directly from the UI to unlock VM and LXC container monitoring with step-by-step setup instructions

### Fixes

<!-- whatsnew:hide -->
- **TrueNAS API Key Revocation**: Fixed automatic key revocation issue by prioritizing secure WebSocket connections
<!-- whatsnew:title=VMs and LXCs look right -->
<!-- whatsnew:description=VMs and LXC containers now show correct icons and badges. -->
- **Virtual Machines & Containers**: VMs and LXC containers now display correctly with icons and badges to distinguish between them
<!-- whatsnew:hide -->
- **Debug Logging**: DEBUG environment variable now properly enables debug output

## [1.1.0] - 2025-08-23

### Dashboard

<!-- whatsnew:hide -->
- **System Port Name Fix**: Fixed the issue where system ports were incorrectly displayed as "unknown".
<!-- whatsnew:hide -->
- **Consistent Status Indicators**: Improved status indicators for system ports to ensure consistency.

## [1.0.8] - 2025-08-20

### Dashboard

<!-- whatsnew:hide -->
- **Batch rename migration fix**: Fix migration issue affecting batch rename operations so renamed services persist correctly.
<!-- whatsnew:hide -->
- **Misc.**: minor migration-related fix for batch rename flow.

## [1.0.7] - 2025-08-19

### Dashboard

<!-- whatsnew:title=Rename services from the UI -->
<!-- whatsnew:description=You can rename services directly in the dashboard. -->
- **Service renaming**: Allow renaming services from the UI.
<!-- whatsnew:title=Bulk actions on ports -->
<!-- whatsnew:description=Select multiple services or ports to ignore or annotate them at once. -->
- **Batch actions**: Add selection and batch operations for services and ports (ignore, add note, etc.).
<!-- whatsnew:hide -->
- **Internal / Port display fixes**: Fix display issues so internal and published ports are shown correctly; fix select-box overlap.

### Backend

<!-- whatsnew:hide -->
- **Port protocol reporting**: Ensure ports include protocol information so reported mappings are accurate.

## [1.0.6] - 2025-08-15

### Dashboard

<!-- whatsnew:title=Container details drawer -->
<!-- whatsnew:description=Slide-out panel with stats, labels, mounts, and env vars for Docker containers. -->
- **Container Details Drawer**: New slide-out panel to show detailed information for Docker containers including stats, labels, mounts, and environment variables
<!-- whatsnew:title=Internal vs published ports, clear -->
<!-- whatsnew:description=Internal-only ports are now clearly distinguished from published ones, with health status. -->
- **Internal Port Display**: UI now correctly shows and differentiates internal-only ports from published ports with health status monitoring
<!-- whatsnew:title=Search across all servers -->
<!-- whatsnew:description=The search bar can search every connected server at once. -->
- **Global Search**: Search bar now includes an option to search across all servers simultaneously
<!-- whatsnew:title=Release notes modal -->
<!-- whatsnew:description=portracker tells you what changed when you open a new version. -->
- **What's New**: Automatic notification system to stay updated with new features when releasing new versions

### Data

<!-- whatsnew:title=Faster refreshes -->
<!-- whatsnew:description=Data collectors now cache between refreshes to reduce duplicate work. -->
- **Collector Caching**: Added caching mechanism to all data collectors to reduce duplicate requests and improve data refresh speed

## [1.0.5] - 2025-08-09

### Server Integrations

<!-- whatsnew:hide -->
- **Dockerode Integration**: Switched to use the dockerode library for more reliable Docker API interactions instead of shell commands
<!-- whatsnew:hide -->
- **Centralized Logging**: All collectors now use a single Logger class for consistent and structured logging throughout the application

## [1.0.4] - 2025-08-09

### Dashboard

<!-- whatsnew:title=Better service detection -->
<!-- whatsnew:description=Improved identification and categorization of running services, including SPA apps. -->
- **Enhanced Service Detection**: Improved identification and categorization of running services with Single Page Application (SPA) detection support
<!-- whatsnew:title=Clearer port status -->
<!-- whatsnew:description=Visual distinction between published and internal ports, with detailed status. -->
- **Port Status Indicators**: Added clear visual distinction between different types of ports (published vs internal) with detailed status information

### Server Integrations

<!-- whatsnew:title=No host networking required -->
<!-- whatsnew:description=Direct /proc parsing replaces the need for Docker host networking mode. -->
- **Removed network_mode: host Requirement**: Eliminated the need for Docker host networking mode by implementing direct /proc filesystem parsing for better security
<!-- whatsnew:title=More accurate port detection -->
<!-- whatsnew:description=Multiple detection methods improve container and system port identification. -->
- **Advanced Port Detection**: Enhanced system for more accurate container and system port identification using multiple detection methods
<!-- whatsnew:title=Steadier container collection -->
<!-- whatsnew:description=Better error handling and fallbacks across platforms for reliable port collection. -->
- **Improved Container Introspection**: Better error handling and fallback strategies across different platforms for reliable port collection

## [1.0.3] - 2025-08-07

### Data

<!-- whatsnew:title=Simpler Docker setup -->
<!-- whatsnew:description=No extra system socket mounts required, and Docker proxy is supported. -->
- **Simplified Docker Dependencies**: Streamlined system requirements - no longer requires mounting additional system sockets for container information and support for docker proxy.
<!-- whatsnew:title=More accurate container metadata -->
<!-- whatsnew:description=Timestamps and metadata parsing are more precise. -->
- **Enhanced Data Accuracy**: Improved container information display with more accurate timestamps and metadata parsing

## [1.0.2] - 2025-07-11

### Security

<!-- whatsnew:hide -->
- **Security Hardening**: Key security aspects addressed
<!-- whatsnew:hide -->
- **Data Collection**: Improved data collection accuracy

## [1.0.1] - 2025-07-10

### Initial Improvements

- Various fixes and improvements after initial release

## [1.0.0] - 2025-07-07

### Dashboard

<!-- whatsnew:title=portracker is out -->
<!-- whatsnew:description=Monitor ports across multiple servers from one dashboard. -->
- **Multi-platform Port Tracking**: Initial release of portracker with support for monitoring ports across multiple servers
<!-- whatsnew:hide -->
- **Docker Integration**: Native Docker container port monitoring
<!-- whatsnew:hide -->
- **Web Interface**: Clean, responsive web interface for port management
<!-- whatsnew:hide -->
- **Server Management**: Support for multiple server configurations
