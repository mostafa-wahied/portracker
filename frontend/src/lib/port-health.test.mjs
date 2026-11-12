import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPortEntry, portHealthStatus, portStatusKey } from './port-health.js';
import { applyOverridesToMatches, buildIndex, findServiceMatches, createHealthPoller, expireStaleHealth, mergeColors, recomputeServiceColor } from './service-health-state.js';

const port = (host_port, extra = {}) => ({ host_ip: '0.0.0.0', host_port, protocol: 'tcp', container_id: 'c1', ...extra });
const entry = (host_port, state, extra = {}) => ({ host_ip: '0.0.0.0', host_port, protocol: 'tcp', state, check: 'tcp', ...extra });
const component = (probe, extra = {}) => ({ containerId: 'c1', role: 'core_access', reason: 'Main web port.', probe, ...extra });

test('each published port gets the color of its own check', () => {
  const comp = component({
    ok: true,
    severity: 'yellow',
    error: 'ports-closed-1',
    evidence: {
      ports: [
        entry(8080, 'ok', { check: 'http', statusCode: 200 }),
        entry(8081, 'open'),
        entry(8082, 'closed', { reasonCode: 'refused' }),
        entry(8083, 'http-error', { check: 'https', statusCode: 503 }),
        entry(8084, 'not-checked', { check: 'none', reasonCode: 'limit' }),
        entry(53, 'not-checked', { protocol: 'udp', check: 'none', reasonCode: 'udp' }),
      ],
    },
  });
  const seen = [8080, 8081, 8082, 8083, 8084].map((n) => portHealthStatus(comp, port(n)));
  assert.deepEqual(seen.map((s) => s.color), ['green', 'green', 'red', 'yellow', 'gray']);
  assert.equal(seen[0].detail, 'Answers with HTTP 200.');
  assert.equal(seen[2].detail, 'Connection refused.');
  assert.equal(seen[3].detail, 'Answers with HTTPS 503.');
  assert.equal(portHealthStatus(comp, port(53, { protocol: 'udp' })).label, 'not checked');
});

test('a port on the IPv6 wildcard uses the IPv4 wildcard result for the same port', () => {
  const entries = [entry(8080, 'closed', { reasonCode: 'timeout' })];
  assert.equal(findPortEntry(entries, port(8080, { host_ip: '::' })), entries[0]);
  assert.equal(findPortEntry(entries, port(8080, { host_ip: '192.168.1.10' })), null);
  assert.equal(findPortEntry(entries, port(8080, { protocol: 'udp' })), null);
});

test('host-only ports stay gray and keep the backend reason', () => {
  const comp = component({
    ok: true,
    evidence: {
      ports: [entry(9000, 'host-only', { host_ip: '127.0.0.1', reasonCode: 'loopback-only' })],
      suppressed: [{ host_ip: '127.0.0.1', host_port: 9000, reason: 'host-network' }],
    },
  });
  const status = portHealthStatus(comp, port(9000, { host_ip: '127.0.0.1' }));
  assert.equal(status.color, 'gray');
  assert.equal(status.suppressed, true);
  assert.equal(status.suppressedReason, 'host-network');
});

test('results without per-port data keep the previous behavior', () => {
  const failing = component({ ok: true, evidence: { failures: [{ host_ip: '0.0.0.0', host_port: 8081 }] } });
  assert.equal(portHealthStatus(failing, port(8081)).color, 'red');
  assert.equal(portHealthStatus(failing, port(8080)).color, 'green');
  assert.equal(portHealthStatus(component({ ok: false, error: 'timeout' }), port(8080)).detail, 'Connection timed out.');
  assert.equal(portHealthStatus(component({ ok: true, severity: 'yellow', error: 'http-status-500' }), port(8080)).color, 'yellow');
});

test('a port with nothing listening inside its container explains why it is red', () => {
  const comp = component({ ok: false, error: 'no-listener', evidence: { ports: [entry(8080, 'closed', { reasonCode: 'no-listener' })] } });
  assert.deepEqual(portHealthStatus(comp, port(8080)), { color: 'red', label: 'unreachable', detail: 'Nothing is listening inside the container.' });
});

test('a port missing from per-port evidence does not inherit another port result', () => {
  const comp = component({ ok: true, evidence: { ports: [entry(8080, 'ok', { check: 'http', statusCode: 200 })] } });
  assert.equal(portHealthStatus(comp, port(8081)).color, 'gray');
});

