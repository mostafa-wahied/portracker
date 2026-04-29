'use strict';

const WEAK_SUPPORT_HINTS = ['exporter', 'metrics', 'sidecar', 'prometheus-'];
const WEAK_PROXY_HINTS = ['proxy', 'nginx', 'traefik', 'caddy', 'haproxy', 'envoy'];

function safeLower(v) {
  return typeof v === 'string' ? v.toLowerCase() : '';
}

function toNumericPort(v) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? n : null;
}

function pickProtocol(port, inspection) {
  const direct = safeLower(port && (port.protocol || port.port_proto || port.proto));
  if (direct === 'tcp' || direct === 'udp') return direct;

  const portNum = toNumericPort(port && (port.host_port || port.container_port));
  if (inspection && inspection.NetworkSettings && inspection.NetworkSettings.Ports && portNum != null) {
    const map = inspection.NetworkSettings.Ports;
    for (const key of Object.keys(map)) {
      const parts = key.split('/');
      if (parts.length === 2 && toNumericPort(parts[0]) === portNum) {
        const proto = safeLower(parts[1]);
        if (proto === 'tcp' || proto === 'udp') return proto;
      }
    }
  }
  return 'tcp';
}

function extractHealthcheck(inspection) {
  if (!inspection || !inspection.State) {
    return { declared: false, status: null };
  }
  const state = inspection.State;
  const hasHealthBlock = !!state.Health;
  const status = hasHealthBlock ? safeLower(state.Health.Status || '') : '';
  const cfg = inspection.Config && inspection.Config.Healthcheck;
  const declared = hasHealthBlock && status && status !== 'none'
    ? true
    : !!(cfg && Array.isArray(cfg.Test) && cfg.Test.length > 0 && cfg.Test[0] !== 'NONE');
  return {
    declared,
    status: declared ? (status || 'starting') : null,
  };
}

function extractContainerState(inspection) {
  if (!inspection || !inspection.State) {
    return { status: 'unknown', exitCode: null, startedAt: null, finishedAt: null };
  }
  const s = inspection.State;
  return {
    status: safeLower(s.Status || 'unknown'),
    exitCode: Number.isFinite(s.ExitCode) ? s.ExitCode : null,
    startedAt: s.StartedAt || null,
    finishedAt: s.FinishedAt || null,
  };
}

function extractRestartPolicy(inspection) {
  if (!inspection || !inspection.HostConfig || !inspection.HostConfig.RestartPolicy) return 'no';
  const name = inspection.HostConfig.RestartPolicy.Name;
  return typeof name === 'string' && name.length > 0 ? name : 'no';
}

function extractDependsOn(inspection) {
  if (!inspection || !inspection.Config || !inspection.Config.Labels) return [];
  const labels = inspection.Config.Labels;
  const raw = labels['com.docker.compose.depends_on'];
  if (!raw || typeof raw !== 'string') return [];
  return raw.split(',')
    .map((s) => s.split(':')[0].trim())
    .filter((s) => s.length > 0);
}

function extractComposeLabels(port, inspection) {
  const labels = (inspection && inspection.Config && inspection.Config.Labels) || {};
  const project = (port && port.compose_project)
    || labels['com.docker.compose.project']
    || null;
  const service = (port && port.compose_service)
    || labels['com.docker.compose.service']
    || null;
  return {
    project: project || null,
    service: service || null,
  };
}

function imageHints(inspection) {
  const raw = safeLower(inspection && inspection.Config && inspection.Config.Image);
  if (!raw) return { isExporterLike: false, isProxyLike: false, raw: null };
  return {
    isExporterLike: WEAK_SUPPORT_HINTS.some((h) => raw.includes(h)),
    isProxyLike: WEAK_PROXY_HINTS.some((h) => raw.includes(h)),
    raw,
  };
}

function bindCategory(host) {
  const h = safeLower(host);
  if (h === '127.0.0.1' || h === '::1' || h === 'localhost') return 'loopback';
  if (h === '' || h === '0.0.0.0' || h === '[::]' || h === '::') return 'any';
  return 'specific';
}

function isOnlyPublishedPort(port, servicePorts) {
  if (!Array.isArray(servicePorts) || servicePorts.length === 0) return false;
  const published = servicePorts.filter((p) => {
    if (p && p.internal === true) return false;
    const host = safeLower(p && (p.host_ip != null ? p.host_ip : ''));
    return toNumericPort(p && p.host_port) != null && host !== '127.0.0.1' && host !== '::1' && host !== 'localhost';
  });
  return published.length === 1
    && toNumericPort(published[0].host_port) === toNumericPort(port && port.host_port)
    && safeLower(published[0].protocol || '') === safeLower(port && port.protocol || '');
}

function extractSignals(port, inspection, servicePorts) {
  const safePort = port || {};
  const compose = extractComposeLabels(safePort, inspection);
  const hc = extractHealthcheck(inspection);
  const state = extractContainerState(inspection);
  const hints = imageHints(inspection);
  const protocol = pickProtocol(safePort, inspection);
  const portNum = toNumericPort(safePort.host_port || safePort.container_port);

  return {
    protocol,
    portNumber: portNum,
    hasHealthcheck: hc.declared,
    healthcheckStatus: hc.status,
    containerState: state.status,
    exitCode: state.exitCode,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    restartPolicy: extractRestartPolicy(inspection),
    isOnlyPublishedPort: isOnlyPublishedPort(safePort, servicePorts),
    boundTo: bindCategory(safePort.host_ip),
    composeProject: compose.project,
    composeService: compose.service,
    dependsOn: extractDependsOn(inspection),
    imageHints: hints,
    owner: safePort.owner || null,
    source: safePort.source || null,
    containerId: safePort.container_id || (inspection && inspection.Id) || null,
  };
}

module.exports = {
  extractSignals,
  WEAK_SUPPORT_HINTS,
  WEAK_PROXY_HINTS,
};
