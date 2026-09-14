const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const WebSocket = require('/app/backend/node_modules/ws');

const containerId = 'c'.repeat(64);
const ports = Array.from({ length: 101 }, (_, index) => ({ PrivatePort: 20000 + index, Type: 'tcp' }));
ports.push({ PrivatePort: 80, PublicPort: 18080, IP: '0.0.0.0', Type: 'tcp' });
const inspection = {
  Id: containerId, Name: '/contract-web', Created: '2026-01-01T00:00:00Z',
  State: { Running: true, Status: 'running', StartedAt: '2026-01-01T00:00:00Z' },
  Config: { Image: 'contract-web:1', Labels: {}, Env: [], ExposedPorts: Object.fromEntries(ports.map(port => [`${port.PrivatePort}/tcp`, {}])) },
  HostConfig: { NetworkMode: 'bridge', PortBindings: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '18080' }] } },
  NetworkSettings: { Ports: Object.fromEntries(ports.map(port => [`${port.PrivatePort}/tcp`, port.PublicPort ? [{ HostIp: '0.0.0.0', HostPort: '18080' }] : null])), Networks: { bridge: { IPAddress: '172.20.0.10', Gateway: '172.20.0.1' } } },
  Mounts: [],
};
let mode = 'ready';
let requests = 0;
const sockets = new Set();
http.createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture');
  const route = url.pathname.replace(/^\/v\d+\.\d+/, '');
  let body;
  if (route === '/mode' && request.method === 'POST') {
    mode = url.searchParams.get('value');
    for (const socket of sockets) socket.close();
    body = { mode };
  } else if (route === '/health') { requests += 1; body = { status: 'ok', version: 'contract' }; }
  else if (route === '/counters') body = { requests };
  else if (route === '/_ping') { response.end('OK'); return; }
  else if (route === '/version') body = { Version: '28.0.0', ApiVersion: '1.47', Os: 'linux', Arch: process.arch };
  else if (route === '/info') body = { OperatingSystem: 'TrueNAS SCALE', Name: 'contract-host', NCPU: 4, MemTotal: 8589934592, ServerVersion: '28.0.0', Containers: 1 };
  else if (route === '/containers/json') body = [{ Id: containerId, Names: ['/contract-web'], Image: 'contract-web:1', State: 'running', Status: 'Up', Labels: {}, Ports: ports, NetworkSettings: inspection.NetworkSettings }];
  else if (route === `/containers/${containerId}/json` || route === `/containers/${containerId.slice(0, 12)}/json`) body = inspection;
  else if (route === '/api/servers/local/scan') body = { platform: 'docker', ports: [{ host_ip: '0.0.0.0', host_port: 8088, protocol: 'tcp', service_name: 'peer-web', source: 'docker', internal: false }], applications: [] };
  else if (route === '/api/version') body = { version: '1.3.10' };
  else if (route === '/api/system-info') body = { hostname: 'contract-peer', platform: 'linux' };
  else if (route === '/api/services') body = { services: [] };
  else if (route === '/api/settings') body = { domain: 'contract.invalid' };
  else { response.writeHead(404); response.end('{}'); return; }
  response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body));
}).listen(8080, '0.0.0.0');
const tls = https.createServer({ key: fs.readFileSync('/fixture/key.pem'), cert: fs.readFileSync('/fixture/cert.pem') });
new WebSocket.Server({ server: tls }).on('connection', socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
  socket.on('message', bytes => {
    const message = JSON.parse(bytes);
    if (mode === 'stall') return;
    if (message.msg === 'connect') { socket.send(JSON.stringify({ msg: 'connected' })); return; }
    let result;
    if (message.method === 'auth.login_with_api_key') result = mode !== 'reject' && message.params[0] === 'contract-only-key';
    else if (message.method === 'system.info') result = { hostname: 'contract-truenas', version: 'TrueNAS-25.10.4', cores: 4, physmem: 8589934592 };
    else if (message.method === 'app.query') result = [{ id: 'native-app', name: 'native-app', state: 'RUNNING', active_workloads: { used_ports: [] } }];
    else if (message.method === 'vm.query') result = [{ id: 1, name: 'contract-vm', status: { state: 'RUNNING' }, vcpus: 2, memory: 1024 }];
    else if (message.method === 'virt.instance.query') result = [
      { id: 'contract-lxc-4g', name: 'contract-lxc-4g', status: 'RUNNING', cpu: 2, memory: 4294967296 },
      { id: 'contract-lxc-8g', name: 'contract-lxc-8g', status: 'RUNNING', cpu: 2, memory: 8589934592 },
    ];
    else result = [];
    socket.send(JSON.stringify({ msg: 'result', id: message.id, result }));
  });
});
tls.listen(9443, '0.0.0.0');