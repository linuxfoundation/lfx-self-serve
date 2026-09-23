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
  FORMATION_ANNOUNCEMENT_DATE_LABEL,
  FORMATION_PROJECT_SLUG,
  FOUNDATION_SLUG,
  gotoFormationDetail,
  gotoFormationDetailItem,
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

  // #2732: one section implementation serves both hosts, so the `?item=` deep link opens the item
  // here too — and the strip keeps `?project=` naming the foundation.
  test("?item= opens that item's drawer on the drill-down and strips only the item param", async ({ page }) => {
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });

    await gotoFormationDetailItem(page, FORMATION_PROJECT_SLUG, 'contribution_agreement_executed');

    await expect(page.getByTestId('formation-item-drawer')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page).toHaveURL(new RegExp(`/foundation/formations/${FORMATION_PROJECT_SLUG}\\?project=${FOUNDATION_SLUG}$`));
  });

  // #2719: the drill-down shipped without the rail `/project/formation` has, so staff read a
  // checklist with no project info card beside it. The card is fed from the checklist response, so
  // it must name the CHILD project — the foundation is what `?project=` and the context still name.
  test('renders the sidebar formation card for the child project, with stage, announcement date and slug', async ({ page }) => {
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });

    await gotoFormationDetail(page, FORMATION_PROJECT_SLUG);

    const sidebar = page.getByTestId('formation-detail-sidebar');
    await expect(sidebar).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });

    const card = sidebar.getByTestId('formation-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Engaged');
    await expect(card).toContainText('Announcement date');
    await expect(card).toContainText(FORMATION_ANNOUNCEMENT_DATE_LABEL);
    await expect(card).toContainText(FORMATION_PROJECT_SLUG);
    await expect(card).not.toContainText(FOUNDATION_SLUG);
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

  // The guard against the tempting one-line version of GH-2584: adding `Formation - Disengaged` to
  // isPostFormationStage drops it from the queue in a single edit and blanks this page at the same
  // time, which is the opposite of what GH-2328 asked for. Leaving the queue and losing the
  // checklist are different things.
  //
  // Scoped to the page GATE, which is all this can honestly check. `mockFormationChecklistApis`
  // serves a hard-coded `lifecycle: 'live'` checklist, so the frozen read-only rendering is not
  // exercised here — and read-only is driven by `can_write` and a server-side CHECKLIST_READ_ONLY
  // conflict rather than by anything this page derives from the stage.
  test('a Disengaged project still opens its checklist by direct link rather than the not-in-formation state', async ({ page }) => {
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG, { stage: 'Formation - Disengaged' }) });

    await gotoFormationDetail(page, FORMATION_PROJECT_SLUG);

    await expect(page.getByTestId('formation-checklist-section')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formation-detail-not-in-formation')).toHaveCount(0);
  });

  test('a non-auditor contributor is redirected to /foundation/overview', async ({ page }) => {
    await stubPersona(page, false);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });

    await gotoFormationDetail(page, FORMATION_PROJECT_SLUG);

    await expect(page, 'non-auditor should be redirected away from the drill-down').toHaveURL(/\/foundation\/overview/, { timeout: ELEMENT_TIMEOUT });
  });
});
