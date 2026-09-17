// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Formation checklist drill-down E2E (LFXV2-3386). The foundation-lens page at
 * `/foundation/formations/:projectSlug` renders one queue row's checklist while `?project=` keeps
 * naming the foundation — the project context must never switch to the child. Deterministic via
 * route mocks; see formation-detail-robust.spec.ts for the structural contract.
 */

import type { LensItem, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import {
  buildBaseProject,
  DATA_LOAD_TIMEOUT,
  FORMATION_PROJECT_SLUG,
  mockFormationChecklistApis,
  skipWhenAuthMissing,
  stubFormationFlag,
} from './helpers/formation-checklist.helper';

test.setTimeout(60_000);

const ELEMENT_TIMEOUT = 10_000;
const SIDEBAR_LOAD_TIMEOUT = 20_000;
const FOUNDATION_SLUG = 'test-foundation';

const MOCK_FOUNDATION_ITEM: LensItem = {
  uid: 'f0000000-0000-0000-0000-000000000099',
  slug: FOUNDATION_SLUG,
  name: 'Test Foundation',
  logoUrl: null,
  isFoundation: true,
};

/** Mirrors formations-queue.spec.ts's identically-named helper. */
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

/**
 * `projectQueryParamGuard` resolves the `?project=<foundation>` slug via `GET /api/projects/:slug`
 * on every hard load of this route — without this stub the fake foundation slug 404s against the
 * real backend and the guard bounces to not-found before the page ever renders.
 */
async function stubFoundationProject(page: Page): Promise<void> {
  await page.route(`**/api/projects/${FOUNDATION_SLUG}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildBaseProject(FOUNDATION_SLUG, { name: 'Test Foundation', stage: 'Active' })),
    });
  });
}

async function gotoFormationDetail(page: Page, slug: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(`/foundation/formations/${slug}?project=${FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}

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