test('status keys keep TCP and UDP on the same port apart', () => {
  assert.notEqual(portStatusKey(port(53)), portStatusKey(port(53, { protocol: 'udp' })));
});

test('an override keeps a degraded main service yellow instead of green', () => {
  const degraded = component({ ok: true, severity: 'yellow', error: 'http-status-500' }, { effectiveRole: 'core_runtime', overridden: true });
  assert.equal(recomputeServiceColor('yellow', [degraded]), 'yellow');
  const helper = component({ ok: true, severity: 'yellow' }, { role: 'support' });
  const main = component({ ok: true });
  assert.equal(recomputeServiceColor('green', [main, helper]), 'yellow');
  assert.equal(recomputeServiceColor('green', [main]), 'green');
  assert.equal(recomputeServiceColor('red', [component({ ok: false })]), 'red');
});

test('an override that removes every main service makes the card gray like the server does', () => {
  assert.equal(recomputeServiceColor('green', [component({ ok: true }, { effectiveRole: 'support' })]), 'gray');
});

test('role overrides distinguish unknown health from known degradation', () => {
  const main = component({ ok: true });
  const unclassified = component({ ok: null }, { role: 'unknown' });
  assert.equal(recomputeServiceColor('green', [main, unclassified]), 'green');
  assert.equal(recomputeServiceColor('green', [main, { ...unclassified, probe: { ok: true, severity: 'yellow' } }]), 'yellow');
  assert.equal(recomputeServiceColor('green', [component({ ok: null })]), 'gray');
  assert.equal(recomputeServiceColor('gray', [component({ ok: null }), component({ ok: false })]), 'red');
});

test('stale service data expires so the dashboard falls back to direct checks', () => {
  const fresh = { enabled: true, services: [{ serviceId: 's' }], updatedAt: 1000, loading: false };
  assert.equal(expireStaleHealth(fresh, 1000 + 59999, 60000), fresh);
  const expired = expireStaleHealth(fresh, 1000 + 60000, 60000);
  assert.equal(expired.enabled, false);
  assert.deepEqual(expired.services, []);
  const disabled = { enabled: false, services: [], updatedAt: null, loading: false };
  assert.equal(expireStaleHealth(disabled, 999999, 60000), disabled);
});

test('explicit card identities cannot inherit an unrelated project failure', () => {
  const primary = { serviceId: 'group::alpha', name: 'alpha', project: 'group', color: 'green', components: [{ containerId: 'primary-container' }] };
  const other = { serviceId: 'group::beta', name: 'beta', project: 'group', color: 'red', components: [{ containerId: 'other-container' }] };
  const index = buildIndex([primary, other]);
  const args = { index, isDocker: true, composeProject: 'group', serviceName: 'alpha' };
  assert.deepEqual(findServiceMatches({ ...args, containerIds: ['primary-container'] }), [primary]);
  assert.deepEqual(findServiceMatches({ ...args, containerIds: ['missing-container'] }), []);
  assert.deepEqual(findServiceMatches({ ...args, containerIds: ['primary-container', 'missing-container'] }), []);
  assert.deepEqual(findServiceMatches(args), [primary]);
  assert.deepEqual(findServiceMatches({ index, isDocker: true, composeProject: 'group' }), [primary, other]);
});

test('renaming a service does not change identity-based card membership', () => {
  for (const name of ['arbitrary-one', 'completely-different']) {
    const service = { serviceId: 'group::' + name, name, project: 'group', components: [{ containerId: 'stable-container' }] };
    const result = findServiceMatches({ index: buildIndex([service]), isDocker: true, containerId: 'stable-container' });
    assert.deepEqual(result, [service]);
  }
});

test('a shared service name without project or container identity is ambiguous', () => {
  const services = ['group-one', 'group-two'].map(project => ({ serviceId: project + '::api', name: 'api', project, components: [] }));
  assert.deepEqual(findServiceMatches({ index: buildIndex(services), isDocker: true, serviceName: 'api' }), []);
});

test('project summaries distinguish partial availability from a complete outage', () => {
  assert.equal(mergeColors(['green', 'red']), 'yellow');
  assert.equal(mergeColors(['red', 'red']), 'red');
  assert.equal(mergeColors(['green', 'gray']), 'gray');
  assert.equal(mergeColors(['green', 'green']), 'green');
  assert.equal(mergeColors([]), 'gray');
});

