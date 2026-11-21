import assert from 'node:assert/strict';

export async function assertFlatRegistryDetails(page, { docker = false, linux = false } = {}) {
  const details = page.locator('section[aria-label="Saved service details"]').first();
  await details.waitFor();
  assert.equal(await details.getAttribute('data-detail-layout'), 'sections');
  await details.getByRole('region', { name: 'Overview' }).waitFor();
  await details.getByRole('region', { name: 'Remembered endpoints' }).waitFor();
  await details.getByRole('region', { name: 'Recovery information' }).waitFor();
  if (docker) await details.getByRole('region', { name: 'Docker launch provenance' }).waitFor();
  if (linux) await details.getByRole('region', { name: 'Linux launch provenance' }).waitFor();

  assert.equal(await details.locator('[data-recovery-command-group]').count(), 1);
  assert.equal(await details.locator('[data-recovery-recipe]').count() > 0, true);
  assert.equal(await details.getByRole('button', { name: 'Copy start command' }).count(), 1);
  assert.equal(await details.getByRole('textbox', { name: 'My recovery notes' }).count(), 1);

  const boundaries = await details.evaluate(root => {
    const parts = [root, ...root.querySelectorAll(
      'section[aria-label], [data-recovery-command-group], [data-recovery-saved-notes], [data-recovery-recipe]'
    )];
    return parts.map(node => {
      const style = window.getComputedStyle(node);
      return {
        label: node.getAttribute('aria-label') || node.tagName.toLowerCase(),
        sides: [style.borderLeftWidth, style.borderRightWidth, style.borderBottomWidth],
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
      };
    });
  });
  for (const boundary of boundaries) {
    assert.deepEqual(boundary.sides, ['0px', '0px', '0px'],
      boundary.label + ' must not add a nested card border');
    assert.equal(boundary.radius, '0px', boundary.label + ' must not be a rounded nested card');
    assert(['transparent', 'rgba(0, 0, 0, 0)'].includes(boundary.background),
      boundary.label + ' must not add a nested card background');
  }
  assert.equal(await details.locator('input[readonly]').count(), 0,
    'Startup command remains selectable text outside Edit mode');
}
