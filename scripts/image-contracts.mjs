import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const [imageReference, platform] = process.argv.slice(2);
assert(imageReference && ['linux/amd64', 'linux/arm64'].includes(platform), 'Provide image and explicit Linux platform');
let image = imageReference;
const prefix = `portracker-contract-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const network = prefix;
const accessNetwork = `${prefix}-access`;
const volume = `${prefix}-data`;
const app = `${prefix}-app`;
const fixture = `${prefix}-fixture`;
const relay = `${prefix}-relay`;
const authenticatedPeer = `${prefix}-authenticated-peer`;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const credentials = { username: 'contract-user', password: crypto.randomBytes(24).toString('hex') };
let baseline = 'mostafawahied/portracker@sha256:c7b4143ae32da4642a339d49ef5559c8408862eb1d1aacd9052df46e8ae225cb';
let securityBaseline = process.env.SECURITY_BASELINE_IMAGE || null;
const containers = new Set();
let networkCreated = false;
let accessNetworkCreated = false;
let volumeCreated = false;
let baseUrl;
let cookie;
const checks = [];
const record = name => { checks.push(name); process.stdout.write(JSON.stringify({ check: name, passed: true, platform }) + '\n'); };
function docker(args, timeout = 90000, input) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout, input, maxBuffer: 5000000 });
  assert.equal(result.status, 0, `Docker ${args[0]} failed (${result.error?.code || result.status}); no container logs emitted`);
  return result.stdout.trim();
}
function resolvePlatformImage(reference) {
  if (!reference.includes('@sha256:')) return reference;
  const manifest = JSON.parse(docker(['buildx', 'imagetools', 'inspect', '--raw', reference]));
  if (!Array.isArray(manifest.manifests)) return reference;
  const matches = manifest.manifests.filter(item => `${item.platform?.os}/${item.platform?.architecture}` === platform);
  assert.equal(matches.length, 1, 'Pinned image must contain exactly one requested platform');
  assert.match(matches[0].digest, /^sha256:[a-f0-9]{64}$/);
  return reference.split('@')[0] + '@' + matches[0].digest;
}
async function request(route, options = {}) {
  const response = await fetch(baseUrl + route, {
    method: options.method || 'GET', headers: { ...(options.cookie === false || !cookie ? {} : { Cookie: cookie }), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined, signal: AbortSignal.timeout(options.timeout || 30000),
  });
  const assignedCookie = response.headers.get('set-cookie');
  if (assignedCookie && options.captureCookie) cookie = assignedCookie.split(';')[0];
  const content = await response.text();
  let body;
  try { body = JSON.parse(content); } catch { body = content; }
  return { status: response.status, body };
}
async function waitReady() {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const state = JSON.parse(docker(['inspect', '--format', '{{json .State}}', app]));
    assert(state.Running, 'Application exited before becoming healthy');
    try { if ((await request('/api/health', { cookie: false, timeout: 2000 })).body.status === 'healthy') return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('App readiness deadline exceeded');
}
async function startApp(selectedImage, auth, enhanced = false, databasePath = '/data/contract.db') {
  containers.add(app);
  docker(['run', '-d', '--name', app, '--platform', platform, '--network', network, '--network-alias', 'app', '-v', `${volume}:/data`,
    '-e', `ENABLE_AUTH=${auth}`, '-e', 'SESSION_SECRET=disposable-contract-session-secret', '-e', `DATABASE_PATH=${databasePath}`,
    '-e', 'DOCKER_HOST=tcp://fixture:8080', '-e', 'PORT=4999',
    ...(enhanced ? ['-e', 'TRUENAS_API_KEY=contract-only-key', '-e', 'TRUENAS_WS_BASE=wss://fixture:9443', '-e', 'TRUENAS_WS_CONNECT_TIMEOUT_MS=2000', '-e', 'TRUENAS_TIMEOUT_MS=6000'] : []), selectedImage]);
  cookie = undefined;
  await waitReady();
}
function startRelay() {
  docker(['network', 'create', accessNetwork]); accessNetworkCreated = true;
  containers.add(relay);
  docker(['run', '-d', '--name', relay, '--platform', platform, '--network', accessNetwork, '-p', '127.0.0.1::4999', '--entrypoint', 'node', image, '-e', "const http=require('http');http.createServer((request,response)=>{const upstream=http.request({hostname:'app',port:4999,path:request.url,method:request.method,headers:request.headers},result=>{response.writeHead(result.statusCode,result.headers);result.pipe(response);});upstream.on('error',()=>{response.writeHead(503);response.end();});request.pipe(upstream);}).listen(4999,'0.0.0.0');"]);
  docker(['network', 'connect', network, relay]);
  const ports = JSON.parse(docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', relay]));
  baseUrl = `http://127.0.0.1:${ports['4999/tcp'][0].HostPort}`;
}
function stopApp() { docker(['rm', '-f', app]); containers.delete(app); }
async function login(setup = false) {
  const response = await request(`/api/auth/${setup ? 'setup' : 'login'}`, { method: 'POST', body: credentials, captureCookie: true, cookie: false });
  assert.equal(response.status, 200); assert(cookie);
}
async function seedPreviousRelease() {
  await startApp(baseline, true);
  assert.equal((await request('/api/version')).body.version, '1.3.10');
  await login(true);
  assert.equal((await request('/api/settings', { method: 'PUT', body: { theme: 'dark' } })).status, 200);
  assert.equal((await request('/api/notes', { method: 'POST', body: { server_id: 'local', host_ip: '0.0.0.0', host_port: 18080, protocol: 'tcp', note: 'preserve-this-note' } })).status, 200);
  const annotation = { server_id: 'local', host_ip: '0.0.0.0', host_port: 18081, protocol: 'tcp' };
  assert.equal((await request('/api/ignores', { method: 'POST', body: { ...annotation, ignored: true } })).status, 200);
  assert.equal((await request('/api/custom-service-names', { method: 'POST', body: { ...annotation, custom_name: 'preserved-service' } })).status, 200);
  assert.equal((await request(`/api/services/contract-service/components/${'c'.repeat(64)}/role`, { method: 'PUT', body: { role: 'support' } })).status, 200);
  for (const [id, label] of [['contract-a', 'Alpha'], ['contract-b', 'Beta']]) {
    assert.equal((await request('/api/servers', { method: 'POST', body: { id, label, type: 'peer', url: 'http://fixture:8080', platform_type: 'docker', apiKey: id === 'contract-a' ? 'contract-legacy-peer-value' : null } })).status, 201);
  }
  assert.equal((await request('/api/servers/order', { method: 'PUT', body: { items: [{ id: 'contract-b', position: 0 }, { id: 'local', position: 1 }, { id: 'contract-a', position: 2 }] } })).status, 200);
  assert.equal((await request('/api/settings', { method: 'PUT', body: { autoxposeUrl: 'http://fixture:8080', autoxposeEnabled: true } })).status, 200);
  record('predecessor-data-created'); stopApp();
}
async function assertPreserved() {
  assert.equal((await request('/api/settings')).body.theme, 'dark');
  const notes = await request('/api/notes?server_id=local'); assert.equal(notes.status, 200); assert(notes.body.some(note => note.note === 'preserve-this-note'));
  assert((await request('/api/ignores?server_id=local')).body.some(port => port.host_port === 18081));
  assert((await request('/api/custom-service-names?server_id=local')).body.some(port => port.custom_name === 'preserved-service'));
  assert.equal((await request('/api/overrides')).body.overrides['c'.repeat(64)], 'support');
  const servers = (await request('/api/servers')).body;
  assert.deepEqual(servers.map(server => server.id), ['contract-b', 'local', 'contract-a']);
  assert.equal(servers.find(server => server.id === 'contract-a').label, 'Alpha');
  const encrypted = docker(['exec', app, 'node', '-e', "console.log=console.info=console.warn=console.error=()=>{};const fs=require('fs'),db=require('./db');const row=db.prepare(\"SELECT * FROM servers WHERE id='contract-a'\").get();process.stdout.write(JSON.stringify({encrypted:row.remote_api_key.startsWith('pkey:v1:'),roundtrip:db.peerKeys.open(row)==='contract-legacy-peer-value',mode:fs.statSync('/data/peer-keys.key').mode&511}));"]);
  assert.deepEqual(JSON.parse(encrypted), { encrypted: true, roundtrip: true, mode: 384 });
  const result = docker(['exec', app, 'node', '-e', "const db=new(require('better-sqlite3'))('/data/contract.db',{readonly:true});const count=db.prepare(\"SELECT COUNT(*) AS count FROM user_settings WHERE setting_key IN ('autoxposeUrl','autoxposeEnabled')\").get().count;const migration=db.prepare(\"SELECT COUNT(*) AS count FROM settings_migrations WHERE id='autoxpose-connection-trust-v1'\").get().count;console.log(JSON.stringify({count,migration,integrity:db.pragma('quick_check',{simple:true})}));db.close();"]);
  assert.deepEqual(JSON.parse(result), { count: 0, migration: 1, integrity: 'ok' });
}
async function securityContracts() {
  const routes = [['POST', '/api/servers/local/generate-port'], ['POST', '/api/servers/contract-a/generate-port'], ['GET', '/api/ping?host_ip=127.0.0.1&host_port=8088'], ['GET', `/api/containers/${'c'.repeat(64)}/details?raw=true`], ['GET', '/api/settings'], ['PUT', '/api/settings'], ['GET', '/api/servers'], ['GET', '/api/ports'], ['GET', '/api/all-ports'], ['GET', '/api/notes?server_id=local'], ['GET', '/api/autoxpose/status'], ['POST', '/api/autoxpose/connect'], ['POST', '/api/autoxpose/disconnect'], ['GET', '/api/autoxpose/services'], ['GET', '/api/autoxpose/domain'], ['PUT', '/api/autoxpose/display-mode'], ['PUT', '/api/autoxpose/url-style']];
  for (const [method, route] of routes) assert.equal((await request(route, { method, cookie: false, ...(method === 'GET' ? {} : { body: { url: 'http://fixture:8080' } }) })).status, 401, `${method} ${route}`);
  const counters = () => JSON.parse(docker(['exec', fixture, 'node', '-e', "fetch('http://localhost:8080/counters').then(response=>response.json()).then(value=>console.log(JSON.stringify(value)))"]));
  assert.equal(counters().requests, 0, 'Unauthorized outbound request reached fixture');
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { ...credentials, password: 'incorrect' }, cookie: false })).status, 401);
  await login();
  await confidentialDetails();
  assert.equal((await request('/api/settings', { method: 'PUT', headers: { Origin: 'https://untrusted.invalid' }, body: { theme: 'light' } })).status, 403);
  assert.equal((await request('/api/settings', { method: 'PUT', body: { autoxposeUrl: 'http://fixture:8080' } })).status, 400);
  assert.equal((await request('/api/autoxpose/connect', { method: 'POST', body: { url: 'http://fixture:8080' } })).body.success, true);
  for (const url of ['http://127.0.0.1:9099', 'http://169.254.169.254', 'file:///etc/passwd']) assert.equal((await request('/api/autoxpose/connect', { method: 'POST', body: { url } })).body.success, false);
  assert.equal((await request('/api/autoxpose/status')).body.connected, true);
  record('signed-out-origin-and-outbound-boundaries');
}
async function apiKeyContracts() {
  const endpoint = '/api/settings/servers/local/api-key';
  assert.equal((await request(endpoint, { method: 'POST', cookie: false, body: {} })).status, 401);
  const createKey = async () => {
    const result = await request(endpoint, { method: 'POST', body: {} });
    assert.equal(result.status, 200); assert(typeof result.body.apiKey === 'string' && result.body.apiKey.length > 20);
    return result.body.apiKey;
  };
  const first = await createKey();
  assert.equal((await request(`/api/containers/${'c'.repeat(64)}/details?raw=true`, { cookie: false, headers: { 'X-API-Key': first } })).status, 403);
  const peerDetails = await request(`/api/containers/${'c'.repeat(64)}/details`, { cookie: false, headers: { 'X-API-Key': first } });
  assert.equal(peerDetails.status, 200); assert(!peerDetails.body.raw);
  await pingContracts({ cookie: false, headers: { 'X-API-Key': first } });
  assert.equal((await request('/api/servers/local/generate-port', { method: 'POST', cookie: false, headers: { 'X-API-Key': first } })).status, 200);
  const keyRequest = key => request('/api/overrides', { cookie: false, headers: { 'X-API-Key': key } });
  assert.equal((await keyRequest(first)).status, 200);
  assert.equal((await keyRequest('invalid-contract-key')).status, 401);
  assert.equal((await request('/api/settings', { cookie: false, headers: { 'X-API-Key': first } })).status, 401);
  assert(!JSON.stringify((await request(endpoint)).body).includes(first), 'API key metadata exposed a credential');
  assert(!JSON.stringify((await request('/api/servers')).body).includes(first), 'Server listing exposed a credential');
  const replacement = await createKey();
  assert.equal((await keyRequest(first)).status, 401); assert.equal((await keyRequest(replacement)).status, 200);
  assert.equal((await request(endpoint, { method: 'DELETE' })).status, 200);
  assert.equal((await keyRequest(replacement)).status, 401);
  record('api-key-permissions-rotation-revocation-and-redaction');
}
async function confidentialDetails(options = {}) {
  for (const flags of ['raw=true', 'raw=true&export=true', 'raw=true&server_id=contract-a']) {
    for (const route of [`/api/containers/${'c'.repeat(64)}/details`, `/API/CONTAINERS/${'c'.repeat(64)}/DETAILS/`]) {
      const response = await request(`${route}?${flags}`, options);
      assert.equal(response.status, 200);
      assert(response.body.raw?.Config && !Object.hasOwn(response.body.raw.Config, 'Env'), 'Raw environment field leaked');
      assert(!JSON.stringify(response.body).includes('contract-sensitive-marker'), 'Synthetic environment value leaked');
      assert(!JSON.stringify(response.body).includes('contract-peer-marker'), 'Synthetic peer value leaked');
      assert(!JSON.stringify(response.body).includes('contract-command-marker'), 'Command value leaked');
      assert(!JSON.stringify(response.body).includes('contract-label-marker'), 'Custom label value leaked');
      assert(!Object.hasOwn(response.body, 'command') && Object.keys(response.body.labels || {}).every(label => label.startsWith('com.docker.compose.')));
    }
  }
}
async function authenticatedPeerContracts() {
  containers.add(authenticatedPeer);
  docker(['run', '-d', '--name', authenticatedPeer, '--platform', platform, '--network', network, '--network-alias', 'auth-peer', '--tmpfs', '/data',
    '-e', 'ENABLE_AUTH=true', '-e', 'DATABASE_PATH=/data/peer.db', '-e', 'DOCKER_HOST=tcp://fixture:8080', '-e', 'PORT=4999', image]);
  const setup = "const fs=require('fs');const credentials=JSON.parse(fs.readFileSync(0,'utf8'));(async()=>{const until=Date.now()+60000;let ready=false;while(Date.now()<until){try{const response=await fetch('http://localhost:4999/api/health',{signal:AbortSignal.timeout(1000)});if(response.ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,300));}if(!ready)throw new Error('readiness');const response=await fetch('http://localhost:4999/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)});if(!response.ok)throw new Error('setup');const cookie=response.headers.get('set-cookie').split(';')[0];const key=await fetch('http://localhost:4999/api/settings/servers/local/api-key',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'});if(!key.ok)throw new Error('key');process.stdout.write(JSON.stringify(await key.json()));})().catch(()=>{process.exitCode=1;});";
  const generated = JSON.parse(docker(['exec', '-i', authenticatedPeer, 'node', '-e', setup], 90000, JSON.stringify(credentials)));
  assert(typeof generated.apiKey === 'string');
  assert.equal((await request('/api/servers', { method: 'POST', body: { id: 'auth-peer', label: 'Authenticated Peer', type: 'peer', url: 'http://auth-peer:4999', apiKey: generated.apiKey } })).status, 201);
  const base = `/api/containers/${'c'.repeat(64)}/details?server_id=auth-peer`;
  const details = await request(base);
  assert.equal(details.status, 200);
  assert.equal(details.body.rawDiagnostics.available, false);
  const link = `http://auth-peer:4999/?server=local&container=${'c'.repeat(64)}`;
  assert.equal(details.body.rawDiagnostics.peerUrl, link);
  for (const flags of ['&raw=true', '&raw=true&export=true']) {
    const result = await request(base + flags);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'RAW_DIAGNOSTICS_REQUIRE_REMOTE_LOGIN');
    assert.equal(result.body.peerUrl, link);
    assert(!result.body.raw);
  }
  record('authenticated-peer-standard-details-and-raw-permissions');
}

