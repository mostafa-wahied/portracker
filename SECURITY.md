# Security

Report suspected vulnerabilities privately through [GitHub private reporting](https://github.com/mostafa-wahied/portracker/security/advisories/new).
Please include the affected version, deployment configuration, prerequisites and a minimal
reproduction using synthetic data. Do not post credentials or exploit details in public issues.

## Deployment Trust

Authentication is opt-in. With `ENABLE_AUTH` unset or false, reachable clients are trusted
administrators. Do not expose that mode to untrusted networks. Enable authentication and
use network access controls for shared or remotely reachable deployments.

HTTP peer connections remain supported. HTTP does not encrypt peer keys or responses;
prefer HTTPS or a suitably protected encrypted network. HTTPS certificate verification
is not disabled. Configure the final peer URL: redirects are not followed. Peer destinations
are validated and their DNS addresses are pinned for each request. Private network addresses
are supported; loopback, link-local and reserved peer destinations are rejected.

Changing a peer address or type clears its saved key unless a replacement is supplied.
Renaming a peer does not clear its key. A compromised configured peer can still receive
credentials intended for that peer; destination validation is not protection against a
compromised trusted endpoint.

## Peer Key Storage And Recovery

Outbound peer keys require reversible storage because Portracker must send them to peers.
They are encrypted with AES-256-GCM and bound to the peer ID and URL. Inbound API keys remain
hashed. Legacy outbound keys are migrated automatically and transactionally when needed.

The default encryption key is a generated 32-byte file named `peer-keys.key` beside the
database. It is created with mode 600. `PEER_KEY_FILE` can specify an absolute path to a
separate persistent key file; the application must be able to read it. Symlinks, malformed
keys and group/world-readable key files are rejected on systems supporting POSIX permissions.

Back up the database and its matching key file together, privately. A complete backup of
the default data directory includes both. If using `PEER_KEY_FILE`, back up that separate
file too. Keep the key across container recreation, host migration and restores.

An encrypted database with a missing, incorrect or unreadable key fails closed at startup.
Restore its original key file and permissions before restarting. Do not generate a new key
over an encrypted database. Contact the maintainer for controlled peer reconfiguration if
the key is irretrievably lost; other database records should not be discarded.

This protects a database-only disclosure, not access to both the database and key or a
compromised host. Older backups can still contain plaintext keys; migration cannot erase
external backups or storage snapshots. Protect or retire them and rotate credentials when
exposure is suspected. Rolling back to a version without encrypted-key support requires a
compatible, protected backup and explicit recovery planning.

## Diagnostics And Request Limits

Raw container diagnostics are opt-in and, with authentication enabled, require a signed-in
user rather than a peer key. Diagnostic APIs omit environment values, commands, arbitrary
labels, health-check output and raw application configuration. Compose grouping and normal
port/VM metadata remain available. Do not deliberately place secrets in display names.
Known health reason codes remain visible; untrusted free-form diagnostic errors are hidden.
For a remote peer that requires a session for raw diagnostics, the details drawer offers
"Open remote server". Sign in there to view or export raw diagnostics. Browser sessions
are not forwarded between instances, and peer keys retain access to standard details only.

Peer responses have a separate default size limit of 8 MiB. `PEER_MAX_RESPONSE_BYTES` accepts
a positive integer byte limit for trusted larger inventories. An oversized response reports
this setting instead of suggesting a bad credential. Keep a finite budget appropriate to
available memory; larger limits increase per-request memory exposure. The autoxpose response
budget is separate and unchanged.

Ping is restricted to the latest server-side discovered inventory, with validated destinations,
bounded responses and no redirects. Refresh discovery after restarting or changing services.
Discovered local services may be checked; this is not an arbitrary network probing API.

Generation defaults to 30 requests per minute per client IP; ping defaults to 6000 to support
large dashboards. `GENERATE_PORT_REQUESTS_PER_MINUTE` and `PING_REQUESTS_PER_MINUTE` accept
positive integer overrides. Excess requests return 429 and `Retry-After`. Limits are per
process and reset at restart. Reverse proxies can cause clients to share the same rate-limit
bucket; size limits for that deployment rather than trusting arbitrary forwarded IP headers.

If credentials may have been exposed, restrict access, update to the relevant fixed release,
rotate affected credentials in their owning services and review their access logs. A passing
test or an upgrade does not establish whether a past compromise occurred.