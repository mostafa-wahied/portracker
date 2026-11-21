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

  test('strict TCP collection accepts an IPv4-only host', async () => {
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
      const snapshot = await captureHostTcp({ parser, dockerized: true, hostProcTrusted: true });
      expect(snapshot.complete).toBe(true);
      expect(snapshot.rows).toEqual([expect.objectContaining({
        host_ip: '127.0.0.1', host_port: 4177, protocol: 'tcp',
      })]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('strict TCP collection rejects a missing IPv6 table with IPv6 indicators', async () => {
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

  test('strict TCP collection rejects a missing IPv4 table even on IPv4-only hosts', async () => {
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
