const { computeServiceHealth, groupPortsByContainer } = require('../lib/health/service-health');
const { completionPrerequisites } = require('../lib/health/signals');
const { portEntry, runWithinBudget, sweepContext } = require('../lib/health/port-sweep');
const overridesDao = require('../lib/overrides');

const LOCAL_SERVER_ID = 'local';

function groupPortsByService(ports) {
  const groups = new Map();
  (ports || []).forEach((p) => {
    if (!p || p.source === 'system' || !p.container_id) return;
    const project = p.compose_project || '__noproject__';
    const service = p.compose_service || (p.owner || 'unknown');
    const key = `${project}::${service}`;
    if (!groups.has(key)) {
      groups.set(key, { serviceId: key, name: service, project: p.compose_project || null, ports: [] });
    }
    groups.get(key).ports.push(p);
  });
  return groups;
}

function unassessedService(service) {
  return {
    serviceId: service.serviceId, name: service.name, project: service.project, color: 'gray',
    reason: 'No current health result.', checkedAt: null, failingComponents: [], evidence: [],
    components: [...groupPortsByContainer(service.ports)].map(([containerId, ports]) => ({
      containerId, componentId: containerId, role: 'unknown', ruleId: 'R8', reason: 'Not yet assessed.',
      autoRole: 'unknown', autoRuleId: 'R8', autoReason: 'Not yet assessed.',
      probe: { ok: null, severity: null, error: null, latencyMs: null,
        evidence: { kind: 'not-checked', ports: ports.map((port) => portEntry(port, 'not-checked', 'none', { reasonCode: 'time-limit' })) } },
    })),
  };
}

function serviceFingerprint(service, overrides) {
  return JSON.stringify(service.ports.map((port) => JSON.stringify([
    port.container_id, port.host_ip, port.host_port, port.protocol, port.internal, overrides[port.container_id] || null,
  ])).sort());
}

function createHealthReader(dockerApi) {
  const cached = new Map();
  const attempted = new Map();
  let pending = null;
  const scan = async (groups, overrides, debug) => {
    const services = [...groups.values()];
    const fingerprints = new Map(services.map((service) => [service.serviceId, serviceFingerprint(service, overrides)]));
    for (const identity of new Set([...cached.keys(), ...attempted.keys()])) {
      if (!fingerprints.has(identity) || attempted.get(identity)?.fingerprint !== fingerprints.get(identity)) {
        cached.delete(identity);
        attempted.delete(identity);
      }
    }
    if (debug) cached.clear();
    const context = sweepContext({ dockerApi });
    const containers = dockerApi && typeof dockerApi.listContainers === 'function'
      ? await runWithinBudget(context, () => dockerApi.listContainers({ all: true })).catch(() => null) : [];
    const expectedCompletionServices = completionPrerequisites(containers || []);
    const ordered = services.slice().sort((left, right) => (attempted.get(left.serviceId)?.at || 0) - (attempted.get(right.serviceId)?.at || 0));
    for (const service of ordered) {
      if (Date.now() >= context.deadline) break;
      const checkedAt = Date.now();
      attempted.set(service.serviceId, { at: checkedAt, fingerprint: fingerprints.get(service.serviceId) });
      try {
        const result = await computeServiceHealth(service, { dockerApi, overrides, expectedCompletionServices,
          budgetMs: Math.max(0, context.deadline - Date.now()) });
        if (result.components.some((component) => typeof component.probe.ok === 'boolean')) {
          cached.set(service.serviceId, { ...result, project: service.project, checkedAt });
        }
      } catch { cached.delete(service.serviceId); }
    }
    return services.map((service) => {
      const result = cached.get(service.serviceId);
      return result && Date.now() - result.checkedAt < 60000 ? result : unassessedService(service);
    });
  };
  return (groups, overrides, debug) => {
    if (!pending) pending = scan(groups, overrides, debug).finally(() => { pending = null; });
    return pending;
  };
}