test('polling stops after a missing endpoint', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  let requests = 0;
  let observed;
  const poller = createHealthPoller({ onState: state => { observed = state; }, request: async () => {
    requests += 1;
    return { status: 404, ok: false };
  } });
  await poller.start();
  context.mock.timers.tick(120000);
  await poller.refresh();
  assert.equal(requests, 1);
  assert.equal(observed.enabled, false);
  poller.stop();
});

test('health requests are single-flight and stop ignores late results', async () => {
  let resolveResponse;
  let requests = 0;
  let updates = 0;
  const poller = createHealthPoller({ onState: () => { updates += 1; }, request: () => {
    requests += 1;
    return new Promise(resolve => { resolveResponse = resolve; });
  } });
  const first = poller.start();
  assert.equal(poller.refresh(), first);
  assert.equal(requests, 1);
  poller.stop();
  resolveResponse({ ok: true, status: 200, json: async () => ({ services: [] }) });
  await first;
  assert.equal(updates, 0);
});

test('old health expires on time while refreshes fail and later recovers', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  let healthy = true;
  let observed;
  const poller = createHealthPoller({ onState: state => { observed = state; }, request: async () =>
    healthy ? { status: 200, ok: true, json: async () => ({ services: [{ serviceId: 'generic' }] }) } : { status: 503, ok: false } });
  await poller.start();
  healthy = false;
  context.mock.timers.tick(59999);
  await poller.refresh();
  assert.equal(observed.enabled, true);
  context.mock.timers.tick(1);
  assert.equal(observed.enabled, false);
  assert.equal(observed.stale, true);
  healthy = true;
  await poller.refresh();
  assert.equal(observed.enabled, true);
  assert.equal(observed.stale, false);
  poller.stop();
});

test('unauthorized health polling pauses until an explicit retry', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  let requests = 0;
  const poller = createHealthPoller({ onState: () => {}, request: async () => {
    requests += 1;
    return { status: 401, ok: false };
  } });
  await poller.start();
  context.mock.timers.tick(120000);
  assert.equal(requests, 1);
  await poller.refresh();
  assert.equal(requests, 2);
  poller.stop();
});

test('override application updates explanation immediately and restores auto role on reset', () => {
  const freshPoll = [{
    serviceId: 'stack::http500',
    name: 'http500',
    color: 'gray',
    components: [{
      containerId: 'c500',
      role: 'unknown',
      ruleId: 'R8',
      reason: 'Component importance is not known. Set a role if needed.',
      autoRole: 'unknown',
      autoRuleId: 'R8',
      autoReason: 'Component importance is not known. Set a role if needed.',
      probe: { ok: true, severity: 'yellow', error: 'http-status-500' },
    }],
  }];
  const promoted = applyOverridesToMatches(freshPoll, () => 'core_runtime');
  assert.equal(promoted.components[0].effectiveRole, 'core_runtime');
  assert.equal(promoted.components[0].effectiveRuleId, 'R2');
  assert.equal(promoted.components[0].reason, 'Marked as main service by you.');
  assert.equal(promoted.overrideAdjustedColors.get('stack::http500'), 'yellow');

  const overriddenPoll = [{
    serviceId: 'stack::http500',
    name: 'http500',
    color: 'yellow',
    components: [{
      ...freshPoll[0].components[0],
      role: 'core_runtime',
      ruleId: 'R2',
      reason: 'Marked as main service by you.',
    }],
  }];
  const cleared = applyOverridesToMatches(overriddenPoll, () => null);
  assert.equal(cleared.components[0].effectiveRole, 'unknown');
  assert.equal(cleared.components[0].effectiveRuleId, 'R8');
  assert.equal(cleared.components[0].reason, 'Component importance is not known. Set a role if needed.');
  assert.equal(cleared.overrideAdjustedColors.get('stack::http500'), 'gray');
});

test('revalidate queues a follow-up refresh when a health poll is already in flight', async () => {
  const resolvers = [];
  let requests = 0;
  const poller = createHealthPoller({
    onState: () => {},
    request: () => {
      requests += 1;
      return new Promise((resolve) => { resolvers.push(resolve); });
    },
  });
  const initial = poller.start();
  poller.revalidate();
  assert.equal(requests, 1);
  resolvers[0]({ ok: true, status: 200, json: async () => ({ services: [] }) });
  await initial;
  assert.equal(requests, 2);
  resolvers[1]({ ok: true, status: 200, json: async () => ({ services: [] }) });
  await Promise.resolve();
  poller.stop();
});
