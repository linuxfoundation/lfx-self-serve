// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Formation-only project sidebar (#2754) — robust structural tests. Asserts the redirect URL and
 * the sidebar's data-testid contract independent of copy — see formation-sidebar.spec.ts for the
 * content-based behaviour coverage.
 */

import { expect, test } from '@playwright/test';

import {
  buildBaseProject,
  FORMATION_PROJECT_SLUG,
  gotoProjectOverview,
  mockFormationChecklistApis,
  setPersonaCookie,
  stubFormationFlag,
  stubPersona,
  stubProjectLensItems,
  waitForSidebar,
} from './helpers/formation-checklist.helper';

// Two full page navigations plus a sidebar-load wait — the default 30s is too tight on slow CI runners.
test.setTimeout(60_000);

const SIDEBAR_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;
const ACTIVE_PROJECT_SLUG = 'cascade-active-project';

/** Every project-lens item the formation-only sidebar must drop, by the sidebar's auto-derived testids. */
const FULL_NAV_TESTIDS = [
  'sidebar-item-dashboard',
  'sidebar-item-meetings',
  'sidebar-item-mailing-lists',
  'sidebar-item-groups',
  'sidebar-item-documents',
  'sidebar-item-governance',
] as const;

test.describe('Project lens sidebar for a formation-stage project — structural contract (#2754)', () => {
  test.beforeEach(async ({ page }) => {
    await stubFormationFlag(page, true);
    await stubPersona(page, false);
    await setPersonaCookie(page);
  });

  test('redirects a formation project to the checklist and keeps only the Formation testid in the sidebar', async ({ page }) => {
    const project = buildBaseProject(FORMATION_PROJECT_SLUG, { stage: 'Formation - Engaged', category: 'project' });
    await stubProjectLensItems(page, project);
    await mockFormationChecklistApis(page, { project });

    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    await expect(page, 'the overview should redirect to the checklist').toHaveURL(new RegExp(`/project/formation\\?project=${FORMATION_PROJECT_SLUG}`), {
      timeout: SIDEBAR_LOAD_TIMEOUT,
    });
    await waitForSidebar(page);
    await expect(page.getByTestId('sidebar-project-formation')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    for (const testId of FULL_NAV_TESTIDS) {
      await expect(page.getByTestId(testId), `${testId} should be hidden for a formation project`).toHaveCount(0);
    }
  });

  test('keeps an active project on the overview with every standard testid and no Formation testid', async ({ page }) => {
    const project = buildBaseProject(ACTIVE_PROJECT_SLUG, { stage: 'Active', category: 'project' });
    await stubProjectLensItems(page, project);
    await mockFormationChecklistApis(page, { project });

    await gotoProjectOverview(page, ACTIVE_PROJECT_SLUG);

    await waitForSidebar(page);
    await expect(page).toHaveURL(new RegExp(`/project/overview\\?project=${ACTIVE_PROJECT_SLUG}`));
    for (const testId of FULL_NAV_TESTIDS) {
      await expect(page.getByTestId(testId), `${testId} should stay visible for an active project`).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    }
    await expect(page.getByTestId('sidebar-project-formation')).toHaveCount(0);
  });
});
