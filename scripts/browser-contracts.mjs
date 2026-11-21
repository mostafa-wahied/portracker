import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import whatsNewConfig from '../frontend/src/lib/whats-new-config.js';
import { chromium } from 'playwright';
import { createRegistryHistoryFixture } from './registry-history-fixture.mjs';
import { phaseAContracts } from './phase-a-browser-contracts.mjs';
import { phaseCContracts } from './phase-c-browser-contracts.mjs';
import { historyHeaderContracts } from './phase-b-browser-contracts.mjs';
import { assertFlatRegistryDetails } from './phase-3-browser-contracts.mjs';

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

async function applyRegistrySearch(page, search) {
  const applied = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/service-registry' &&
      url.searchParams.get('search') === search && response.status() === 200;
  });
  await page.getByRole('textbox', { name: 'Search saved service names' }).fill(search);
  await applied;
  await page.waitForTimeout(100);
}

async function recoveryCommandFlow(page) {
    const commandField = page.getByRole('textbox', { name: 'One-line startup command' });
    const commandText = page.getByTestId('registry-start-command-text');
    const originalCommand = "cd -- '/home/dev/demo' && docker compose up -d web";
    const updatedCommand = 'cd /home/dev/demo && docker compose up -d web';
    assert.equal(await commandField.count(), 0,
      'Read mode must not mount an input, even readOnly');
    assert.equal((await commandText.textContent()).trim(), originalCommand);

    await page.getByRole('button', { name: 'Edit command' }).click();
    await commandField.waitFor();
    assert.equal(await commandField.isEditable(), true);
    assert.equal(await commandField.inputValue(), originalCommand,
      'Edit must begin with exactly the displayed legacy cwd/command line');
    assert.equal(await commandText.count(), 0, 'Edit replaces text with one input');
    await commandField.fill(updatedCommand);
    await page.getByRole('button', { name: 'Save command' }).click();
    await page.getByText('Preferred startup command saved.').waitFor();
    assert.equal(await commandField.count(), 0,
      'After Save the command must be ordinary text, not a readOnly input');
    assert.equal((await commandText.textContent()).trim(), updatedCommand);

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async text => { window.__registryCopiedCommand = text; } },
      });
    });
    await page.getByRole('button', { name: 'Copy start command' }).click();
    await page.getByText('Command copied. Review it before running on the correct host.').waitFor();
    assert.equal(await page.evaluate(() => window.__registryCopiedCommand),
      (await commandText.textContent()).trim(),
      'Copy must match the exact displayed read-only command');

    await page.getByRole('button', { name: 'Edit command' }).click();
    await commandField.fill('this should not be saved');
    await page.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await commandField.count(), 0, 'Cancel restores plain text');
    assert.equal((await commandText.textContent()).trim(), updatedCommand);

    const errorRoute = '**/api/service-registry/history-fixture-78/recovery-start';
    await page.route(errorRoute, route => route.fulfill({
      status: 409, contentType: 'application/json',
      body: JSON.stringify({ error: 'Synthetic preferred command conflict' }),
    }));
    try {
      await page.getByRole('button', { name: 'Edit command' }).click();
      await commandField.fill('retain this draft on conflict');
      await page.getByRole('button', { name: 'Save command' }).click();
      await page.getByText('Synthetic preferred command conflict', { exact: true }).waitFor();
      assert.equal(await commandField.inputValue(), 'retain this draft on conflict');
      await page.getByRole('button', { name: 'Cancel' }).click();
      assert.equal(await commandField.count(), 0);
      assert.equal((await commandText.textContent()).trim(), updatedCommand);
    } finally {
      await page.unroute(errorRoute);
    }
}
async function registryHistoryNavigation(page, options) {
  const { records, urlPattern, handleRegistryRequest } = createRegistryHistoryFixture();
  await page.route(urlPattern, handleRegistryRequest);
  try {
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await page.getByRole('heading', { name: 'Service history' }).waitFor();
    await page.getByText('example-unknown', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('offline');
    await applyRegistrySearch(page, 'example');
    await page.getByText('Page 1 of 5').waitFor();
    assert.equal(await page.getByText('example-unknown', { exact: true }).count(), 0,
      'A failed source scan must remain unknown, never appear under offline');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText('Page 2 of 5').waitFor();
    const dockerCard = page.getByRole('button', { name: /^example-service-78\b/ });
    await dockerCard.click();
    assert.equal(await dockerCard.locator('xpath=ancestor::article[1]')
      .locator('section[aria-label="Saved service details"]').count(), 1,
    'Expanded details must be mounted inside the selected service card');
    await page.getByRole('region', { name: 'Docker launch provenance' }).waitFor();
    await page.getByText('nginx:stable', { exact: true }).waitFor();
    await page.getByRole('region', { name: 'Recovery information' }).waitFor();
    await page.getByText('Suggested Docker Compose recovery').waitFor();
    await assertFlatRegistryDetails(page, { docker: true });
    await recoveryCommandFlow(page);
    await historyHeaderContracts(page);
    await page.getByRole('textbox', { name: 'My recovery notes' }).fill('Use compose on the Docker host');
    await page.getByRole('button', { name: 'Save notes' }).click();
    await page.getByText('Recovery notes saved.').waitFor();
    await page.getByRole('button', { name: /^example-service-79\b/ })
      .dispatchEvent('click');
    await page.getByText('Remembered endpoints').waitFor();
    await page.getByRole('region', { name: 'Linux launch provenance' }).waitFor();
    await page.getByText('dev.service', { exact: true }).waitFor();
    await page.getByText('Start the observed systemd unit').waitFor();
    await assertFlatRegistryDetails(page, { linux: true });
    await page.getByText('Verified Local Root', { exact: true }).first().waitFor();
    await page.locator('img[src="/api/service-registry/icons/' + 'a'.repeat(64) + '"]').first().waitFor();
    const forget = page.getByRole('button', { name: 'Forget example-service-79' });
    await forget.click();
    const confirmation = page.getByRole('dialog', { name: 'Forget saved service?' });
    await confirmation.waitFor();
    assert.equal(records.length, 105, 'Opening Forget must not delete any data');
    await confirmation.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(records.length, 105, 'Cancelling Forget must leave history intact');
    await forget.click();
    await confirmation.getByRole('button', { name: 'Forget service' }).click();
    await confirmation.waitFor({ state: 'hidden' });
    await page.getByText('Page 2 of 5').waitFor();
    assert.equal(records.length, 104, 'Forgetting must delete only the selected saved history row');
    await page.screenshot({
      path: path.join(options.artifacts, options.viewport.width + '-history.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await page.getByText('Page 1 of 5').waitFor();
    await page.getByRole('button', { name: 'Pin example-service-103', exact: true }).click();
    await page.getByRole('button', { name: 'Unpin example-service-103', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Pinned', exact: true }).click();
    await page.getByRole('heading', { name: 'Pinned services' }).waitFor();
    await page.getByRole('button', { name: /^example-service-103\b/ }).waitFor();
    await page.getByRole('button', { name: /^example-service-103\b/ }).click();
    await page.getByRole('region', { name: 'Recovery information' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Pinned services' }).waitFor();
    await page.getByRole('button', { name: /^example-service-103\b/ }).click();
    await page.getByRole('button', { name: 'Unpin selected service' }).click();
    await page.getByText('No pinned services match these filters.').waitFor();
    await page.getByRole('button', { name: 'Browse History' }).click();
    await page.getByRole('heading', { name: 'Service history' }).waitFor();
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
    await phaseAContracts(context, options);
    await phaseCContracts(context, options);
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