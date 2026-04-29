async function enrichComposeLabels(dockerApi, entries, logWarn) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  const uniqueIds = new Set();
  for (const e of entries) if (e && e.container_id) uniqueIds.add(e.container_id);
  if (uniqueIds.size === 0) return;
  const labelsById = new Map();
  for (const id of uniqueIds) {
    try {
      const inspection = await dockerApi.inspectContainer(id);
      const labels = (inspection && inspection.Config && inspection.Config.Labels) || {};
      labelsById.set(id, {
        composeProject: labels['com.docker.compose.project'] || null,
        composeService: labels['com.docker.compose.service'] || null,
      });
    } catch (err) {
      logWarn(`compose-label enrichment failed for ${id}:`, err.message);
    }
  }
  for (const entry of entries) {
    if (!entry || !entry.container_id) continue;
    const info = labelsById.get(entry.container_id);
    if (!info) continue;
    if (info.composeProject) entry.compose_project = info.composeProject;
    if (info.composeService) entry.compose_service = info.composeService;
  }
}

module.exports = { enrichComposeLabels, enrichComposeLabelsOnPorts };

async function enrichComposeLabelsOnPorts(dockerApi, ports, logger) {
  if (!Array.isArray(ports) || ports.length === 0) return;
  const uniqueIds = new Set();
  for (const port of ports) if (port && port.container_id) uniqueIds.add(port.container_id);
  const labelsById = new Map();
  let inspectFailures = 0;
  let dockerAvailable = uniqueIds.size > 0;
  if (dockerAvailable) {
    try {
      if (typeof dockerApi._ensureConnected === 'function') await dockerApi._ensureConnected();
    } catch (_err) {
      dockerAvailable = false;
    }
  }
  if (dockerAvailable) {
    for (const id of uniqueIds) {
      try {
        const inspection = await dockerApi.inspectContainer(id);
        const labels = (inspection && inspection.Config && inspection.Config.Labels) || {};
        const networks = inspection && inspection.NetworkSettings && inspection.NetworkSettings.Networks;
        const networkNames = networks ? Object.keys(networks) : [];
        const defaultNetwork = networkNames.find((networkName) => networkName.endsWith('_default'));
        labelsById.set(id, {
          composeProject: labels['com.docker.compose.project'] || (defaultNetwork ? defaultNetwork.replace(/_default$/, '') : null),
          composeService: labels['com.docker.compose.service'] || null,
        });
      } catch (err) {
        inspectFailures++;
        logger.debug(`[enrichComposeLabels] inspect failed for ${id}: ${err.message}`);
      }
    }
  }
  let mutations = 0;
  for (const port of ports) {
    if (!port || !port.container_id) continue;
    const info = labelsById.get(port.container_id);
    if (!info) continue;
    if (info.composeProject && port.compose_project !== info.composeProject) {
      port.compose_project = info.composeProject;
      mutations++;
    }
    if (info.composeService && port.compose_service !== info.composeService) {
      port.compose_service = info.composeService;
    }
  }
  const knownProjects = Array.from(
    new Set(ports.map((port) => port && port.compose_project).filter(Boolean))
  ).sort((a, b) => b.length - a.length);
  for (const port of ports) {
    if (!port || port.source !== 'docker' || !port.owner) continue;
    if (port.compose_project && port.compose_service) continue;
    if (!/-\d+$/.test(port.owner)) continue;
    const project = port.compose_project || knownProjects.find((candidate) => port.owner.startsWith(`${candidate}-`));
    if (!project) continue;
    if (!port.owner.startsWith(`${project}-`)) continue;
    const service = port.owner.slice(project.length + 1).replace(/-\d+$/, '');
    if (!port.compose_project) {
      port.compose_project = project;
      mutations++;
    }
    if (service && !port.compose_service) {
      port.compose_service = service;
      mutations++;
    }
  }
  logger.debug(
    `[enrichComposeLabels] entries=${ports.length} cids=${uniqueIds.size} ` +
    `resolved=${labelsById.size} inspect_failures=${inspectFailures} mutations=${mutations}`
  );
}
