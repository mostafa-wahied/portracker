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
