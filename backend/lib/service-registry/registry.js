'use strict';

const { randomUUID } = require('node:crypto');
const { migrateRegistrySchema } = require('./schema');
const { normalizeObservation, validServerId, normalizePort } = require('./identity');

function toService(row) {
  if (!row) return null;
  return {
    id: row.id,
    serverId: row.server_id,
    displayName: row.display_name,
    source: row.source,
    identityConfidence: row.identity_confidence,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    status: row.status,
    endpointCount: row.endpoint_count === undefined ? undefined : row.endpoint_count,
    previewHostIp: row.preview_host_ip ?? undefined,
    previewPort: row.preview_port ?? undefined,
    previewProtocol: row.preview_protocol ?? undefined,
  };
}

function toEndpoint(row) {
  return {
    id: row.id,
    hostIp: row.host_ip,
    hostPort: row.host_port,
    protocol: row.protocol,
    internal: Boolean(row.internal),
    source: row.source,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

function boundedInteger(value, name, fallback, maximum, minimum = 0) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new TypeError('Invalid ' + name);
  }
  if (!/^(0|[1-9]\d*)$/.test(String(value))) throw new TypeError('Invalid ' + name);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError('Invalid ' + name);
  }
  return parsed;
}

/**
 * Persistent registry DAO. An observation is not an authoritative full scan:
 * it can add/update evidence but cannot conclude that other listeners died.
 * Reconciliation and definitive offline states belong to the scanner PR.
 */
