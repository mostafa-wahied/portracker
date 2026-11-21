import assert from 'node:assert/strict';

/** The manual list reload must not be mistaken for an on-demand discovery scan. */
export async function assertRegistryReloadBehavior(page, listPath) {
  const reload = page.getByRole('button', { name: 'Reload list', exact: true });
  await reload.waitFor();
  assert.equal(await reload.getAttribute('title'),
    'Reload saved services without scanning. The list also updates every 30 seconds.');
  assert.equal(await reload.isEnabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Scan now', exact: true }).count(), 1,
    'Discovery must remain a separately labeled action');

  const scanRequests = [];
  const trackRequest = request => {
    if (new URL(request.url()).pathname === '/api/service-registry/scan' &&
        request.method() === 'POST') scanRequests.push(request.url());
  };
  page.on('request', trackRequest);
  try {
    const updated = page.waitForResponse(response =>
      new URL(response.url()).pathname === listPath &&
      response.request().method() === 'GET' && response.status() === 200);
    await reload.click();
    await updated;
    assert.equal(scanRequests.length, 0,
      'Reload list must fetch saved data without starting a new discovery scan');
  } finally {
    page.off('request', trackRequest);
  }
}
