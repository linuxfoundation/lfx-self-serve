// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { createLinkedinRuns, LINKEDIN_TEST_PROJECT, openLinkedin, setupLinkedin, stubLinkedinClipboard } from './helpers/mktg-linkedin.helper';

// setupLinkedin/openLinkedin call suppressCookieBanner before navigation and stub
// the project, feature flag and Marketing OS requests with synthetic records.
for (const completed of [false, true]) {
  test(`LinkedIn ${completed ? 'option cards are selectable by body and keyboard' : 'live feed has only the board leave line'}`, async ({ page }, info) => {
    const documentId = 'run-' + 'a'.repeat(24);
    const runs = createLinkedinRuns();
    const run = { documentId, shareLink: '', answered: false, polls: 0, reads: 0, completed, failed: false };
    runs.set('synthetic-session-1', run);
    await setupLinkedin(page, { saved: true, runs });
    await stubLinkedinClipboard(page);
    if (!completed) {
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
      await second.getByTestId('mktg-linkedin-post-text').click();
      await expect(second).toHaveAttribute('aria-checked', 'true');
      await expect(second).toContainText('Selected');
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
      await first.getByTestId('mktg-linkedin-copy-1').getByRole('button', { name: 'Copy post' }).click();
      await expect(first).toHaveAttribute('aria-checked', 'true');
      await expect(first.getByTestId('mktg-linkedin-copy-1')).toContainText('Copied');
      await expect(group.locator('[aria-checked="true"]')).toHaveCount(1);
    } else {
      const progress = page.getByTestId('mktg-document-view-run');
      await expect(progress).toBeVisible();
      await expect(progress.getByText('You can leave this page — the agent keeps working.', { exact: true })).toHaveCount(1);
      await expect(progress.getByTestId('mktg-document-view-run-steps')).toHaveCount(0);
      await expect(progress).not.toContainText('It will appear here when it is ready.');
      await expect(progress.getByTestId('mktg-run-activity-phases')).toHaveCount(1);
      await expect(progress.getByTestId('mktg-run-activity')).toHaveCount(1);
    }
    await page.screenshot({ path: info.outputPath(completed ? 'selected-option.png' : 'single-leave-line.png'), fullPage: true });
  });
}
