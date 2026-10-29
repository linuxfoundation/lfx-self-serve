// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_AGENTS, MKTG_KIT_FAMILIES, MKTG_KIT_POSITIONING_FAMILY_ID, MKTG_DOCUMENT_TYPES } from '../../../packages/shared/src/constants';
import { expect } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { kitTest as test, openKit, setupKit } from './helpers/mktg-kit.helper';

test.describe('Marketing family responsive structure', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  for (const width of [1440, 1280, 390]) {
    for (const familyId of ['positioning-brand', 'member-sponsor']) {
      test(`${familyId} structure and export placement at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        await setupKit(page, { loaded: true, approvedFramework: true });
        await openKit(page, `/families/${familyId}`);
        await expect(page.getByTestId('mktg-family-assets').getByRole('listitem')).toHaveCount(
          MKTG_KIT_FAMILIES.find((family) => family.id === familyId)?.assets.length ?? 0
        );
        for (const row of await page.getByTestId('mktg-family-assets').getByRole('listitem').all()) {
          if (await row.locator('[data-testid^="mktg-family-open-"]').count()) await expect(row.locator('lfx-button')).toHaveCount(0);
        }
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
        // This fixture has nothing stale: the header carries no rebuild, only the run action.
        await expect(page.getByTestId('mktg-family-rebuild')).toHaveCount(0);
        if (familyId === MKTG_KIT_POSITIONING_FAMILY_ID) {
          await expect(page.locator('lfx-mktg-rebuild')).toBeAttached();
          await expect(page.getByTestId('mktg-rebuild-progress')).toHaveCount(0);
        } else await expect(page.locator('lfx-mktg-rebuild')).toHaveCount(0);
        await expect(page.getByTestId('mktg-breadcrumb-link-0')).toContainText('Synthetic Kit Project kit');
        if (familyId === 'positioning-brand') await expect(page.getByTestId('mktg-family-sources')).toBeVisible();
        else {
          await expect(page.getByTestId('mktg-family-sources')).toHaveCount(0);
          const family = MKTG_KIT_FAMILIES.find((entry) => entry.id === familyId);
          const runnable = MKTG_AGENTS.find((agent) => family?.agentIds.includes(agent.id) && agent.status === 'active');
          const runButton = page.getByTestId('mktg-family-run').getByRole(runnable ? 'link' : 'button');
          const run = await page.getByTestId('mktg-family-run').boundingBox();
          expect(run).not.toBeNull();
          if (runnable) {
            await expect(runButton).toBeVisible();
            const asset = family?.assets.find((row) =>
              MKTG_DOCUMENT_TYPES.some((type) => type.agentKey === row.agentKey && type.catalogAgentId === runnable.id)
            );
            await expect(runButton).toHaveAccessibleName('Create ' + (asset?.runName ?? asset?.label ?? runnable.name));
            await expect(page.getByTestId('mktg-family-run-next')).toHaveCount(0);
            await expect(page.getByTestId('mktg-family-run-unavailable')).toHaveCount(0);
          } else {
            await expect(page.getByTestId('mktg-family-actions')).toHaveCount(0);
          }
        }
        await expect(page.getByTestId('mktg-family-approve')).toBeVisible();
        // The aside also contains #4498's source/sign-off Show toggles; they are not export actions.
        const exportSlot = page.getByTestId('mktg-family-exports');
        const exportActions = exportSlot.getByTestId('family-export-actions');
        if (familyId === MKTG_KIT_POSITIONING_FAMILY_ID) {
          await expect(exportActions.getByTestId('family-export-pdf').getByRole('button', { name: 'Download PDF', exact: true })).toBeVisible();
          await expect(exportActions.getByTestId('family-export-slides').getByRole('button', { name: 'Export to Google Slides', exact: true })).toBeVisible();
          await expect(exportSlot.getByTestId('mktg-family-sources-toggle').getByRole('button', { name: 'Show', exact: true })).toBeVisible();
          await expect(exportActions.getByTestId('family-export-unsupported')).toHaveCount(0);
        } else {
          await expect(exportActions.getByTestId('family-export-pdf')).toHaveCount(0);
          await expect(exportActions.getByTestId('family-export-slides')).toHaveCount(0);
          await expect(exportActions.getByTestId('family-export-unsupported')).toBeVisible();
          await expect(exportSlot.getByTestId('mktg-family-sources-toggle')).toHaveCount(0);
        }
        await expect(exportSlot.getByTestId('mktg-family-sign-off-toggle').getByRole('button', { name: 'Show', exact: true })).toBeVisible();
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
          await expect(page.getByTestId('mktg-breadcrumb-link-1')).toHaveText('Positioning & brand');
          await expect(page.getByTestId('mktg-breadcrumb-link-0')).toBeVisible();
          expect(await page.getByTestId('mktg-document-view-page').evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
          await testInfo.attach(`asset-breadcrumb-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
        }
      });
    }
  }
});
