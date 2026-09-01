// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Formations queue E2E (GH-1958). Deterministic via route mocks. */

import type { LensItem, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import { mockFormationsQueue } from './fixtures/mock-data';
import { FormationApiMockHelper } from './helpers/formation-api-mock.helper';
import { stubFormationFlag } from './helpers/formation-checklist.helper';

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

function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — let the test surface the failure naturally.
  }
}

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
  test('an auditor sees the tiles and table, with the withdrawn row already reflecting a past decline', async ({ page }) => {
    await stubFormationFlag(page, true);
    await stubPersona(page, true);
    await setPersonaCookie(page);
    await stubNavLensItems(page);
    await FormationApiMockHelper.setupFormationsQueueMock(page);
    await FormationApiMockHelper.setupFormationQueueActionMock(page);

    await gotoFormationsQueue(page);

    await expect(page.getByTestId('formations-queue-container')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
    await expect(page.getByTestId('stat-card-In formation')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    for (const row of mockFormationsQueue) {
      await expect(page.getByTestId(`formations-table-row-${row.uid}`)).toBeVisible();
    }
    // formerly-brightpath is seeded as withdrawn — its proposed-only Accept/Decline actions must not render.
    await expect(page.getByTestId('formations-table-accept-formation:formerly-brightpath')).toHaveCount(0);
  });

  test('a non-auditor contributor is redirected to /foundation/overview', async ({ page }) => {
    await stubFormationFlag(page, true);
    await stubPersona(page, false);
    await setPersonaCookie(page);
    await stubNavLensItems(page);
    await FormationApiMockHelper.setupFormationsQueueMock(page);

    await gotoFormationsQueue(page);

    await expect(page, 'non-auditor should be redirected away from the Formations queue').toHaveURL(/\/foundation\/overview/, { timeout: ELEMENT_TIMEOUT });
  });

  test('the status pills filter the table by sub_stage', async ({ page }) => {
    await stubFormationFlag(page, true);
    await stubPersona(page, true);
    await setPersonaCookie(page);
    await stubNavLensItems(page);
    await FormationApiMockHelper.setupFormationsQueueMock(page);

    await gotoFormationsQueue(page);
    await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });

    await page.getByTestId('filter-pill-proposed').click();

    await expect(page.getByTestId('formations-table-row-formation:harbor-data-exchange')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('formations-table-row-formation:cascade-data-alliance')).toHaveCount(0);
  });

  test('Accept opens the admin-tool deep link and Decline requires a reason', async ({ page }) => {
    await stubFormationFlag(page, true);
    await stubPersona(page, true);
    await setPersonaCookie(page);
    await stubNavLensItems(page);
    await FormationApiMockHelper.setupFormationsQueueMock(page);
    await FormationApiMockHelper.setupFormationQueueActionMock(page);

    await gotoFormationsQueue(page);
    await expect(page.getByTestId('formations-table')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });

    // harbor-data-exchange is the seeded 'proposed' row — the only sub_stage that renders Accept/Decline.
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByTestId('formations-table-accept-formation:harbor-data-exchange').locator('button').click(),
    ]);
    expect(popup.url()).toContain('admin.linuxfoundation.org');
    await popup.close();

    await page.getByTestId('formations-table-decline-formation:harbor-data-exchange').locator('button').click();
    const dialog = page.getByTestId('reason-prompt-dialog');
    await expect(dialog).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    const confirm = page.getByTestId('reason-prompt-dialog-confirm').locator('button');
    await expect(confirm).toBeDisabled();
    await page.locator('textarea[data-test="reason-prompt-dialog-textarea"]').fill('not a fit at this time');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(dialog).toHaveCount(0);
  });

  test('the inline error state renders on a 500 from the queue endpoint', async ({ page }) => {
    await stubFormationFlag(page, true);
    await stubPersona(page, true);
    await setPersonaCookie(page);
    await stubNavLensItems(page);
    await page.route('**/api/formations*', (route) =>
      route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : route.fallback()
    );

    await gotoFormationsQueue(page);

    await expect(page.getByTestId('formations-queue-inline-error')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
    await expect(page.getByTestId('formations-queue-retry')).toBeVisible();
  });
});
