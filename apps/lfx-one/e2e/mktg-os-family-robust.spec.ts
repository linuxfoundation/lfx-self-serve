// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_KIT_FAMILIES } from '@lfx-one/shared/constants';
import { expect } from '@playwright/test';
import { kitTest as test, openKit, setupKit } from './helpers/mktg-kit.helper';

test.describe('Marketing family responsive structure', () => {
  for (const width of [1440, 1280, 390]) {
    for (const familyId of ['positioning-brand', 'member-sponsor']) {
      test(`${familyId} structure and export placement at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        await setupKit(page, { loaded: true });
        await openKit(page, `/families/${familyId}`);
        await expect(page.getByTestId('mktg-family-assets').locator('tbody tr')).toHaveCount(
          MKTG_KIT_FAMILIES.find((family) => family.id === familyId)?.assets.length ?? 0
        );
        const title = await page.getByTestId('mktg-family-title').boundingBox();
        const intro = await page.getByTestId('mktg-family-intro').boundingBox();
        const actions = await page.getByTestId('mktg-family-actions').boundingBox();
        expect(title).not.toBeNull();
        expect(intro).not.toBeNull();
        expect(actions).not.toBeNull();
        if (title && intro && actions) {
          if (width >= 1280) {
            expect(actions.x).toBeGreaterThanOrEqual(title.x + title.width);
            expect(Math.abs(actions.y - title.y)).toBeLessThan(2);
          } else expect(actions.y).toBeGreaterThanOrEqual(intro.y + intro.height);
        }
        for (const cell of await page.getByTestId(/^mktg-family-(state|current)-/).all()) {
          await expect(cell).toHaveCSS('white-space', 'nowrap');
        }
        const rebuild = await page.getByTestId('mktg-family-rebuild').getByRole('button').boundingBox();
        const caption = await page.getByTestId('mktg-family-rebuild-unavailable').boundingBox();
        expect(rebuild).not.toBeNull();
        expect(caption).not.toBeNull();
        if (rebuild && caption) expect(caption.y).toBeGreaterThanOrEqual(rebuild.y + rebuild.height);
        await expect(page.getByTestId('mktg-family-kit-link')).toContainText('Synthetic Kit Project kit');
        if (familyId === 'positioning-brand') await expect(page.getByTestId('mktg-family-sources')).toBeVisible();
        else {
          await expect(page.getByTestId('mktg-family-sources')).toHaveCount(0);
          await expect(page.getByTestId('mktg-family-run').getByRole('button')).toBeDisabled();
          const run = await page.getByTestId('mktg-family-run').boundingBox();
          const reason = await page.getByTestId('mktg-family-run-unavailable').boundingBox();
          expect(run).not.toBeNull();
          expect(reason).not.toBeNull();
          if (run && reason) expect(reason.y).toBeGreaterThanOrEqual(run.y + run.height);
        }
        await expect(page.getByTestId('mktg-family-approve')).toBeVisible();
        await expect(page.getByTestId('mktg-family-exports').getByRole('button')).toHaveCount(2);
        const table = await page.getByTestId('mktg-family-assets').boundingBox();
        const exports = await page.getByTestId('mktg-family-exports').boundingBox();
        expect(table).not.toBeNull();
        expect(exports).not.toBeNull();
        if (table && exports) {
          if (width >= 1280) expect(exports.x).toBeGreaterThanOrEqual(table.x + table.width);
          else expect(exports.y).toBeGreaterThanOrEqual(table.y + table.height);
        }
        expect(await page.getByTestId('mktg-family-page').evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
        await testInfo.attach(`family-${familyId}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
        if (familyId === 'positioning-brand') {
          await page.getByTestId('mktg-family-open-messaging-framework').click();
          await expect(page.getByTestId('mktg-document-crumb-family')).toHaveText('Positioning & brand');
          await expect(page.getByTestId('mktg-document-crumb-kit')).toBeVisible();
          expect(await page.getByTestId('mktg-document-view-page').evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
          await testInfo.attach(`asset-breadcrumb-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
        }
      });
    }
  }
});
