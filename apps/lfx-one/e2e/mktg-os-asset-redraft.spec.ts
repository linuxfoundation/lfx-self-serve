// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { ASSET_PROJECT, ASSET_REVISION } from './helpers/mktg-os-assets.helper';
import { redraftComment, redraftFixture } from './helpers/mktg-os-redraft.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';

test.beforeEach(async ({ page }) => {
  await suppressCookieBanner(page);
});
test('sends only pinned open IDs, shows the existing feed, and lands on the exact new Draft while approved current stays older', async ({ page }) => {
  const { fixture, state, nextId } = await redraftFixture(page);
  await fixture.open();
  const panel = page.getByTestId('mktg-comments-panel');
  await panel.getByRole('button', { name: 'Send 2 open comments to the agent', exact: true }).click();
  await expect(panel.getByTestId('mktg-comments-feed')).toBeVisible();
  expect(state.sends).toHaveLength(1);
  expect(state.sends[0]).toMatchObject({ project: ASSET_PROJECT.uid, revisionId: ASSET_REVISION, commentIds: ['comment-one', 'comment-two'] });
  expect(Object.keys(state.sends[0]).sort()).toEqual(['clientRequestId', 'commentIds', 'project', 'revisionId']);
  state.done = true;
  await expect(page).toHaveURL(new RegExp(`revision=${nextId}`), { timeout: 20_000 });
  await expect(page.getByTestId('mktg-framework-view-tagline')).toHaveText('Revised synthetic tagline.');
  await expect(page.getByTestId('mktg-document-view-revision-label-2')).toContainText('Draft');
  await page.screenshot({ path: test.info().outputPath('redraft-exact-new-draft.png'), fullPage: true });
});
test('uncertain retry keeps the original nonce/IDs and release409 says still starting without another generation', async ({ page }) => {
  const { fixture, state } = await redraftFixture(page);
  state.fail = true;
  await fixture.open();
  const panel = page.getByTestId('mktg-comments-panel');
  await panel.getByRole('button', { name: 'Send 2 open comments to the agent', exact: true }).click();
  await expect(panel).toContainText('Try the same send again');
  fixture.state.rows.push(redraftComment('later-comment'));
  await panel.getByRole('button', { name: 'Retry the same redraft', exact: true }).click();
  await expect.poll(() => state.sends.length).toBe(2);
  expect(state.sends[1]).toEqual(state.sends[0]);
  await panel.getByRole('button', { name: 'Release this uncertain send', exact: true }).click();
  await expect(panel).toContainText('Still starting — retry shortly.');
  expect(state.sends).toHaveLength(2);
  await page.screenshot({ path: test.info().outputPath('redraft-uncertain-release-busy.png'), fullPage: true });
});
