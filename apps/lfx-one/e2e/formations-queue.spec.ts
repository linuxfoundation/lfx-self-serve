// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Formations queue E2E (GH-1958). Deterministic via route mocks. */

import { expect, test } from '@playwright/test';

import { mockFormationsQueue, mockFormationsQueueLifecycleMix } from './fixtures/mock-data';
import { FormationApiMockHelper } from './helpers/formation-api-mock.helper';
import {
  buildBaseProject,
  FORMATION_PROJECT_SLUG,
  FOUNDATION_SLUG,
  gotoFormationsQueue,
  mockFormationChecklistApis,
  setPersonaCookie,
  skipWhenAuthMissing,
  stubFormationFlag,
  stubFoundationProject,
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

    // The health tiles read the BFF's unfiltered counts — the fixture has one gates-cleared row
    // and two rows carrying one blocked item each — and the pills carry the per-stage counts.
    await expect(page.getByTestId('stat-card-Ready to activate').locator('p').first()).toHaveText('1');
    await expect(page.getByTestId('stat-card-Blocked')).toContainText('2 blocked items');
    await expect(page.getByTestId('stat-card-On hold')).toBeVisible();
    await expect(page.getByTestId('filter-pill-all')).toHaveText(`All (${mockFormationsQueue.length})`);
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

  test('clicking a formation name opens its checklist page keeping ?project=, and browser back returns to the queue with it', async ({ page }) => {
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await stubFoundationProject(page);

    // Start WITH `?project=<foundation>` in the queue URL — the point of queryParamsHandling
    // ="preserve" on the row link is that this parameter survives the round trip, so this test
    // must begin with it present or it would still pass with "preserve" removed (#2690 review).
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.goto(`/foundation/formations?project=${FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });

    await page.getByTestId('formations-table-open-formation:cascade-data-alliance').click();

    await expect(page).toHaveURL(new RegExp(`/foundation/formations/cascade-data-alliance\\?project=${FOUNDATION_SLUG}`), { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('formation-detail-container')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/foundation/formations\\?project=${FOUNDATION_SLUG}`), { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  // #2782: the whole row is a click target, not just the name — and it must preserve `?project=`
  // exactly like the name link does (LFXV2-3386).
  test('clicking elsewhere on a row opens the same checklist page, keeping ?project=', async ({ page }) => {
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await stubFoundationProject(page);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.goto(`/foundation/formations?project=${FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });

    await page.getByTestId('formations-table-announcement-formation:cascade-data-alliance').click();

    await expect(page).toHaveURL(new RegExp(`/foundation/formations/cascade-data-alliance\\?project=${FOUNDATION_SLUG}`), { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('formation-detail-container')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  // GH-2584: the queue lists a formation when the formation service still calls it in progress,
  // not when the row's stage happens to start with "Formation".
  //
  // These pin the RENDERING of an already-filtered response, not the filter. `/api/formations` is
  // intercepted here, so formation.service.ts never runs — reverting the real filter would not
  // fail anything below; only reverting the mock helper's mirror of the rule would. The filter
  // itself is covered in formation.service.spec.ts, which is the only place it executes.
  test.describe('lifecycle exclusion (GH-2584)', () => {
    test.beforeEach(async ({ page }) => {
      await FormationApiMockHelper.setupFormationsQueueMock(page, mockFormationsQueueLifecycleMix);
    });

    test('a Disengaged formation is in neither the table nor any tile count', async ({ page }) => {
      await gotoFormationsQueue(page);
      await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });

      await expect(page.getByTestId('formations-table-row-formation:disengaged-fixture')).toHaveCount(0);
      // Absent from the count too, not merely unrendered — the tiles and the table have to agree
      // on what is in the queue, which is the half of LFXV2-3386 easiest to regress silently.
      // Scoped to the value <p> (the card's first paragraph) so this asserts the number itself and
      // not a digit appearing anywhere in value + label + subLine.
      await expect(page.getByTestId('stat-card-In formation').locator('p').first()).toHaveText('3');
    });

    test('Active and Archived formations stay excluded', async ({ page }) => {
      await gotoFormationsQueue(page);
      await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });

      // Already true before GH-2584 (LFXV2-3386 excluded them by stage). Pinned here because the
      // reason changed — they are now excluded by lifecycle — and a future edit could drop the new
      // rule while leaving no test that notices.
      await expect(page.getByTestId('formations-table-row-formation:activated-fixture')).toHaveCount(0);
      await expect(page.getByTestId('formations-table-row-formation:archived-fixture')).toHaveCount(0);
    });

    test('a still-forming formation is listed, including one whose sub-stage has no label', async ({ page }) => {
      await gotoFormationsQueue(page);
      await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });

      await expect(page.getByTestId('formations-table-row-formation:still-forming-fixture')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      // The fail-open half of the rule (GH-2366): an unrecognised `Formation - *` sub-stage is
      // still in progress, so it is listed and its stage rendered verbatim. Without this, a
      // "tidier" filter that also required a mapped sub-stage would look correct and hide work.
      await expect(page.getByTestId('formations-table-row-formation:unmapped-fixture')).toBeVisible();
    });

    test('the "In formation" tile no longer claims rows are outside formation stages', async ({ page }) => {
      await gotoFormationsQueue(page);
      await expect(page.getByTestId('stat-card-In formation')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });

      // Two of the three listed rows have no mapped sub-stage, so the removed clause would be
      // rendering right now if it were still there — this fixture makes its absence meaningful
      // rather than vacuous.
      await expect(page.getByTestId('stat-card-In formation')).not.toContainText('outside formation stages');
    });

    test('a Confidential formation is listed for a caller who can see it', async ({ page }) => {
      await gotoFormationsQueue(page);
      await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });

      // GH-1954. A Confidential row only reaches the BFF when the caller is already authorized for
      // it, so this filter must not second-guess that: dropping it would hide the project from the
      // only people entitled to act on it, and every other assertion here would still pass.
      // Confidentiality is enforced by access control upstream, never by sub-stage or lifecycle.
      await expect(page.getByTestId('formations-table-row-formation:confidential-fixture')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    });
  });

  test('the empty state renders "No formations yet" with zero rows, and "No results found" once filtered', async ({ page }) => {
    await FormationApiMockHelper.setupFormationsQueueMock(page, []);

    await gotoFormationsQueue(page);

    const empty = page.getByTestId('formations-table-empty');
    await expect(empty).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
    await expect(empty).toContainText('No formations yet');

    await page.getByTestId('filter-pill-on_hold').click();
    await expect(empty).toContainText('No results found');

    // "Reset filters" clears the pill and returns the genuinely-empty copy.
    await empty.getByRole('button', { name: /Reset filters/ }).click();
    await expect(empty).toContainText('No formations yet');
    await expect(page.getByTestId('filter-pill-all')).toHaveAttribute('aria-pressed', 'true');
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
