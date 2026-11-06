import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPortBinding, filterPortGroup, normalizePortFilters } from './port-filters.js';

const all = { docker: true, system: true, binding: 'all' };
const row = (host_ip, extra = {}) => ({ host_ip, host_port: 8080, source: 'docker', ...extra });
const group = data => ({ id: 'local', ok: true, data });

for (const address of ['127.0.0.1', '127.10.20.30', 'localhost', 'LOCALHOST', '::1', '[::1]',
  '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '[::ffff:7f00:1]']) {
  test('server-only binding: ' + address, () => assert.equal(classifyPortBinding(row(address)), 'server'));
}
for (const address of ['0.0.0.0', '::', '[::]', '10.0.0.66', '192.168.1.10', '2001:db8::1',
  'fe80::1%eth0', '::ffff:192.168.1.10']) {
  test('network binding: ' + address, () => assert.equal(classifyPortBinding(row(address)), 'network'));
}
for (const address of [null, undefined, '', ' ', 'not-an-address', 'http://localhost', '999.1.1.1']) {
  test('unknown binding: ' + String(address), () => assert.equal(classifyPortBinding(row(address)), 'unknown'));
}
test('unpublished metadata takes precedence over a placeholder address', () => {
  assert.equal(classifyPortBinding(row('0.0.0.0', { internal: true })), 'unpublished');
  assert.equal(classifyPortBinding(row('127.0.0.1', { internal: true })), 'unpublished');
});
test('old or malformed preferences default to All without losing source choices', () => {
  assert.deepEqual(normalizePortFilters({ docker: false, system: true }), { docker: false, system: true, binding: 'all' });
  for (const saved of [null, undefined, false, {}, { binding: 'invalid' }]) {
    assert.deepEqual(normalizePortFilters(saved), { docker: true, system: false, binding: 'all' });
  }
  assert.equal(normalizePortFilters({ binding: 'network' }).binding, 'network');
});
test('All preserves unknown and internal rows for the existing Internal control', () => {
  const input = group([row('127.0.0.1'), row('0.0.0.0'), row(null), row('0.0.0.0', { internal: true })]);
  assert.deepEqual(filterPortGroup(input, all).data, input.data);
  assert.equal(filterPortGroup(input, { ...all, binding: 'server' }).data.length, 1);
  assert.equal(filterPortGroup(input, { ...all, binding: 'network' }).data.length, 1);
});
test('source, binding and search filters combine without changing ignored flags', () => {
  const port = row('127.0.0.1', { source: 'system', owner: 'Example', ignored: true });
  const input = group([port, row('0.0.0.0', { owner: 'Example' })]);
  assert.deepEqual(filterPortGroup(input, { ...all, docker: false, binding: 'server' }, 'example').data, [port]);
  assert.equal(filterPortGroup(input, { ...all, system: false, binding: 'server' }).data.length, 0);
  assert.equal(port.ignored, true);
});
test('binding changes update matching instead of permanently hiding a port', () => {
  const original = row('127.0.0.1', { ignored: false });
  const changed = { ...original, host_ip: '0.0.0.0' };
  assert.equal(filterPortGroup(group([original]), { ...all, binding: 'network' }).data.length, 0);
  assert.equal(filterPortGroup(group([changed]), { ...all, binding: 'network' }).data.length, 1);
  assert.equal(filterPortGroup(group([changed]), { ...all, binding: 'server' }).data.length, 0);
  assert.equal(original.ignored, false);
});
test('unavailable groups are returned unchanged', () => {
  for (const input of [{ ok: false, data: [] }, { ok: true }]) assert.equal(filterPortGroup(input, all), input);
});
