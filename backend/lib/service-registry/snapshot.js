'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ProcParser = require('../proc-parser');
const DockerAPIClient = require('../docker-api');

function isDockerized() {
  return fs.existsSync('/.dockerenv');
}

function trustedHostProcRoot() {
  const root = process.env.HOST_PROC;
  return Boolean(root && fs.existsSync(path.join(root, '1', 'net', 'tcp')));
}

/**
 * Only an explicitly complete source snapshot is allowed to transition
 * previously observed listeners to offline.
 *
 * A container's own network namespace is NOT an authoritative scan of its
 * host even when it can see some PIDs. Host /proc must be explicitly mounted.
 */
function readBootId() {
  try {
    return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch { return null; }
}

async function captureHostTcp({
  parser = new ProcParser(),
  dockerized = isDockerized(),
  hostProcTrusted = trustedHostProcRoot(),
} = {}) {
  const rows = await parser.getTcpPorts({ strict: true });
  const bootId = readBootId();
  if (!Array.isArray(rows) || rows.some(row => !row || row.error)) {
    throw new Error('System TCP snapshot returned invalid rows');
  }
  return {
    source: 'system',
    complete: !dockerized || hostProcTrusted,
    rows: rows.map(row => ({
      source: 'system',
      protocol: 'tcp',
      host_ip: row.host_ip,
      host_port: row.host_port,
      owner: row.owner || 'unknown',
      pid: row.pid || null,
      boot_id: bootId,
      internal: false,
    })),
  };
}

async function captureDockerPublished({
  dockerApi = new DockerAPIClient(),
  maxContainers = 500,
  concurrency = 6,
} = {}) {
  const containers = await dockerApi.listContainers();
  if (!Array.isArray(containers) || containers.length > maxContainers) {
    throw new Error('Docker snapshot invalid or exceeds configured limit');
  }

  const rows = [];
  for (let cursor = 0; cursor < containers.length; cursor += concurrency) {
    const batch = containers.slice(cursor, cursor + concurrency);
    const details = await Promise.all(batch.map(async container => {
      if (!container.ID || typeof container.ID !== 'string') {
        throw new Error('Container without a valid identifier');
      }
      const inspect = await dockerApi.inspectContainer(container.ID);
      const mappings = inspect.NetworkSettings?.Ports || {};
      if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
        throw new Error('Malformed Docker port mapping');
      }
      const itemRows = [];
      for (const [containerSocket, bindings] of Object.entries(mappings)) {
        const [port, protocol] = containerSocket.split('/');
        if (protocol !== 'tcp' || bindings === null) continue;
        if (!Array.isArray(bindings)) throw new Error('Malformed Docker port bindings');
        for (const binding of bindings) {
          if (!binding || !binding.HostPort) throw new Error('Malformed Docker host binding');
          itemRows.push({
            source: 'docker',
            protocol: 'tcp',
            host_ip: binding.HostIp || '0.0.0.0',
            host_port: binding.HostPort,
            owner: String(container.Names || inspect.Name || 'unknown').replace(/^\/+/, ''),
            container_id: container.ID,
            internal: false,
          });
        }
        void port;
      }
      return itemRows;
    }));
    for (const entries of details) rows.push(...entries);
  }

  return { source: 'docker', complete: true, rows };
}

module.exports = {
  captureHostTcp,
  captureDockerPublished,
  isDockerized,
  trustedHostProcRoot,
};
