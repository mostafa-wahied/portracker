'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const UNIT_NAME = /^[a-zA-Z0-9:_.@-]{1,200}\.service$/;
const SCOPE_NAME = /^[a-zA-Z0-9:_.@-]{1,200}\.scope$/;

function readLinuxProvenanceConfig(env = process.env) {
  const requested = env.SERVICE_REGISTRY_PROVENANCE_ENABLED === 'true';
  const authenticated = env.ENABLE_AUTH === 'true';
  return { enabled: requested && authenticated, requiresAuth: requested && !authenticated };
}

// Field 22 is the 20th token after the closing parenthesis of field 2.
// The process name may contain spaces or parentheses.
function parseStartTicks(stat) {
  if (typeof stat !== 'string') return null;
  const end = stat.lastIndexOf(')');
  if (end < 2 || stat[end + 1] !== ' ') return null;
  const parts = stat.slice(end + 2).trim().split(/\s+/);
  const startTicks = parts[19];
  return startTicks && /^[0-9]{1,20}$/.test(startTicks) ? startTicks : null;
}

function parseUid(status) {
  const match = /^Uid:\s+([0-9]{1,10})\b/m.exec(status || '');
  return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null;
}

function safePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 1024) return null;
  if (Array.from(value).some(ch => ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127)) return null;
  return value;
}

function parseCgroup(text) {
  if (typeof text !== 'string' || text.length > 65536) {
    return { kind: 'unknown', unitName: null, unitScope: null, confidence: 'unavailable' };
  }
  const records = text.split('\n').map(line => {
    const match = /^[0-9]+:([^:]*):(\/.*)$/.exec(line.trim());
    return match && { controllers: match[1], group: match[2] };
  }).filter(Boolean);
  const relevant = records.find(x => x.controllers === '') ||
    records.find(x => x.controllers.split(',').includes('name=systemd'));
  if (!relevant) return { kind: 'manual', unitName: null, unitScope: null, confidence: 'inferred' };
  const parts = relevant.group.split('/').filter(Boolean);
  const container = parts.some(part => /^(docker|libpod|kubepods)(-|\.|$)/i.test(part) ||
    /^cri-containerd-[a-f0-9]{12,}/.test(part) || /^[a-f0-9]{64}$/.test(part));
  if (container) return { kind: 'container', unitName: null, unitScope: null, confidence: 'observed' };
  const user = parts.includes('user.slice');
  const userManager = parts.findIndex(x => /^user@[0-9]+\.service$/.test(x));
  const candidate = user && userManager >= 0 ? parts.slice(userManager + 1) :
    user ? [] : parts;
  const services = candidate.filter(part => UNIT_NAME.test(part));
  const scopes = candidate.filter(part => SCOPE_NAME.test(part));
  const unit = services.at(-1);
  if (unit) return {
    kind: user ? 'systemd_user_service' : 'systemd_system_service',
    unitName: unit,
    unitScope: user ? 'user' : 'system',
    confidence: 'observed',
  };
  if (scopes.length || parts.some(part => SCOPE_NAME.test(part))) {
    return { kind: 'session_scope', unitName: null, unitScope: null, confidence: 'observed' };
  }
  return { kind: 'manual', unitName: null, unitScope: null, confidence: 'inferred' };
}

async function maybeRead(fsp, file) {
  try { return await fsp.readFile(file, 'utf8'); }
  catch { return null; }
}

async function maybeLink(fsp, file) {
  try { return safePath(await fsp.readlink(file)); }
  catch { return null; }
}

// These reads are best effort; process lifetime or permission restrictions
// must not turn an authoritative socket inventory into a failed scan.
async function readLinuxProcessProvenance(pid, {
  procRoot = '/proc', io = fs, bootId = null,
} = {}) {
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 4194304) return null;
  const root = path.join(procRoot, String(pid));
  const first = parseStartTicks(await maybeRead(io, path.join(root, 'stat')));
  if (!first) return null;
  const [status, cgroup, exe, cwd] = await Promise.all([
    maybeRead(io, path.join(root, 'status')),
    maybeRead(io, path.join(root, 'cgroup')),
    maybeLink(io, path.join(root, 'exe')),
    maybeLink(io, path.join(root, 'cwd')),
  ]);
  const second = parseStartTicks(await maybeRead(io, path.join(root, 'stat')));
  if (!second || first !== second) return null;

  const owner = cgroup === null ? {
    kind: 'unknown', unitName: null, unitScope: null, confidence: 'unavailable',
  } : parseCgroup(cgroup);
  return {
    ...owner,
    pid,
    uid: parseUid(status),
    startTicks: first,
    bootId: typeof bootId === 'string' && /^[a-f0-9-]{36}$/i.test(bootId) ? bootId : null,
    executablePath: exe,
    cwd,
  };
}

module.exports = {
  readLinuxProvenanceConfig,
  parseStartTicks,
  parseCgroup,
  parseUid,
  readLinuxProcessProvenance,
};
