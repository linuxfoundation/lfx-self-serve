// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { MKTG_DOCUMENT_TYPES } from '../../../packages/shared/src/constants/mktg-document-store.constants';
import { createLinkedinRuns, json, LINKEDIN_TEST_PROJECT, openLinkedin, setupLinkedin, stubLinkedinClipboard } from './helpers/mktg-linkedin.helper';

// setupLinkedin/openLinkedin call suppressCookieBanner before navigation and stub
// the project, feature flag and Marketing OS requests with synthetic records.
for (const variant of ['options', 'feed', 'empty'] as const) {
  const completed = variant === 'options';
  test(`LinkedIn ${variant}: accessible options or one live heading with feed/fallback`, async ({ page }, info) => {
    const documentId = 'run-' + 'a'.repeat(24);
    const runs = createLinkedinRuns();
    const run = { documentId, shareLink: '', answered: false, polls: 0, reads: 0, completed, failed: false };
    runs.set('synthetic-session-1', run);
    await setupLinkedin(page, { saved: true, runs });
    await stubLinkedinClipboard(page);
    if (variant === 'empty') {
      const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === 'linkedin-post');
      if (!type) throw new Error('Missing synthetic LinkedIn type');
      await page.route('**/api/mktg-agents/documents/linkedin-post/**', (route) =>
        json(route, {
          project: LINKEDIN_TEST_PROJECT.uid,
          type,
          documentId,
          revisions: [],
          approvedCurrent: null,
          runs: [
            {
              project: LINKEDIN_TEST_PROJECT.uid,
              agentKey: type.agentKey,
              documentId,
              runId: 'a'.repeat(64),
              state: 'writing',
              startedAt: '2026-10-29T10:00:00Z',
            },
          ],
        })
      );
    } else if (!completed) {
      await page.route('**/api/mktg-agents/documents/linkedin-post/**', async (route) => {
        run.reads = 0; // Keep the synthetic server run writing for this state assertion.
        await route.fallback();
      });
    }
    await openLinkedin(page);
    await page.evaluate((url) => {
      history.pushState({}, '', url);
      dispatchEvent(new PopStateEvent('popstate'));
    }, `/project/mktg-os-agents/documents/linkedin-post/${documentId}?project=${LINKEDIN_TEST_PROJECT.slug}`);
    if (completed) {
      const group = page.getByRole('radiogroup', { name: 'Post options' });
      const first = group.getByRole('radio', { name: 'Option 1: Angle 1' });
      const second = group.getByRole('radio', { name: 'Option 2: Angle 2' });
      const third = group.getByRole('radio', { name: 'Option 3: Angle 3' });
      await expect(first).toHaveAttribute('aria-checked', 'true');
      const firstCard = page.getByTestId('mktg-linkedin-option').nth(0);
      const secondCard = page.getByTestId('mktg-linkedin-option').nth(1);
      await secondCard.getByTestId('mktg-linkedin-post-text').click();
      await expect(second).toHaveAttribute('aria-checked', 'true');
      await expect(second).toContainText('Selected');
      const accessibleCard = await secondCard.ariaSnapshot();
      expect(accessibleCard).toContain('Example release 2.');
      expect(accessibleCard).toContain('button "Copy post"');
      await second.focus();
      await second.press('ArrowRight');
      await expect(third).toBeFocused();
      await expect(third).toHaveAttribute('aria-checked', 'true');
      await first.focus();
      await first.press('Space');
      await expect(first).toHaveAttribute('aria-checked', 'true');
      await second.focus();
      await second.press('Enter');
      await expect(second).toHaveAttribute('aria-checked', 'true');
      await firstCard.getByTestId('mktg-linkedin-copy-1').getByRole('button', { name: 'Copy post' }).click();
      await expect(first).toHaveAttribute('aria-checked', 'true');
      await expect(firstCard.getByTestId('mktg-linkedin-copy-1')).toContainText('Copied');
      await expect(group.locator('[aria-checked="true"]')).toHaveCount(1);
    } else {
      const progress = page.getByTestId('mktg-document-view-run');
      await expect(progress).toBeVisible();
      await expect(progress.getByText('You can leave this page — the agent keeps working.', { exact: true })).toHaveCount(1);
      await expect(progress.getByRole('heading')).toHaveCount(1);
      await expect(progress.getByRole('heading')).toHaveText('LinkedIn Post Agent is working on your post.');
      if (variant === 'empty') {
        await expect(progress.getByTestId('mktg-document-view-run-steps')).toContainText('Writing…');
        await expect(progress).toContainText('It will appear here when it is ready.');
        await expect(progress.getByTestId('mktg-run-activity')).toHaveCount(0);
      } else {
        await expect(progress.getByTestId('mktg-document-view-run-steps')).toHaveCount(0);
        await expect(progress).not.toContainText('It will appear here when it is ready.');
        await expect(progress.getByTestId('mktg-run-activity-phases')).toHaveCount(1);
        await expect(progress.getByTestId('mktg-run-activity')).toHaveCount(1);
      }
    }
    await page.screenshot({ path: info.outputPath(`${variant}.png`), fullPage: true });
  });
}
