import { humanizeProbeError } from './health-copy.js';

const WILDCARD_HOSTS = new Set(['', '0.0.0.0', '::', '[::]']);

const CLOSED_DETAIL = {
  refused: 'Connection refused.',
  timeout: 'Connection timed out.',
  reset: 'Connection reset.',
  'no-listener': 'Nothing is listening inside the container.',
};

const NOT_CHECKED_DETAIL = {
  udp: 'UDP port, not checked.',
  'on-demand': 'Starts on demand, not checked.',
  limit: 'Not checked: more published ports than the check limit.',
  'time-limit': 'Not checked: the check ran out of time.',
  'finished-job': 'Completed job; this port was not checked.',
  'container-check': 'Container health was checked; this port was not checked.',
  internal: 'Not published; this port was not checked.',
  stopped: 'Container is stopped; this port was not checked.',
  'job-pending': 'Job completion is not confirmed; this port was not checked.',
};

function lower(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function protocolOf(value) {
  return lower(value) || 'tcp';
}

export function portStatusKey(port) {
  return `${port.host_ip}:${port.host_port}/${protocolOf(port.protocol)}`;
}

function sameEndpoint(entry, port) {
  return !!entry && Number(entry.host_port) === Number(port.host_port)
    && protocolOf(entry.protocol) === protocolOf(port.protocol);
}

export function findPortEntry(entries, port) {
  if (!Array.isArray(entries) || !port) return null;
  const candidates = entries.filter((entry) => sameEndpoint(entry, port));
  const host = lower(port.host_ip);
  const exact = candidates.find((entry) => lower(entry.host_ip) === host);
  if (exact) return exact;
  if (!WILDCARD_HOSTS.has(host)) return null;
  return candidates.find((entry) => WILDCARD_HOSTS.has(lower(entry.host_ip))) || null;
}

function schemeOf(entry) {
  return entry.check === 'https' ? 'HTTPS' : 'HTTP';
}

function openDetail(entry) {
  if (entry.check === 'tcp+http') return 'Port open, no HTTP response.';
  if (entry.via === 'container-ip') return 'Port open on the container network.';
  return 'Port open (TCP check).';
}

export function describePortEntry(entry) {
  if (!entry) return null;
  switch (entry.state) {
    case 'ok':
      return { color: 'green', label: 'reachable', detail: entry.statusCode ? `Answers with ${schemeOf(entry)} ${entry.statusCode}.` : 'Reachable.' };
    case 'open':
      return { color: 'green', label: 'reachable', detail: openDetail(entry) };
    case 'http-error':
      return { color: 'yellow', label: 'degraded', detail: `Answers with ${schemeOf(entry)} ${entry.statusCode}.` };
    case 'closed':
      return { color: 'red', label: 'unreachable', detail: CLOSED_DETAIL[entry.reasonCode] || "Port isn't responding." };
    case 'host-only':
      return { color: 'gray', label: 'host-only', detail: `Bound to ${entry.host_ip || '127.0.0.1'}`, suppressed: true };
    case 'not-checked':
      return { color: 'gray', label: 'not checked', detail: NOT_CHECKED_DETAIL[entry.reasonCode] || 'Not checked.' };
    default:
      return null;
  }
}

function legacyMatch(entry, port) {
  if (!entry || Number(entry.host_port) !== Number(port.host_port)) return false;
  if (!entry.host_ip || !port.host_ip) return true;
  return entry.host_ip === port.host_ip;
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

function legacyStatus(component, probe, evidence, port) {
  if (listOf(evidence.failures).some((failure) => legacyMatch(failure, port))) {
    return { color: 'red', label: 'unreachable', detail: "Container is running, but the port isn't responding." };
  }
  if (listOf(evidence.suppressed).some((entry) => legacyMatch(entry, port))) {
    return { color: 'gray', label: 'host-only', detail: 'Bound to 127.0.0.1', suppressed: true };
  }
  if (probe.ok === true && probe.severity === 'yellow') {
    return { color: 'yellow', label: 'degraded', detail: humanizeProbeError(probe.error) || component.reason || null };
  }
  if (probe.ok === true) return { color: 'green', label: 'reachable', detail: component.reason || null };
  return { color: 'red', label: 'unreachable', detail: humanizeProbeError(probe.error) || component.reason || null };
}

export function portHealthStatus(component, port) {
  if (!component || !port) return null;
  const probe = component.probe || {};
  const evidence = probe.evidence || {};
  const status = Array.isArray(evidence.ports)
    ? describePortEntry(findPortEntry(evidence.ports, port)) || { color: 'gray', label: 'not checked', detail: 'No result for this port.' }
    : legacyStatus(component, probe, evidence, port);
  if (!status.suppressed) return status;
  const hostOnly = listOf(evidence.suppressed).find((entry) => legacyMatch(entry, port));
  return { ...status, suppressedReason: (hostOnly && hostOnly.reason) || 'unknown' };
}
