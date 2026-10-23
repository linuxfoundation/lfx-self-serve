// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { leaveAndReturnToAsset, RETURNING_AGENT_TYPES } from './helpers/mktg-os-asset-return.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';

test.describe('Marketing OS returned asset structure', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test.beforeEach(async ({ page }) => suppressCookieBanner(page));
  for (const type of RETURNING_AGENT_TYPES) {
    test(`${type.agentKey}: the returned revision replaces progress without losing history`, async ({ page }) => {
      const selector = await leaveAndReturnToAsset(page, type);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByTestId(selector)).toBeVisible();
      await expect(page.getByTestId('mktg-document-view-revisions')).toBeVisible();
      await expect(page.getByTestId('mktg-document-view-run-again')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('returned-asset-mobile.png'), fullPage: true });
    });
  }
});
