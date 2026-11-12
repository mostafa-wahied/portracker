'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const LISTEN_STATE = '0A';

function defaultProcRoots() {
  return [process.env.HOST_PROC, '/host/proc', '/proc'].filter(Boolean);
}

async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (_err) {
    return null;
  }
}

function listeningPorts(text) {
  if (typeof text !== 'string') return null;
  const [header, ...lines] = text.trim().split('\n');
  if (!/\blocal_address\b/.test(header) || !/\bst\b/.test(header)) return null;
  const ports = new Set();
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4 || !/^[a-f0-9]{2}$/i.test(parts[3])) return null;
    if (parts[3] !== LISTEN_STATE) continue;
    const portHex = String(parts[1]).split(':')[1];
    if (!/^[a-f0-9]{4}$/i.test(portHex || '')) return null;
    const port = parseInt(portHex, 16);
    if (port <= 0) return null;
    ports.add(port);
  }
  return ports;
}

async function containerListeners(inspection, procRoots) {
  const pid = inspection && inspection.State ? inspection.State.Pid : null;
  const id = inspection && typeof inspection.Id === 'string' ? inspection.Id : '';
  if (!Number.isInteger(pid) || pid <= 0 || !/^[a-f0-9]{64}$/.test(id)) return null;
  const roots = Array.isArray(procRoots) && procRoots.length > 0 ? procRoots : defaultProcRoots();
  for (const root of roots) {
    const base = path.join(root, String(pid));
    const cgroup = await readText(path.join(base, 'cgroup'));
    if (!cgroup || !cgroup.includes(id)) continue;
    const tables = await Promise.all(['tcp', 'tcp6'].map((name) => readText(path.join(base, 'net', name))));
    const parsed = tables.map(listeningPorts);
    if (parsed.some((ports) => ports === null)) continue;
    if (await readText(path.join(base, 'cgroup')) !== cgroup) continue;
    return new Set(parsed.flatMap((ports) => [...ports]));
  }
  return null;
}

function normalizedHost(value) {
  return String(value || '0.0.0.0').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function publishedContainerPort(inspection, hostPort, protocol, hostIp) {
  if (!inspection || !Number.isInteger(hostPort)) return null;
  const mode = String((inspection.HostConfig && inspection.HostConfig.NetworkMode) || '').toLowerCase();
  if (mode === 'host') return hostPort;
  const bindings = (inspection.NetworkSettings && inspection.NetworkSettings.Ports) || {};
  const matches = new Set();
  for (const [spec, hosts] of Object.entries(bindings)) {
    const [containerPort, proto] = String(spec).split('/');
    if ((proto || 'tcp').toLowerCase() !== protocol || !Array.isArray(hosts)) continue;
    const matched = hosts.some((binding) => binding && Number(binding.HostPort) === hostPort
      && (hostIp == null || normalizedHost(binding.HostIp) === normalizedHost(hostIp)));
    const parsed = Number(containerPort);
    if (matched && Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) matches.add(parsed);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

module.exports = { containerListeners, publishedContainerPort, listeningPorts };
