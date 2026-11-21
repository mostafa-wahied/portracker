import assert from 'node:assert/strict';

export async function historyHeaderContracts(page) {
  const card = page.getByRole('button', { name: /^example-service-78\b/ });
  const article = card.locator('xpath=ancestor::article[1]');
  const header = article.locator('[data-history-service-header]');
  const details = article.locator('section[aria-label="Saved service details"]');
  const forget = header.getByRole('button', { name: 'Forget example-service-78' });
  const close = header.getByRole('button', { name: 'Close saved service details' });
  const pin = header.getByRole('button', { name: /^(Pin|Unpin) example-service-78$/ });
  assert.equal(await forget.count(), 1,
    'Forget must be in outer service header beside the status chip');
  assert.equal(await close.count(), 1, 'Close must be in outer service header');
  assert.equal(await pin.count(), 1, 'Pin must be in outer service header');
  assert.equal(await details.getByRole('button', { name: 'Forget example-service-78' }).count(), 0,
    'Details must not render duplicate nested actions');
  assert.equal(await card.getAttribute('aria-expanded'), 'true');
  const initialPin = await pin.getAttribute('aria-pressed');
  await pin.click();
  assert.equal(await details.count(), 1, 'Pin must not collapse selected service');
  await pin.click();
  await page.waitForFunction(expected => {
    const button = document.querySelector(
      'button[aria-pressed][aria-label$="example-service-78"]'
    );
    return button?.getAttribute('aria-pressed') === expected;
  }, initialPin);
  assert.equal(await pin.getAttribute('aria-pressed'), initialPin,
    'Browser fixture pin must be restored for later Pinned scenarios');
  await card.click();
  assert.equal(await details.count(), 0, 'Click selected service again must collapse');
  assert.equal(await card.getAttribute('aria-expanded'), 'false');
  await card.press('Enter');
  await details.waitFor();
  await card.press('Space');
  assert.equal(await details.count(), 0, 'Keyboard activation must toggle closed');
  await card.click();
  await details.waitFor();
  await close.click();
  assert.equal(await details.count(), 0, 'Close button must collapse');
  await card.click();
  await details.waitFor();
  assert.equal(await forget.count(), 1, 'Forget returns with the selected service');
}
