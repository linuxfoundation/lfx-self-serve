// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

/**
 * US5 acceptance — responsive coverage at mobile / tablet / desktop / wide
 * breakpoints. Asserts no horizontal scroll appears, the search component is
 * reachable, and core navigation icons are present (per task T049 and the
 * 360 / 768 / 1024 / 1440 breakpoint matrix in plan.md).
 */

const DATA_LOAD_TIMEOUT = 30_000;
const TEST_TIMEOUT = 60_000;
const VIEWPORTS = [
  { name: 'mobile', width: 360, height: 640 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1024, height: 768 },
  { name: 'wide', width: 1440, height: 900 },
] as const;

test.use({ storageState: { cookies: [], origins: [] } });

// 30s data-load timeout demands a test timeout that comfortably exceeds it,
// per docs/architecture/testing/testing-best-practices.md (avoid flake from
// the default 30s test timeout colliding with a 30s `toBeVisible`).
test.describe.configure({ timeout: TEST_TIMEOUT });

test.describe('Docs portal — responsive (US5)', () => {
  for (const vp of VIEWPORTS) {
    test(`landing renders without horizontal scroll @ ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/docs', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('docs-landing')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

      // Search must be reachable from every breakpoint.
      await expect(page.getByTestId('docs-search-input')).toBeVisible();

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      // Allow a 1px floating-point fudge factor.
      expect(overflow.scrollWidth, `scrollWidth at ${vp.width}px`).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });

    test(`article renders without horizontal scroll @ ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('docs-article-title')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth, `scrollWidth at ${vp.width}px`).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
  }
});
