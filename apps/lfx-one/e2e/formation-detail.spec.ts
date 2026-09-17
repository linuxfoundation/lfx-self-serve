// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Formation checklist drill-down E2E (LFXV2-3386). The foundation-lens page at
 * `/foundation/formations/:projectSlug` renders one queue row's checklist while `?project=` keeps
 * naming the foundation — the project context must never switch to the child. Deterministic via
 * route mocks; see formation-detail-robust.spec.ts for the structural contract.
 */

import { expect, test } from '@playwright/test';

import {
  buildBaseProject,
  DATA_LOAD_TIMEOUT,
  FORMATION_PROJECT_SLUG,
  FOUNDATION_SLUG,
  gotoFormationDetail,
  mockFormationChecklistApis,
  setPersonaCookie,
  stubFoundationProject,
  stubFormationFlag,
  stubNavLensItems,
  stubPersona,
} from './helpers/formation-checklist.helper';

test.setTimeout(60_000);

const ELEMENT_TIMEOUT = 10_000;
const SIDEBAR_LOAD_TIMEOUT = 20_000;

test.describe('Formation checklist drill-down (LFXV2-3386)', () => {
  test.beforeEach(async ({ page }) => {
    await stubFormationFlag(page, true);
    await stubPersona(page, true);
    await setPersonaCookie(page);
    await stubNavLensItems(page);
    await stubFoundationProject(page);
  });

  test('renders the child project heading and checklist while ?project= keeps naming the foundation', async ({ page }) => {
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });

    await gotoFormationDetail(page, FORMATION_PROJECT_SLUG);

    await expect(page.getByTestId('formation-detail-container')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
    await expect(page.locator('h1')).toContainText('Cascade Data Alliance', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formation-readiness-strip')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formation-checklist-section')).toBeVisible();

    // The context contract: the URL still names the foundation, not the child.
    await expect(page).toHaveURL(new RegExp(`/foundation/formations/${FORMATION_PROJECT_SLUG}\\?project=${FOUNDATION_SLUG}`));
  });

  test('a row action opens the item drawer from the drill-down page', async ({ page }) => {
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });

    await gotoFormationDetail(page, FORMATION_PROJECT_SLUG);

    const rowTitle = page.getByTestId('formation-checklist-row-title-formation-item:cascade-data-alliance:contribution_agreement_executed');
    await expect(rowTitle).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await rowTitle.click();

    await expect(page.getByTestId('formation-item-drawer')).toBeVisible();
  });

  test('the back link returns to the formations queue with the foundation ?project= intact', async ({ page }) => {
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });

    await gotoFormationDetail(page, FORMATION_PROJECT_SLUG);

    const back = page.getByTestId('formation-detail-back');
    await expect(back).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
    await expect(back).toHaveAttribute('href', new RegExp(`/foundation/formations\\?project=${FOUNDATION_SLUG}`));
  });

  test('an unknown project slug shows the in-place not-found state without redirecting', async ({ page }) => {
    await page.route('**/api/projects/no-such-project', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Project not found' }) })
    );

    await gotoFormationDetail(page, 'no-such-project');

    await expect(page.getByTestId('formation-detail-not-found')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page).toHaveURL(new RegExp(`/foundation/formations/no-such-project`));
  });

  test('a post-Formation project shows the in-place not-in-formation state', async ({ page }) => {
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG, { stage: 'Active' }) });

    await gotoFormationDetail(page, FORMATION_PROJECT_SLUG);

    await expect(page.getByTestId('formation-detail-not-in-formation')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formation-checklist-section')).toHaveCount(0);
  });

  test('a non-auditor contributor is redirected to /foundation/overview', async ({ page }) => {
    await stubPersona(page, false);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });

    await gotoFormationDetail(page, FORMATION_PROJECT_SLUG);

    await expect(page, 'non-auditor should be redirected away from the drill-down').toHaveURL(/\/foundation\/overview/, { timeout: ELEMENT_TIMEOUT });
  });
});
