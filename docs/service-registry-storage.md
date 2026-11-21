# Persistent service registry: storage foundation (upstream issue #132)

The storage and authenticated read-only history API underpin opt-in background discovery.
See [Background service discovery](service-registry-scanner.md) for scan configuration,
source completeness, and offline/unknown behavior. Existing live port-monitoring
endpoints are unchanged.

## Data model

The schema is isolated from Portracker's existing `notes`, `ignores`, and
`custom_service_names` tables.

- `registry_services`: opaque service/episode ID, server scope, provisional
  identity fingerprint, confidence, display name, source, first/last seen, status.
- `registry_endpoints`: service-linked IP address, port, protocol,
  internal/published flag, observation source, first/last seen.
- `registry_schema_versions`: idempotent migration tracking.

This design deliberately keeps an application identity separate from its ports.
A process may bind multiple ports, and unrelated applications may reuse one
port. The first version uses available container IDs, process IDs and owner
names as **provisional evidence**, not verified durable identities. More durable systemd/Compose attribution is tracked in upstream issue #135.

Unknown-identity observations may have to be divided into distinct episodes
after a verified absence. The scanner uses this mechanism to separate episodes. If two unrelated processes
present exactly the same available evidence without an observed absence,
Portracker cannot prove they were different.

## Authenticated API

- `GET /api/service-registry?limit=50&offset=0&serverId=local`: paginated
  historical records. Optional filters: `status`, `search`, `port`, `source`.
- `GET /api/service-registry/:id`: saved service and historical endpoints.
- `DELETE /api/service-registry/:id`: explicitly forget a history record,
  without stopping any process or deleting legacy notes.

The history API uses Portracker's existing `requireAuth` rules. When
`ENABLE_AUTH=true`, a signed-in session is required to read or forget history.
When authentication is globally disabled, these routes are also accessible
to anyone who can reach the dashboard: bind the dashboard to localhost or
enable authentication before using future sensitive-provenance features.

A schema migration failure makes the registry API return 503 while allowing
the existing live monitor to continue. No existing service history is
automatically purged due to port closure.

## Testing

`npm test -- --runInBand` includes registry DAO and HTTP route tests:
migration, idempotency, multiple endpoints, port reuse, uncertain identity,
file-backed reopen, filters/pagination, explicit deletion, input validation,
secrets not being stored, and auth enforcement.

Background collection and source-scoped offline/unknown reconciliation are implemented
in this contribution; see `service-registry-scanner.md`. Follow-up upstream issues:
#133 (historical UI), #134 (HTTP title/favicon), #135 (provenance),
and #136 (recovery instructions).
