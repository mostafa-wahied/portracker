'use strict';

const { describe, expect, test } = require('@jest/globals');
const { groupPinnedServices } = require('./pinned-groups');

const FINGERPRINT = 'a'.repeat(64);
const local = (id, values = {}) => ({
  id, serverId: 'local', source: 'system', sources: ['system'],
  displayName: 'node', status: 'listening', pinned: true,
  pinnedAt: 500, lastSeenAt: 700, ...values,
});
const docker = (id, values = {}) => local(id, {
  source: 'docker', sources: ['docker', 'system'], displayName: 'demo-web',
  ...values,
});
const provenance = (id, project = 'demo', fingerprint = FINGERPRINT,
  confidence = 'verified') => ({
  service_id: id, compose_project: project, compose_service: id,
  daemon_fingerprint: fingerprint, identity_confidence: confidence,
});
const endpoint = (id, port, lastSeenAt = 700, internal = 0) => ({
  id: id + '-' + port, service_id: id, host_ip: '127.0.0.1',
  host_port: port, protocol: 'tcp', source: 'docker', internal,
  last_seen_at: lastSeenAt,
});

describe('Pinned group presentation has no impact on durable identity', () => {
  test('verified Compose siblings visually group while keeping own IDs, status, pins and ports', () => {
    const services = [
      docker('web', { status: 'offline', pinnedAt: 200 }),
      docker('db', { pinnedAt: 300 }),
    ];
    const groups = groupPinnedServices(services, [
      endpoint('web', 8080, 600), endpoint('web', 8081),
      endpoint('db', 5432),
    ], [provenance('web'), provenance('db')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: 'compose', name: 'demo', status: 'offline', serviceCount: 2,
      sources: ['docker', 'system'],
    });
    expect(groups[0].services.map(row => row.id)).toEqual(['db', 'web']);
    expect(groups[0].ports.map(row => row.port)).toEqual([5432, 8080, 8081]);
    expect(groups[0].ports.find(row => row.port === 8080).active).toBe(false);
  });

  test('five exposed ports form five chips on one durable Docker service', () => {
    const ports = [54321, 54322, 54323, 54324, 54327];
    const [group] = groupPinnedServices([docker('one')], ports.map(port =>
      endpoint('one', port)), [provenance('one')]);
    expect(group.services).toHaveLength(1);
    expect(group.ports.map(p => p.port)).toEqual(ports);
    expect(group.ports.every(p => p.active)).toBe(true);
  });

  test('duplicate binding observations produce one port chip with both IDs', () => {
    const [group] = groupPinnedServices([docker('web'), docker('worker')], [
      endpoint('web', 4181), endpoint('worker', 4181),
    ], [provenance('web'), provenance('worker')]);
    expect(group.ports).toMatchObject([
      { port: 4181, serviceIds: ['web', 'worker'] },
    ]);
  });

  test('never groups unknown native processes by name, port or user', () => {
    const groups = groupPinnedServices([
      local('n1'), local('n2', { status: 'offline' }),
    ], [endpoint('n1', 3000), endpoint('n2', 3000)], []);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.id)).toEqual(['service:n2', 'service:n1']);
  });

  test('provisional provenance, another host or different daemon cannot merge', () => {
    const groups = groupPinnedServices([
      docker('a'), docker('b'), docker('c'), docker('d', { serverId: 'peer-1' }),
    ], [], [
      provenance('a'), provenance('b', 'demo', 'b'.repeat(64)),
      provenance('c', 'demo', FINGERPRINT, 'provisional'),
      provenance('d'),
    ]);
    expect(groups).toHaveLength(4);
    expect(new Set(groups.map(g => g.id)).size).toBe(4);
  });

  test('historical endpoint remains while offline and identical chip is deduplicated', () => {
    const [g] = groupPinnedServices([docker('app', {
      status: 'offline', lastSeenAt: 900,
    })], [endpoint('app', 4182, 100), endpoint('app', 4182, 200),
      endpoint('app', 4183, 900)], [provenance('app')]);
    expect(g.ports).toHaveLength(2);
    expect(g.ports.map(p => p.port)).toEqual([4182, 4183]);
    expect(g.ports.every(p => !p.active)).toBe(true);
  });
});