function createServicesHandler({ getLocalPortsUsingCollectors, dockerApi, logger, baseDebug }) {
  const readHealth = createHealthReader(dockerApi);
  return async function servicesHandler(req, res) {
    const debug = req.query.debug === "true";
    const hasDebugQuery = Object.prototype.hasOwnProperty.call(req.query, 'debug');
    if (hasDebugQuery) logger.setDebugEnabled(debug);
    try {
      const localPorts = await getLocalPortsUsingCollectors({ debug });
      const groups = groupPortsByService(localPorts);
      const overrides = overridesDao.getOverridesForServer(LOCAL_SERVER_ID);
      const services = await readHealth(groups, overrides, debug);
      res.json({ services, overrides });
    } catch (error) {
      logger.error("Error in GET /api/services:", error.message);
      logger.debug("Stack trace:", error.stack || "");
      res.status(500).json({ error: 'failed to compute services', details: error.message });
    } finally {
      if (hasDebugQuery) logger.setDebugEnabled(baseDebug);
    }
  };
}

function createGetOverridesHandler({ logger }) {
  return function getOverridesHandler(req, res) {
    try {
      const overrides = overridesDao.getOverridesForServer(LOCAL_SERVER_ID);
      res.json({ overrides });
    } catch (error) {
      logger.error("Error in GET /api/overrides:", error.message);
      res.status(500).json({ error: 'failed to read overrides', details: error.message });
    }
  };
}

function createPutOverrideHandler({ logger }) {
  return function putOverrideHandler(req, res) {
    const { serviceId, componentId } = req.params;
    const role = req.body && req.body.role;
    if (!serviceId || !componentId) {
      return res.status(400).json({ error: 'serviceId and componentId are required' });
    }
    if (!overridesDao.isValidRole(role)) {
      return res.status(400).json({ error: 'invalid role', validRoles: Array.from(overridesDao.VALID_ROLES) });
    }
    try {
      const ok = overridesDao.setOverride(LOCAL_SERVER_ID, serviceId, componentId, role);
      if (!ok) return res.status(400).json({ error: 'invalid input' });
      res.json({ ok: true, serviceId, componentId, role });
    } catch (error) {
      logger.error("Error in PUT override:", error.message);
      res.status(500).json({ error: 'failed to write override', details: error.message });
    }
  };
}

function createDeleteOverrideHandler({ logger }) {
  return function deleteOverrideHandler(req, res) {
    const { componentId } = req.params;
    if (!componentId) return res.status(400).json({ error: 'componentId is required' });
    try {
      const changes = overridesDao.clearOverride(LOCAL_SERVER_ID, componentId);
      res.json({ ok: true, removed: changes });
    } catch (error) {
      logger.error("Error in DELETE override:", error.message);
      res.status(500).json({ error: 'failed to clear override', details: error.message });
    }
  };
}

function createDeleteServiceOverridesHandler({ logger }) {
  return function deleteServiceOverridesHandler(req, res) {
    const { serviceId } = req.params;
    if (!serviceId) return res.status(400).json({ error: 'serviceId is required' });
    try {
      const changes = overridesDao.clearAllForService(LOCAL_SERVER_ID, serviceId);
      res.json({ ok: true, serviceId, removed: changes });
    } catch (error) {
      logger.error("Error in DELETE service overrides:", error.message);
      res.status(500).json({ error: 'failed to clear service overrides', details: error.message });
    }
  };
}

function createDeleteAllOverridesHandler({ logger }) {
  return function deleteAllOverridesHandler(req, res) {
    try {
      const changes = overridesDao.clearAllForServer(LOCAL_SERVER_ID);
      res.json({ ok: true, removed: changes });
    } catch (error) {
      logger.error("Error in DELETE all overrides:", error.message);
      res.status(500).json({ error: 'failed to clear overrides', details: error.message });
    }
  };
}

module.exports = {
  createServicesHandler,
  createGetOverridesHandler,
  createPutOverrideHandler,
  createDeleteOverrideHandler,
  createDeleteServiceOverridesHandler,
  createDeleteAllOverridesHandler,
};
