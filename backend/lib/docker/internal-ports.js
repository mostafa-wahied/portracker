const DEFAULT_MAX_UNPUBLISHED_EXPOSED_PORTS = 100;
const { redactDiagnosticData } = require("../diagnostic-data");

function getMaxUnpublishedExposedPorts() {
  const raw = Number(process.env.MAX_INTERNAL_PORTS_PER_CONTAINER || "");
  if (Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_MAX_UNPUBLISHED_EXPOSED_PORTS;
}

function getPublishedBindings(binding) {
  if (Array.isArray(binding)) {
    return binding;
  }
  if (binding && typeof binding === "object") {
    return [binding];
  }
  return [];
}

function hasPublishedBindings(binding) {
  return getPublishedBindings(binding).length > 0;
}

function mergePortBindings(portBindings, configuredBindings) {
  const merged = { ...(configuredBindings || {}) };
  Object.entries(portBindings || {}).forEach(([portDef, bindings]) => {
    if (hasPublishedBindings(bindings) || !hasPublishedBindings(merged[portDef])) {
      merged[portDef] = bindings;
    }
  });
  return merged;
}

function parsePortDefinition(portDef) {
  const [port, protocol] = String(portDef).split("/");
  const portNum = Number(port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return null;
  }
  return { portNum, protocol: protocol || "tcp" };
}

function parseHostPort(value) {
  const portNum = Number(value);
  return Number.isInteger(portNum) && portNum > 0 && portNum <= 65535
    ? portNum
    : null;
}

function listUnpublishedExposedDefs(exposedPorts, portBindings) {
  if (!exposedPorts || typeof exposedPorts !== "object") {
    return [];
  }
  const bindings = portBindings || {};
  return Object.keys(exposedPorts).filter(
    (portDef) => !hasPublishedBindings(bindings[portDef])
  );
}

function getAllowedUnpublishedDefs({
  exposedPorts,
  portBindings,
  containerName,
  logWarn,
}) {
  const unpublishedDefs = listUnpublishedExposedDefs(exposedPorts, portBindings);
  const limit = getMaxUnpublishedExposedPorts();
  if (unpublishedDefs.length <= limit) {
    return unpublishedDefs;
  }
  if (typeof logWarn === "function") {
    logWarn(
      `Container ${containerName} exposes ${unpublishedDefs.length} unpublished ports; skipping internal-port enumeration (limit ${limit})`
    );
  }
  return [];
}

function buildInternalPorts({
  exposedPorts,
  portBindings,
  containerId,
  containerName,
  composeProject,
  composeService,
  logWarn,
}) {
  const unpublishedDefs = getAllowedUnpublishedDefs({
    exposedPorts,
    portBindings,
    containerName,
    logWarn,
  });
  const internalPorts = [];
  unpublishedDefs.forEach((portDef) => {
    const parsed = parsePortDefinition(portDef);
    if (!parsed) {
      return;
    }
    internalPorts.push({
      source: "docker",
      owner: containerName,
      protocol: parsed.protocol,
      host_ip: "0.0.0.0",
      host_port: parsed.portNum,
      target: `${containerId.substring(0, 12)}:${parsed.portNum}(internal)`,
      container_id: containerId,
      app_id: containerName,
      compose_project: composeProject,
      compose_service: composeService,
      internal: true,
    });
  });
  return internalPorts;
}

function buildContainerPortDetails({
  exposedPorts,
  portBindings,
  configuredBindings,
  containerName,
  logWarn,
}) {
  const mappings = [];
  const bindings = mergePortBindings(portBindings, configuredBindings);
  Object.entries(bindings).forEach(([portDef, hostBindings]) => {
    const parsed = parsePortDefinition(portDef);
    const publishedBindings = getPublishedBindings(hostBindings);
    if (!parsed || publishedBindings.length === 0) {
      return;
    }
    publishedBindings.forEach((binding) => {
      const hostPort = parseHostPort(binding.HostPort);
      if (hostPort === null) {
        return;
      }
      mappings.push({
        host_ip: binding.HostIp || "0.0.0.0",
        host_port: hostPort,
        container_port: parsed.portNum,
        protocol: parsed.protocol,
      });
    });
  });
  const allExposedPorts = Object.fromEntries(
    Object.keys(bindings).map((portDef) => [portDef, {}])
  );
  Object.assign(allExposedPorts, exposedPorts || {});
  const unpublishedDefs = getAllowedUnpublishedDefs({
    exposedPorts: allExposedPorts,
    portBindings: bindings,
    containerName,
    logWarn,
  });
  const exposedUnmapped = [];
  unpublishedDefs.forEach((portDef) => {
    const parsed = parsePortDefinition(portDef);
    if (!parsed) {
      return;
    }
    mappings.push({
      host_ip: "0.0.0.0",
      host_port: parsed.portNum,
      container_port: parsed.portNum,
      protocol: parsed.protocol,
      internal: true,
    });
    exposedUnmapped.push({ port: parsed.portNum, protocol: parsed.protocol });
  });
  return { portMappings: mappings, exposedUnmapped };
}

function sanitizeDockerInspection(inspection, logWarn) {
  if (!inspection || typeof inspection !== "object") {
    return inspection;
  }
  inspection = redactDiagnosticData(inspection);
  const config = inspection.Config || {};
  const networkSettings = inspection.NetworkSettings || {};
  const hostConfig = inspection.HostConfig || {};
  const exposedPorts = config.ExposedPorts || {};
  const networkBindings = networkSettings.Ports || {};
  const configuredBindings = hostConfig.PortBindings || {};
  const allExposedPorts = Object.fromEntries(
    [...Object.keys(networkBindings), ...Object.keys(configuredBindings)].map(
      (portDef) => [portDef, {}]
    )
  );
  Object.assign(allExposedPorts, exposedPorts);
  const effectiveBindings = { ...configuredBindings, ...networkBindings };
  Object.entries(configuredBindings).forEach(([portDef, bindings]) => {
    if (!hasPublishedBindings(effectiveBindings[portDef])) {
      effectiveBindings[portDef] = bindings;
    }
  });
  const unpublishedDefs = listUnpublishedExposedDefs(
    allExposedPorts,
    effectiveBindings
  );
  const limit = getMaxUnpublishedExposedPorts();
  if (unpublishedDefs.length <= limit) {
    return inspection;
  }
  const publishedDefs = new Set(
    Object.keys(allExposedPorts).filter((portDef) =>
      hasPublishedBindings(effectiveBindings[portDef])
    )
  );
  if (typeof logWarn === "function") {
    const name = (inspection.Name || inspection.Id || "unknown").replace(/^\//, "");
    logWarn(
      `Container ${name} exposes ${unpublishedDefs.length} unpublished ports; filtering them from raw details (limit ${limit})`
    );
  }
  const keepPublished = ([portDef]) => publishedDefs.has(portDef);
  return {
    ...inspection,
    Config: {
      ...config,
      ExposedPorts: Object.fromEntries(Object.entries(exposedPorts).filter(keepPublished)),
    },
    HostConfig: {
      ...hostConfig,
      PortBindings: Object.fromEntries(
        Object.entries(configuredBindings).filter(keepPublished)
      ),
    },
    NetworkSettings: {
      ...networkSettings,
      Ports: Object.fromEntries(Object.entries(networkBindings).filter(keepPublished)),
    },
  };
}

function getInternalGroupKey(port) {
  return port.container_id || port.app_id || port.owner || "unknown";
}

function sanitizeInternalPortRows(portRows, logWarn) {
  if (!Array.isArray(portRows)) {
    throw new TypeError("Port rows must be an array");
  }
  const limit = getMaxUnpublishedExposedPorts();
  const counts = new Map();
  portRows.forEach((port) => {
    if (port && port.internal === true) {
      const key = getInternalGroupKey(port);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  });
  const oversized = new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > limit)
      .map(([key]) => key)
  );
  if (typeof logWarn === "function") {
    oversized.forEach((key) => {
      logWarn(
        `Container ${key} returned ${counts.get(key)} internal ports; dropping them from the response (limit ${limit})`
      );
    });
  }
  return portRows.filter(
    (port) => !(port && port.internal === true && oversized.has(getInternalGroupKey(port)))
  );
}

function sanitizeApplications(applications, logWarn) {
  if (!Array.isArray(applications)) {
    return applications;
  }
  const limit = getMaxUnpublishedExposedPorts();
  return applications.map((application) => {
    const ports = application?.platform_data?.ports;
    if (!Array.isArray(ports)) {
      return application;
    }
    const internalCount = ports.filter((port) => port?.internal === true).length;
    if (internalCount <= limit) {
      return application;
    }
    if (typeof logWarn === "function") {
      logWarn(
        `Application ${application.name || application.id || "unknown"} returned ${internalCount} internal ports; dropping them from metadata (limit ${limit})`
      );
    }
    return {
      ...application,
      platform_data: {
        ...application.platform_data,
        ports: ports.filter((port) => port?.internal !== true),
      },
    };
  });
}

function sanitizeScanPayload(payload, logWarn) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !Array.isArray(payload.ports)
  ) {
    throw new TypeError("Scan payload must contain a ports array");
  }
  return {
    ...payload,
    ...(Array.isArray(payload.ports)
      ? { ports: sanitizeInternalPortRows(payload.ports, logWarn) }
      : {}),
    ...(Array.isArray(payload.applications)
      ? { applications: sanitizeApplications(payload.applications, logWarn) }
      : {}),
    ...(Array.isArray(payload.apps)
      ? { apps: sanitizeApplications(payload.apps, logWarn) }
      : {}),
  };
}

module.exports = {
  DEFAULT_MAX_UNPUBLISHED_EXPOSED_PORTS,
  getMaxUnpublishedExposedPorts,
  listUnpublishedExposedDefs,
  buildInternalPorts,
  buildContainerPortDetails,
  sanitizeDockerInspection,
  sanitizeInternalPortRows,
  sanitizeApplications,
  sanitizeScanPayload,
};
