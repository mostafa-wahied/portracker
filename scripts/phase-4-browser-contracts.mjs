import assert from 'node:assert/strict';

async function readServiceVisual(page, kind) {
  const card = page.locator('[data-service-list-surface="' + kind + '"]').first();
  await card.waitFor();
  return card.evaluate(root => {
    const header = root.querySelector('[data-service-list-header]');
    const title = root.querySelector('[data-service-list-title]');
    const source = root.querySelector('[data-service-source-badge]');
    const port = root.querySelector('[data-service-port-badge]');
    const cardStyle = getComputedStyle(root);
    const headerStyle = getComputedStyle(header);
    const titleStyle = getComputedStyle(title);
    const sourceStyle = getComputedStyle(source);
    const portStyle = getComputedStyle(port);
    return {
      className: root.className,
      card: {
        background: cardStyle.backgroundColor,
        border: cardStyle.borderTopColor,
        borderWidth: cardStyle.borderTopWidth,
        radius: cardStyle.borderTopLeftRadius,
        shadow: cardStyle.boxShadow,
      },
      header: {
        padding: [headerStyle.paddingTop, headerStyle.paddingRight,
          headerStyle.paddingBottom, headerStyle.paddingLeft],
        background: headerStyle.backgroundColor,
      },
      title: {
        weight: titleStyle.fontWeight,
        size: titleStyle.fontSize,
        color: titleStyle.color,
      },
      source: {
        size: sourceStyle.fontSize,
        radius: sourceStyle.borderTopLeftRadius,
        padding: [sourceStyle.paddingTop, sourceStyle.paddingLeft],
      },
      port: {
        size: portStyle.fontSize,
        weight: portStyle.fontWeight,
        radius: portStyle.borderTopLeftRadius,
        padding: [portStyle.paddingTop, portStyle.paddingLeft],
      },
    };
  });
}

function matchLiveVisual(live, other, kind) {
  for (const key of ['className', 'card', 'header', 'title', 'source', 'port']) {
    assert.deepEqual(other[key], live[key],
      kind + ' should use the Live ports ' + key + ' visual tokens');
  }
}

export async function phase4VisualContracts(page) {
  const originalDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  try {
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);

      await page.getByRole('tab', { name: 'History', exact: true }).click();
      await page.getByRole('textbox', { name: 'Search saved service names' }).fill('');
      const historyCards = page.locator('[data-history-service-card]');
      await historyCards.nth(1).waitFor();
      const first = await historyCards.first().boundingBox();
      const second = await historyCards.nth(1).boundingBox();
      assert(first && second && Math.abs(first.x - second.x) <= 1,
        'History should use one full-width list column like Live ports');
      const history = await readServiceVisual(page, 'history');
      assert.equal(await page.locator('[data-history-service-list]').count(), 1);
      assert.equal(await page.locator('[data-history-service-card]').count() > 1, true);

      await page.getByRole('tab', { name: 'Pinned', exact: true }).click();
      const pinned = await readServiceVisual(page, 'pinned');
      const enclosingPanel = page.locator('[data-pinned-service-list]');
      assert.equal(await enclosingPanel.count(), 1);
      assert.equal(await enclosingPanel.evaluate(el => getComputedStyle(el).borderLeftWidth), '0px',
        'Pinned must not add a second enclosing card');
      assert.equal(await enclosingPanel.evaluate(el => getComputedStyle(el).borderTopLeftRadius), '0px');

      await page.getByRole('tab', { name: 'Live ports', exact: true }).click();
      const live = await readServiceVisual(page, 'live');
      matchLiveVisual(live, history, 'History');
      matchLiveVisual(live, pinned, 'Pinned');
    }
  } finally {
    await page.evaluate(value => document.documentElement.classList.toggle('dark', value), originalDark);
  }
}
