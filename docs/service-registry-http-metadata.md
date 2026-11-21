# Local HTTP title and favicon enrichment (upstream issue #134)

This feature captures **actual HTTP-root HTML titles and raster favicons** from saved,
observed local TCP listeners, not browser-tab titles or externally inferred product
logos. Successful metadata survives process shutdown in SQLite.

## Configuration and defaults

The persistent registry itself remains **opt-in**: set
`SERVICE_REGISTRY_ENABLED=true`. When the registry is enabled, HTTP enrichment
is **requested by default** unless `SERVICE_REGISTRY_HTTP_ENABLED=false` is set.
If it cannot select a safe local target, it degrades gracefully and does not
interrupt TCP discovery or erase cached metadata.

- Native Linux probes local `127.0.0.1`.
- A container uses an IPv4 Docker default gateway parsed from its own
  `/proc/net/route` **only if** that gateway is a vetted private numeric IP.
  Missing, ambiguous, public and otherwise unsafe gateways fail closed.
- Set `SERVICE_REGISTRY_HTTP_HOST` only to an independently verified private/
  loopback numeric IP to override this choice. Hostnames, public/link-local/
  cloud-metadata addresses, IPv6 zone IDs and arbitrary URLs are rejected.
- A host service bound only to `127.0.0.1` may not be reachable through a
  Docker bridge gateway. Do not disable the NixOS firewall or publish it
  globally to overcome this limitation.

## Security bounds and retention

Only likely HTTP listeners already observed by the local scanner are candidates.
There is no user-provided arbitrary URL, browser credential, DNS lookup,
proxy, JavaScript execution or external HTTP request. At most two **same-origin**
redirects are followed; TLS certificate verification remains enabled even
for self-signed development certificates.

The root HTML response is limited to 256 KiB; image bytes to 128 KiB; a
webmanifest (when present) to 32 KiB. Candidate raster images may come from
HTML icons, Apple touch icons, a bounded same-origin manifest, and conventional
favicon filenames. The entire favicon search is capped at five icon attempts
and eight seconds, with at most four scanned services per cycle and two
concurrent workers. SVG is not cached; image bytes require recognized raster
signatures and compatible MIME types.

Titles are sanitized and bounded. Image blobs are content-addressed by
SHA-256 and retained in the existing SQLite database with cache limits.
Last-known valid title/favicon survives probe errors and offline transitions.
Automatic metadata never overwrites a user-chosen service name.

Requests without valid HTML, authenticated/SPA-only pages, TLS errors and
unreachable NixOS loopback services may produce no metadata; they do not
indicate a failed TCP listener.

## API and UI

`GET /api/service-registry` and detail responses include saved title,
observed root URL, icon hash and metadata fetch time when available.
`GET /api/service-registry/icons/:hash` serves authenticated, same-origin
cached raster images with `nosniff` and restrictive CSP. History shows the
actual title and favicon when present, otherwise retains safe existing
fallbacks. The observed URL need not be reachable from a different browser
host: it describes the backend probe target.

## Validation

Jest fixtures exercise real local HTML/title/favicons, relative and fallback
icons, same-origin redirect policy, invalid hosts, MIME confusion, large
responses, TLS errors, cache preservation and worker backoff/concurrency.
Native AMD64/ARM64 image/browser contracts should also run on the final
upstream PR head. History and Pinned show sanitized discovery capabilities, including safe HTTP
mode, last attempt/success and last successfully cached favicon timestamp.

## Dashboard discovery support

Expand the **Discovery capabilities** section in History/Pinned to inspect
HTTP and Docker readiness independently. The status intentionally does not
expose a Docker socket URL, credentials, private bridge gateway or raw error.
A local icon may be absent when an editor requires login, redirects to a
different origin or only serves a favicon behind a route prefix. The UI then
shows a generic terminal/editor glyph rather than a falsely verified logo.

The hostname/IP in an observed root URL is the backend's probe target and may
not be usable from a remote browser. For host-loopback-only NixOS services,
consider a native deployment or narrowly configured local access, never a
publicly exposed Docker socket or blanket firewall exception.
