// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens · Project Detail Page E2E Tests (LFXV2-1885)
 *
 * Covers the acceptance criteria for the per-project Org Lens view:
 * - data-testid resolution smoke test (breadcrumb, hero, tabs, card groups, trend)
 * - tab strip switching (click + keyboard) with ?tab= URL persistence
 * - leaderboard ranking, score/metric toggles with ?metric= persistence,
 *   Activity Count hiding the band tags, and Show more pagination
 * - not-found (404) panel for an unknown slug
 *
 * Prerequisites:
 * - Dev server running on the Playwright baseURL
 * - User authenticated with the `org-lens-enabled` flag on and an organization selected
 *
 * Data semantics (v1): the page is served from live Snowflake platinum via the BFF. `k8s` is the real
 * catalog slug for the Kubernetes project (the earlier `kubernetes` was only the removed demo-fixture
 * key); a slug with no catalog row for the selected org returns null → the not-found panel.
 */

import { expect, test } from '@playwright/test';

const DETAIL_URL = '/org/projects/k8s';
const DETAIL_URL_BOGUS = '/org/projects/totally-bogus-project';
const DATA_LOAD_TIMEOUT = 30_000;

test.setTimeout(90_000);

test.describe('Org Project Detail — testid resolution', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('project-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('renders breadcrumb, hero and tab strip', async ({ page }) => {
    await expect(page.getByTestId('project-detail-breadcrumb')).toBeVisible();
    await expect(page.getByTestId('project-detail-hero')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('project-detail-name')).toHaveText('Kubernetes');
    await expect(page.getByTestId('project-detail-first-commit')).toBeVisible();
    await expect(page.getByTestId('project-detail-software-value')).toBeVisible();
    await expect(page.getByTestId('project-detail-health-badge')).toBeVisible();
    await expect(page.getByTestId('project-detail-foundation-pill')).toBeVisible();
    await expect(page.getByTestId('project-detail-tab-pd-influence')).toBeVisible();
    await expect(page.getByTestId('project-detail-tab-pd-leaderboards')).toBeVisible();
  });

  test('renders the Technical and Ecosystem card groups', async ({ page }) => {
    await expect(page.getByTestId('project-detail-technical-card-maintainers')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    for (const key of ['maintainers', 'contributors', 'commits', 'pull-requests']) {
      await expect(page.getByTestId(`project-detail-technical-card-${key}`)).toBeVisible();
    }
    for (const key of ['collaboration', 'meeting-attendance', 'board-members', 'committee-members']) {
      await expect(page.getByTestId(`project-detail-ecosystem-card-${key}`)).toBeVisible();
    }

    await page.getByTestId('project-detail-tab-pd-leaderboards').click();
    await expect(page.getByTestId('project-detail-trend-group')).toBeVisible();
  });
});

test.describe('Org Project Detail — tab strip', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('project-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('defaults to Our Influence and switches to Leaderboards via click + URL', async ({ page }) => {
    await expect(page.getByTestId('project-detail-technical-group')).toBeVisible();
    await page.getByTestId('project-detail-tab-pd-leaderboards').click();
    await expect(page).toHaveURL(/tab=pd-leaderboards/);
    await expect(page.getByTestId('project-detail-leaderboard-technical')).toBeVisible();
  });

  test('deep-links to the Leaderboards tab via ?tab=', async ({ page }) => {
    await page.goto(`${DETAIL_URL}?tab=pd-leaderboards`, { waitUntil: 'domcontentloaded' });
    // The board is fetched lazily on first activation; wait for its table (data present), not just
    // the wrapper that renders during the loading skeleton.
    await expect(page.getByTestId('project-detail-leaderboard-technical-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('arrow keys move between tabs', async ({ page }) => {
    await page.getByTestId('project-detail-tab-pd-influence').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('project-detail-tab-pd-leaderboards')).toBeFocused();
  });
});

