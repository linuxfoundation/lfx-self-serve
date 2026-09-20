// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Formation-only project sidebar (#2754) — content-based. Lands on a project the way a user does
 * (the Project lens overview) and reads what they see in the sidebar: for a project still in a
 * Formation stage, the Formation checklist is the one place the nav offers, and the checklist page
 * is where they arrive; an active project keeps its usual links. See formation-sidebar-robust.spec.ts
 * for the data-testid contract.
 */

import { expect, Page, test } from '@playwright/test';

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

/** The links a project user normally sees in the Project lens, by their visible labels. */
const STANDARD_LINKS = ['Dashboard', 'Meetings', 'Mailing Lists', 'Groups', 'Documents', 'Votes', 'Surveys', 'Permissions'] as const;

const sidebarLink = (page: Page, label: string) => page.getByTestId('sidebar').getByRole('link', { name: new RegExp(`^${label}$`) });

test.describe('Project lens sidebar for a formation-stage project (#2754)', () => {
  test.beforeEach(async ({ page }) => {
    await stubFormationFlag(page, true);
    await stubPersona(page, false);
    await setPersonaCookie(page);
  });

  test('offers only the Formation link and opens the checklist for a project that is still forming', async ({ page }) => {
    const project = buildBaseProject(FORMATION_PROJECT_SLUG, { stage: 'Formation - Engaged', category: 'project' });
    await stubProjectLensItems(page, project);
    await mockFormationChecklistApis(page, { project });

    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    await expect(page.getByTestId('formation-checklist-section'), 'the user should land on the Formation checklist').toBeVisible({
      timeout: SIDEBAR_LOAD_TIMEOUT,
    });
    await waitForSidebar(page);
    await expect(sidebarLink(page, 'Formation')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    for (const label of STANDARD_LINKS) {
      await expect(sidebarLink(page, label), `the ${label} link should not be offered while the project is forming`).toHaveCount(0);
    }
  });

  test('keeps the usual links, with no Formation link, for an active project', async ({ page }) => {
    const project = buildBaseProject(ACTIVE_PROJECT_SLUG, { stage: 'Active', category: 'project' });
    await stubProjectLensItems(page, project);
    await mockFormationChecklistApis(page, { project });

    await gotoProjectOverview(page, ACTIVE_PROJECT_SLUG);

    await waitForSidebar(page);
    for (const label of STANDARD_LINKS) {
      await expect(sidebarLink(page, label), `the ${label} link should be offered for an active project`).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    }
    await expect(sidebarLink(page, 'Formation')).toHaveCount(0);
  });
});
