'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');

const SOURCE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SERVER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;

function cleanLabel(value, maxLength = 120) {
  if (typeof value !== 'string') return '';
  return Array.from(value, (character) => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  }).join('').trim().slice(0, maxLength);
}

function validServerId(value) {
  return typeof value === 'string' && SERVER_PATTERN.test(value);
}

function normalizeHost(value) {
  if (typeof value !== 'string') throw new TypeError('Invalid socket address');
  let host = value.trim();
  if (host === '*' || host === '[::]' || host === '::') host = host === '*' ? '0.0.0.0' : '::';
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (net.isIP(host) === 0) throw new TypeError('Invalid socket address');
  return host.toLowerCase();
}

function normalizePort(value) {
  if (!Number.isInteger(Number(value)) || !/^\d{1,5}$/.test(String(value))) {
    throw new TypeError('Invalid port number');
  }
  const port = Number(value);
  if (port < 1 || port > 65535) throw new TypeError('Invalid port number');
  return port;
}

function hashedIdentity(material) {
  return crypto.createHash('sha256').update(material).digest('hex');
}

// This is a logical service hint, NOT an assertion that two process
// invocations have identical argv or environment. Unlike a PID fingerprint,
// it survives a restart when trusted cgroup or project evidence matches.
function safeAbsolute(value) {
  return typeof value === 'string' && path.isAbsolute(value) && value.length <= 1024 &&
    !Array.from(value).some(ch => ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127);
}

function computeLogicalIdentity(value, { serverId, hostIp, hostPort, protocol }) {
  if (value.source !== 'system' || !value.provenance ||
      typeof value.provenance !== 'object') return null;
  const info = value.provenance;
  const uid = Number.isSafeInteger(info.uid) && info.uid >= 0 ? info.uid : null;
  const validUnit = typeof info.unitName === 'string' &&
    /^[A-Za-z0-9:_.@-]{1,200}\.service$/.test(info.unitName) &&
    !/^user@[0-9]+\.service$/.test(info.unitName);
  const systemUnit = info.kind === 'systemd_system_service' && info.unitScope === 'system';
  const userUnit = info.kind === 'systemd_user_service' && info.unitScope === 'user';
  if (info.confidence === 'observed' && validUnit &&
      (systemUnit || (userUnit && uid !== null))) {
    return {
      key: hashedIdentity(JSON.stringify([
        'native-systemd-v1', serverId, info.unitScope, userUnit ? uid : null, info.unitName,
      ])),
      confidence: 'verified',
    };
  }

  // Interpreter/executable identity alone is NOT enough: python, node and
  // other executables often host unrelated apps. Include uid + cwd + the
  // exact listening endpoint, and only match an inactive prior record.
  if ((info.kind === 'manual' || info.kind === 'session_scope') &&
      uid !== null && safeAbsolute(info.cwd) && safeAbsolute(info.executablePath)) {
    return {
      key: hashedIdentity(JSON.stringify([
        'native-dev-v1', serverId, uid, info.cwd, info.executablePath,
        hostIp, hostPort, protocol,
      ])),
      confidence: 'provisional',
    };
  }
  return null;
}

/**
 * Normalize *only* safe collector fields. No raw argv, environment, Docker labels,
 * arbitrary platform_data, secrets, mounts or raw inspection objects are stored.
 *
 * Identity here is explicitly provisional: later systemd/Compose collectors will
 * supply stronger evidence. This method does not attempt to prove that an
 * unidentifiable application survived a reboot or reused port.
 */
function normalizeObservation(value, serverId = 'local') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.error) {
    throw new TypeError('Invalid port observation');
  }
  if (!validServerId(serverId)) throw new TypeError('Invalid server ID');

  const hostIp = normalizeHost(value.host_ip);
  const hostPort = normalizePort(value.host_port);
  const protocol = String(value.protocol || 'tcp').toLowerCase();
  if (protocol !== 'tcp' && protocol !== 'udp') throw new TypeError('Invalid protocol');
  const source = typeof value.source === 'string' && SOURCE_PATTERN.test(value.source)
    ? value.source : 'unknown';
  const owner = cleanLabel(value.owner) || 'unknown';
  const pid = Number.isSafeInteger(Number(value.pid)) && Number(value.pid) > 0
    ? Number(value.pid) : null;
  const bootId = typeof value.boot_id === 'string' &&
    /^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(value.boot_id)
    ? value.boot_id.toLowerCase() : null;
  const startTicks = typeof value.process_start_ticks === 'string' &&
    /^[0-9]{1,20}$/.test(value.process_start_ticks) ? value.process_start_ticks : null;
  const composeProject = typeof value.compose_project === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value.compose_project)
    ? value.compose_project : null;
  const composeService = typeof value.compose_service === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value.compose_service)
    ? value.compose_service : null;
  const dockerHostHash = typeof value.docker_host_hash === 'string' &&
    /^[a-f0-9]{64}$/.test(value.docker_host_hash) ? value.docker_host_hash : null;
  const containerId = typeof value.container_id === 'string' &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(value.container_id)
    ? value.container_id : null;

  let identityKey = null;
  let identityConfidence = 'uncertain';

  if (source === 'docker' && dockerHostHash && composeProject && composeService) {
    // Only labels from an inspected container on a *known Docker daemon*
    // qualify as a durable Compose service identity across container IDs.
    identityKey = hashedIdentity('docker-compose:' + dockerHostHash + ':' +
      composeProject + ':' + composeService);
    identityConfidence = 'verified';
  } else if (source === 'docker' && containerId) {
    identityKey = hashedIdentity('docker-container:' +
      (dockerHostHash ? dockerHostHash + ':' : '') + containerId);
    identityConfidence = 'provisional';
  } else if (pid !== null) {
    // Only an observation episode, never a verified identity across host boots.
    identityKey = hashedIdentity('process:' + source + ':' + (bootId || 'boot-unknown') +
      ':' + pid + ':' + (startTicks || 'start-unknown') + ':' + owner);
    identityConfidence = 'provisional';
  } else if (owner !== 'unknown') {
    // Owner text is weak evidence, but distinguishes e.g. nginx from node on
    // the same endpoint. It must not be labelled "verified".
    identityKey = hashedIdentity('owner-endpoint:' + source + ':' + owner + ':' +
      hostIp + ':' + hostPort + ':' + protocol);
  }

  const logical = computeLogicalIdentity(value, { serverId, hostIp, hostPort, protocol });

  return {
    serverId,
    hostIp,
    hostPort,
    protocol,
    source,
    owner,
    internal: value.internal === true ? 1 : 0,
    identityKey,
    identityConfidence: logical?.confidence || identityConfidence,
    logicalKey: logical?.key || null,
    displayName: owner === 'unknown' ? 'Port ' + hostPort : owner,
  };
}

module.exports = { normalizeObservation, computeLogicalIdentity, cleanLabel, validServerId, normalizePort };
