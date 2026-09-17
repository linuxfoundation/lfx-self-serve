// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Formations queue E2E (GH-1958). Deterministic via route mocks. */

import { expect, test } from '@playwright/test';

import { mockFormationsQueue } from './fixtures/mock-data';
import { FormationApiMockHelper } from './helpers/formation-api-mock.helper';
import {
  buildBaseProject,
  FORMATION_PROJECT_SLUG,
  gotoFormationsQueue,
  mockFormationChecklistApis,
  setPersonaCookie,
  stubFormationFlag,
  stubNavLensItems,
  stubPersona,
} from './helpers/formation-checklist.helper';

test.setTimeout(60_000);

const ELEMENT_TIMEOUT = 10_000;
const SIDEBAR_LOAD_TIMEOUT = 20_000;

test.describe('Formations queue (GH-1958)', () => {
  // Default setup: an auditor, formation flag on, queue mocked with the standard 3-row fixture.
  // Individual tests override a route registered here (last-registered handler wins) to change
  // just the one thing they're testing.
  test.beforeEach(async ({ page }) => {
    await stubFormationFlag(page, true);
    await stubPersona(page, true);
    await setPersonaCookie(page);
    await stubNavLensItems(page);
    await FormationApiMockHelper.setupFormationsQueueMock(page);
  });

  test('an auditor sees the tiles and table, with every seeded row rendered', async ({ page }) => {
    await gotoFormationsQueue(page);

    await expect(page.getByTestId('formations-queue-container')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
    await expect(page.getByTestId('stat-card-In formation')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    for (const row of mockFormationsQueue) {
      await expect(page.getByTestId(`formations-table-row-${row.formation_uid}`)).toBeVisible();
    }
  });

  test('a non-auditor contributor is redirected to /foundation/overview', async ({ page }) => {
    await stubPersona(page, false);

    await gotoFormationsQueue(page);

    await expect(page, 'non-auditor should be redirected away from the Formations queue').toHaveURL(/\/foundation\/overview/, { timeout: ELEMENT_TIMEOUT });
  });

  test('the status pills filter the table by sub_stage', async ({ page }) => {
    await gotoFormationsQueue(page);
    await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });

    await page.getByTestId('filter-pill-on_hold').click();

    await expect(page.getByTestId('formations-table-row-formation:harbor-data-exchange')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('formations-table-row-formation:cascade-data-alliance')).toHaveCount(0);
  });

  // LFXV2-3386: rows link to the foundation-lens checklist drill-down (child in the path param),
  // never to `/project/overview?project=<child>` — that handed the whole project context to the child.
  test('a formation name links to its checklist drill-down', async ({ page }) => {
    await gotoFormationsQueue(page);
    await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });

    const link = page.getByTestId('formations-table-open-formation:cascade-data-alliance');
    await expect(link).toHaveAttribute('href', /\/foundation\/formations\/cascade-data-alliance/);
  });

  test('clicking a formation name opens its checklist page, and browser back returns to the queue', async ({ page }) => {
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });

    await gotoFormationsQueue(page);
    await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });

    await page.getByTestId('formations-table-open-formation:cascade-data-alliance').click();

    await expect(page).toHaveURL(/\/foundation\/formations\/cascade-data-alliance/, { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('formation-detail-container')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await page.goBack();
    await expect(page).toHaveURL(/\/foundation\/formations(\?|$)/, { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  // LFXV2-3386: the mock helper mirrors the BFF's post-Formation drop — an Active row is in
  // neither the table nor the tiles, while in-formation fixture rows still render.
  test('a post-Formation (Active) row is excluded from the table and tiles', async ({ page }) => {
    const activeRow = {
      ...mockFormationsQueue[0],
      formation_uid: 'formation:already-active',
      project_uid: 'e2e-already-active-uid',
      project_name: 'Already Active Project',
      project_slug: 'already-active-project',
      sub_stage: null,
      sub_stage_raw: 'Active',
    };
    await FormationApiMockHelper.setupFormationsQueueMock(page, [...mockFormationsQueue, activeRow]);

    await gotoFormationsQueue(page);
    await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });

    await expect(page.getByTestId('formations-table-row-formation:cascade-data-alliance')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('formations-table-row-formation:already-active')).toHaveCount(0);
    // The "In formation" tile's headline counts only in-formation rows — the Active row is not in
    // `total`. Scoped to the value <p> (the card's first paragraph) so this asserts the number
    // itself, not a digit appearing anywhere in the value + label + subLine text.
    await expect(page.getByTestId('stat-card-In formation').locator('p').first()).toHaveText(String(mockFormationsQueue.length));
  });

  test('the empty state renders "No formations yet" with zero rows, and "No results found" once filtered', async ({ page }) => {
    await FormationApiMockHelper.setupFormationsQueueMock(page, []);

    await gotoFormationsQueue(page);

    const empty = page.getByTestId('formations-table-empty');
    await expect(empty).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
    await expect(empty).toContainText('No formations yet');

    await page.getByTestId('filter-pill-on_hold').click();
    await expect(empty).toContainText('No results found');
  });

  test('the inline error state renders (with a working Retry) on a 500 from the queue endpoint', async ({ page }) => {
    await page.route('**/api/formations*', (route) =>
      route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : route.fallback()
    );

    await gotoFormationsQueue(page);

    await expect(page.getByTestId('formations-queue-inline-error')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
    const retry = page.getByTestId('formations-queue-retry');
    await expect(retry).toBeVisible();

    // Re-route to a working response before clicking, so this pins onRetry's filters.set()-alone
    // contract — not just that the button renders.
    await FormationApiMockHelper.setupFormationsQueueMock(page);
    await retry.click();

    await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
    await expect(page.getByTestId('formations-queue-inline-error')).toHaveCount(0);
  });
});
