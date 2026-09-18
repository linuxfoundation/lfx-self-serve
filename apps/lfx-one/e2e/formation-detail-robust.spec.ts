// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Formation checklist drill-down — robust structural tests (LFXV2-3386). Asserts the data-testid
 * contract and container nesting independent of copy/content — see formation-detail.spec.ts for
 * the content-based behavior coverage.
 */

import { expect, test } from '@playwright/test';

import {
  buildBaseProject,
  DATA_LOAD_TIMEOUT,
  FORMATION_PROJECT_SLUG,
  gotoFormationDetail,
  mockFormationChecklistApis,
  setPersonaCookie,
  stubFoundationProject,
  stubFormationFlag,
  stubNavLensItems,
  stubPersona,
} from './helpers/formation-checklist.helper';

test.setTimeout(60_000);

const SIDEBAR_LOAD_TIMEOUT = 20_000;

test.describe('Formation checklist drill-down — structural contract', () => {
  test.beforeEach(async ({ page }) => {
    await stubFormationFlag(page, true);
    await stubPersona(page, true);
    await setPersonaCookie(page);
    await stubNavLensItems(page);
    await stubFoundationProject(page);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await gotoFormationDetail(page, FORMATION_PROJECT_SLUG);
    await expect(page.getByTestId('formation-detail-container')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
  });

  test('nests the back link, heading, and checklist section inside the container', async ({ page }) => {
    const container = page.getByTestId('formation-detail-container');

    const back = container.getByTestId('formation-detail-back');
    await expect(back).toBeAttached();
    expect(await back.evaluate((el) => el.tagName)).toBe('A');
    await expect(back).toHaveAttribute('href', /.+/);

    await expect(container.locator('h1')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await expect(container.getByTestId('formation-checklist-section')).toBeAttached();
  });

  test('nests the checklist section and the formation card under the two-column wrapper (#2719)', async ({ page }) => {
    const columns = page.getByTestId('formation-detail-columns');
    await expect(columns.getByTestId('formation-checklist-section')).toBeAttached();

    const sidebar = columns.getByTestId('formation-detail-sidebar');
    await expect(sidebar).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await expect(sidebar.getByTestId('formation-card')).toBeAttached();
  });

  test('hosts the readiness strip inside the checklist section', async ({ page }) => {
    const section = page.getByTestId('formation-checklist-section');
    await expect(section.getByTestId('formation-readiness-strip')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
  });
});
