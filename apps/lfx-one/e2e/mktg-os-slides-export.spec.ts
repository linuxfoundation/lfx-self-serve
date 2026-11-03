// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect } from '@playwright/test';
import { MKTG_POLL_RETRYING_TEXT } from '@lfx-one/shared/constants';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { kitTest as test, kitDocuments, kitJson, kitRevision, openKit, setupKit } from './helpers/mktg-kit.helper';

/**
 * The slides export panel's last-export lookup: a failed read keeps checking on its own behind
 * one plain line (law 3) and offers no "Check again" button; Export is unavailable until a check succeeds.
 */
test.beforeEach(async ({ page }) => suppressCookieBanner(page));

test('a failed last-export lookup shows the one plain line with no Check again button, holds Export, and recovers on its own', async ({ page }, info) => {
  await setupKit(page, { loaded: true, approvedFramework: true });
  const type = kitDocuments(true).groups.find((group) => group.type.agentKey === 'foundation-message')?.type;
  if (!type) throw new Error('Missing synthetic framework type');
  const revision = kitRevision(type).revision;
  let failing = true;
  let lookups = 0;
  await page.route(
    (url) => url.pathname === '/api/mktg-agents/slides-export/last',
    (route) => {
      lookups++;
      if (failing) return kitJson(route, { error: 'Synthetic lookup outage' }, 503);
      return kitJson(route, { last: null, latestRevision: { id: revision.id, number: revision.number, contentSha256: revision.contentSha256 } });
    }
  );
  await openKit(page, '/documents/foundation-message/living');
  await expect(page.getByTestId('mktg-document-view-framework')).toBeVisible();
  const failed = page.getByTestId('mktg-slides-export-lookup-failed');
  await expect(failed).toContainText(MKTG_POLL_RETRYING_TEXT, { timeout: 15_000 });
  await expect(failed).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('mktg-slides-export-check-again')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check again' })).toHaveCount(0);
  await expect(failed.getByRole('button')).toHaveCount(0);
  await expect(page.getByTestId('mktg-framework-view-export-slides').getByRole('button')).toBeDisabled();
  await page.screenshot({ path: info.outputPath('lookup-failed-plain-line.png'), fullPage: true });
  failing = false;
  await expect(failed).toHaveCount(0, { timeout: 15_000 });
  expect(lookups).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('mktg-framework-view-export-slides').getByRole('button')).toBeEnabled();
  await page.screenshot({ path: info.outputPath('lookup-recovered.png'), fullPage: true });
});
