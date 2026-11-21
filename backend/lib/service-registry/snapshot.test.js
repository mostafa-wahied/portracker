'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { describe, expect, test } = require('@jest/globals');
const ProcParser = require('../proc-parser');
const { captureHostTcp, captureDockerPublished } = require('./snapshot');

describe('source-complete port capture', () => {
  test('host /proc collection explicitly requires strict completeness', async () => {
    const calls = [];
    const parser = { getTcpPorts: async opts => {
      calls.push(opts);
      return [{ protocol: 'tcp', host_ip: '127.0.0.1', host_port: 3000, owner: 'node', pid: 10 }];
    } };
    const trusted = await captureHostTcp({ parser, dockerized: true, hostProcTrusted: true });
    expect(trusted.complete).toBe(true);
    expect(trusted.rows[0]).toMatchObject({ source: 'system', host_port: 3000, pid: 10 });
    expect(calls).toEqual([{ strict: true }]);
    expect((await captureHostTcp({ parser, dockerized: true, hostProcTrusted: false })).complete)
      .toBe(false);
    expect((await captureHostTcp({ parser, dockerized: false, hostProcTrusted: false })).complete)
      .toBe(true);
  });

  test('real Linux localhost TCP listener appears in an authoritative snapshot', async () => {
    if (process.platform !== 'linux') return;
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    try {
      const snapshot = await captureHostTcp({ dockerized: false, hostProcTrusted: true });
      expect(snapshot.complete).toBe(true);
      expect(snapshot.rows.some(row => row.host_port === port && row.protocol === 'tcp'))
        .toBe(true);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('provenance is opt-in, per unique PID, and does not affect complete scan status', async () => {
    const parser = { procPath: '/fake/proc', getTcpPorts: async () => [
      { host_ip: '127.0.0.1', host_port: 3000, owner: 'node', pid: 7 },
      { host_ip: '127.0.0.1', host_port: 3001, owner: 'node', pid: 7 },
      { host_ip: '127.0.0.1', host_port: 3002, owner: 'unknown', pid: null },
    ] };
    let reads = 0;
    const provenanceReader = async (pid, options) => {
      reads++;
      expect(pid).toBe(7);
      expect(options.procRoot).toBe('/fake/proc');
      return {
        kind: 'systemd_user_service', unitName: 'dev.service', unitScope: 'user',
        confidence: 'observed', pid, startTicks: '123456', uid: 1000,
      };
    };
    const snapshot = await captureHostTcp({
      parser, dockerized: false, collectProvenance: true, provenanceReader,
    });
    expect(snapshot.complete).toBe(true);
    expect(reads).toBe(1);
    expect(snapshot.rows[0].provenance.unitName).toBe('dev.service');
    expect(snapshot.rows[1].process_start_ticks).toBe('123456');
    expect(snapshot.rows[2].provenance).toBeNull();
    await captureHostTcp({ parser, dockerized: false, collectProvenance: false, provenanceReader });
    expect(reads).toBe(1);
  });

  test('Docker without trusted host proc never stores container-local process provenance', async () => {
    let calls = 0;
    const snapshot = await captureHostTcp({
      parser: { getTcpPorts: async () => [
        { host_ip: '127.0.0.1', host_port: 3000, owner: 'node', pid: 7 },
      ] },
      dockerized: true, hostProcTrusted: false, collectProvenance: true,
      provenanceReader: async () => { calls++; return { startTicks: '123' }; },
    });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.rows[0].provenance).toBeNull();
    expect(calls).toBe(0);
  });

  test('permission errors during provenance read do not mark host TCP scan failed', async () => {
    const snapshot = await captureHostTcp({
      parser: { procPath: '/fake', getTcpPorts: async () => [
        { host_ip: '127.0.0.1', host_port: 3000, owner: 'node', pid: 7 },
      ] },
      dockerized: false, collectProvenance: true,
      provenanceReader: async () => { throw new Error('permission denied'); },
    });
    expect(snapshot.complete).toBe(true);
    expect(snapshot.rows[0].provenance).toBeNull();
  });

  test('strict /proc parser does not call missing tcp6 a successful empty scan', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-proc-fixture-'));
    try {
      fs.mkdirSync(path.join(dir, 'net'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'net', 'tcp'), '  sl  local_address rem_address st\n');
      fs.writeFileSync(path.join(dir, 'net', 'sockstat6'), 'TCP6: inuse 0\n');
      const parser = new ProcParser(dir);
      parser._buildInodeMap = async () => new Map();
      parser._buildInodeMapForInodes = async () => new Map();
      parser.isContainerized = false;
      await expect(parser.getTcpPorts({ strict: true }))
        .rejects.toThrow('Incomplete TCP port snapshot: tcp6');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('strict TCP collection accepts host with IPv4 and no IPv6 stack', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipv4-only-proc-'));
    try {
      fs.mkdirSync(path.join(dir, 'net'), { recursive: true });
      const line = '  0: 0100007F:1051 00000000:0000 0A ' +
        '00000000:00000000 00:00000000 00000000 1000 0 12345 1 ' +
        '0000000000000000 100 0 0 10 0';
      fs.writeFileSync(path.join(dir, 'net', 'tcp'),
        '  sl  local_address rem_address st\n' + line + '\n');
      const parser = new ProcParser(dir);
      parser.isContainerized = false;
      parser._buildInodeMap = async () => new Map();
      parser._buildInodeMapForInodes = async () => new Map();
      const snapshot = await captureHostTcp({
        parser, dockerized: true, hostProcTrusted: true,
      });
      expect(snapshot.complete).toBe(true);
      expect(snapshot.rows).toEqual([expect.objectContaining({
        host_ip: '127.0.0.1', host_port: 4177, protocol: 'tcp',
      })]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('strict collection rejects missing IPv6 table if IPv6 interface evidence exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipv6-incomplete-proc-'));
    try {
      fs.mkdirSync(path.join(dir, 'net'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'net', 'tcp'), '  sl  local_address rem_address st\n');
      fs.writeFileSync(path.join(dir, 'net', 'if_inet6'), '::1 host-loopback\n');
      const parser = new ProcParser(dir);
      parser.isContainerized = false;
      parser._buildInodeMap = async () => new Map();
      parser._buildInodeMapForInodes = async () => new Map();
      await expect(parser.getTcpPorts({ strict: true }))
        .rejects.toThrow('Incomplete TCP port snapshot: tcp6');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('strict collection rejects missing IPv4 table even without IPv6 support', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipv4-missing-proc-'));
    try {
      fs.mkdirSync(path.join(dir, 'net'), { recursive: true });
      const tcp = path.join(dir, 'net', 'tcp');
      fs.writeFileSync(tcp, '  sl  local_address rem_address st\n');
      const parser = new ProcParser(dir);
      parser.isContainerized = false;
      parser._buildInodeMap = async () => new Map();
      fs.rmSync(tcp);
      await expect(parser.getTcpPorts({ strict: true }))
        .rejects.toThrow('Incomplete TCP port snapshot: tcp');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('explicit host proc reads PID 1 net namespace even with few host processes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-proc-netns-'));
    const previous = process.env.HOST_PROC;
    try {
      fs.mkdirSync(path.join(dir, 'net'), { recursive: true });
      fs.mkdirSync(path.join(dir, '1', 'net'), { recursive: true });
      const header = '  sl  local_address rem_address st\n';
      const entry = port => '  0: 0100007F:' + port + ' 00000000:0000 0A ' +
        '00000000:00000000 00:00000000 00000000 1000 0 12345 1 ' +
        '0000000000000000 100 0 0 10 0\n';
      fs.writeFileSync(path.join(dir, 'net', 'tcp'), header + entry('1052'));
      fs.writeFileSync(path.join(dir, '1', 'net', 'tcp'), header + entry('1051'));
      fs.writeFileSync(path.join(dir, '1', 'net', 'tcp6'), header);
      process.env.HOST_PROC = dir;
      const parser = new ProcParser(dir);
      parser.isContainerized = false;
      parser._buildInodeMap = async () => new Map();
      parser._buildInodeMapForInodes = async () => new Map();
      const result = await captureHostTcp({ parser, dockerized: true, hostProcTrusted: true });
      expect(result.complete).toBe(true);
      expect(result.rows.map(row => row.host_port)).toEqual([4177]);
    } finally {
      if (previous === undefined) delete process.env.HOST_PROC;
      else process.env.HOST_PROC = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('strict TCP snapshot rejects malformed headers and truncated rows', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-tcp-malformed-'));
    try {
      fs.mkdirSync(path.join(dir, 'net'), { recursive: true });
      const file = path.join(dir, 'net', 'tcp');
      fs.writeFileSync(path.join(dir, 'net', 'tcp6'),
        '  sl  local_address rem_address st\n');
      const parser = new ProcParser(dir);
      parser.isContainerized = false;
      parser._buildInodeMap = async () => new Map();
      parser._buildInodeMapForInodes = async () => new Map();
      fs.writeFileSync(file, 'not a proc net socket table\n');
      await expect(parser.getTcpPorts({ strict: true }))
        .rejects.toThrow('Incomplete TCP port snapshot: tcp');
      fs.writeFileSync(file, '  sl  local_address rem_address st\ntruncated\n');
      await expect(parser.getTcpPorts({ strict: true }))
        .rejects.toThrow('Incomplete TCP port snapshot: tcp');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('missing Docker inspect data cannot mark saved containers offline', async () => {
    const listed = [{ ID: 'abcdef123456', Names: 'site' }];
    for (const inspection of [{}, { NetworkSettings: {} },
      { NetworkSettings: { Ports: undefined } }, { NetworkSettings: { Ports: [] } },
      { NetworkSettings: { Ports: { 'invalid/tcp': [{ HostPort: '3000' }] } } }]) {
      await expect(captureDockerPublished({
        dockerApi: {
          listContainers: async () => listed,
          inspectContainer: async () => inspection,
        },
      })).rejects.toThrow();
    }
  });

  test('Docker discovery bounds cannot disable the batching loop', async () => {
    const dockerApi = { listContainers: async () => [] };
    for (const settings of [
      { concurrency: 0 }, { concurrency: -1 }, { concurrency: 100 },
      { maxContainers: 0 }, { maxContainers: 10000 },
    ]) {
      await expect(captureDockerPublished({ dockerApi, ...settings }))
        .rejects.toThrow('Invalid Docker discovery limits');
    }
  });

  test('Docker published ports are copied only from successful inspection', async () => {
    const dockerApi = {
      listContainers: async () => [
        { ID: 'abcdef123456', Names: 'site', Image: 'node:22' },
        { ID: 'abcaabca1234', Names: 'worker', Image: 'node:22' },
      ],
      inspectContainer: async id => id === 'abcdef123456'
        ? { NetworkSettings: { Ports: {
          '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '3300' }],
          '3001/tcp': null,
          '3002/udp': [{ HostIp: '127.0.0.1', HostPort: '3302' }],
        } } }
        : { NetworkSettings: { Ports: { '9000/tcp': null } } },
    };
    const snap = await captureDockerPublished({ dockerApi });
    expect(snap.complete).toBe(true);
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0]).toMatchObject({
      source: 'docker', owner: 'site', host_port: '3300',
      host_ip: '127.0.0.1', container_id: 'abcdef123456',
    });
  });

  test('reuses one Docker inspect per container and captures trusted Compose labels', async () => {
    let inspections = 0;
    let infoCalls = 0;
    const dockerApi = {
      listContainers: async () => [{ ID: 'a'.repeat(12), Names: 'project-web-1',
        Image: 'nginx:stable' }],
      getSystemInfo: async () => { infoCalls++; return { ID: 'AAABBB:CCCDDD:EEEFGG:HHHIII' }; },
      inspectContainer: async () => {
        inspections++;
        return {
          Id: 'a'.repeat(64), Name: '/project-web-1',
          Config: { Image: 'nginx:stable', Labels: {
            'com.docker.compose.project': 'project',
            'com.docker.compose.service': 'web',
            'com.docker.compose.project.working_dir': '/home/dev/project',
          } },
          NetworkSettings: { Ports: {
            '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '8080' }],
            '9000/tcp': null,
          } },
        };
      },
    };
    const snap = await captureDockerPublished({ dockerApi });
    expect(snap.complete).toBe(true);
    expect(inspections).toBe(1);
    expect(infoCalls).toBe(1);
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0]).toMatchObject({
      compose_project: 'project', compose_service: 'web',
      container_id: 'a'.repeat(64), host_port: '8080',
      docker_provenance: {
        projectWorkingDir: '/home/dev/project',
        identityConfidence: 'verified',
      },
    });
    expect(snap.rows[0].docker_host_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('unavailable Docker /info does not lose published TCP source coverage', async () => {
    const snap = await captureDockerPublished({
      dockerApi: {
        listContainers: async () => [{ ID: 'a'.repeat(12), Names: 'standalone' }],
        getSystemInfo: async () => { throw new Error('socket proxy denied info'); },
        inspectContainer: async () => ({
          Config: { Image: 'nginx:stable', Labels: {} },
          NetworkSettings: { Ports: {
            '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }],
          } },
        }),
      },
    });
    expect(snap.complete).toBe(true);
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0].docker_host_hash).toBeNull();
    expect(snap.rows[0].docker_provenance.identityConfidence).toBe('provisional');
  });

  test('host-network and internal-only container metadata never fabricate a host port', async () => {
    const snap = await captureDockerPublished({
      dockerApi: {
        listContainers: async () => [{ ID: 'a'.repeat(12), Names: 'hosted' }],
        inspectContainer: async () => ({
          HostConfig: { NetworkMode: 'host' },
          NetworkSettings: { Ports: { '8000/tcp': null, '9000/udp': null } },
        }),
      },
    });
    expect(snap.rows).toEqual([]);
    expect(snap.complete).toBe(true);
  });

  test('Docker API failure never becomes an authoritative empty result', async () => {
    await expect(captureDockerPublished({
      dockerApi: { listContainers: async () => { throw new Error('connection refused'); } },
    })).rejects.toThrow('connection refused');
    await expect(captureDockerPublished({
      dockerApi: { listContainers: async () => [{ ID: 'abcdef123456', Names: 'site' }],
        inspectContainer: async () => { throw new Error('missing container'); } },
    })).rejects.toThrow('missing container');
  });

  test('malformed Docker snapshots are rejected instead of silently reconciled', async () => {
    await expect(captureDockerPublished({
      dockerApi: { listContainers: async () => [{ ID: 'abcdef123456' }],
        inspectContainer: async () => ({ NetworkSettings: { Ports: {
          '3000/tcp': { HostIp: '0.0.0.0', HostPort: '3000' },
        } } }) },
    })).rejects.toThrow('Malformed Docker port bindings');
  });
});
