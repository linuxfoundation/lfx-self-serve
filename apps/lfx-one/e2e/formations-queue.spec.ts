// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Formations queue E2E (GH-1958). Deterministic via route mocks. */

import type { LensItem, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import { mockFormationsQueue } from './fixtures/mock-data';
import { FormationApiMockHelper } from './helpers/formation-api-mock.helper';
import { skipWhenAuthMissing, stubFormationFlag } from './helpers/formation-checklist.helper';

test.setTimeout(60_000);

const ELEMENT_TIMEOUT = 10_000;
const SIDEBAR_LOAD_TIMEOUT = 20_000;

const MOCK_FOUNDATION_ITEM: LensItem = {
  uid: 'f0000000-0000-0000-0000-000000000099',
  slug: 'test-foundation',
  name: 'Test Foundation',
  logoUrl: null,
  isFoundation: true,
};

/** Mirrors marketing-access.spec.ts's `stubPersona` — `isAuditor` is the field `formationsQueueAuditorGuard` reads. */
async function stubPersona(page: Page, isAuditor: boolean): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas: ['contributor'],
        personaProjects: {},
        projects: [],
        organizations: [],
        isRootWriter: false,
        isLFStaff: false,
        isAuditor,
      }),
    })
  );
}

/** See persona-navigation.spec.ts's identically-named helper for the full rationale (SSR guard cookie seeding). */
async function setPersonaCookie(page: Page): Promise<void> {
  const state: PersistedPersonaState = { primary: 'contributor' as PersonaType, all: ['contributor'] as PersonaType[] };
  await page
    .context()
    .addCookies([{ name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(state)), domain: 'localhost', path: '/', sameSite: 'Lax' }]);
}

async function stubNavLensItems(page: Page): Promise<void> {
  await page.route('**/api/nav/lens-items*', (route) => {
    const requestedLens = new URL(route.request().url()).searchParams.get('lens') ?? 'foundation';
    const items = requestedLens === 'foundation' ? [MOCK_FOUNDATION_ITEM] : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, next_page_token: null, upstream_failed: false, lens: requestedLens }),
    });
  });
}

async function gotoFormationsQueue(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto('/foundation/formations', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}

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
      await expect(page.getByTestId(`formations-table-row-${row.uid}`)).toBeVisible();
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

  test('a formation name links to its project page', async ({ page }) => {
    await gotoFormationsQueue(page);
    await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });

    const link = page.getByTestId('formations-table-open-formation:cascade-data-alliance');
    await expect(link).toHaveAttribute('href', /\/project\/overview\?project=cascade-data-alliance/);
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
