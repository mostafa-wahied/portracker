'use strict';

const { safeName, safePath } = require('./docker-provenance');

const IMAGE = /^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,255}(?:@sha256:[a-f0-9]{64})?$/;
const NETWORK = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/;

function normalizeEvidence(value) {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid Docker provenance');
  const project = safeName(value.composeProject);
  const service = safeName(value.composeService);
  const compose = Boolean(project && service);
  const hostFingerprint = typeof value.hostFingerprint === 'string' &&
    /^[a-f0-9]{64}$/.test(value.hostFingerprint) ? value.hostFingerprint : null;
  const id = typeof value.containerId === 'string' && /^[a-f0-9]{12,64}$/i.test(value.containerId)
    ? value.containerId.toLowerCase() : null;
  const name = safeName(value.containerName);
  const image = typeof value.image === 'string' && IMAGE.test(value.image) ? value.image : null;
  const net = typeof value.networkMode === 'string' && NETWORK.test(value.networkMode)
    ? value.networkMode : null;
  const files = Array.isArray(value.configFilePaths) && value.configFilePaths.length <= 8 &&
    value.configFilePaths.every(file => safePath(file))
    ? value.configFilePaths.map(file => file.slice(0, 1024)) : [];
  const workingDir = compose ? safePath(value.projectWorkingDir) : null;
  return {
    hostFingerprint, containerId: id, containerName: name,
    image, networkMode: net,
    composeProject: compose ? project : null,
    composeService: compose ? service : null,
    projectWorkingDir: workingDir,
    configFilePaths: compose ? files : [],
    pathScope: 'docker-host',
    identityConfidence: compose && hostFingerprint ? 'verified' : 'provisional',
  };
}

function createDockerProvenanceStore(db) {
  const save = db.prepare(
    'INSERT INTO registry_docker_provenance ' +
    '(service_id, daemon_fingerprint, container_id, container_name, image, ' +
    'network_mode, compose_project, compose_service, project_working_dir, ' +
    'config_files_json, path_scope, identity_confidence, captured_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(service_id) DO UPDATE SET ' +
    'daemon_fingerprint = COALESCE(excluded.daemon_fingerprint, registry_docker_provenance.daemon_fingerprint), ' +
    'container_id = excluded.container_id, ' +
    'container_name = COALESCE(excluded.container_name, registry_docker_provenance.container_name), ' +
    'image = COALESCE(excluded.image, registry_docker_provenance.image), ' +
    'network_mode = COALESCE(excluded.network_mode, registry_docker_provenance.network_mode), ' +
    'compose_project = COALESCE(excluded.compose_project, registry_docker_provenance.compose_project), ' +
    'compose_service = COALESCE(excluded.compose_service, registry_docker_provenance.compose_service), ' +
    'project_working_dir = COALESCE(excluded.project_working_dir, registry_docker_provenance.project_working_dir), ' +
    "config_files_json = CASE WHEN excluded.config_files_json = '[]' " +
    'THEN registry_docker_provenance.config_files_json ELSE excluded.config_files_json END, ' +
    'path_scope = excluded.path_scope, ' +
    'identity_confidence = excluded.identity_confidence, ' +
    'captured_at = excluded.captured_at ' +
    'WHERE excluded.captured_at >= registry_docker_provenance.captured_at'
  );
  const lookup = db.prepare(
    'SELECT daemon_fingerprint, container_id, container_name, image, network_mode, ' +
    'compose_project, compose_service, project_working_dir, config_files_json, ' +
    'path_scope, identity_confidence, captured_at ' +
    'FROM registry_docker_provenance WHERE service_id = ?'
  );

  function record(serviceId, evidence, at = Date.now()) {
    if (typeof serviceId !== 'string' || serviceId.length > 128 ||
        !Number.isSafeInteger(at) || at < 0) throw new TypeError('Invalid Docker provenance target');
    const entry = normalizeEvidence(evidence);
    save.run(serviceId, entry.hostFingerprint, entry.containerId, entry.containerName,
      entry.image, entry.networkMode, entry.composeProject, entry.composeService,
      entry.projectWorkingDir, JSON.stringify(entry.configFilePaths),
      entry.pathScope, entry.identityConfidence, at);
  }

  function get(serviceId) {
    if (typeof serviceId !== 'string' || serviceId.length > 128) return null;
    const row = lookup.get(serviceId);
    if (!row) return null;
    return {
      hostFingerprint: row.daemon_fingerprint,
      containerId: row.container_id, containerName: row.container_name,
      image: row.image, networkMode: row.network_mode,
      composeProject: row.compose_project, composeService: row.compose_service,
      projectWorkingDir: row.project_working_dir,
      configFilePaths: JSON.parse(row.config_files_json),
      pathScope: row.path_scope, identityConfidence: row.identity_confidence,
      capturedAt: row.captured_at,
    };
  }

  return { record, get };
}

module.exports = { createDockerProvenanceStore, normalizeEvidence };
