const { computeServiceHealth } = require('../lib/health/service-health');
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

function createServicesHandler({ getLocalPortsUsingCollectors, dockerApi, logger, baseDebug }) {
  return async function servicesHandler(req, res) {
    const debug = req.query.debug === "true";
    const hasDebugQuery = Object.prototype.hasOwnProperty.call(req.query, 'debug');
    if (hasDebugQuery) logger.setDebugEnabled(debug);
    try {
      const localPorts = await getLocalPortsUsingCollectors({ debug });
      const groups = groupPortsByService(localPorts);
      const overrides = overridesDao.getOverridesForServer(LOCAL_SERVER_ID);
      const services = [];
      for (const svc of groups.values()) {
        try {
          const result = await computeServiceHealth(svc, { dockerApi, overrides });
          services.push(Object.assign({ project: svc.project }, result));
        } catch (err) {
          logger.error(`computeServiceHealth failed for ${svc.serviceId}:`, err.message);
          services.push({
            serviceId: svc.serviceId, name: svc.name, project: svc.project,
            color: 'gray', reason: `error: ${err.message}`,
            failingComponents: [], components: [], evidence: [],
          });
        }
      }
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
