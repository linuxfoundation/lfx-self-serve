// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Formation checklist drill-down — robust structural tests (LFXV2-3386). Asserts the data-testid
 * contract and container nesting independent of copy/content — see formation-detail.spec.ts for
 * the content-based behavior coverage.
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

/** See formation-detail.spec.ts's identically-named helper — the `?project=` guard 404s on the fake foundation slug without this stub. */
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

async function gotoFormationDetail(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(`/foundation/formations/${FORMATION_PROJECT_SLUG}?project=${FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}

test.describe('Formation checklist drill-down — structural contract', () => {
  test.beforeEach(async ({ page }) => {
    await stubFormationFlag(page, true);
    await stubPersona(page, true);
    await setPersonaCookie(page);
    await stubNavLensItems(page);
    await stubFoundationProject(page);
    await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });
    await gotoFormationDetail(page);
    await expect(page.getByTestId('formation-detail-container')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
  });

  test('nests the back link, heading, and checklist section inside the container', async ({ page }) => {
    const container = page.getByTestId('formation-detail-container');

    const back = container.getByTestId('formation-detail-back');
    await expect(back).toBeAttached();
    expect(await back.evaluate((el) => el.tagName)).toBe('A');
    await expect(back).toHaveAttribute('href', /.+/);

    await expect(container.locator('h1')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    await expect(container.getByTestId('formation-checklist-section')).toBeAttached();
  });

  test('hosts the readiness strip inside the checklist section', async ({ page }) => {
    const section = page.getByTestId('formation-checklist-section');
    await expect(section.getByTestId('formation-readiness-strip')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
  });
});
