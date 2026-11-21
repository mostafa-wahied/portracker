'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { describe, test, expect } = require('@jest/globals');
const {
  readLinuxProvenanceConfig, parseCgroup, parseStartTicks,
  readLinuxProcessProvenance,
} = require('./linux-provenance');

function sampleStat(ticks = '123456') {
  const fields = Array(25).fill('0');
  fields[0] = 'S';
  fields[19] = ticks;
  return '4321 (node (with spaces)) ' + fields.join(' ') + '\n';
}

async function procFixture(callback, cgroup = '0::/system.slice/sshd.service\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-proc-'));
  const proc = path.join(dir, '4321');
  fs.mkdirSync(proc);
  fs.writeFileSync(path.join(proc, 'stat'), sampleStat());
  fs.writeFileSync(path.join(proc, 'status'), 'Name:\tnode\nUid:\t1000\t1000\t1000\t1000\n');
  fs.writeFileSync(path.join(proc, 'cgroup'), cgroup);
  fs.symlinkSync('/home/dev/my app', path.join(proc, 'cwd'));
  fs.symlinkSync('/nix/store/1234-node/bin/node', path.join(proc, 'exe'));
  try { return await callback(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

describe('safe Linux systemd process attribution', () => {
  test('requires an explicit opt-in and authenticated Portracker mode', () => {
    expect(readLinuxProvenanceConfig({})).toEqual({ enabled: false, requiresAuth: false });
    expect(readLinuxProvenanceConfig({
      SERVICE_REGISTRY_PROVENANCE_ENABLED: 'true',
    })).toEqual({ enabled: false, requiresAuth: true });
    expect(readLinuxProvenanceConfig({
      SERVICE_REGISTRY_PROVENANCE_ENABLED: 'true', ENABLE_AUTH: 'true',
    })).toEqual({ enabled: true, requiresAuth: false });
  });

  test('reads field 22 correctly even when process name contains parentheses', () => {
    expect(parseStartTicks(sampleStat())).toBe('123456');
    expect(parseStartTicks('not a proc stat')).toBeNull();
    expect(parseStartTicks(sampleStat('not-a-tick'))).toBeNull();
  });

  test('disambiguates system service, user service, manager and session scope', () => {
    expect(parseCgroup('0::/system.slice/ssh.service\n')).toMatchObject({
      kind: 'systemd_system_service', unitName: 'ssh.service', unitScope: 'system',
    });
    expect(parseCgroup('0::/user.slice/user-1000.slice/user@1000.service/app.slice/dev.service\n'))
      .toMatchObject({
        kind: 'systemd_user_service', unitName: 'dev.service', unitScope: 'user',
      });
    expect(parseCgroup('0::/user.slice/user-1000.slice/user@1000.service/app.slice\n'))
      .not.toHaveProperty('unitName', 'user@1000.service');
    expect(parseCgroup('0::/user.slice/user-1000.slice/session-2.scope\n').kind)
      .toBe('session_scope');
    expect(parseCgroup('3:name=systemd:/system.slice/my-service.service\n'))
      .toMatchObject({ kind: 'systemd_system_service', unitName: 'my-service.service' });
  });

  test('recognizes Docker/container-managed processes instead of systemd units', () => {
    const cgroups = [
      '0::/system.slice/docker-abcdefabcdefabcdefabcdef.scope\n',
      '0::/kubepods.slice/pod-1234/docker-abcdef.scope\n',
      '0::/user.slice/user-1000.slice/libpod-abcdef.scope\n',
    ];
    for (const text of cgroups) expect(parseCgroup(text).kind).toBe('container');
  });

  test('captures systemd unit, UID, cwd and executable without raw argv', async () => {
    await procFixture(async procRoot => {
      const evidence = await readLinuxProcessProvenance(4321, {
        procRoot, bootId: 'a1b2c3d4-0000-4444-8888-eeeeffffffff',
      });
      expect(evidence).toMatchObject({
        kind: 'systemd_system_service', confidence: 'observed',
        unitName: 'sshd.service', unitScope: 'system',
        pid: 4321, uid: 1000, startTicks: '123456',
        cwd: '/home/dev/my app',
        executablePath: '/nix/store/1234-node/bin/node',
      });
      expect(evidence).not.toHaveProperty('argv');
      expect(evidence).not.toHaveProperty('env');
      expect(evidence).not.toHaveProperty('cmdline');
    });
  });

  test('missing optional proc fields degrades to unknown, not an error', async () => {
    await procFixture(async procRoot => {
      const file = path.join(procRoot, '4321', 'cgroup');
      fs.rmSync(file);
      const evidence = await readLinuxProcessProvenance(4321, { procRoot });
      expect(evidence.kind).toBe('unknown');
      expect(evidence.confidence).toBe('unavailable');
      expect(evidence.startTicks).toBe('123456');
    });
  });

  test('rejects recycled PID when stat start tick changes during observation', async () => {
    await procFixture(async procRoot => {
      let reads = 0;
      const io = {
        readFile: async (file, encoding) => {
          if (file.endsWith('/stat')) {
            reads++;
            return reads === 1 ? sampleStat('123456') : sampleStat('987654');
          }
          return fsp.readFile(file, encoding);
        },
        readlink: file => fsp.readlink(file),
      };
      expect(await readLinuxProcessProvenance(4321, { procRoot, io })).toBeNull();
    });
  });

  test('will not read arbitrary PIDs or traverse outside numeric proc entries', async () => {
    for (const pid of [0, -1, 1.5, NaN, '../../etc/passwd', 9999999999]) {
      expect(await readLinuxProcessProvenance(pid)).toBeNull();
    }
  });

  test('unreadable or exited process does not leak paths or throw', async () => {
    const io = {
      readFile: async () => { throw Object.assign(new Error('/secret/proc/path'), { code: 'EACCES' }); },
      readlink: async () => { throw new Error('secret'); },
    };
    expect(await readLinuxProcessProvenance(1234, { io })).toBeNull();
  });
});
