import assert from 'node:assert/strict';
import { createRegistryHistoryFixture } from './registry-history-fixture.mjs';

async function browserScrollPosition(page) {
  return page.locator('main').evaluate(element => ({
    top: element.scrollTop,
    height: element.scrollHeight,
    viewport: element.clientHeight,
  }));
}

export async function phaseAContracts(context, options) {
  const { records, urlPattern, handleRegistryRequest } = createRegistryHistoryFixture();
  for (const item of records.slice(76, 104)) {
    item.pinned = true;
    item.pinnedAt = item.lastSeenAt;
  }
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.clock.install();
  await page.addInitScript(() => {
    localStorage.setItem('portrackerActiveView', 'pinned');
    localStorage.setItem('autoRefreshEnabled', 'true');
    localStorage.setItem('refreshInterval', '30000');
  });
  await page.route(urlPattern, route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/service-registry/scan-status') {
      return route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: 'Transient scan status outage' }) });
    }
    return handleRegistryRequest(route);
  });
  try {
    await page.goto(options.baseUrl + '/?server=local', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Pinned services' }).waitFor();
    await page.getByRole('button', { name: /^example-service-103\b/ }).waitFor();
    assert.equal(await page.getByText('No pinned services match these filters.').count(), 0,
      'Scanner status failure must not mask saved pins');
    await page.getByRole('button', { name: /^example-service-103\b/ }).click();
    await page.getByRole('region', { name: 'Recovery information' }).waitFor();

    const prior = await page.locator('main').evaluate(element => {
      element.scrollTop = 480;
      return element.scrollTop;
    });
    assert(prior > 0, 'Pinned fixture must be scrollable');
    await page.clock.runFor(31000);
    await page.getByRole('region', { name: 'Recovery information' }).waitFor();
    const after = await browserScrollPosition(page);
    assert(Math.abs(after.top - prior) <= 2,
      `Pinned auto-refresh moved viewport from ${prior} to ${after.top}`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Pinned services' }).waitFor();
    await page.getByRole('button', { name: /^example-service-103\b/ }).waitFor();
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await page.getByRole('tab', { name: 'Pinned', exact: true }).click();
    await page.getByRole('button', { name: /^example-service-103\b/ }).waitFor();

    await page.getByRole('tab', { name: 'Live ports', exact: true }).click();
    const search = page.getByPlaceholder('Search ports, processes...');
    await search.fill('18080');
    await page.getByText('18080', { exact: true }).first().waitFor();
    let resumeScan;
    const gate = new Promise(resolve => { resumeScan = resolve; });
    let sawRequest;
    const pending = new Promise(resolve => { sawRequest = resolve; });
    await page.route('**/api/servers/local/scan**', async route => {
      sawRequest();
      await gate;
      await route.continue();
    });
    try {
      await page.clock.runFor(31000);
      await pending;
      assert.equal(await page.getByText('18080', { exact: true }).first().isVisible(), true,
        'Global live-port refresh must keep existing cards mounted during API fetch');
    } finally {
      resumeScan();
    }
  } finally {
    await page.evaluate(() => {
      localStorage.setItem('portrackerActiveView', 'live');
      localStorage.setItem('autoRefreshEnabled', 'false');
      localStorage.setItem('refreshInterval', '30000');
    }).catch(() => undefined);
    await page.close();
  }
}
