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
    await releaseNotice(page, options.version);
    await settings(page);
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