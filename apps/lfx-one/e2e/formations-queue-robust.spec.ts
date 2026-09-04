// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Formations queue — robust structural tests (GH-1958). Asserts the data-testid contract, table
 * DOM shape, and per-row action nesting independent of copy/content — see formations-queue.spec.ts
 * for the content-based behavior coverage.
 */

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

async function gotoFormationsQueue(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto('/foundation/formations', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}

test.describe('Formations queue — structural contract', () => {
  test.beforeEach(async ({ page }) => {
    await stubFormationFlag(page, true);
    await stubPersona(page, true);
    await setPersonaCookie(page);
    await stubNavLensItems(page);
    await FormationApiMockHelper.setupFormationsQueueMock(page);
    await gotoFormationsQueue(page);
    await expect(page.getByTestId('formations-queue-container')).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
  });

  test.describe('Container nesting', () => {
    test('nests the table card containing status tabs, search input, and the table', async ({ page }) => {
      const card = page.getByTestId('formations-table-card');
      await expect(card).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await expect(card.getByTestId('formations-status-tabs')).toBeAttached();
      await expect(card.getByTestId('formations-search-input')).toBeAttached();
      await expect(card.getByTestId('formations-table')).toBeAttached();
    });

    test('renders one stat tile per queue metric', async ({ page }) => {
      for (const label of ['In formation', 'Ready to activate', 'Exploratory', 'Engaged']) {
        await expect(page.getByTestId(`stat-card-${label}`)).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      }
    });

    test('renders a filter pill for "all" and every queue sub-stage', async ({ page }) => {
      const tabs = page.getByTestId('formations-status-tabs');
      for (const id of ['all', 'exploratory', 'engaged', 'on_hold']) {
        const pill = tabs.getByTestId(`filter-pill-${id}`);
        await expect(pill).toBeAttached();
        await expect(pill).toHaveAttribute('aria-pressed', id === 'all' ? 'true' : 'false');
      }
    });
  });

  test.describe('Table structure', () => {
    test('the real <table> element carries the ariaLabel contract', async ({ page }) => {
      const table = page.getByTestId('formations-table').locator('table');
      await expect(table).toHaveAttribute('aria-label', 'Formations queue');
    });

    test('the header row has the 6 documented columns in order', async ({ page }) => {
      const headers = page.getByTestId('formations-table').locator('thead th');
      await expect(headers).toHaveCount(6);
      await expect(headers.nth(0)).toHaveText('Formation');
      await expect(headers.nth(1)).toHaveText('Type');
      await expect(headers.nth(2)).toHaveText('Stage');
      await expect(headers.nth(3)).toHaveText('Progress');
      await expect(headers.nth(4)).toHaveText('Announcement');
      await expect(headers.nth(5)).toHaveText('Blocking');
    });

    test('renders one row per queue formation, keyed by uid', async ({ page }) => {
      for (const row of mockFormationsQueue) {
        await expect(page.getByTestId(`formations-table-row-${row.uid}`)).toBeAttached();
      }
    });

    test('a formation name is a real link to its project page', async ({ page }) => {
      for (const row of mockFormationsQueue) {
        const link = page.getByTestId(`formations-table-open-${row.uid}`);
        await expect(link).toBeAttached();
        expect(await link.evaluate((el) => el.tagName)).toBe('A');
      }
    });
  });

  test.describe('Empty and error state contract', () => {
    test('an empty result set renders the empty-state container in place of the table', async ({ page }) => {
      await FormationApiMockHelper.setupFormationsQueueMock(page, []);
      await gotoFormationsQueue(page);

      await expect(page.getByTestId('formations-table-empty')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await expect(page.getByTestId('formations-table')).toHaveCount(0);
    });

    test('a 500 from the queue endpoint nests a retry button in place of the tiles and table', async ({ page }) => {
      await page.route('**/api/formations*', (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      });
      await gotoFormationsQueue(page);

      const error = page.getByTestId('formations-queue-inline-error');
      await expect(error).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      const retry = error.getByTestId('formations-queue-retry');
      await expect(retry).toBeAttached();
      expect(await retry.evaluate((el) => el.tagName)).toBe('BUTTON');
      await expect(page.getByTestId('formations-table-card')).toHaveCount(0);
    });
  });
});
