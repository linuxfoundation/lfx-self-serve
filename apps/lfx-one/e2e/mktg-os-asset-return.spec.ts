// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { test } from '@playwright/test';
import { leaveAndReturnToAsset, RETURNING_AGENT_TYPES } from './helpers/mktg-os-asset-return.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';

test.describe('Marketing OS leave-and-return result recovery', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test.beforeEach(async ({ page }) => suppressCookieBanner(page));
  for (const type of RETURNING_AGENT_TYPES) {
    test(`${type.agentKey}: Generate, leave mid-run, open the recorded asset and land its revision`, async ({ page }) => {
      await leaveAndReturnToAsset(page, type);
      await page.screenshot({ path: test.info().outputPath('returned-asset-ready.png'), fullPage: true });
    });
  }
});
