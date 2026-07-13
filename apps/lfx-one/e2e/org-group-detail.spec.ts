// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens · Group Detail Page E2E Tests (LFXV2-1879)
 *
 * Demo semantics (v1): the page is served from client-side demo fixtures
 * (org-group-detail-demo.data.ts). `k8s-steering` is a curated, fully-seeded group; an
 * unknown id returns null → the not-found panel. No account/org-context gating on this page
 * (it keys purely off the `groupId` route param), so no org-context stubbing is needed here.
 */

import { expect, test } from '@playwright/test';

const DETAIL_URL = '/org/groups/k8s-steering';
const DETAIL_URL_BOGUS = '/org/groups/totally-bogus-group';
const DATA_LOAD_TIMEOUT = 30_000;

test.setTimeout(90_000);

test.describe('Org Group Detail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('org-group-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('renders header, tags, and tab strip', async ({ page }) => {
    await expect(page.getByTestId('org-group-detail-name')).toHaveText('Kubernetes Steering Committee');
    await expect(page.getByTestId('org-group-detail-tags')).toBeVisible();
    await expect(page.getByTestId('org-group-detail-tabs')).toBeVisible();
    await expect(page.getByTestId('org-group-detail-tab-overview')).toBeVisible();
    await expect(page.getByTestId('org-group-detail-tab-votes')).toBeVisible();
  });

  test('renders overview stats and meeting cards', async ({ page }) => {
    await expect(page.getByTestId('org-group-detail-stats')).toBeVisible();
    await expect(page.getByTestId('org-group-detail-chairs')).toBeVisible();
  });

  test('switches tabs via click and persists selection', async ({ page }) => {
    await page.getByTestId('org-group-detail-tab-members').click();
    await expect(page.getByTestId('org-group-detail-members-panel')).toBeVisible();

    await page.getByTestId('org-group-detail-tab-meetings').click();
    await expect(page.getByTestId('org-group-detail-meetings-panel')).toBeVisible();
  });

  test('arrow keys move focus between tabs', async ({ page }) => {
    await page.getByTestId('org-group-detail-tab-overview').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('org-group-detail-tab-members')).toBeFocused();
  });
});

test.describe('Org Group Detail — not found', () => {
  test('renders the not-found panel for an unknown id', async ({ page }) => {
    await page.goto(DETAIL_URL_BOGUS, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('org-group-detail-not-found')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });
});
