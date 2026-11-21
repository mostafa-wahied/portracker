'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
  daemonFingerprint, extractDockerProvenance, configFilePaths,
  readDockerProvenanceConfig,
} = require('./docker-provenance');

const daemon = { ID: 'AAABBB:CCCDDD:EEEFGG:HHHIII' };
const labels = {
  'com.docker.compose.project': 'my-project',
  'com.docker.compose.service': 'web',
  'com.docker.compose.project.working_dir': '/home/dev/my project',
  'com.docker.compose.project.config_files': '/home/dev/compose.yml,/home/dev/override.yml',
  'secret-token': 'TOP_SECRET_SHOULD_NEVER_BE_SAVED',
};

function inspection(overrides = {}) {
  return {
    Id: 'a'.repeat(64), Name: '/my-project-web-1',
    Config: { Image: 'nginx:stable', Labels: { ...labels } },
    HostConfig: { NetworkMode: 'bridge' },
    NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }] } },
    ...overrides,
  };
}

describe('whitelisted Compose/Docker inspection', () => {
  test('only an explicit authenticated opt-in allows private host path collection', () => {
    expect(readDockerProvenanceConfig({})).toEqual({ enabled: false, requiresAuth: false });
    expect(readDockerProvenanceConfig({
      SERVICE_REGISTRY_DOCKER_PROVENANCE_ENABLED: 'true',
    })).toEqual({ enabled: false, requiresAuth: true });
    expect(readDockerProvenanceConfig({
      SERVICE_REGISTRY_DOCKER_PROVENANCE_ENABLED: 'true', ENABLE_AUTH: 'true',
    })).toEqual({ enabled: true, requiresAuth: false });
  });

  test('accepts daemon ID fingerprint but stores no Docker daemon credentials', () => {
    const fingerprint = daemonFingerprint(daemon);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain('AAABBB');
    expect(daemonFingerprint({ ID: 'too-short' })).toBeNull();
    expect(daemonFingerprint({ ID: 'abc?token=secret' })).toBeNull();
  });

  test('trusted Compose project/service and Docker host paths come only from allowlisted labels', () => {
    const result = extractDockerProvenance({
      ID: 'a'.repeat(12), Names: 'my-project-web-1',
    }, inspection(), daemonFingerprint(daemon));
    expect(result).toMatchObject({
      composeProject: 'my-project', composeService: 'web',
      containerId: 'a'.repeat(64), containerName: 'my-project-web-1',
      image: 'nginx:stable', networkMode: 'bridge',
      projectWorkingDir: '/home/dev/my project',
      configFilePaths: ['/home/dev/compose.yml', '/home/dev/override.yml'],
      hostFingerprint: daemonFingerprint(daemon),
      pathScope: 'docker-host', identityConfidence: 'verified',
    });
    expect(JSON.stringify(result)).not.toContain('TOP_SECRET');
    expect(JSON.stringify(result)).not.toContain('Labels');
    expect(JSON.stringify(result)).not.toContain('HostConfig');
  });

  test('network-inferred project names are never treated as verified Compose labels', () => {
    const plain = inspection({ Config: { Image: 'nginx:stable', Labels: {} } });
    const result = extractDockerProvenance({ ID: 'a'.repeat(12), Names: 'foo-web-1' },
      plain, daemonFingerprint(daemon));
    expect(result.composeProject).toBeNull();
    expect(result.composeService).toBeNull();
    expect(result.identityConfidence).toBe('provisional');
  });

  test('rejects malicious paths, partial labels, and arbitrary image strings', () => {
    const mixed = inspection({
      Config: { Image: 'https://token:secret@example.com/img',
        Labels: { ...labels, 'com.docker.compose.service': 'web; rm -rf /',
          'com.docker.compose.project.config_files': '/good.yml,../bad.yml' } },
    });
    const result = extractDockerProvenance({}, mixed, daemonFingerprint(daemon));
    expect(result.composeProject).toBeNull();
    expect(result.composeService).toBeNull();
    expect(result.image).toBeNull();
    expect(result.configFilePaths).toEqual([]);
    expect(result.projectWorkingDir).toBeNull();
    expect(configFilePaths('/file.yml,relative.yml')).toEqual([]);
    expect(configFilePaths('/file.yml')).toEqual(['/file.yml']);
  });

  test('standalone container uses no invented Compose identity', () => {
    const plain = inspection({
      Config: { Image: 'postgres:16', Labels: {} },
      HostConfig: { NetworkMode: 'host' },
    });
    const result = extractDockerProvenance({ ID: 'a'.repeat(12), Names: 'db' },
      plain, daemonFingerprint(daemon));
    expect(result).toMatchObject({
      composeProject: null, composeService: null,
      image: 'postgres:16', networkMode: 'host', identityConfidence: 'provisional',
    });
  });
});
