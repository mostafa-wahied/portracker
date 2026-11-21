import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import whatsNewConfig from '../frontend/src/lib/whats-new-config.js';
import { chromium } from 'playwright';

async function assertLayout(page) {
  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, content: document.documentElement.scrollWidth }));
  assert(dimensions.content <= dimensions.width + 1, 'Page exceeds viewport width');
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible()) {
    const bounds = await dialog.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.y >= 0, 'Dialog starts outside viewport');
    assert(bounds.x + bounds.width <= dimensions.width + 1, 'Dialog exceeds viewport');
  }
}

async function signIn(page, credentials) {
  await page.getByLabel('Username', { exact: true }).fill(credentials.username);
  await page.getByLabel('Password', { exact: true }).fill('incorrect');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByText('Invalid credentials', { exact: true }).waitFor();
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByPlaceholder('Search ports, processes...').waitFor();
}

export function releaseNoticePlan(changelog, version, generateNotes, config = whatsNewConfig) {
  const versions = [...changelog.matchAll(/^##\s+\[(\d+\.\d+\.\d+)\]/gm)].map(match => match[1]);
  versions.sort((first, second) => second.localeCompare(first, undefined, { numeric: true }));
  assert.equal(versions[0], version, 'Current release must be the newest changelog version');
  assert.equal(new Set(versions).size, versions.length, 'Duplicate changelog version');
  const visible = versions.filter(candidate => !config.ignoreVersions?.includes(candidate) &&
    generateNotes(candidate).split('\n').some(line => line.startsWith('- **')));
  const initial = visible.slice(0, Math.max(1, config.maxVersionsOnFirstOpen || 1));
  const freshVersion = initial.length > 1 ? `${initial.at(-1)} - ${initial[0]}` : initial[0] || null;
  return { freshVersion, previousVersion: versions[1] || null, currentVisible: visible.includes(version) };
}

export async function releaseNotice(page, version) {
  const button = page.getByRole('banner').locator('button').filter({ has: page.locator('svg.lucide-sparkles') });
  if (!version) {
    assert.equal(await button.count(), 0, 'No visible releases should expose a notice button');
    assert.equal(await page.getByRole('dialog').count(), 0, 'No visible releases should open a notice');
    return;
  }
  await button.click();
  await page.getByRole('heading', { name: `What's New in portracker ${version}`, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Back to dashboard', exact: true }).waitFor();
  await assertLayout(page);
  await page.getByRole('button', { name: 'Back to dashboard', exact: true }).click();
}

export async function upgradeNotice(page, options) {
  if (!options.noticePlan.previousVersion) return;
  await page.evaluate(previous => {
    localStorage.setItem('portracker_last_seen_version', previous);
    localStorage.removeItem('portracker_whats_new_dismissed');
  }, options.noticePlan.previousVersion);
  await page.clock.install();
  const changelog = page.waitForResponse(response => new URL(response.url()).pathname === '/api/changelog');
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal((await changelog).status(), 200);
  await page.getByPlaceholder('Search ports, processes...').waitFor();
  await page.clock.runFor(2000);
  if (options.noticePlan.currentVisible) {
    await page.getByRole('heading', { name: `What's New in portracker ${options.version}`, exact: true }).waitFor();
    await assertLayout(page);
    await page.getByRole('button', { name: "Don't show again", exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('portracker_last_seen_version')), options.version);
  } else {
    assert.equal(await page.getByRole('dialog').count(), 0, 'A hidden release must not open an empty notice');
    assert.equal(await page.getByRole('banner').locator('button').filter({ has: page.locator('svg.lucide-sparkles') }).count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('portracker_last_seen_version')), options.noticePlan.previousVersion);
  }
}

async function settings(page) {
  await page.locator('button').filter({ has: page.locator('svg.lucide-user') }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  await assertLayout(page);
  const toggle = page.getByRole('dialog').getByRole('switch').first();
  const previous = await toggle.getAttribute('aria-checked');
  await toggle.click();
  const expected = previous === 'true' ? 'false' : 'true';
  await page.waitForFunction(value => localStorage.getItem('showIcons') === value, expected);
  assert.equal(await toggle.getAttribute('aria-checked'), expected);
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Search ports, processes...').waitFor();
  await page.locator('button').filter({ has: page.locator('svg.lucide-user') }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), expected);
  await page.keyboard.press('Escape');
}

async function memoryLabels(page, options) {
  for (const [name, memory] of [['contract-vm', '1 GB'], ['contract-lxc-4g', '4 GB'], ['contract-lxc-8g', '8 GB']]) {
    const heading = page.getByRole('heading', { name, exact: true });
    await heading.waitFor();
    const card = heading.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
    await card.getByText(memory, { exact: true }).waitFor();
    await card.scrollIntoViewIfNeeded();
    const bounds = await card.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= options.viewport.width, 'Memory card is clipped');
    await card.screenshot({ path: path.join(options.artifacts, `${options.viewport.width}-${name}.png`), animations: 'disabled' });
  }
}

async function peerWarning(page, options) {
  await page.goto(options.baseUrl + '/?server=local', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Search ports, processes...').waitFor();
  const add = page.getByRole('button', { name: 'Add Server', exact: true });
  const tip = page.getByRole('button', { name: 'Not now', exact: true });
  if (await tip.isVisible()) await tip.click();
  if (options.viewport.width < 768) await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
  await add.waitFor();
  await add.click();
  await page.locator('#label').fill('Security fixture');
  await page.locator('#server-url').fill('http://fixture:8080');
  await page.locator('#apiKey').fill('synthetic-ui-key');
  const warning = page.getByText('HTTP sends this key without encryption. Use HTTPS or an encrypted VPN on untrusted networks.', { exact: true });
  await warning.waitFor();
  const refresh = page.getByRole('banner').locator('button').filter({ has: page.locator('svg.lucide-refresh-cw') });
  await refresh.waitFor();
  const scan = page.waitForResponse(response => new URL(response.url()).pathname === '/api/servers/local/scan');
  await refresh.evaluate(button => button.click());
  assert.equal((await scan).status(), 200);
  await refresh.waitFor();
  assert.equal(await page.locator('#label').inputValue(), 'Security fixture');
  assert.equal(await page.locator('#server-url').inputValue(), 'http://fixture:8080');
  assert.equal(await page.locator('#apiKey').inputValue(), 'synthetic-ui-key');
  await warning.scrollIntoViewIfNeeded();
  const bounds = await warning.boundingBox();
  assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= options.viewport.width);
  await page.screenshot({ path: path.join(options.artifacts, `${options.viewport.width}-peer-warning.png`), animations: 'disabled' });
  await page.locator('#server-url').fill('https://fixture:9443');
  await warning.waitFor({ state: 'hidden' });
  assert.equal(await warning.count(), 0);
  await page.goto(options.baseUrl + '/?server=local', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Search ports, processes...').waitFor();
}

async function remoteDiagnostics(page, options) {
  const scan = await page.request.get(options.baseUrl + '/api/servers/auth-peer/scan');
  assert.equal(scan.status(), 200);
  const port = (await scan.json()).ports.find(row => Number(row.host_port) === 18080);
  assert(port?.container_id, 'Discovered peer port must identify its container');
  const previousLayout = await page.evaluate(() => localStorage.getItem('portLayout'));
  for (const layout of ['list', 'grid', 'table']) {
  await page.evaluate(value => localStorage.setItem('portLayout', value), layout);
  await page.goto(`${options.baseUrl}/?server=auth-peer&container=${encodeURIComponent(port.container_id)}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Container Details', exact: true }).waitFor();
  await page.getByRole('button', { name: /More Details/ }).click();
  await page.getByRole('button', { name: /JSON \(raw inspect\)/ }).click();
  const guidance = page.getByText('Raw diagnostics require signing in on this server directly. Peer keys allow standard details only.', { exact: true });
  await guidance.waitFor(); await guidance.scrollIntoViewIfNeeded();
  assert.equal(await page.getByRole('button', { name: 'Load Raw', exact: true }).count(), 0);
  const link = page.getByRole('link', { name: 'Open remote server', exact: true });
  assert.equal(await link.getAttribute('href'), `http://auth-peer:4999/?server=local&container=${encodeURIComponent(port.container_id)}`);
  await link.scrollIntoViewIfNeeded();
  const linkBounds = await link.boundingBox();
  assert(linkBounds && linkBounds.x >= 0 && linkBounds.x + linkBounds.width <= options.viewport.width && linkBounds.y >= 0 && linkBounds.y + linkBounds.height <= options.viewport.height, 'Remote login action is clipped');
  const bounds = await guidance.boundingBox();
  assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= options.viewport.width);
  await page.screenshot({ path: path.join(options.artifacts, `${options.viewport.width}-remote-diagnostics-${layout}.png`), animations: 'disabled' });
  }
  await page.evaluate(value => { if (value === null) localStorage.removeItem('portLayout'); else localStorage.setItem('portLayout', value); }, previousLayout);
  await page.goto(options.baseUrl + '/?server=local', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Search ports, processes...').waitFor();
}

function createRegistryHistoryFixture() {
  const records = Array.from({ length: 105 }, (_, index) => ({
    id: 'history-fixture-' + index,
    serverId: 'local',
    displayName: index === 104 ? 'example-unknown' : 'example-service-' + index,
    source: index % 3 === 0 ? 'docker' : 'system',
    identityConfidence: 'uncertain',
    firstSeenAt: 1730000000000,
    lastSeenAt: 1730000000000 + index * 60000,
    status: index === 104 ? 'unknown' : 'offline',
    previewHostIp: '127.0.0.1',
    previewPort: 3000 + index,
    previewProtocol: 'tcp',
    endpointCount: 1,
    httpTitle: index === 79 ? 'Verified Local Root' : null,
    httpRootUrl: index === 79 ? 'http://127.0.0.1:3079/' : null,
    iconHash: index === 79 ? 'a'.repeat(64) : null,
    metadataFetchedAt: index === 79 ? 1730000000000 : null,
  }));
  const urlPattern = '**/api/service-registry**';
  const handleRegistryRequest = async route => {
    const req = route.request();
    const uri = new URL(req.url());
    const suffix = uri.pathname.replace('/api/service-registry', '');
    const json = (body, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    if (suffix.startsWith('/icons/')) {
      return route.fulfill({
        status: 200, contentType: 'image/png',
        headers: { 'x-content-type-options': 'nosniff' },
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WkW3+IAAAAASUVORK5CYII=', 'base64'),
      });
    }
    if (suffix === '/scan-status') {
      return json({ enabled: true, sources: [
        { source: 'system', outcome: 'complete', lastSuccessAt: 1730000000000 },
        { source: 'docker', outcome: 'failed', lastSuccessAt: 1729990000000 },
      ] });
    }
    if (suffix && suffix !== '/') {
      const id = decodeURIComponent(suffix.slice(1));
      const item = records.find(row => row.id === id);
      if (!item) return json({ error: 'Saved service not found' }, 404);
      if (req.method() === 'DELETE') {
        records.splice(records.indexOf(item), 1);
        return route.fulfill({ status: 204, body: '' });
      }
      return json({ ...item, dockerProvenance: id === 'history-fixture-78' ? {
        composeProject: 'demo', composeService: 'web',
        containerName: 'demo-web-1', image: 'nginx:stable',
        networkMode: 'bridge', hostFingerprint: 'a'.repeat(64),
        projectWorkingDir: '/home/dev/demo',
        configFilePaths: ['/home/dev/demo/compose.yml'],
        pathScope: 'docker-host', identityConfidence: 'verified',
        capturedAt: 1730000000000,
      } : null, linuxProvenance: id === 'history-fixture-79' ? {
        kind: 'systemd_user_service', confidence: 'observed',
        unitName: 'dev.service', unitScope: 'user',
        pid: 777, uid: 1000, processStartTicks: '876543',
        cwd: '/home/dev/app', executablePath: '/nix/store/node/bin/node',
        capturedAt: 1730000000000,
      } : null, endpoints: [
        { id: 'endpoint-' + id, source: item.source, hostIp: item.previewHostIp,
          hostPort: item.previewPort, protocol: 'tcp', lastSeenAt: item.lastSeenAt },
      ] });
    }
    const filters = uri.searchParams;
    const search = (filters.get('search') || '').toLowerCase();
    const source = filters.get('source');
    const status = filters.get('status');
    const port = filters.get('port');
    const since = Number(filters.get('seenSince') || 0);
    const matching = records.filter(row =>
      (!search || row.displayName.toLowerCase().includes(search)) &&
      (!source || row.source === source) &&
      (!status || row.status === status) &&
      (!port || row.previewPort === Number(port)) &&
      (!since || row.lastSeenAt >= since)
    ).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    const offset = Number(filters.get('offset') || 0);
    const limit = Number(filters.get('limit') || 24);
    return json({ items: matching.slice(offset, offset + limit), total: matching.length, offset, limit });
  };

  return { records, urlPattern, handleRegistryRequest };
}

async function registryHistoryNavigation(page, options) {
  const { records, urlPattern, handleRegistryRequest } = createRegistryHistoryFixture();
  await page.route(urlPattern, handleRegistryRequest);
  try {
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await page.getByRole('heading', { name: 'Service history' }).waitFor();
    await page.getByText('example-unknown', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('offline');
    await page.getByRole('textbox', { name: 'Search saved service names' }).fill('example');
    await page.getByText('Page 1 of 5').waitFor();
    assert.equal(await page.getByText('example-unknown', { exact: true }).count(), 0,
      'A failed source scan must remain unknown, never appear under offline');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText('Page 2 of 5').waitFor();
    await page.getByRole('button', { name: /example-service-78/ }).click();
    await page.getByRole('region', { name: 'Docker launch provenance' }).waitFor();
    await page.getByText('nginx:stable', { exact: true }).waitFor();
    await page.getByRole('button', { name: /example-service-79/ }).click();
    await page.getByText('Remembered endpoints').waitFor();
    await page.getByRole('region', { name: 'Linux launch provenance' }).waitFor();
    await page.getByText('dev.service', { exact: true }).waitFor();
    await page.getByText('Verified Local Root', { exact: true }).first().waitFor();
    await page.locator('img[src="/api/service-registry/icons/' + 'a'.repeat(64) + '"]').first().waitFor();
    const forget = page.getByRole('button', { name: 'Forget this history record' });
    page.once('dialog', dialog => dialog.accept());
    await forget.click();
    await page.getByText('Page 1 of 5').waitFor();
    assert.equal(records.length, 104, 'Forgetting must delete only the selected saved history row');
    await page.screenshot({
      path: path.join(options.artifacts, options.viewport.width + '-history.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('tab', { name: 'Live ports', exact: true }).click();
    await page.getByPlaceholder('Search ports, processes...').waitFor();
  } finally {
    await page.unroute(urlPattern, handleRegistryRequest);
  }
}

async function viewportContract(browser, options) {
  const context = await browser.newContext({ viewport: options.viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    const target = new URL(route.request().url());
    return target.origin === new URL(options.baseUrl).origin ? route.continue() : route.abort();
  });
  try {
    await page.goto(options.baseUrl + '/?server=local', { waitUntil: 'domcontentloaded' });
    await signIn(page, options.credentials);
    const changelog = await context.request.get(options.baseUrl + '/api/changelog');
    assert.equal(changelog.status(), 200);
    assert.equal((await changelog.json()).content.replace(/\r\n/g, '\n'), options.changelog.replace(/\r\n/g, '\n'));
    const notice = page.getByRole('button', { name: 'Back to dashboard', exact: true });
    if (await notice.isVisible()) await notice.click();
    const search = page.getByPlaceholder('Search ports, processes...');
    await search.fill('18080');
    await page.getByText('18080', { exact: true }).first().waitFor();
    await search.fill('');
    await memoryLabels(page, options);
    await registryHistoryNavigation(page, options);
    await releaseNotice(page, options.noticePlan.freshVersion);
    await settings(page);
    await peerWarning(page, options);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await search.waitFor();
    await search.fill('18080');
    await page.getByText('18080', { exact: true }).first().waitFor();
    await assertLayout(page);
    assert.deepEqual(errors, [], 'Unhandled browser errors');
    await page.screenshot({ path: path.join(options.artifacts, `${options.viewport.width}.png`), fullPage: true, animations: 'disabled' });
    const port = page.getByText('18080', { exact: true }).first();
    await port.scrollIntoViewIfNeeded();
    const portBounds = await port.boundingBox();
    assert(portBounds && portBounds.x >= 0 && portBounds.x + portBounds.width <= options.viewport.width, 'Port result is clipped');
    await page.screenshot({ path: path.join(options.artifacts, `${options.viewport.width}-ports.png`), fullPage: true, animations: 'disabled' });
    await remoteDiagnostics(page, options);
    await upgradeNotice(page, options);
    await page.locator('button').filter({ has: page.locator('svg.lucide-user') }).click();
    await page.getByRole('menuitem', { name: 'Logout', exact: true }).click();
    await page.getByRole('button', { name: 'Sign In', exact: true }).waitFor();
    assert.equal((await context.request.get(options.baseUrl + '/api/settings')).status(), 401);
  } catch (error) {
    await page.screenshot({ path: path.join(options.artifacts, `${options.viewport.width}-failed.png`), fullPage: true, animations: 'disabled' });
    fs.writeFileSync(path.join(options.artifacts, `${options.viewport.width}-failed.txt`), await page.locator('body').innerText());
    throw error;
  } finally {
    await context.close();
  }
}

export async function browserContracts(baseUrl, credentials, version) {
  const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const generator = fileURLToPath(new URL('./generate-release-notes.mjs', import.meta.url));
  const noticePlan = releaseNoticePlan(changelog, version, candidate =>
    execFileSync(process.execPath, [generator, candidate], { encoding: 'utf8' }));
  const artifacts = process.env.CONTRACT_ARTIFACTS || path.resolve('test-results');
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await viewportContract(browser, { baseUrl, credentials, version, viewport, artifacts, changelog, noticePlan });
    }
  } finally {
    await browser.close();
  }
}