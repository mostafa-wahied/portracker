import assert from 'node:assert/strict';
import { createRegistryHistoryFixture } from './registry-history-fixture.mjs';
import { assertFlatRegistryDetails } from './phase-3-browser-contracts.mjs';
import { phase4VisualContracts } from './phase-4-browser-contracts.mjs';
import { phase5IconHelpContracts } from './phase-5-browser-contracts.mjs';
import { assertRegistryReloadBehavior } from './registry-reload-browser-contracts.mjs';

export async function phaseCContracts(context, options) {
  const { records, urlPattern, handleRegistryRequest } = createRegistryHistoryFixture();
  for (const index of [78, 81]) {
    records[index].pinned = true;
    records[index].pinnedAt = records[index].lastSeenAt;
  }
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript(() => localStorage.setItem('portrackerActiveView', 'pinned'));
  await page.route(urlPattern, handleRegistryRequest);
  try {
    await page.goto(options.baseUrl + '/?server=local', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Pinned services' }).waitFor();
    await phase5IconHelpContracts(page);
    const group = page.getByRole('button', { name: 'demo-group service group' });
    await group.waitFor();
    await assertRegistryReloadBehavior(page, '/api/service-registry/pinned-groups');
    assert.equal(await page.locator('[data-pinned-group]').count(), 1,
      'Two verified Compose services should produce one project row');
    assert.equal(await group.getByText('54321', { exact: true }).count(), 1,
      'One pinned service displays all current and remembered ports');
    assert.equal(await group.getByText('+2 more').count(), 1,
      'Additional port chips should be accessible after expansion');
    assert.equal(await page.getByRole('button', { name: 'Unpin selected service' }).count(), 0,
      'Collapsed row must not have an Unpin button');
    await group.click();
    await page.getByRole('button', { name: /^example-service-78\b/ }).waitFor();
    await page.getByRole('button', { name: /^example-service-81\b/ }).waitFor();
    await page.getByRole('region', { name: 'Recovery information' }).waitFor();
    await assertFlatRegistryDetails(page, { docker: true });
    const selectedUnpin = page.getByRole('button', { name: 'Unpin selected service' });
    assert.equal(await selectedUnpin.getAttribute('aria-pressed'), 'true');
    assert.equal(await selectedUnpin.getAttribute('data-registry-pin-state'), 'pinned');
    assert.equal(await selectedUnpin.isEnabled(), true);
    const unpinAppearance = await selectedUnpin.evaluate(button => {
      const style = getComputedStyle(button);
      return { cursor: style.cursor, opacity: style.opacity, borderWidth: style.borderTopWidth };
    });
    assert.equal(unpinAppearance.cursor, 'pointer');
    assert.equal(unpinAppearance.opacity, '1');
    assert.notEqual(unpinAppearance.borderWidth, '0px',
      'The service-details Unpin action must use the outlined style');
    assert.equal(await selectedUnpin.locator('svg').getAttribute('fill'), 'currentColor');
    await selectedUnpin.click();
    await group.waitFor();
    await page.getByRole('button', { name: /^example-service-78\b/ })
      .waitFor({ state: 'hidden' });
    await page.locator('section[aria-label="Saved service details"]')
      .getByText('example-service-81', { exact: true }).waitFor();
    assert.equal(records[78].pinned, false);
    assert.equal(records[81].pinned, true, 'Unpin only affects selected durable service');
    await page.getByRole('button', { name: 'Unpin selected service' }).waitFor();
    await page.getByRole('button', { name: 'Unpin selected service' }).click();
    await page.getByText('No pinned services match these filters.').waitFor();
    assert.equal(records[81].pinned, false);
    await page.getByRole('button', { name: 'Browse History' }).click();
    await page.getByRole('heading', { name: 'Service history' }).waitFor();
    await phase5IconHelpContracts(page);
    await page.getByRole('textbox', { name: 'Search saved service names' })
      .fill('example-service-78');
    await page.getByRole('button', { name: 'Pin example-service-78' }).waitFor();
    await page.getByRole('button', { name: 'Pin example-service-78' }).click();
    await page.getByRole('button', { name: 'Unpin example-service-78' }).waitFor();
    assert.equal(records[78].pinned, true, 'History must retain quick Pin/Unpin');
    await phase4VisualContracts(page);
  } finally {
    await page.evaluate(() => {
      localStorage.setItem('portrackerActiveView', 'live');
    }).catch(() => undefined);
    await page.close();
  }
}
