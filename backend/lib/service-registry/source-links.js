'use strict';

// Correlate Docker's published TCP binding with the *host-side* docker-proxy
// process. Do not merge source-owned rows, statuses, notes or process identity.
// Only a recent, exact, unique active match is safe to link.
function createSourceLinks(db) {
  const candidates = db.prepare(
    'SELECT DISTINCT s.id AS system_id, d.id AS docker_id, ' +
    'se.host_ip, se.host_port, se.protocol ' +
    'FROM registry_services s ' +
    'JOIN registry_endpoints se ON se.service_id = s.id ' +
    'JOIN registry_endpoints de ON de.host_ip = se.host_ip ' +
    'AND de.host_port = se.host_port AND de.protocol = se.protocol ' +
    'AND de.internal = se.internal ' +
    'JOIN registry_services d ON d.id = de.service_id ' +
    'JOIN registry_docker_provenance p ON p.service_id = d.id ' +
    "WHERE s.server_id = d.server_id AND s.source = 'system' " +
    "AND s.display_name = 'docker-proxy' AND s.status = 'listening' " +
    "AND d.source = 'docker' AND d.status = 'listening' " +
    "AND se.source = 'system' AND de.source = 'docker' " +
    "AND se.protocol = 'tcp' AND se.internal = 0 " +
    'AND p.container_id IS NOT NULL ' +
    'AND se.last_seen_at >= ? AND de.last_seen_at >= ? ' +
    'AND p.captured_at >= ? ' +
    'AND ABS(se.last_seen_at - de.last_seen_at) <= 120000'
  );
  const insert = db.prepare(
    'INSERT OR IGNORE INTO registry_source_links ' +
    '(system_service_id, docker_service_id, linked_at) VALUES (?, ?, ?)'
  );
  const linked = db.prepare(
    'SELECT system_service_id FROM registry_source_links ' +
    'WHERE docker_service_id = ? ORDER BY system_service_id'
  );

  const linkListening = db.transaction((at = Date.now()) => {
    if (!Number.isSafeInteger(at) || at < 0) throw new TypeError('Invalid correlation time');
    const pairs = candidates.all(at - 120000, at - 120000, at - 120000);
    const systems = new Map();
    const bindings = new Map();
    for (const pair of pairs) {
      const binding = [pair.docker_id, pair.host_ip, pair.host_port, pair.protocol].join('|');
      if (!systems.has(pair.system_id)) systems.set(pair.system_id, new Set());
      if (!bindings.has(binding)) bindings.set(binding, new Set());
      systems.get(pair.system_id).add(pair.docker_id);
      bindings.get(binding).add(pair.system_id);
    }
    let created = 0;
    for (const pair of pairs) {
      const binding = [pair.docker_id, pair.host_ip, pair.host_port, pair.protocol].join('|');
      if (systems.get(pair.system_id).size !== 1 || bindings.get(binding).size !== 1) continue;
      created += insert.run(pair.system_id, pair.docker_id, at).changes;
    }
    return created;
  });

  return {
    linkListening,
    linkedSystemIds: (id) => linked.all(id).map(row => row.system_service_id),
  };
}

module.exports = { createSourceLinks };
