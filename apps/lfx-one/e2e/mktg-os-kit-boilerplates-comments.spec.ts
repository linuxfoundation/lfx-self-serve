// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { ASSET_PROJECT, ASSET_REVISION } from './helpers/mktg-os-assets.helper';
import { setupStructuredComments } from './helpers/mktg-os-kit-comments.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';

test.beforeEach(async ({ page }) => {
  await suppressCookieBanner(page);
});
for (const agentKey of ['brand-kit', 'boilerplates'] as const) {
  test(`${agentKey}: pin a comment and send this asset to the exact new Draft without changing approved current`, async ({ page }) => {
    const fixture = await setupStructuredComments(page, agentKey);
    await fixture.open();
    const panel = page.getByTestId('mktg-comments-panel');
    await expect(panel.getByTestId('mktg-comments-empty')).toBeVisible();
    const field = page.getByTestId(`mktg-field-comments-${fixture.key}`);
    await field.hover();
    await field.getByRole('button', { name: /^Comment on/ }).click();
    await field.getByRole('textbox').fill('Shorten this synthetic passage.');
    await field.getByRole('button', { name: 'Add comment', exact: true }).click();
    await expect(field.getByTestId('mktg-comment-thread')).toContainText('Shorten this synthetic passage.');
    await expect(panel).toContainText('Project writer');
    expect(fixture.state.adds[0]).toMatchObject({
      revisionId: ASSET_REVISION,
      anchor: { kind: agentKey === 'brand-kit' ? 'passage' : 'field', key: fixture.key },
    });
    expect(fixture.state.adds[0]['anchor']).not.toHaveProperty('passage');
    if (agentKey === 'brand-kit') {
      await expect.poll(() => fixture.exportChecks()).toBeGreaterThan(0);
      await expect(page.getByText('Could not check for an earlier deck', { exact: false })).toHaveCount(0);
      // Even when the reader moves, the submitted Voice passage must be visible on landing.
      await page.getByTestId('brand-kit-web-view-tab-color').click();
    }
    await panel.getByRole('button', { name: 'Send 1 open comment to the agent', exact: true }).click();
    await expect(panel.getByTestId('mktg-comments-feed')).toBeVisible();
    expect(fixture.state.sends).toHaveLength(1);
    expect(fixture.state.sends[0]).toMatchObject({ project: ASSET_PROJECT.uid, revisionId: ASSET_REVISION, commentIds: ['synthetic-pinned-comment'] });
    expect(Object.keys(fixture.state.sends[0]).sort()).toEqual(['clientRequestId', 'commentIds', 'project', 'revisionId']);
    fixture.state.done = true;
    await expect(page).toHaveURL(new RegExp(`revision=${fixture.nextId}`), { timeout: 20_000 });
    if (agentKey === 'brand-kit') {
      await expect(page).toHaveURL(/tab=voice/);
      await expect(page.getByTestId('brand-kit-web-view-tab-voice')).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('brand-kit-web-view-line')).toHaveText('Revised synthetic brand line.');
    } else await expect(page.getByTestId('mktg-boilerplates-view-text-1')).toHaveText('Revised synthetic boilerplate.');
    await expect(page.getByTestId('mktg-document-view-revision-label-2')).toContainText('Draft');
    await expect(page.getByTestId('mktg-document-view-current-since-1')).toContainText('Current since');
    await expect(panel).toContainText('Shortened the selected passage.');
    await page.screenshot({ path: test.info().outputPath(`${agentKey}-redraft.png`), fullPage: true });
  });
  test(`${agentKey}: loading is not empty and failed reads recover only on explicit Retry`, async ({ page }) => {
    const fixture = await setupStructuredComments(page, agentKey);
    fixture.state.hold = true;
    try {
      await fixture.open();
      const panel = page.getByTestId('mktg-comments-panel');
      await expect(panel.getByTestId('mktg-comments-loading')).toContainText('Loading comments');
      await expect(panel.getByTestId('mktg-comments-empty')).toHaveCount(0);
      await expect(page.getByTestId(`mktg-field-comments-${fixture.key}`)).toBeHidden();
      fixture.state.fail = true;
    } finally {
      fixture.release();
    }
    const panel = page.getByTestId('mktg-comments-panel');
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByTestId('mktg-comments-empty')).toHaveCount(0);
    await expect(panel.getByTestId('mktg-comments-send').getByRole('button')).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath(`${agentKey}-comments-error.png`), fullPage: true });
    fixture.state.fail = false;
    await panel.getByRole('button', { name: 'Retry comments' }).click();
    await expect(panel.getByTestId('mktg-comments-empty')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`${agentKey}-comments-empty.png`), fullPage: true });
  });
  test(`${agentKey}: no writer access exposes neither comments nor redraft actions`, async ({ page }) => {
    const fixture = await setupStructuredComments(page, agentKey, false);
    await fixture.open();
    await expect(page.getByTestId('mktg-document-view-error')).toContainText('write access');
    await expect(page.getByTestId('mktg-comments-panel')).toHaveCount(0);
    await expect(page.locator('[data-testid^="mktg-field-comments-"]')).toHaveCount(0);
    expect(fixture.state.adds).toHaveLength(0);
    expect(fixture.state.sends).toHaveLength(0);
    await page.screenshot({ path: test.info().outputPath(`${agentKey}-no-access.png`), fullPage: true });
  });
}
