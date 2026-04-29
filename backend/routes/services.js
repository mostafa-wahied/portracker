const { computeServiceHealth } = require('../lib/health/service-health');

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
    if (process.env.FEAT_001_ENABLED !== 'true') {
      return res.status(404).json({ error: 'feature-disabled' });
    }
    const debug = req.query.debug === "true";
    const hasDebugQuery = Object.prototype.hasOwnProperty.call(req.query, 'debug');
    if (hasDebugQuery) logger.setDebugEnabled(debug);
    try {
      const localPorts = await getLocalPortsUsingCollectors({ debug });
      const groups = groupPortsByService(localPorts);
      const services = [];
      for (const svc of groups.values()) {
        try {
          const result = await computeServiceHealth(svc, { dockerApi, overrides: {} });
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
      res.json({ services });
    } catch (error) {
      logger.error("Error in GET /api/services:", error.message);
      logger.debug("Stack trace:", error.stack || "");
      res.status(500).json({ error: 'failed to compute services', details: error.message });
    } finally {
      if (hasDebugQuery) logger.setDebugEnabled(baseDebug);
    }
  };
}

module.exports = { createServicesHandler };
