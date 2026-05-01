const db = require('../db');

const VALID_ROLES = new Set(['core_runtime', 'core_access', 'support', 'job_expected_exit', 'unknown']);

db.exec(`
  CREATE TABLE IF NOT EXISTS component_overrides (
    server_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    component_id TEXT NOT NULL,
    role TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (server_id, component_id)
  );
`);

const stmtUpsert = db.prepare(`
  INSERT INTO component_overrides (server_id, service_id, component_id, role, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(server_id, component_id) DO UPDATE SET
    service_id = excluded.service_id,
    role = excluded.role,
    updated_at = excluded.updated_at
`);

const stmtDeleteOne = db.prepare(`
  DELETE FROM component_overrides WHERE server_id = ? AND component_id = ?
`);

const stmtDeleteForService = db.prepare(`
  DELETE FROM component_overrides WHERE server_id = ? AND service_id = ?
`);

const stmtDeleteForServer = db.prepare(`
  DELETE FROM component_overrides WHERE server_id = ?
`);

const stmtListForServer = db.prepare(`
  SELECT service_id, component_id, role, updated_at FROM component_overrides WHERE server_id = ?
`);

function isValidRole(role) {
  return typeof role === 'string' && VALID_ROLES.has(role);
}

function setOverride(serverId, serviceId, componentId, role) {
  if (!serverId || !serviceId || !componentId || !isValidRole(role)) return false;
  stmtUpsert.run(String(serverId), String(serviceId), String(componentId), role, Date.now());
  return true;
}

function clearOverride(serverId, componentId) {
  if (!serverId || !componentId) return 0;
  return stmtDeleteOne.run(String(serverId), String(componentId)).changes;
}

function clearAllForService(serverId, serviceId) {
  if (!serverId || !serviceId) return 0;
  return stmtDeleteForService.run(String(serverId), String(serviceId)).changes;
}

function clearAllForServer(serverId) {
  if (!serverId) return 0;
  return stmtDeleteForServer.run(String(serverId)).changes;
}

function getOverridesForServer(serverId) {
  if (!serverId) return {};
  const rows = stmtListForServer.all(String(serverId));
  const out = {};
  rows.forEach((r) => { out[r.component_id] = r.role; });
  return out;
}

function listOverridesForServer(serverId) {
  if (!serverId) return [];
  return stmtListForServer.all(String(serverId));
}

module.exports = {
  VALID_ROLES,
  isValidRole,
  setOverride,
  clearOverride,
  clearAllForService,
  clearAllForServer,
  getOverridesForServer,
  listOverridesForServer,
};
