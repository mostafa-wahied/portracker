import assert from 'node:assert/strict';

async function pinAppearance(button, pressed) {
  assert.equal(await button.getAttribute('aria-pressed'), pressed);
  assert.equal(await button.getAttribute('data-registry-pin-state'),
    pressed === 'true' ? 'pinned' : 'unpinned');
  assert.equal(await button.isEnabled(), true, 'Pin must be enabled when idle');
  const appearance = await button.evaluate(element => {
    const { cursor, opacity, borderColor, color, backgroundColor, borderTopWidth } =
      getComputedStyle(element);
    return { cursor, opacity, borderColor, color, backgroundColor, borderTopWidth };
  });
  assert.equal(appearance.cursor, 'pointer', 'Idle Pin/Unpin must look clickable');
  assert.equal(appearance.opacity, '1', 'Idle Pin/Unpin must not look disabled');
  assert.notEqual(appearance.borderTopWidth, '0px', 'Pin/Unpin must retain its outline');
  assert.equal(await button.locator('svg').getAttribute('fill'),
    pressed === 'true' ? 'currentColor' : 'none',
    'Pin uses an outline icon; Unpin uses the filled icon');
  return appearance;
}

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
  const initialClassName = await pin.getAttribute('class');
  await pinAppearance(pin, initialPin);
  await pin.click();
  assert.equal(await details.count(), 1, 'Pin must not collapse selected service');
  const toggledPin = initialPin === 'true' ? 'false' : 'true';
  await page.waitForFunction(expected => {
    const button = document.querySelector(
      'button[aria-pressed][aria-label$="example-service-78"]'
    );
    return button?.getAttribute('aria-pressed') === expected && !button.disabled;
  }, toggledPin);
  await pinAppearance(pin, toggledPin);
  assert.equal(await pin.getAttribute('class'), initialClassName,
    'Pin and Unpin must share the same outlined indigo styling, regardless of hover');
  await pin.click();
  await page.waitForFunction(expected => {
    const button = document.querySelector(
      'button[aria-pressed][aria-label$="example-service-78"]'
    );
    return button?.getAttribute('aria-pressed') === expected && !button.disabled;
  }, initialPin);
  await pinAppearance(pin, initialPin);
  assert.equal(await pin.getAttribute('class'), initialClassName,
    'Restoring pin state must preserve the same action styling');
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
