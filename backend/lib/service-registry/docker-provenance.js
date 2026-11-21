'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const IMAGE = /^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,255}(?:@sha256:[a-f0-9]{64})?$/;
const NETWORK = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/;
const CONTAINER_ID = /^[a-fA-F0-9]{12,64}$/;

function safePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 1024) return null;
  return Array.from(value).some(ch => ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127)
    ? null : value;
}

function safeName(value) {
  return typeof value === 'string' && NAME.test(value) ? value : null;
}

function daemonFingerprint(systemInfo) {
  // Only the daemon's unique ID, not connection URLs, auth or its full info.
  const id = systemInfo?.ID;
  return typeof id === 'string' && /^[a-zA-Z0-9:-]{12,256}$/.test(id)
    ? crypto.createHash('sha256').update('docker-daemon:' + id).digest('hex') : null;
}

function configFilePaths(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) return [];
  const paths = raw.split(',').map(item => item.trim());
  if (paths.length > 8 || paths.some(item => !safePath(item))) return [];
  return paths;
}

/**
 * Only whitelisted inspect fields. Never preserve arbitrary Config.Labels,
 * Env, Mounts, HostConfig, Command, Entrypoint or inspection JSON.
 */
function extractDockerProvenance(container, inspect, fingerprint = null) {
  if (!inspect || typeof inspect !== 'object') throw new TypeError('Invalid Docker inspection');
  const labels = inspect.Config?.Labels || {};
  const project = safeName(labels['com.docker.compose.project']);
  const service = safeName(labels['com.docker.compose.service']);
  const compose = Boolean(project && service);
  const containerId = typeof inspect.Id === 'string' && CONTAINER_ID.test(inspect.Id)
    ? inspect.Id.toLowerCase() : typeof container?.ID === 'string' && CONTAINER_ID.test(container.ID)
      ? container.ID.toLowerCase() : null;
  const rawName = String(inspect.Name || container?.Names || '').split(',')[0].replace(/^\/+/, '');
  const name = safeName(rawName);
  const rawImage = inspect.Config?.Image || container?.Image;
  const image = typeof rawImage === 'string' && IMAGE.test(rawImage) ? rawImage : null;
  const network = inspect.HostConfig?.NetworkMode;
  const networkMode = typeof network === 'string' && NETWORK.test(network) ? network : null;
  const workingDir = safePath(labels['com.docker.compose.project.working_dir']);
  const files = configFilePaths(labels['com.docker.compose.project.config_files']);
  const hostFingerprint = typeof fingerprint === 'string' && /^[a-f0-9]{64}$/.test(fingerprint)
    ? fingerprint : null;
  return {
    containerId, containerName: name, image, networkMode,
    composeProject: compose ? project : null,
    composeService: compose ? service : null,
    projectWorkingDir: compose ? workingDir : null,
    configFilePaths: compose ? files : [],
    pathScope: 'docker-host', hostFingerprint,
    identityConfidence: compose && hostFingerprint ? 'verified' : 'provisional',
  };
}

function readDockerProvenanceConfig(env = process.env) {
  const requested = env.SERVICE_REGISTRY_DOCKER_PROVENANCE_ENABLED === 'true';
  const authenticated = env.ENABLE_AUTH === 'true';
  return { enabled: requested && authenticated, requiresAuth: requested && !authenticated };
}

module.exports = {
  safeName, safePath, daemonFingerprint, extractDockerProvenance, configFilePaths,
  readDockerProvenanceConfig,
};
