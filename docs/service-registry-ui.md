# Historical and offline services dashboard (upstream issue #133)

## Where to find it

The main dashboard has **Live ports** and **History** tabs. The sidebar remains for live server navigation; selecting a server returns to Live ports. History has its **own filters** that are separate from the existing live-port search and health indicators.

The History tab reads saved entries from the authenticated `/api/service-registry` endpoint. No browser session is required **to collect** history—when the backend is configured with `SERVICE_REGISTRY_ENABLED=true`, its background scanner continues sampling even with all browser tabs closed.

## Search and use

- Search by last-known service/process name.
- Filter by exact port, TCP listening status (`listening`, `offline`, `unknown`), and source (`system` or `docker`).
- Use paginated results (24 at a time), with first/last-seen timestamps and the latest known endpoint.
- Open a record to see its full historical endpoint list and identity-confidence label.
- Explicitly **Forget** a selected record after confirmation. This deletes history only; it does **not** stop the process, alter Docker/systemd, or delete existing per-port notes.
- The page refreshes on demand or at a low frequency only while History is visible. It does not trigger a new host scan from the browser.

## State interpretation

**Listening**: this TCP socket was observed. It is not a promise that an HTTP page is healthy.

**Offline**: an authoritative scan of the relevant source no longer observed that service.

**Unknown**: the source was partially observable, failed, or Portracker restarted and has not yet observed an authoritative snapshot. Its historical last-seen timestamp remains.

A port can be reused. Registry records are keyed by saved service/episode IDs, not port alone. When ownership is uncertain, the UI explicitly says so.

The scanner is server-wide opt-in. If disabled, the History page explains how to enable it; previous saved history remains browseable.

## Boundaries

This feature does **not** automatically fetch website page titles/favicons (#134), discover systemd or Compose ownership (#135), or generate recovery instructions (#136). These enhancements will appear in the same saved-service detail panel without merging it into live port health state.

## Validation

Backend Jest verifies paginated preview fields and authentication; frontend Node tests verify status/port/page formatting; browser contracts exercise History-to-Live navigation and mobile/desktop layouts. The upstream PR checks include AMD64/ARM64 image/browser contracts. Screenshots of key states are useful for manual review.

## Follow-up: manual scan, stable native identity and prefix filtering

The History view can request a backend **Scan now** operation while preserving
source-scoped failure handling and single-flight scheduling. Port search supports
partial digit prefixes (not only a complete port number), and logical identity
reconciliation uses allowlisted systemd unit or manual-project evidence when
available to preserve notes across genuine application restarts. Weak matches
remain provisional, and ordinary port reuse must not steal an existing record.
This behavior supplements upstream #132 and #133.

## Pinned services and source correlation (follow-up)

Pinned Services are a persistent per-service **annotation**, not a new identity
and not an instruction to start a process. A stopped service remains pinned
until explicitly unpinned or forgotten. API endpoints provide individual
pin/unpin and paginated grouped Pinned views; only verified sibling services
within one Compose project/daemon are visually grouped into a parent row.
Unverified/native services remain separate. Unpinning one Compose child never
unpinns another, and grouping does not merge SQLite records or recovery notes.

When the native collector also observes a Docker-published port as a
`docker-proxy` listener, a validated recent one-to-one source link avoids
presenting it as a second independent service while keeping each source's
own status, history and authority. No cross-source identity merge occurs.

Backend capabilities summarize HTTP and Docker readiness with sanitized
status and timestamps; they must not reveal Docker endpoints, private
route details, or raw probe/inspect errors. The follow-up frontend stage
renders these statuses and Pinned controls.
