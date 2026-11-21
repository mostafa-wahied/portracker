import assert from 'node:assert/strict';
import fs from 'node:fs';

// Validate the *resolved* Compose model, not fragile text matching. The
// session secret arrives via stdin-only JSON and is never printed by this tool.
const compose = JSON.parse(fs.readFileSync(0, 'utf8'));
const app = compose.services?.portracker;
const proxy = compose.services?.['docker-api-proxy'];
assert(app && proxy, 'Local Compose must include monitor and read-only Docker proxy');
assert.equal(app.environment?.SERVICE_REGISTRY_ENABLED, 'true');
assert.equal(app.environment?.SERVICE_REGISTRY_HTTP_ENABLED, 'true');
assert.equal(app.environment?.SERVICE_REGISTRY_DOCKER_PROVENANCE_ENABLED, 'true');
assert.equal(app.environment?.DOCKER_HOST, 'tcp://docker-api-proxy:2375');
assert.equal(app.environment?.ENABLE_AUTH, 'true');
assert.equal(proxy.environment?.POST, '0');
assert.equal(proxy.environment?.CONTAINERS, '1');
assert.equal(proxy.environment?.INFO, '1');
assert.equal(proxy.environment?.DISABLE_IPV6, '1');
assert.equal(proxy.privileged, undefined);
assert(!proxy.ports?.length, 'Proxy must never publish Docker API port');
assert(!app.depends_on || Object.keys(app.depends_on).length === 0,
  'Monitor startup must not depend on the optional Docker API');
assert.deepEqual(Object.keys(proxy.networks || {}), ['docker-monitor']);
assert.equal(compose.networks?.['docker-monitor']?.internal, true);
assert(Object.keys(app.networks || {}).includes('docker-monitor'));
assert(Object.keys(app.networks || {}).includes('default'));
assert(!app.volumes?.some(volume => volume.target === '/var/run/docker.sock'),
  'Monitor must not mount the real Docker socket');
assert(proxy.volumes?.some(volume => volume.target === '/var/run/docker.sock' &&
  volume.read_only === true), 'Only proxy may have a read-only socket bind');
const published = app.ports?.map(port => port.host_ip + ':' + port.published);
assert.deepEqual(published, ['127.0.0.1:4999'], 'Monitor UI must remain loopback-only');
process.stdout.write('Secure default Compose model validated\n');
