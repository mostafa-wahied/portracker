'use strict';

/**
 * Separate opt-in history schema: leaves legacy notes, custom names and
 * ignores untouched (those tables are keyed by endpoint, not app identity).
 */
function migrateRegistrySchema(db) {
  const migrate = db.transaction(() => {
    db.exec([
      'CREATE TABLE IF NOT EXISTS registry_schema_versions (',
      '  version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL',
      ');',
      'CREATE TABLE IF NOT EXISTS registry_services (',
      '  id TEXT PRIMARY KEY,',
      '  server_id TEXT NOT NULL,',
      '  identity_key TEXT,',
      "  identity_confidence TEXT NOT NULL CHECK (identity_confidence IN ('provisional','uncertain','verified')),",
      '  display_name TEXT NOT NULL,',
      '  source TEXT NOT NULL,',
      '  first_seen_at INTEGER NOT NULL,',
      '  last_seen_at INTEGER NOT NULL,',
      "  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown','listening','offline')),",
      '  created_at INTEGER NOT NULL,',
      '  updated_at INTEGER NOT NULL',
      ');',
      'CREATE INDEX IF NOT EXISTS idx_registry_services_recent',
      '  ON registry_services (server_id, last_seen_at DESC, id);',
      'CREATE INDEX IF NOT EXISTS idx_registry_services_identity',
      '  ON registry_services (server_id, identity_key);',
      'CREATE INDEX IF NOT EXISTS idx_registry_services_status',
      '  ON registry_services (status, last_seen_at DESC);',
      'CREATE TABLE IF NOT EXISTS registry_endpoints (',
      '  id TEXT PRIMARY KEY,',
      '  service_id TEXT NOT NULL REFERENCES registry_services(id) ON DELETE CASCADE,',
      '  host_ip TEXT NOT NULL,',
      '  host_port INTEGER NOT NULL CHECK (host_port BETWEEN 1 AND 65535),',
      "  protocol TEXT NOT NULL CHECK (protocol IN ('tcp','udp')),",
      '  internal INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0,1)),',
      '  source TEXT NOT NULL,',
      '  first_seen_at INTEGER NOT NULL,',
      '  last_seen_at INTEGER NOT NULL,',
      '  UNIQUE(service_id, host_ip, host_port, protocol, internal, source)',
      ');',
      'CREATE INDEX IF NOT EXISTS idx_registry_endpoints_locator',
      '  ON registry_endpoints (host_ip, host_port, protocol, source);',
      'CREATE INDEX IF NOT EXISTS idx_registry_endpoints_service',
      '  ON registry_endpoints (service_id, last_seen_at DESC);',
      'CREATE TABLE IF NOT EXISTS registry_icons (',
      '  hash TEXT PRIMARY KEY,',
      '  mime TEXT NOT NULL,',
      '  bytes BLOB NOT NULL,',
      '  created_at INTEGER NOT NULL',
      ');',
      'CREATE TABLE IF NOT EXISTS registry_http_metadata (',
      '  service_id TEXT PRIMARY KEY REFERENCES registry_services(id) ON DELETE CASCADE,',
      '  title TEXT,',
      '  visit_url TEXT,',
      '  icon_hash TEXT REFERENCES registry_icons(hash),',
      '  fetched_at INTEGER,',
      '  last_attempt_at INTEGER NOT NULL,',
      '  error_code TEXT',
      ');',
      'CREATE INDEX IF NOT EXISTS idx_registry_metadata_retry',
      '  ON registry_http_metadata (last_attempt_at, fetched_at);',
      'CREATE TABLE IF NOT EXISTS registry_scan_state (',
      '  server_id TEXT NOT NULL,',
      "  source TEXT NOT NULL CHECK (source IN ('system', 'docker')),",
      '  last_attempt_at INTEGER NOT NULL,',
      '  last_success_at INTEGER,',
      "  outcome TEXT NOT NULL CHECK (outcome IN ('complete', 'partial', 'failed')),",
      '  error_code TEXT,',
      '  PRIMARY KEY (server_id, source)',
      ');',

    ].join('\n'));

    db.prepare('INSERT OR IGNORE INTO registry_schema_versions (version, applied_at) VALUES (?, ?)')
      .run(1, Date.now());
    db.prepare('INSERT OR IGNORE INTO registry_schema_versions (version, applied_at) VALUES (?, ?)')
      .run(2, Date.now());
    db.prepare('INSERT OR IGNORE INTO registry_schema_versions (version, applied_at) VALUES (?, ?)')
      .run(3, Date.now());
  });
  migrate();
}

module.exports = { migrateRegistrySchema };