test.describe('Org Project Detail — leaderboards', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${DETAIL_URL}?tab=pd-leaderboards`, { waitUntil: 'domcontentloaded' });
    // Gate on the rendered table so per-block lazy loading has resolved before the assertions below.
    await expect(page.getByTestId('project-detail-leaderboard-technical-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('renders both side-by-side boards with the viewing-org row at its ranked position', async ({ page }) => {
    await expect(page.getByTestId('project-detail-leaderboard-technical')).toBeVisible();
    await expect(page.getByTestId('project-detail-leaderboard-ecosystem')).toBeVisible();
    await expect(page.getByTestId('project-detail-leaderboard-technical-viewing-row')).toBeVisible();
    await expect(page.getByTestId('project-detail-leaderboard-ecosystem-viewing-row')).toBeVisible();
    await expect(page.getByTestId('project-detail-trend-group')).toBeVisible();

    // The viewing org is no longer pinned to the top: the default Calculated Influence view ranks
    // rows 1..N contiguously, so ranks ascend in render order and the viewing row sits at the
    // position matching its rank number. A pinned out-of-order row would break both invariants.
    for (const board of ['technical', 'ecosystem'] as const) {
      const rows = page.locator(`[data-testid="project-detail-leaderboard-${board}"] tbody tr`);
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);

      const ranks: number[] = [];
      let viewingIndex = -1;
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        ranks.push(Number((await row.locator('td').first().innerText()).trim()));
        if ((await row.getAttribute('data-testid')) === `project-detail-leaderboard-${board}-viewing-row`) {
          viewingIndex = i;
        }
      }

      expect(ranks[0]).toBe(1);
      for (let i = 1; i < ranks.length; i++) {
        expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
      }
      expect(viewingIndex).toBeGreaterThanOrEqual(0);
      expect(ranks[viewingIndex]).toBe(viewingIndex + 1);
    }
  });

  test('metric toggle persists in the URL and switches the score column', async ({ page }) => {
    await expect(page.getByRole('columnheader', { name: 'Influence Score' }).first()).toBeVisible();
    await page.getByTestId('project-detail-metric-activity').click();
    await expect(page).toHaveURL(/metric=activity/);
    await expect(page.getByText('Contribution Activities Leaderboard')).toBeVisible();
    await expect(page.getByText('Collaboration Activities Leaderboard')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Total contributions' })).toHaveCount(1);
    await expect(page.getByRole('columnheader', { name: 'Total collaborations' })).toHaveCount(1);
    await expect(page.getByRole('columnheader', { name: 'Influence Score' })).toHaveCount(0);
  });

  test('time-range toggle persists in the URL and updates the activity column label', async ({ page }) => {
    await page.getByTestId('project-detail-metric-activity').click();
    await page.getByTestId('project-detail-time-range-1y').click();
    await expect(page).toHaveURL(/range=1y/);
    await expect(page.getByRole('columnheader', { name: 'Total contributions' }).first()).toBeVisible();
  });

  test('search filters a board to matching organizations', async ({ page }) => {
    await page.locator('[data-test="project-detail-search-technical"]').fill('Google');
    const rows = page.locator('[data-testid="project-detail-leaderboard-technical"] tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Google');
  });
});

test.describe('Org Project Detail — Contributors drawer deep-link', () => {
  test('auto-opens the Contributors drawer from ?card=contributors', async ({ page }) => {
    await page.goto(`${DETAIL_URL}?card=contributors`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('project-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await expect(page.getByTestId('project-detail-technical-card-contributors')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('influence-card-detail-title')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('influence-card-detail-title')).toHaveText('Contributors');
  });

  test('closing the auto-opened drawer stays on the detail page', async ({ page }) => {
    await page.goto(`${DETAIL_URL}?card=contributors`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('influence-card-detail-title')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('influence-card-detail-title')).toBeHidden();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page).toHaveURL(/\/org\/projects\/k8s/);
  });

  test('ignores an unknown ?card= value and loads the page with no drawer', async ({ page }) => {
    await page.goto(`${DETAIL_URL}?card=bogus-card`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('project-detail-technical-group')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('influence-card-detail-title')).toBeHidden();
  });
});

test.describe('Org Project Detail — not found', () => {
  test('renders the 404 panel for an unknown slug', async ({ page }) => {
    await page.goto(DETAIL_URL_BOGUS, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('project-detail-not-found')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });
});