async function largeInventoryContracts() {
  const mode = enabled => docker(['exec', fixture, 'node', '-e', `fetch('http://localhost:8080/large-inventory?enabled=${enabled}',{method:'POST'}).then(response=>{if(!response.ok)process.exitCode=1;})`]);
  mode(true);
  try {
    const response = await request('/api/servers/contract-a/scan');
    assert.equal(response.status, 200, 'Valid large peer inventory rejected');
    assert.equal(response.body.ports.length, 9600);
  } finally { mode(false); }
  record('large-peer-inventory-within-bounded-budget');
}
async function pingContracts(options = {}) {
  assert.equal((await request('/api/servers/contract-a/scan', options)).status, 200);
  const allowed = await request('/api/ping?server_id=contract-a&host_ip=0.0.0.0&host_port=8088', options);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.reachable, true, 'Discovered private peer service must remain probeable');
  for (const query of ['host_ip=169.254.169.254&host_port=80', 'host_ip=127.0.0.1&host_port=1', 'server_id=contract-a&host_ip=0.0.0.0&host_port=8089', 'server_id=contract-a&host_ip=0.0.0.0&host_port=8088&target_server_url=http://unconfigured.invalid']) {
    assert.equal((await request(`/api/ping?${query}`, options)).status, 403, 'Undiscovered target accepted');
  }
  for (const host of ['fixture/probe#', 'user@fixture', '2130706433', '[::1]:80']) {
    assert.equal((await request(`/api/ping?host_ip=${encodeURIComponent(host)}&host_port=8088`, options)).status, 400);
  }
}
async function rateContracts() {
  let denied = false;
  for (let index = 0; index < 32; index += 1) {
    const response = await request('/api/servers/does-not-exist/generate-port', { method: 'POST' });
    assert([404, 429].includes(response.status));
    if (response.status === 429) { denied = true; break; }
  }
  assert(denied, 'Generation rate limiter did not reject excess requests');
}
async function preservationNegativeControl() {
  const note = { server_id: 'local', host_ip: '0.0.0.0', host_port: 18080, protocol: 'tcp' };
  assert.equal((await request('/api/notes', { method: 'POST', body: { ...note, note: 'deliberately-changed' } })).status, 200);
  await assert.rejects(assertPreserved, { code: 'ERR_ASSERTION' });
  assert.equal((await request('/api/notes', { method: 'POST', body: { ...note, note: 'preserve-this-note' } })).status, 200);
  await assertPreserved(); record('data-loss-negative-control-rejected');
}
async function serviceContracts() {
  const services = await request('/api/services');
  assert.equal(services.status, 200);
  const service = services.body.services.find(item => item.name === 'contract-web');
  assert(service && service.components.length > 0, 'Docker service grouping is missing');
  assert.equal(services.body.overrides['c'.repeat(64)], 'support');
  const endpoint = `/api/services/contract-service/components/${'c'.repeat(64)}/role`;
  assert.equal((await request(endpoint, { method: 'PUT', body: { role: 'invalid' } })).status, 400);
  assert.equal((await request('/api/overrides')).body.overrides['c'.repeat(64)], 'support');
  for (const server of ['local', 'contract-a']) {
    const result = await request(`/api/servers/${server}/generate-port`, { method: 'POST', body: {} });
    assert.equal(result.status, 200); assert(Number.isInteger(result.body.port));
    assert(result.body.port > 0 && result.body.port <= 65535);
    assert(![18080, 8088].includes(result.body.port), 'Port generator suggested an occupied port');
    if (server !== 'local') assert.equal(result.body.meta.fallbackUsed, true);
  }
  record('service-grouping-role-preservation-and-port-generation');
}
async function selectTrueNAS() {
  const local = (await request('/api/servers')).body.find(server => server.id === 'local');
  assert.equal((await request('/api/servers', { method: 'POST', body: { ...local, platform_type: 'truenas' } })).status, 200);
}
async function discoveryContracts() {
  await selectTrueNAS();
  const scan = await request('/api/servers/local/scan?disableCache=true', { timeout: 60000 });
  assert.equal(scan.status, 200); assert(scan.body.ports.some(port => Number(port.host_port) === 18080), 'Published Docker mapping missing');
  assert(!scan.body.ports.some(port => Number(port.host_port) >= 20000 && Number(port.host_port) <= 20100), 'Excess internal ports leaked');
  assert.equal(scan.body.enhancedFeaturesStatus.state, 'ready'); assert.equal(scan.body.systemInfo.enhanced, true);
  assert(scan.body.applications.some(item => item.platform_data?.type === 'truenas_app')); assert(scan.body.vms.length > 0);
  assert.equal(scan.body.vms.find(item => item.id === 1).memory, 1073741824, 'VM memory must convert MiB to bytes');
  for (const [id, memory] of [['contract-lxc-4g', 4294967296], ['contract-lxc-8g', 8589934592]]) {
    const container = scan.body.vms.find(item => item.id === id);
    assert.equal(container?.memory, memory, 'Container memory must stay in bytes');
    assert.equal(container.platform_data.orig_data.memory, memory, 'Raw container memory must be preserved');
  }
  const peer = await request('/api/servers/contract-a/scan'); assert.equal(peer.status, 200); assert(peer.body.ports.some(port => Number(port.host_port) === 8088));
  await pingContracts();
  const cycle = await request('/api/servers/order', { method: 'PUT', body: { items: [{ id: 'contract-a', parentId: 'contract-b', position: 1 }, { id: 'contract-b', parentId: 'contract-a', position: 0 }] } }); assert.equal(cycle.status, 400);
  record('docker-ports-peer-scan-truenas-and-order-integrity');
}
async function failureContract() {
  docker(['exec', fixture, 'node', '-e', "fetch('http://localhost:8080/mode?value=stall',{method:'POST'}).then(response=>{if(!response.ok)process.exitCode=1;})"]);
  docker(['restart', app]); await waitReady(); await login();
  await selectTrueNAS();
  const started = Date.now(); const result = await request('/api/servers/local/scan?disableCache=true', { timeout: 30000 });
  assert.equal(result.status, 200); assert.equal(result.body.enhancedFeaturesStatus.state, 'degraded');
  assert(result.body.ports.some(port => Number(port.host_port) === 18080)); assert(Date.now() - started < 20000);
  docker(['exec', fixture, 'node', '-e', "fetch('http://localhost:8080/mode?value=ready',{method:'POST'}).then(response=>{if(!response.ok)process.exitCode=1;})"]);
  docker(['restart', app]); await waitReady(); await login();
  await discoveryContracts(); record('bounded-enrichment-failure-and-recovery');
}
async function verifyUnpatchedSecurityBaseline() {
  await startApp(securityBaseline, false, false, '/data/security-baseline.db');
  const details = await request(`/api/containers/${'c'.repeat(64)}/details?raw=true`, { cookie: false });
  assert.equal(details.status, 200);
  assert(details.body.raw.Config.Env.some(value => value === 'DATABASE_PASSWORD=contract-sensitive-marker'));
  const probe = await request('/api/ping?host_ip=fixture&host_port=8088', { cookie: false });
  assert.equal(probe.status, 200); assert.equal(probe.body.reachable, true);
  stopApp();
  await startApp(securityBaseline, true, false, '/data/security-baseline.db');
  assert.equal((await request('/api/servers/local/scan', { cookie: false })).status, 401);
  assert.equal((await request('/api/servers/local/generate-port', { method: 'POST', cookie: false })).status, 200);
  stopApp();
  record('unpatched-security-baseline-reproduced');
}
try {
  image = resolvePlatformImage(image);
  baseline = resolvePlatformImage(baseline);
  if (securityBaseline) securityBaseline = resolvePlatformImage(securityBaseline);
  const nativeCode = fs.readFileSync(new URL('./native-contract.cjs', import.meta.url), 'utf8');
  const nativeArgs = ['run', '--rm', '--network', 'none', '--platform', platform, '-e', `EXPECTED_ARCH=${platform === 'linux/arm64' ? 'arm64' : 'x64'}`, '--entrypoint', 'node', image, '-e'];
  const native = docker([...nativeArgs, nativeCode]);
  const expectedVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version;
  assert.equal(JSON.parse(native).version, expectedVersion, 'Shipped package version differs from source');
  if (process.env.SOURCE_SHA) assert.equal(docker(['image', 'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}', image]), process.env.SOURCE_SHA);
  const broken = spawnSync('docker', [...nativeArgs, "require('fs').writeFileSync('/app/backend/node_modules/better-sqlite3/build/Release/better_sqlite3.node','broken-test-binding');\n" + nativeCode], { encoding: 'utf8', timeout: 90000 });
  assert.equal(broken.status, 1); assert(broken.stderr.includes('Native contract failed'), 'Native negative control failed for an unrelated reason');
  record('broken-native-binding-rejected');
  assert.equal(JSON.parse(native).arch, platform === 'linux/arm64' ? 'arm64' : 'x64'); record('native-elf-and-database-execution');
  docker(['network', 'create', '--internal', network]); networkCreated = true;
  docker(['volume', 'create', volume]); volumeCreated = true;
  const openssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'), '-subj', '/CN=fixture', '-days', '1'], { stdio: 'ignore', timeout: 15000 }); assert.equal(openssl.status, 0);
  const fixtureCode = fs.readFileSync(fileURLToPath(new URL('./contract-fixture.cjs', import.meta.url)), 'utf8');
  containers.add(fixture); docker(['run', '-d', '--name', fixture, '--platform', platform, '--network', network, '--network-alias', 'fixture', '-v', `${directory}:/fixture:ro`, '-e', 'DATABASE_PASSWORD=contract-sensitive-marker', '-e', 'UNEXPECTED_NAME=contract-peer-marker', '--entrypoint', 'node', image, '-e', fixtureCode]);
  const realEnvironment = JSON.parse(docker(['inspect', '--format', '{{json .Config.Env}}', fixture]));
  assert(realEnvironment.includes('DATABASE_PASSWORD=contract-sensitive-marker'));
  docker(['exec', fixture, 'node', '-e', "fetch('http://localhost:8080/inspection-env',{method:'POST',body:process.argv[1]}).then(response=>{if(!response.ok)process.exitCode=1;})", JSON.stringify(realEnvironment)]);
  startRelay();
  if (securityBaseline) await verifyUnpatchedSecurityBaseline();
  await seedPreviousRelease(); await startApp(image, true, true); await securityContracts(); await assertPreserved(); record('upgrade-data-and-trust-migration');
  await apiKeyContracts(); await preservationNegativeControl(); await serviceContracts();
  await discoveryContracts(); docker(['restart', app]); await waitReady(); await login(); await assertPreserved(); assert.equal((await request('/api/autoxpose/status')).body.connected, true); record('restart-persistence');
  await failureContract();
  await largeInventoryContracts();
  await authenticatedPeerContracts();
  await rateContracts();
  const { browserContracts } = await import('./browser-contracts.mjs');
  await browserContracts(baseUrl, credentials, JSON.parse(native).version); record('desktop-mobile-browser-contracts');
  assert.equal((await request('/api/servers/auth-peer', { method: 'DELETE' })).status, 200);
  docker(['rm', '-f', authenticatedPeer]); containers.delete(authenticatedPeer);
  await assertPreserved();
  assert.equal((await request('/api/auth/logout', { method: 'POST', body: {} })).status, 200); assert.equal((await request('/api/settings')).status, 401); record('logout-invalidates-session');
  stopApp(); await startApp(image, false, true); assert.equal((await request('/api/auth/status', { cookie: false })).body.authEnabled, false); assert.equal((await request('/api/settings', { cookie: false })).status, 200); await confidentialDetails({ cookie: false }); await pingContracts({ cookie: false }); record('explicit-auth-disabled-mode');
  await assert.rejects(securityContracts, { code: 'ERR_ASSERTION' }); record('authentication-bypass-negative-control-rejected');
  stopApp(); await startApp(image, true, false, '/data/fresh.db');
  assert.equal((await request('/api/auth/status', { cookie: false })).body.setupRequired, true);
  assert.equal((await request('/api/settings', { cookie: false })).status, 401);
  await login(true);
  assert.equal((await request('/api/auth/setup', { method: 'POST', cookie: false, body: credentials })).status, 400);
  docker(['restart', app]); await waitReady(); await login();
  assert.equal((await request('/api/auth/status')).body.setupRequired, false); record('fresh-install-setup-once-and-restart');
} catch (error) {
  process.stderr.write(JSON.stringify({ platform, passed: false, failedAfter: checks, error: error.message }) + '\n'); process.exitCode = 1;
} finally {
  const failures = [];
  for (const name of containers) { const result = spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8', timeout: 30000 }); if (result.status !== 0) failures.push('container:' + name); }
  if (volumeCreated && spawnSync('docker', ['volume', 'rm', volume], { encoding: 'utf8', timeout: 15000 }).status !== 0) failures.push('volume');
  if (networkCreated && spawnSync('docker', ['network', 'rm', network], { encoding: 'utf8', timeout: 15000 }).status !== 0) failures.push('network');
  if (accessNetworkCreated && spawnSync('docker', ['network', 'rm', accessNetwork], { encoding: 'utf8', timeout: 15000 }).status !== 0) failures.push('access-network');
  fs.rmSync(directory, { recursive: true, force: true });
  if (failures.length) { process.stderr.write(JSON.stringify({ cleanupFailed: failures }) + '\n'); process.exitCode = 1; }
  else record('owned-resource-cleanup');
}