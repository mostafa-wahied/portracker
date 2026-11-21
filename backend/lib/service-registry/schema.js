'use strict';

const { computeLogicalIdentity } = require('./identity');

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
      'CREATE TABLE IF NOT EXISTS registry_recovery_notes (',
      '  service_id TEXT PRIMARY KEY REFERENCES registry_services(id) ON DELETE CASCADE,',
      "  notes TEXT NOT NULL DEFAULT '',",
      '  revision INTEGER NOT NULL DEFAULT 0,',
      '  updated_at INTEGER,',
      '  CHECK (length(notes) <= 4000)',
      ');',
      'CREATE TABLE IF NOT EXISTS registry_docker_provenance (',
      '  service_id TEXT PRIMARY KEY REFERENCES registry_services(id) ON DELETE CASCADE,',
      '  daemon_fingerprint TEXT,',
      '  container_id TEXT,',
      '  container_name TEXT,',
      '  image TEXT,',
      '  network_mode TEXT,',
      '  compose_project TEXT,',
      '  compose_service TEXT,',
      '  project_working_dir TEXT,',
      '  config_files_json TEXT NOT NULL DEFAULT \'[]\',',
      "  path_scope TEXT NOT NULL DEFAULT 'docker-host',",
      "  identity_confidence TEXT NOT NULL CHECK (identity_confidence IN ('verified','provisional')),",
      '  captured_at INTEGER NOT NULL',
      ');',
      'CREATE INDEX IF NOT EXISTS idx_registry_docker_compose',
      '  ON registry_docker_provenance (compose_project, compose_service);',
      'CREATE TABLE IF NOT EXISTS registry_linux_provenance (',
      '  service_id TEXT PRIMARY KEY REFERENCES registry_services(id) ON DELETE CASCADE,',
      "  kind TEXT NOT NULL CHECK (kind IN ('systemd_system_service','systemd_user_service','session_scope','container','manual','unknown')),",
      "  confidence TEXT NOT NULL CHECK (confidence IN ('observed','inferred','unavailable')),",
      "  unit_scope TEXT CHECK (unit_scope IN ('system','user') OR unit_scope IS NULL),",
      '  unit_name TEXT,',
      '  pid INTEGER NOT NULL,',
      '  uid INTEGER,',
      '  start_ticks TEXT NOT NULL,',
      '  boot_id TEXT,',
      '  executable_path TEXT,',
      '  cwd TEXT,',
      '  captured_at INTEGER NOT NULL',
      ');',
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

    // Additive v7: existing databases had no stable logical service key.
    // Never combine or delete old rows during migration; only seed keys from
    // individually recorded, allowlisted provenance.
    const columns = db.prepare('PRAGMA table_info(registry_services)').all();
    if (!columns.some(column => column.name === 'logical_identity_key')) {
      db.exec('ALTER TABLE registry_services ADD COLUMN logical_identity_key TEXT');
    }
    db.exec([
      'CREATE INDEX IF NOT EXISTS idx_registry_services_logical',
      '  ON registry_services (server_id, source, logical_identity_key, status);',
      'CREATE TABLE IF NOT EXISTS registry_process_runs (',
      '  service_id TEXT NOT NULL REFERENCES registry_services(id) ON DELETE CASCADE,',
      '  run_key TEXT NOT NULL,',
      '  first_seen_at INTEGER NOT NULL,',
      '  last_seen_at INTEGER NOT NULL,',
      '  PRIMARY KEY (service_id, run_key)',
      ');',
    ].join('\n'));
    // Preserve historical run evidence from existing provisional process rows.
    db.prepare(
      'INSERT OR IGNORE INTO registry_process_runs ' +
      '(service_id, run_key, first_seen_at, last_seen_at) ' +
      'SELECT id, identity_key, first_seen_at, last_seen_at FROM registry_services ' +
      "WHERE source = 'system' AND identity_confidence = 'provisional' AND identity_key IS NOT NULL"
    ).run();
    const previous = db.prepare(
      'SELECT s.id, s.server_id, p.kind, p.confidence, p.unit_name, p.unit_scope, ' +
      'p.uid, p.cwd, p.executable_path, ' +
      '(SELECT e.host_ip FROM registry_endpoints e WHERE e.service_id = s.id ' +
      'ORDER BY e.last_seen_at DESC LIMIT 1) AS host_ip, ' +
      '(SELECT e.host_port FROM registry_endpoints e WHERE e.service_id = s.id ' +
      'ORDER BY e.last_seen_at DESC LIMIT 1) AS host_port, ' +
      '(SELECT e.protocol FROM registry_endpoints e WHERE e.service_id = s.id ' +
      'ORDER BY e.last_seen_at DESC LIMIT 1) AS protocol ' +
      'FROM registry_services s JOIN registry_linux_provenance p ON p.service_id = s.id ' +
      "WHERE s.source = 'system' AND s.logical_identity_key IS NULL"
    ).all();
    const backfill = db.prepare(
      'UPDATE registry_services SET logical_identity_key = ? WHERE id = ?'
    );
    for (const row of previous) {
      const logical = computeLogicalIdentity({
        source: 'system',
        provenance: {
          kind: row.kind, confidence: row.confidence,
          unitName: row.unit_name, unitScope: row.unit_scope,
          uid: row.uid, cwd: row.cwd, executablePath: row.executable_path,
        },
      }, {
        serverId: row.server_id, hostIp: row.host_ip,
        hostPort: row.host_port, protocol: row.protocol,
      });
      if (logical) backfill.run(logical.key, row.id);
    }

    db.prepare('INSERT OR IGNORE INTO registry_schema_versions (version, applied_at) VALUES (?, ?)')
      .run(1, Date.now());
    db.prepare('INSERT OR IGNORE INTO registry_schema_versions (version, applied_at) VALUES (?, ?)')
      .run(2, Date.now());
    db.prepare('INSERT OR IGNORE INTO registry_schema_versions (version, applied_at) VALUES (?, ?)')
      .run(3, Date.now());
    db.prepare('INSERT OR IGNORE INTO registry_schema_versions (version, applied_at) VALUES (?, ?)')
      .run(4, Date.now());
    db.prepare('INSERT OR IGNORE INTO registry_schema_versions (version, applied_at) VALUES (?, ?)')
      .run(5, Date.now());
    db.prepare('INSERT OR IGNORE INTO registry_schema_versions (version, applied_at) VALUES (?, ?)')
      .run(6, Date.now());
    // Additive v8: preferred one-line startup command is separate from notes.
    // No raw process argv or environment is read to populate these fields.
    const noteColumns = db.prepare('PRAGMA table_info(registry_recovery_notes)').all();
    for (const [name, definition] of [
      ['start_command', "TEXT NOT NULL DEFAULT ''"],
      ['start_cwd', "TEXT NOT NULL DEFAULT ''"],
      ['start_revision', 'INTEGER NOT NULL DEFAULT 0'],
      ['start_updated_at', 'INTEGER'],
    ]) {
      if (!noteColumns.some(column => column.name === name)) {
        db.exec('ALTER TABLE registry_recovery_notes ADD COLUMN ' + name + ' ' + definition);
      }
    }

    db.prepare('INSERT OR IGNORE INTO registry_schema_versions (version, applied_at) VALUES (?, ?)')
      .run(7, Date.now());
    db.prepare('INSERT OR IGNORE INTO registry_schema_versions (version, applied_at) VALUES (?, ?)')
      .run(8, Date.now());
    // Additive v9: favorites belong to the durable service ID, not its port.
    const serviceColumns = db.prepare('PRAGMA table_info(registry_services)').all();
    if (!serviceColumns.some(column => column.name === 'is_pinned')) {
      db.exec('ALTER TABLE registry_services ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0 ' +
        'CHECK (is_pinned IN (0, 1))');
    }
    if (!serviceColumns.some(column => column.name === 'pinned_at')) {
      db.exec('ALTER TABLE registry_services ADD COLUMN pinned_at INTEGER');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_registry_services_pinned ' +
      'ON registry_services (server_id, is_pinned, status, pinned_at DESC)');
    db.prepare('INSERT OR IGNORE INTO registry_schema_versions (version, applied_at) VALUES (?, ?)')
      .run(9, Date.now());
    // Additive v10: source-owned history stays independent. A confirmed host
    // docker-proxy listener can be shown under a single Docker-owned card.
    db.exec([
      'CREATE TABLE IF NOT EXISTS registry_source_links (',
      '  system_service_id TEXT PRIMARY KEY REFERENCES registry_services(id) ON DELETE CASCADE,',
      '  docker_service_id TEXT NOT NULL REFERENCES registry_services(id) ON DELETE CASCADE,',
      '  linked_at INTEGER NOT NULL',
      ');',
      'CREATE INDEX IF NOT EXISTS idx_registry_source_links_docker',
      '  ON registry_source_links (docker_service_id);',
    ].join('\n'));
    db.prepare('INSERT OR IGNORE INTO registry_schema_versions (version, applied_at) VALUES (?, ?)')
      .run(10, Date.now());
  });
  migrate();
}

module.exports = { migrateRegistrySchema };
