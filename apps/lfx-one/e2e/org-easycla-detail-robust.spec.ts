// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA CLA Group detail — structural E2E (GH-1978).
 *
 * The structural half of the repository's dual E2E architecture; `org-easycla-detail.spec.ts` is
 * the content half. This one asserts the `data-testid` contract, the component nesting and the
 * tablist's ARIA wiring rather than the copy, so the pair fails independently: reworded labels
 * break only the content spec, and a header rebuilt behind the same testids leaves this one green.
 *
 * The page's states are mutually exclusive by construction — one request either yields the row, or
 * yields a list without it, or fails — so each is pinned together with the absence of the others. A
 * regression that renders two at once is invisible to a spec that only asserts presence.
 *
 * Prerequisites: as `org-easycla-list.spec.ts`.
 */

import { expect, Page, test } from '@playwright/test';

import {
  claGroup,
  claGroupList,
  CLA_GROUPS_ROUTE,
  fulfillJson,
  gotoEasyclaDetail,
  PAGE_LOAD_TIMEOUT,
  skipWithoutCredentials,
} from './helpers/org-easycla.helper';

const SIGNED = claGroup({ id: 'sig-signed', claGroupName: 'Nimbus Foundation CLA' });

function stubList(rows = [SIGNED]) {
  return (page: Page) => fulfillJson(page, CLA_GROUPS_ROUTE, claGroupList(rows));
}

test.describe('Org Lens EasyCLA detail — structure', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('nests the page, breadcrumb, header, tabs and overview as the shell expects', async ({ page }) => {
    await gotoEasyclaDetail(page, 'sig-signed', stubList());

    const pageRoot = page.getByTestId('org-easycla-detail-page');
    await expect(pageRoot).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Anchor on the overview before asserting the rest. The page shell renders before the list
    // resolves, so an unanchored count runs against a page still showing its skeleton and fails on
    // timing rather than on structure.
    await expect(pageRoot.getByTestId('org-easycla-detail-overview')).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });

    for (const testid of ['org-easycla-detail-breadcrumb', 'org-easycla-detail-header', 'org-easycla-detail-tabs']) {
      await expect(pageRoot.getByTestId(testid)).toHaveCount(1);
    }

    await expect(pageRoot.getByTestId('org-easycla-detail-header').getByTestId('org-easycla-detail-title')).toHaveCount(1);
    await expect(pageRoot.getByTestId('org-easycla-detail-header').getByTestId('org-easycla-detail-status')).toHaveCount(1);
    await expect(pageRoot.getByTestId('org-easycla-detail-overview').getByTestId('org-easycla-detail-ccla-title')).toHaveCount(1);
  });

  test('gives the tab bar the roles and selection state assistive tech reads', async ({ page }) => {
    await gotoEasyclaDetail(page, 'sig-signed', stubList());

    const tablist = page.getByRole('tablist', { name: 'CLA Group sections' });
    await expect(tablist).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });

    const tabs = tablist.getByRole('tab');
    await expect(tabs).not.toHaveCount(0);

    // Exactly one selected, and it is the one holding the only focusable tab stop. A bar that
    // selects two, or none, still renders correctly and still reads wrongly.
    await expect(tablist.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
    await expect(tablist.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  });

  // `aria-controls` is not a relationship until it resolves to an element on the page. Asserting
  // the attribute's presence passes against a panel id that no longer exists, which is precisely
  // the state a renamed panel leaves behind.
  test('points the selected tab at a panel that is actually on the page', async ({ page }) => {
    await gotoEasyclaDetail(page, 'sig-signed', stubList());

    const selected = page.locator('[role="tab"][aria-selected="true"]');
    await expect(selected).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });

    const panelId = await selected.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();

    const panel = page.locator(`#${panelId}`);
    await expect(panel).toHaveAttribute('role', 'tabpanel');
    await expect(panel).toHaveAttribute('aria-labelledby', (await selected.getAttribute('id')) ?? '');
  });

  test('moves the selection with the arrow keys, leaving one tab stop behind', async ({ page }) => {
    await gotoEasyclaDetail(page, 'sig-signed', stubList());

    const tablist = page.getByRole('tablist', { name: 'CLA Group sections' });
    await expect(tablist).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });

    const first = tablist.locator('[role="tab"]').first();
    await first.focus();
    await page.keyboard.press('ArrowRight');

    await expect(first).toHaveAttribute('aria-selected', 'false');
    await expect(tablist.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
    await expect(tablist.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  });

  test('shows the not-found state alone, with no overview and no error beside it', async ({ page }) => {
    await gotoEasyclaDetail(page, 'sig-absent', stubList());

    await expect(page.getByTestId('org-easycla-detail-not-found-state')).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-detail-overview')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-detail-tabs')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-detail-error-state')).toHaveCount(0);
  });

  test('shows the error state alone, with no overview and no not-found beside it', async ({ page }) => {
    await gotoEasyclaDetail(page, 'sig-signed', (p) =>
      p.route(CLA_GROUPS_ROUTE, (route) =>
        route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 'UPSTREAM_ERROR', message: 'upstream unavailable' }) })
      )
    );

    await expect(page.getByTestId('org-easycla-detail-error-state')).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-detail-overview')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-detail-not-found-state')).toHaveCount(0);
  });
});
