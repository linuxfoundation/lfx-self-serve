// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Formation Checklist section E2E (GH-1958). Deterministic via route mocks. */

import { expect, test } from '@playwright/test';

import {
  buildBaseProject,
  DATA_LOAD_TIMEOUT,
  FORMATION_PROJECT_SLUG,
  gotoProjectOverview,
  mockFormationChecklistApis,
  stubFormationFlag,
} from './helpers/formation-checklist.helper';

test.setTimeout(120_000);

test.describe('Formation Checklist section (GH-1958)', () => {
  test('renders the readiness strip, both template sections, and gates the section on the Formation stage', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    const section = page.getByTestId('formation-checklist-section');
    await expect(section).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formation-readiness-strip')).toBeVisible();
    await expect(page.getByTestId('formation-readiness-strip-gating-text')).toContainText('open');

    // Both seeded-template sections render with at least one row.
    await expect(section.getByText('Legal and entity')).toBeVisible();
    await expect(section.getByText('Community and launch')).toBeVisible();
    await expect(page.getByTestId('formation-checklist-row-title-formation-item:cascade-data-alliance:draft-project-record')).toBeVisible();
  });

  test('does not render the checklist section for a project not in a Formation stage', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG, { stage: 'Active' }) });
    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    // Something else on the page must be visible first, or a slow-loading section could produce a false negative.
    await expect(page.getByTestId('project-dashboard-container')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formation-checklist-section')).toHaveCount(0);
  });

  test('does not render the checklist section when formation-enabled is off, even for a Formation-stage project', async ({ page }) => {
    await stubFormationFlag(page, false);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    await expect(page.getByTestId('project-dashboard-container')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formation-checklist-section')).toHaveCount(0);
  });

  test('a row action opens the item drawer with notes/history lazy-loaded', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    const rowTitle = page.getByTestId('formation-checklist-row-title-formation-item:cascade-data-alliance:contribution-agreement-executed');
    await expect(rowTitle).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await rowTitle.click();

    const drawer = page.getByTestId('formation-item-drawer');
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId('formation-item-drawer-history')).toContainText('updated notes');
  });

  test('the "Choose a template" empty state renders when no formation exists yet for the project', async ({ page }) => {
    await stubFormationFlag(page, true);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG), hasFormation: false });
    await gotoProjectOverview(page, FORMATION_PROJECT_SLUG);

    await expect(page.getByTestId('formation-checklist-inline-error')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });
});
