'use strict';

const path = require('node:path');

const UNIT = /^[a-zA-Z0-9][a-zA-Z0-9:_.@-]{0,199}\.service$/;
const COMPOSE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const CONTAINER = /^[a-f0-9]{12,64}$/i;

function quoteShellArg(value) {
  if (typeof value !== 'string' || !value.length || value.length > 2048 ||
      Array.from(value).some(ch => ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127)) {
    throw new TypeError('Invalid command argument');
  }
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function renderCommand(argv) {
  if (!Array.isArray(argv) || argv.length > 32 || argv.length < 1) {
    throw new TypeError('Invalid command');
  }
  return argv.map(quoteShellArg).join(' ');
}

function recipe(type, title, argv, confidence, caveats, hostScope) {
  return { type, title, argv, command: renderCommand(argv), confidence, caveats, hostScope };
}

function systemdRecipes(linux) {
  if (!linux || linux.confidence !== 'observed' || !UNIT.test(linux.unitName || '')) return [];
  const system = linux.kind === 'systemd_system_service' && linux.unitScope === 'system';
  const user = linux.kind === 'systemd_user_service' && linux.unitScope === 'user';
  if (!system && !user) return [];
  const prefix = user ? ['systemctl', '--user'] : ['systemctl'];
  const unit = linux.unitName;
  const caveats = [
    'Observed from a Linux cgroup, not verified installed or runnable now',
    'On NixOS, starting a unit does not persist changes across rebuilds',
  ];
  const journal = user ? ['journalctl', '--user', '-u', unit] :
    ['journalctl', '-u', unit];
  return [
    recipe('systemd-start', 'Start the observed systemd unit',
      [...prefix, 'start', unit], 'observed', caveats, 'linux-host'),
    recipe('systemd-status', 'Inspect the systemd unit status',
      [...prefix, 'status', unit], 'observed', caveats, 'linux-host'),
    recipe('systemd-journal', 'Inspect journal logs',
      journal, 'observed', caveats, 'linux-host'),
  ];
}

function safeRecipePath(value) {
  return typeof value === 'string' && path.isAbsolute(value) && value.length <= 1024 &&
    !Array.from(value).some(ch => ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127);
}

function composeRecipes(docker) {
  if (!docker || !COMPOSE.test(docker.composeProject || '') ||
      !COMPOSE.test(docker.composeService || '') ||
      !Array.isArray(docker.configFilePaths) ||
      !docker.configFilePaths.length || docker.configFilePaths.length > 8 ||
      !docker.configFilePaths.every(safeRecipePath)) return [];
  const argv = ['docker', 'compose'];
  if (safeRecipePath(docker.projectWorkingDir)) {
    argv.push('--project-directory', docker.projectWorkingDir);
  }
  for (const file of docker.configFilePaths) argv.push('-f', file);
  argv.push('-p', docker.composeProject, 'up', '-d', docker.composeService);
  return [recipe('compose-up', 'Suggested Docker Compose recovery',
    argv, 'unverified', [
      'Run from a shell connected to the Docker host, not the Portracker container',
      'Verify that Compose configuration files and the intended project still exist',
      'Command was generated from historical labels, not executed or live-verified',
    ], 'docker-host')];
}

function standaloneDockerRecipes(docker) {
  if (!docker || docker.composeProject || !CONTAINER.test(docker.containerId || '')) return [];
  // A saved ID cannot prove the container still exists. Only offer a read-only
  // inspection; never invent a docker start command from stale metadata.
  return [recipe('docker-inspect', 'Verify the saved container still exists',
    ['docker', 'inspect', docker.containerId], 'unverified', [
      'This is a read-only inspection, NOT a start action',
      'Container IDs may be stale after recreation or removal',
    ], 'docker-host')];
}

function buildRecoveryRecipes({ linuxProvenance = null, dockerProvenance = null } = {}) {
  if (dockerProvenance) {
    const compose = composeRecipes(dockerProvenance);
    if (compose.length) return compose;
    return standaloneDockerRecipes(dockerProvenance);
  }
  return systemdRecipes(linuxProvenance);
}

module.exports = { buildRecoveryRecipes, quoteShellArg, renderCommand };
