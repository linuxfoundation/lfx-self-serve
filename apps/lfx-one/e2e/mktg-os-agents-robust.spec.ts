// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_AGENTS, MKTG_KIT_EXCLUDED_AGENT_IDS } from '@lfx-one/shared/constants';
import { expect } from '@playwright/test';
import { kitTest as test, openKit, setupKit } from './helpers/mktg-kit.helper';

test.describe('Marketing agents responsive structure', () => {
  for (const width of [1440, 1280, 390]) {
    test(`Agents structure at ${width}px uses one card per catalog entry`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await setupKit(page);
      await openKit(page, '/agents');
      await expect(page.getByTestId('mktg-kit-tab-agents')).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('mktg-os-agents-results').locator('button')).toHaveCount(
        MKTG_AGENTS.filter((agent) => !MKTG_KIT_EXCLUDED_AGENT_IDS.includes(agent.id)).length
      );
      await expect(page.getByTestId(/^mktg-os-agents-run-order-/)).toHaveCount(1);
      await expect(page.getByTestId('mktg-os-agents-search')).toHaveCount(0);
      const overflowing = await page.getByTestId('mktg-os-agents-page').evaluate((element) => element.scrollWidth > element.clientWidth + 1);
      expect(overflowing).toBe(false);
      await testInfo.attach(`agents-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    });
  }
});