function createServiceRegistry(db) {
  migrateRegistrySchema(db);

  const findIdentity = db.prepare(
    'SELECT id, status FROM registry_services ' +
    'WHERE server_id = ? AND identity_key = ? ' +
    'ORDER BY last_seen_at DESC, id DESC LIMIT 1'
  );
  // Candidate records can be reused when inactive, or when a COMPLETE
  // snapshot proves their previous process disappeared between scans.
  const findLogicalCandidates = db.prepare(
    'SELECT id, status, identity_key FROM registry_services ' +
    'WHERE server_id = ? AND source = ? AND logical_identity_key = ? ' +
    'ORDER BY last_seen_at DESC, id DESC'
  );
  const findWeakEndpoint = db.prepare(
    'SELECT s.id, s.status FROM registry_services s ' +
    'JOIN registry_endpoints e ON e.service_id = s.id ' +
    'WHERE s.server_id = ? AND s.identity_key IS NULL ' +
    'AND e.host_ip = ? AND e.host_port = ? AND e.protocol = ? ' +
    'AND e.internal = ? AND e.source = ? ' +
    'ORDER BY e.last_seen_at DESC, s.id DESC LIMIT 1'
  );
  const insertService = db.prepare(
    'INSERT INTO registry_services ' +
    '(id, server_id, identity_key, identity_confidence, logical_identity_key, display_name, source, ' +
    'first_seen_at, last_seen_at, status, created_at, updated_at) ' +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'listening', ?, ?)"
  );
  const touchService = db.prepare(
    'UPDATE registry_services SET ' +
    'last_seen_at = MAX(last_seen_at, ?), ' +
    "status = CASE WHEN ? >= last_seen_at THEN 'listening' ELSE status END, " +
    'updated_at = MAX(updated_at, ?), ' +
    'identity_key = COALESCE(?, identity_key), ' +
    'logical_identity_key = COALESCE(logical_identity_key, ?), ' +
    "identity_confidence = CASE WHEN ? = 'verified' THEN 'verified' ELSE identity_confidence END " +
    'WHERE id = ?'
  );
  const touchRun = db.prepare(
    'INSERT INTO registry_process_runs (service_id, run_key, first_seen_at, last_seen_at) ' +
    'VALUES (?, ?, ?, ?) ON CONFLICT(service_id, run_key) DO UPDATE SET ' +
    'last_seen_at = MAX(registry_process_runs.last_seen_at, excluded.last_seen_at)'
  );
  const touchEndpoint = db.prepare(
    'INSERT INTO registry_endpoints ' +
    '(id, service_id, host_ip, host_port, protocol, internal, source, first_seen_at, last_seen_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(service_id, host_ip, host_port, protocol, internal, source) ' +
    'DO UPDATE SET last_seen_at = MAX(registry_endpoints.last_seen_at, excluded.last_seen_at)'
  );

  const insertObservation = db.transaction((raw, options) => {
    const serverId = options.serverId === undefined ? 'local' : options.serverId;
    const at = options.at === undefined ? Date.now() : options.at;
    const startNewEpisode = options.startNewEpisode === true;
    if (!Number.isSafeInteger(at) || at < 0) throw new TypeError('Invalid observation timestamp');

    const item = normalizeObservation(raw, serverId);
    let existing = null;

    // Once a reliable identity is known, multiple endpoints may share a service.
    // The current keys are only provisional, so a scanner may request a new
    // episode on a known absence, reboot or conflicting attribution.
    if (!startNewEpisode && item.identityKey) {
      existing = findIdentity.get(item.serverId, item.identityKey);
    } else if (!startNewEpisode && !item.identityKey) {
      existing = findWeakEndpoint.get(
        item.serverId, item.hostIp, item.hostPort, item.protocol,
        item.internal, item.source
      );
    }

    // Without logical evidence, preserve the old conservative episode split.
    if (existing?.status === 'offline' && item.source !== 'docker' && !item.logicalKey) {
      existing = null;
    }
    if (!existing && item.logicalKey) {
      const candidates = findLogicalCandidates.all(item.serverId, item.source, item.logicalKey);
      existing = candidates.find(candidate =>
        candidate.status !== 'listening' ||
        (options.allowActiveReuse === true &&
          options.currentProcessKeys instanceof Set &&
          candidate.identity_key &&
          !options.currentProcessKeys.has(candidate.identity_key))
      ) || null;
    }

    const serviceId = existing ? existing.id : randomUUID();
    if (existing) {
      touchService.run(at, at, at, item.identityKey, item.logicalKey,
        item.identityConfidence, serviceId);
    } else {
      insertService.run(
        serviceId, item.serverId, item.identityKey, item.identityConfidence,
        item.logicalKey, item.displayName, item.source, at, at, at, at
      );
    }
    if (item.source === 'system' && item.identityKey && item.identityConfidence !== 'uncertain') {
      touchRun.run(serviceId, item.identityKey, at, at);
    }
    touchEndpoint.run(
      randomUUID(), serviceId, item.hostIp, item.hostPort, item.protocol,
      item.internal, item.source, at, at
    );
    return serviceId;
  });

  const getById = db.prepare('SELECT * FROM registry_services WHERE id = ?');
  const countRuns = db.prepare(
    'SELECT COUNT(*) AS count FROM registry_process_runs WHERE service_id = ?'
  );
  const getEndpoints = db.prepare(
    'SELECT * FROM registry_endpoints WHERE service_id = ? ' +
    'ORDER BY last_seen_at DESC, host_port ASC'
  );

  function getService(id) {
    if (typeof id !== 'string' || id.length > 128) throw new TypeError('Invalid service ID');
    const row = getById.get(id);
    return row ? { ...toService(row), runCount: countRuns.get(id).count,
      endpoints: getEndpoints.all(id).map(toEndpoint) } : null;
  }

  function listServices(filters = {}) {
    const limit = boundedInteger(filters.limit, 'limit', 50, 100, 1);
    const offset = boundedInteger(filters.offset, 'offset', 0, 1000000);
    const serverId = filters.serverId === undefined ? 'local' : filters.serverId;
    if (!validServerId(serverId)) throw new TypeError('Invalid server ID');

    const clauses = ['s.server_id = ?'];
    const params = [serverId];
    if (filters.status !== undefined) {
      if (!['unknown', 'listening', 'offline'].includes(filters.status)) {
        throw new TypeError('Invalid status');
      }
      clauses.push('s.status = ?');
      params.push(filters.status);
    }
    if (filters.source !== undefined) {
      if (typeof filters.source !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(filters.source)) {
        throw new TypeError('Invalid source');
      }
      clauses.push('s.source = ?');
      params.push(filters.source);
    }
    if (filters.search !== undefined) {
      if (typeof filters.search !== 'string' || filters.search.length > 100) {
        throw new TypeError('Invalid search');
      }
      // Escape LIKE metacharacters so a search is literal and bounded.
      const term = filters.search.replace(/[\\%_]/g, '\\$&');
      clauses.push("s.display_name LIKE ? ESCAPE '\\'");
      params.push('%' + term + '%');
    }
    if (filters.seenSince !== undefined) {
      const since = boundedInteger(filters.seenSince, 'seenSince', 0, 8640000000000000);
      clauses.push('s.last_seen_at >= ?');
      params.push(since);
    }
    if (filters.port !== undefined) {
      const port = normalizePort(filters.port);
      clauses.push('EXISTS (SELECT 1 FROM registry_endpoints e ' +
        'WHERE e.service_id = s.id AND e.host_port = ?)');
      params.push(port);
    }

    if (filters.portPrefix !== undefined) {
      if (filters.port !== undefined) throw new TypeError('Specify port or portPrefix');
      const prefix = String(filters.portPrefix);
      if (!/^[1-9][0-9]{0,4}$/.test(prefix) || Number(prefix) > 65535) {
        throw new TypeError('Invalid portPrefix');
      }
      // Numeric ranges preserve port-prefix semantics without a full-table
      // CAST(host_port AS TEXT), and continue using the endpoint port index.
      const ranges = [];
      for (let scale = 1, digits = prefix.length; digits <= 5; scale *= 10, digits += 1) {
        const from = Number(prefix) * scale;
        const to = Math.min((Number(prefix) + 1) * scale - 1, 65535);
        if (from > 65535) break;
        ranges.push('(e.host_port BETWEEN ? AND ?)');
        params.push(from, to);
      }
      clauses.push('EXISTS (SELECT 1 FROM registry_endpoints e ' +
        'WHERE e.service_id = s.id AND (' + ranges.join(' OR ') + '))');
    }

    const where = ' WHERE ' + clauses.join(' AND ');
    const count = db.prepare('SELECT COUNT(*) AS total FROM registry_services s' + where)
      .get(...params).total;
    const items = db.prepare(
      'SELECT s.*, (SELECT COUNT(*) FROM registry_endpoints e ' +
      'WHERE e.service_id = s.id) AS endpoint_count, ' +
      '(SELECT e.host_ip FROM registry_endpoints e WHERE e.service_id = s.id ' +
      'ORDER BY e.last_seen_at DESC, e.id LIMIT 1) AS preview_host_ip, ' +
      '(SELECT e.host_port FROM registry_endpoints e WHERE e.service_id = s.id ' +
      'ORDER BY e.last_seen_at DESC, e.id LIMIT 1) AS preview_port, ' +
      '(SELECT e.protocol FROM registry_endpoints e WHERE e.service_id = s.id ' +
      'ORDER BY e.last_seen_at DESC, e.id LIMIT 1) AS preview_protocol ' +
      'FROM registry_services s' + where +
      ' ORDER BY s.last_seen_at DESC, s.id ASC LIMIT ? OFFSET ?'
    ).all(...params, limit, offset).map(toService);

    return { items, total: count, limit, offset };
  }

  const forgetOne = db.transaction((id) => {
    const found = getById.get(id);
    if (!found) return false;
    db.prepare('DELETE FROM registry_process_runs WHERE service_id = ?').run(id);
    db.prepare('DELETE FROM registry_recovery_notes WHERE service_id = ?').run(id);
    db.prepare('DELETE FROM registry_docker_provenance WHERE service_id = ?').run(id);
    db.prepare('DELETE FROM registry_linux_provenance WHERE service_id = ?').run(id);
    db.prepare('DELETE FROM registry_http_metadata WHERE service_id = ?').run(id);
    db.prepare('DELETE FROM registry_endpoints WHERE service_id = ?').run(id);
    db.prepare('DELETE FROM registry_services WHERE id = ?').run(id);
    return true;
  });

  function forgetService(id) {
    if (typeof id !== 'string' || id.length > 128) throw new TypeError('Invalid service ID');
    return forgetOne(id);
  }

  function markStale(serverId = 'local') {
    if (!validServerId(serverId)) throw new TypeError('Invalid server ID');
    return db.prepare(
      "UPDATE registry_services SET status = 'unknown' " +
      "WHERE server_id = ? AND status = 'listening'"
    ).run(serverId).changes;
  }

  const scanRows = db.prepare(
    'SELECT server_id, source, last_attempt_at, last_success_at, outcome, error_code ' +
    'FROM registry_scan_state WHERE server_id = ? ORDER BY source'
  );

  function getScanStatus(serverId = 'local') {
    if (!validServerId(serverId)) throw new TypeError('Invalid server ID');
    return scanRows.all(serverId).map(row => ({
      source: row.source,
      lastAttemptAt: row.last_attempt_at,
      lastSuccessAt: row.last_success_at,
      outcome: row.outcome,
      errorCode: row.error_code,
    }));
  }

  const saveScan = db.prepare(
    'INSERT INTO registry_scan_state ' +
    '(server_id, source, last_attempt_at, last_success_at, outcome, error_code) ' +
    'VALUES (?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(server_id, source) DO UPDATE SET ' +
    'last_attempt_at = MAX(registry_scan_state.last_attempt_at, excluded.last_attempt_at), ' +
    "last_success_at = CASE WHEN excluded.outcome = 'complete' " +
    'THEN MAX(COALESCE(registry_scan_state.last_success_at, 0), excluded.last_attempt_at) ' +
    'ELSE registry_scan_state.last_success_at END, ' +
    'outcome = excluded.outcome, error_code = excluded.error_code'
  );

  /**
   * A snapshot is complete only for its single source. Missing observations
   * from a different source must NEVER be marked offline.
   */
  const reconcile = db.transaction(({ serverId = 'local', source, rows = [],
    complete = false, at = Date.now(), errorCode = null, onObservation = null }) => {
    if (!validServerId(serverId)) throw new TypeError('Invalid server ID');
    if (!['system', 'docker'].includes(source)) throw new TypeError('Invalid scan source');
    if (!Array.isArray(rows) || rows.length > 4096) throw new TypeError('Invalid scan rows');
    if (!Number.isSafeInteger(at) || at < 0) throw new TypeError('Invalid scan timestamp');
    if (errorCode !== null && (typeof errorCode !== 'string' ||
        !/^[a-z][a-z0-9_]{0,63}$/.test(errorCode))) {
      throw new TypeError('Invalid scan error code');
    }

    // Build the process fingerprint set before reconciling individual rows.
    // This prevents two concurrently listening workers with the same
    // executable/cwd from being folded into one logical record.
    const items = rows.map(row => normalizeObservation(row, serverId));
    const currentProcessKeys = new Set(items.map(item => item.identityKey).filter(Boolean));
    const observed = new Set();
    for (const row of rows) {
      const item = normalizeObservation(row, serverId);
      if (item.source !== source || item.protocol !== 'tcp' || item.internal) {
        throw new TypeError('Snapshot contains out-of-scope listener');
      }
      const serviceId = insertObservation(row, {
        serverId, at,
        allowActiveReuse: complete && source === 'system',
        currentProcessKeys,
      });
      observed.add(serviceId);
      if (onObservation) onObservation(serviceId, row, at);
    }

    // When a source is incomplete, prior listening records become unknown;
    // positive observations above remain listening. Definitive offline
    // requires a successful and complete snapshot for THIS source.
    const status = complete ? 'offline' : 'unknown';
    const ids = [...observed];
    const excluded = ids.length ? ' AND id NOT IN (' + ids.map(() => '?').join(',') + ')' : '';
    db.prepare(
      'UPDATE registry_services SET status = ?, updated_at = MAX(updated_at, ?) ' +
      'WHERE server_id = ? AND source = ?' + excluded
    ).run(status, at, serverId, source, ...ids);

    const outcome = complete ? 'complete' : (rows.length ? 'partial' : 'failed');
    saveScan.run(serverId, source, at, complete ? at : null, outcome, errorCode);
    return { source, outcome, count: ids.length, at };
  });

  return {
    observe: (row, options = {}) => getService(insertObservation(row, options)),
    getService,
    listServices,
    forgetService,
    markStale,
    getScanStatus,
    reconcileSource: (snapshot) => reconcile(snapshot),
  };
}

module.exports = { createServiceRegistry, boundedInteger };
