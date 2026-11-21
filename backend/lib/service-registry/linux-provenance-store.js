'use strict';

const path = require('node:path');

const KINDS = new Set([
  'systemd_system_service', 'systemd_user_service',
  'session_scope', 'container', 'manual', 'unknown',
]);
const CONFIDENCES = new Set(['observed', 'inferred', 'unavailable']);
const UNIT = /^[a-zA-Z0-9:_.@-]{1,200}\.service$/;

function safeHostPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 1024) return null;
  return Array.from(value).some(ch => ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127)
    ? null : value;
}

function normalizeEvidence(value) {
  if (!value || !KINDS.has(value.kind) || !CONFIDENCES.has(value.confidence) ||
      !Number.isSafeInteger(value.pid) || value.pid < 1 || value.pid > 4194304 ||
      typeof value.startTicks !== 'string' || !/^[0-9]{1,20}$/.test(value.startTicks)) {
    throw new TypeError('Invalid process provenance');
  }
  const uid = Number.isSafeInteger(value.uid) && value.uid >= 0 ? value.uid : null;
  const unitName = typeof value.unitName === 'string' && UNIT.test(value.unitName)
    ? value.unitName : null;
  const unitScope = unitName && value.kind === 'systemd_system_service' ? 'system' :
    unitName && value.kind === 'systemd_user_service' ? 'user' : null;
  const kind = unitScope ? value.kind :
    value.kind.startsWith('systemd_') ? 'unknown' : value.kind;
  return {
    kind, confidence: unitScope ? 'observed' : value.confidence,
    unitName: unitScope ? unitName : null, unitScope, uid, pid: value.pid,
    startTicks: value.startTicks,
    bootId: typeof value.bootId === 'string' && /^[a-f0-9-]{36}$/i.test(value.bootId)
      ? value.bootId.toLowerCase() : null,
    executablePath: safeHostPath(value.executablePath),
    cwd: safeHostPath(value.cwd),
  };
}

function createLinuxProvenanceStore(db) {
  const save = db.prepare(
    'INSERT INTO registry_linux_provenance ' +
    '(service_id, kind, confidence, unit_name, unit_scope, pid, uid, ' +
    'start_ticks, boot_id, executable_path, cwd, captured_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(service_id) DO UPDATE SET ' +
    'kind = CASE WHEN excluded.confidence = \'unavailable\' THEN registry_linux_provenance.kind ' +
    'ELSE excluded.kind END, ' +
    'confidence = CASE WHEN excluded.confidence = \'unavailable\' THEN registry_linux_provenance.confidence ' +
    'ELSE excluded.confidence END, ' +
    'unit_name = COALESCE(excluded.unit_name, registry_linux_provenance.unit_name), ' +
    'unit_scope = COALESCE(excluded.unit_scope, registry_linux_provenance.unit_scope), ' +
    'pid = excluded.pid, uid = COALESCE(excluded.uid, registry_linux_provenance.uid), ' +
    'start_ticks = excluded.start_ticks, ' +
    'boot_id = COALESCE(excluded.boot_id, registry_linux_provenance.boot_id), ' +
    'executable_path = COALESCE(excluded.executable_path, registry_linux_provenance.executable_path), ' +
    'cwd = COALESCE(excluded.cwd, registry_linux_provenance.cwd), ' +
    'captured_at = excluded.captured_at ' +
    'WHERE excluded.captured_at >= registry_linux_provenance.captured_at'
  );
  const lookup = db.prepare(
    'SELECT kind, confidence, unit_name, unit_scope, pid, uid, start_ticks, ' +
    'boot_id, executable_path, cwd, captured_at ' +
    'FROM registry_linux_provenance WHERE service_id = ?'
  );

  function record(serviceId, evidence, at = Date.now()) {
    if (typeof serviceId !== 'string' || serviceId.length > 128 ||
        !Number.isSafeInteger(at) || at < 0) throw new TypeError('Invalid provenance target');
    const entry = normalizeEvidence(evidence);
    save.run(serviceId, entry.kind, entry.confidence, entry.unitName, entry.unitScope,
      entry.pid, entry.uid, entry.startTicks, entry.bootId,
      entry.executablePath, entry.cwd, at);
  }

  function get(serviceId) {
    if (typeof serviceId !== 'string' || serviceId.length > 128) return null;
    const row = lookup.get(serviceId);
    if (!row) return null;
    return {
      kind: row.kind,
      confidence: row.confidence,
      unitName: row.unit_name,
      unitScope: row.unit_scope,
      pid: row.pid,
      uid: row.uid,
      processStartTicks: row.start_ticks,
      bootId: row.boot_id,
      executablePath: row.executable_path,
      cwd: row.cwd,
      capturedAt: row.captured_at,
    };
  }

  return { record, get };
}

module.exports = { createLinuxProvenanceStore, normalizeEvidence };
