// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens · Project Detail Page E2E Tests (LFXV2-1885)
 *
 * Covers the acceptance criteria for the per-project Org Lens view:
 * - data-testid resolution smoke test (breadcrumb, hero, tabs, card groups, trend)
 * - tab strip switching (click + keyboard) with ?tab= URL persistence
 * - leaderboard ranking, score/metric toggles with ?score=/?metric= persistence,
 *   Activity Count hiding the Trend + Band columns, and Show more pagination
 * - not-found (404) panel for an unknown slug
 *
 * Prerequisites:
 * - Dev server running on the Playwright baseURL
 * - User authenticated with the `org-lens-enabled` flag on and an organization selected
 *
 * Demo semantics (v1): the page is served from frontend demo fixtures
 * (org-lens-project-detail.demo-data.ts). `kubernetes` is a rich seeded project; an
 * unknown slug returns null → the not-found panel.
 */

import { expect, test } from '@playwright/test';

const DETAIL_URL = '/org/projects/kubernetes';
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
    await expect(page.getByTestId('project-detail-hero')).toBeVisible();
    await expect(page.getByTestId('project-detail-name')).toHaveText('Kubernetes');
    await expect(page.getByTestId('project-detail-first-commit')).toBeVisible();
    await expect(page.getByTestId('project-detail-software-value')).toBeVisible();
    await expect(page.getByTestId('project-detail-health-badge')).toBeVisible();
    await expect(page.getByTestId('project-detail-foundation-pill')).toBeVisible();
    await expect(page.getByTestId('project-detail-tab-pd-influence')).toBeVisible();
    await expect(page.getByTestId('project-detail-tab-pd-leaderboards')).toBeVisible();
  });

  test('renders the Technical and Ecosystem card groups', async ({ page }) => {
    for (const key of ['maintainers', 'contributors', 'commits', 'pull-requests']) {
      await expect(page.getByTestId(`project-detail-technical-card-${key}`)).toBeVisible();
    }
    for (const key of ['collaboration', 'meeting-attendance', 'board-members', 'committee-members']) {
      await expect(page.getByTestId(`project-detail-ecosystem-card-${key}`)).toBeVisible();
    }
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
    await expect(page.getByTestId('project-detail-leaderboard-table')).toBeVisible();
  });

  test('deep-links to the Leaderboards tab via ?tab=', async ({ page }) => {
    await page.goto(`${DETAIL_URL}?tab=pd-leaderboards`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('project-detail-leaderboard-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('arrow keys move between tabs', async ({ page }) => {
    await page.getByTestId('project-detail-tab-pd-influence').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('project-detail-tab-pd-leaderboards')).toBeFocused();
  });
});

test.describe('Org Project Detail — leaderboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${DETAIL_URL}?tab=pd-leaderboards`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('project-detail-leaderboard-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('pins the viewing-org row and paginates with Show more', async ({ page }) => {
    await expect(page.getByTestId('project-detail-leaderboard-viewing-row')).toBeVisible();
    const showMore = page.getByTestId('project-detail-leaderboard-show-more');
    if (await showMore.isVisible()) {
      const before = await page.locator('[data-testid="project-detail-leaderboard-table"] tbody tr').count();
      await showMore.click();
      const after = await page.locator('[data-testid="project-detail-leaderboard-table"] tbody tr').count();
      expect(after).toBeGreaterThan(before);
    }
  });

  test('score + metric toggles persist in the URL', async ({ page }) => {
    await page.getByTestId('project-detail-score-technical').click();
    await expect(page).toHaveURL(/score=technical/);
    await page.getByTestId('project-detail-metric-activity').click();
    await expect(page).toHaveURL(/metric=activity/);
  });

  test('Activity Count mode hides the Trend + Band columns', async ({ page }) => {
    await expect(page.getByRole('columnheader', { name: 'Trend (1y)' })).toBeVisible();
    await page.getByTestId('project-detail-metric-activity').click();
    await expect(page.getByRole('columnheader', { name: 'Trend (1y)' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Band' })).toHaveCount(0);
  });
});

test.describe('Org Project Detail — not found', () => {
  test('renders the 404 panel for an unknown slug', async ({ page }) => {
    await page.goto(DETAIL_URL_BOGUS, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('project-detail-not-found')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });
});
