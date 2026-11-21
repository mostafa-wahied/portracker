import assert from 'node:assert/strict';

export async function phase5IconHelpContracts(page) {
  const capability = page.locator('section[aria-label="Discovery capabilities"]');
  await capability.waitFor();
  const help = capability.locator('details[aria-label="Icon and metadata discovery help"]');
  await help.waitFor();
  await help.locator('summary').click();
  const content = await help.textContent();
  for (const phrase of ['Last attempt:', 'Last successful metadata:',
    'Last successfully cached raster icon:', 'Hermes, VS Code/code-server',
    'SERVICE_REGISTRY_HTTP_HOST', 'PORTRACKER_DOCKER_SOCK']) {
    assert(content.includes(phrase), 'Discovery help should explain ' + phrase);
  }
  assert.equal(await help.getAttribute('open'), '',
    'The help should expand to show actionable setup guidance');
  await help.locator('summary').click();
  assert.equal(await help.getAttribute('open'), null,
    'Discovery help should collapse without changing service state');
}
