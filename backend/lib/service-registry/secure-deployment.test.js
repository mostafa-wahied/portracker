'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { describe, test, expect } = require('@jest/globals');

const root = path.resolve(__dirname, '../../..');
const profilePath = path.join(root, 'docker-compose.registry-secure.yml');
const config = yaml.load(fs.readFileSync(profilePath, 'utf8'));
const app = config.services?.portracker;
const proxy = config.services?.['docker-api-proxy'];

describe('secure upstream registry deployment contract', () => {
  test('uses a released upstream image and persists the existing database directory', () => {
    expect(config.name).toBe('portracker-registry');
    expect(Object.keys(config.services)).toEqual(['portracker', 'docker-api-proxy']);
    expect(app.build).toBeUndefined();
    expect(app.image).toBe('${PORTRACKER_IMAGE:-mostafawahied/portracker:latest}');
    expect(app.environment.DATABASE_PATH).toBe('/data/portracker.db');
    expect(app.volumes).toContain('${PORTRACKER_DATA_DIR:-./portracker-data}:/data');
    expect(app.environment.SESSION_SECRET).toBe(
      '${SESSION_SECRET:?export_SESSION_SECRET_before_running_compose}'
    );
  });

  test('always enables authentication and only binds the UI to host loopback', () => {
    expect(app.environment.ENABLE_AUTH).toBe('true');
    expect(app.ports).toEqual(['127.0.0.1:4999:4999']);
    expect(app.environment.SERVICE_REGISTRY_ENABLED).toBe('true');
    expect(app.environment.SERVICE_REGISTRY_PROVENANCE_ENABLED).toBe('true');
    expect(app.environment.SERVICE_REGISTRY_DOCKER_PROVENANCE_ENABLED).toBe('true');
    expect(app.environment.SERVICE_REGISTRY_RECOVERY_ENABLED).toBe('true');
    expect(app.environment.SERVICE_REGISTRY_HTTP_ENABLED).toBe(
      '${SERVICE_REGISTRY_HTTP_ENABLED:-true}'
    );
  });

  test('host listener scan uses read-only procfs without broad Docker or Linux privileges', () => {
    expect(app.pid).toBe('host');
    expect(app.environment.HOST_PROC).toBe('/host/proc');
    expect(app.volumes).toContain('/proc:/host/proc:ro');
    expect(app.privileged).toBeUndefined();
    expect(app.cap_add).not.toContain('SYS_ADMIN');
    expect(app.security_opt || []).not.toContain('apparmor:unconfined');
    expect(app.volumes).not.toContain('/var/run/docker.sock:/var/run/docker.sock:ro');
    expect(app.environment.DOCKER_HOST).toBe('tcp://docker-api-proxy:2375');
  });

  test('optional socket proxy permits limited read-only Docker API, with no published port', () => {
    expect(proxy.privileged).toBeUndefined();
    expect(proxy.ports).toBeUndefined();
    expect(proxy.environment.CONTAINERS).toBe('1');
    expect(proxy.environment.INFO).toBe('1');
    expect(proxy.environment.POST).toBe('0');
    expect(proxy.environment.AUTH).toBe('0');
    expect(proxy.environment.SECRETS).toBe('0');
    expect(proxy.environment.DISABLE_IPV6).toBe('1');
    expect(proxy.volumes).toEqual([
      { type: 'bind', source: '${PORTRACKER_DOCKER_SOCK:-/var/run/docker.sock}',
        target: '/var/run/docker.sock', read_only: true },
    ]);
    expect(proxy.networks).toEqual(['docker-monitor']);
    expect(config.networks['docker-monitor'].internal).toBe(true);
    expect(app.networks).toEqual(['default', 'docker-monitor']);
    expect(app.depends_on).toBeUndefined();
  });

  test('upstream migration guide gates release, preserves storage and documents recovery', () => {
    const guide = fs.readFileSync(path.join(root,
      'docs/service-registry-upstream-deployment.md'), 'utf8');
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    expect(readme).toContain('docs/service-registry-upstream-deployment.md');
    expect(guide).toContain('verified upstream');
    expect(guide).toContain('PORTRACKER_DATA_DIR');
    expect(guide).toContain('SESSION_SECRET');
    expect(guide).toContain('before-upstream');
    expect(guide).toContain('Do not run fork and upstream containers');
    expect(guide).toContain('rootless');
    expect(fs.existsSync(path.join(root, 'scripts/validate-registry-compose.mjs')))
      .toBe(true);
  });
});
