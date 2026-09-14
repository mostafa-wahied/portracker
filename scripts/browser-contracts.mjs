import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

async function releaseNotice(page, version) {
  await page.getByRole('banner').locator('button').filter({ has: page.locator('svg.lucide-sparkles') }).click();
  await page.getByRole('heading', { name: `What's New in portracker ${version}`, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Back to dashboard', exact: true }).waitFor();
  await assertLayout(page);
  await page.getByRole('button', { name: 'Back to dashboard', exact: true }).click();
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
    const notice = page.getByRole('button', { name: 'Back to dashboard', exact: true });
    if (await notice.isVisible()) await notice.click();
    const search = page.getByPlaceholder('Search ports, processes...');
    await search.fill('18080');
    await page.getByText('18080', { exact: true }).first().waitFor();
    await search.fill('');
    await memoryLabels(page, options);
    await releaseNotice(page, options.version);
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
  const artifacts = process.env.CONTRACT_ARTIFACTS || path.resolve('test-results');
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await viewportContract(browser, { baseUrl, credentials, version, viewport, artifacts });
    }
  } finally {
    await browser.close();
  }
}