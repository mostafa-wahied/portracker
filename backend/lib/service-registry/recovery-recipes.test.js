'use strict';

const { spawnSync } = require('node:child_process');
const { describe, test, expect } = require('@jest/globals');
const { buildRecoveryRecipes, renderCommand, quoteShellArg } = require('./recovery-recipes');

const systemUnit = overrides => ({
  kind: 'systemd_system_service', unitName: 'my-api.service',
  unitScope: 'system', confidence: 'observed', ...overrides,
});
const userUnit = overrides => ({
  kind: 'systemd_user_service', unitName: 'my-dev.service',
  unitScope: 'user', confidence: 'observed', ...overrides,
});
const compose = overrides => ({
  composeProject: 'my-project', composeService: 'web',
  projectWorkingDir: '/home/dev/my project',
  configFilePaths: ['/home/dev/my project/compose.yml'],
  containerId: 'a'.repeat(64), ...overrides,
});

describe('copy-only recovery recipe generator', () => {
  test('system service commands are scoped to system, not user manager', () => {
    const recipes = buildRecoveryRecipes({ linuxProvenance: systemUnit() });
    expect(recipes.map(r => r.type)).toEqual([
      'systemd-start', 'systemd-status', 'systemd-journal',
    ]);
    expect(recipes[0].command).toContain("'systemctl' 'start' 'my-api.service'");
    expect(recipes[0].command).not.toContain("'--user'");
    expect(recipes[1].command).toContain("'status'");
    expect(recipes[2].command).toContain("'journalctl' '-u'");
    expect(recipes[0].hostScope).toBe('linux-host');
  });

  test('systemd user services get only user-scoped commands', () => {
    const recipes = buildRecoveryRecipes({ linuxProvenance: userUnit() });
    expect(recipes).toHaveLength(3);
    expect(recipes[0].command).toContain("'systemctl' '--user' 'start'");
    expect(recipes[2].command).toContain("'journalctl' '--user' '-u'");
  });

  test('interactive session, missing unit, and misleading systemd names produce no start', () => {
    for (const value of [
      { kind: 'session_scope', confidence: 'observed', unitName: 'my-dev.service' },
      systemUnit({ confidence: 'unavailable' }),
      userUnit({ unitName: 'user@1000.service', unitScope: null }),
      systemUnit({ unitName: "foo'; rm -rf /.service" }),
      { kind: 'manual', cwd: '/home/dev/project' },
    ]) {
      expect(buildRecoveryRecipes({ linuxProvenance: value })).toEqual([]);
    }
  });

  test('Compose recipe uses only structured project/service and Docker-host files', () => {
    const recipes = buildRecoveryRecipes({ dockerProvenance: compose() });
    expect(recipes).toHaveLength(1);
    expect(recipes[0].type).toBe('compose-up');
    expect(recipes[0].confidence).toBe('unverified');
    expect(recipes[0].hostScope).toBe('docker-host');
    expect(recipes[0].command).toContain("'docker' 'compose'");
    expect(recipes[0].command).toContain("'--project-directory' '/home/dev/my project'");
    expect(recipes[0].command).toContain("'-f' '/home/dev/my project/compose.yml'");
    expect(recipes[0].command).toContain("'-p' 'my-project' 'up' '-d' 'web'");
    expect(recipes[0].caveats.join(' ')).toContain('Verify');
  });

  test('Compose without config files, bad project, or untrusted paths never guesses', () => {
    for (const value of [
      compose({ configFilePaths: [] }),
      compose({ composeProject: 'bad; rm -rf /' }),
      compose({ configFilePaths: ['/home/x\nnode'] }),
      compose({ configFilePaths: ['relative.yml'] }),
      compose({ composeService: '--evil' }),
    ]) {
      expect(buildRecoveryRecipes({ dockerProvenance: value })).toEqual([]);
    }
  });

  test('standalone Docker containers yield read-only inspection, never docker start', () => {
    const recipes = buildRecoveryRecipes({ dockerProvenance: {
      containerId: 'a'.repeat(64), containerName: 'db', image: 'postgres:16',
    } });
    expect(recipes).toHaveLength(1);
    expect(recipes[0].type).toBe('docker-inspect');
    expect(recipes[0].command).toContain("'docker' 'inspect'");
    expect(recipes[0].command).not.toContain("'start'");
    expect(buildRecoveryRecipes({ dockerProvenance: {
      containerId: 'old-invalid',
    } })).toEqual([]);
  });

  test('POSIX quoting preserves apostrophes, Unicode, spaces and shell metacharacters', () => {
    const dangerous = "a'b $(echo UNWANTED) ; 🐱";
    const command = renderCommand(['printf', '%s', dangerous]);
    const shell = spawnSync('sh', ['-c', command], { encoding: 'utf8' });
    expect(shell.status).toBe(0);
    expect(shell.stdout).toBe(dangerous);
    expect(quoteShellArg(dangerous)).toContain("'\\''");
    expect(() => quoteShellArg('hello\nworld')).toThrow('Invalid command argument');
    expect(() => quoteShellArg('\0')).toThrow('Invalid command argument');
  });

  test('injected raw argv, environment and labels never affect suggested commands', () => {
    const secret = 'SENSITIVE_SECRET_BEARER_TOKEN';
    const recipes = buildRecoveryRecipes({
      dockerProvenance: {
        ...compose(), rawLabels: { TOKEN: secret }, env: [secret],
        command: 'docker compose --password=' + secret,
      },
    });
    expect(JSON.stringify(recipes)).not.toContain(secret);
  });
});
