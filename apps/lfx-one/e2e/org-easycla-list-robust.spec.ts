// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA list — structural E2E (GH-1978).
 *
 * The structural half of the repository's dual E2E architecture; `org-easycla-list.spec.ts` is the
 * content half. This one asserts the `data-testid` contract and the component nesting rather than
 * the copy, so the pair fails independently: reworded labels break only the content spec, and a
 * card rebuilt behind the same testids leaves this one green.
 *
 * The states are mutually exclusive by construction — one list either has rows, or has none, or
 * failed to load — so each is pinned together with the absence of the other two. A regression that
 * renders two of them at once is otherwise invisible to a spec that only asserts presence.
 *
 * Prerequisites: as `org-easycla-list.spec.ts`.
 */

import { expect, Page, test } from '@playwright/test';
import type { OrgClaGroup } from '@lfx-one/shared/interfaces';

import {
  claGroup,
  claGroupList,
  CLA_GROUPS_ROUTE,
  fulfillJson,
  gotoEasyclaList,
  PAGE_LOAD_TIMEOUT,
  skipWithoutCredentials,
} from './helpers/org-easycla.helper';

const CARD_FIELDS = [
  'org-easycla-card-title',
  'org-easycla-card-status',
  'org-easycla-card-approval-count',
  'org-easycla-card-approval-label',
  'org-easycla-card-manager-count',
];

function stubRows(count: number) {
  const rows = Array.from({ length: count }, (_, i) => claGroup({ id: `sig-${i + 1}`, claGroupName: `CLA Group ${i + 1}` }));
  return stubList(rows);
}

function stubList(rows: OrgClaGroup[]) {
  return (page: Page) => fulfillJson(page, CLA_GROUPS_ROUTE, claGroupList(rows));
}

test.describe('Org Lens EasyCLA list — structure', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('nests the page, header, toolbar and grid as the shell expects', async ({ page }) => {
    await gotoEasyclaList(page, stubRows(3));

    const pageRoot = page.getByTestId('org-easycla-page');
    await expect(pageRoot).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Anchor on the grid before asserting the rest of the nesting. The page shell renders before
    // the list resolves, so an unanchored count runs against a page that is still loading and
    // fails on timing rather than on structure.
    await expect(pageRoot.getByTestId('org-easycla-grid')).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });

    for (const testid of ['org-easycla-header', 'org-easycla-toolbar']) {
      await expect(pageRoot.getByTestId(testid)).toHaveCount(1);
    }

    await expect(pageRoot.getByTestId('org-easycla-header').getByTestId('org-easycla-title')).toHaveCount(1);
    await expect(pageRoot.getByTestId('org-easycla-toolbar').locator('[data-test="org-easycla-search"]')).toHaveCount(1);
    await expect(pageRoot.getByTestId('org-easycla-grid').getByTestId('org-easycla-card')).toHaveCount(3);
  });

  // A label element is not an accessible name until it resolves to the control. `getByLabel`
  // performs the same association a screen reader does, so it fails where a `for` attribute points
  // at a wrapper rather than the input inside it — which is invisible to any assertion that only
  // checks the label's presence.
  test('gives the search box an accessible name that resolves to the input itself', async ({ page }) => {
    await gotoEasyclaList(page, stubRows(3));
    await expect(page.getByTestId('org-easycla-grid')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    const labelled = page.getByLabel('Search CLAs');
    await expect(labelled).toHaveCount(1);
    await expect(labelled).toHaveJSProperty('tagName', 'INPUT');
  });

  test('gives every card the full field contract', async ({ page }) => {
    await gotoEasyclaList(page, stubRows(3));

    const cards = page.getByTestId('org-easycla-card');
    await expect(cards).toHaveCount(3, { timeout: PAGE_LOAD_TIMEOUT });

    // Per card rather than per page: a page-level count of 3 titles is also satisfied by one card
    // holding three and two holding none.
    for (let i = 0; i < 3; i++) {
      for (const field of CARD_FIELDS) {
        await expect(cards.nth(i).getByTestId(field)).toHaveCount(1);
      }
    }
  });

  // Two focusable things per card now — the stretched link and the coverage chip — and the chip is
  // a sibling of the anchor, not a descendant. Nesting them would make the chip unreachable by
  // keyboard, so this pins the structure rather than the styling.
  test('exposes the coverage chip as a control beside the card link, not inside it', async ({ page }) => {
    // `stubRows` covers one project per row, which renders no control — the chip exists only where
    // there is a list to open, so this case supplies its own multi-project row.
    await gotoEasyclaList(
      page,
      stubList([
        claGroup({
          id: 'sig-1',
          projects: [
            { projectSfid: 'a09410000182dD3AAI', projectName: 'Cascade' },
            { projectSfid: 'a09410000182dD4AAI', projectName: 'Driftwood' },
          ],
        }),
      ])
    );

    await expect(page.getByTestId('org-easycla-card')).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });

    const chip = page.getByTestId('org-easycla-card-coverage-link').first();
    await expect(chip).toHaveJSProperty('tagName', 'BUTTON');
    await expect(chip).toHaveAttribute('aria-label', /show the projects this agreement covers/);

    // The anchor must not contain the chip; both are reachable in their own right.
    const link = page.getByTestId('org-easycla-card-link').first();
    await expect(link.getByTestId('org-easycla-card-coverage-link')).toHaveCount(0);
    await chip.focus();
    await expect(chip).toBeFocused();
  });

  test('renders the pager only alongside a grid it can page', async ({ page }) => {
    await gotoEasyclaList(page, stubRows(9));

    await expect(page.getByTestId('org-easycla-grid')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    const pager = page.getByTestId('org-easycla-pager');
    await expect(pager).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(pager.getByTestId('org-easycla-prev-page')).toHaveCount(1);
    await expect(pager.getByTestId('org-easycla-next-page')).toHaveCount(1);
    await expect(pager.getByTestId('org-easycla-page-label')).toHaveCount(1);
  });

  test('shows the empty state alone, with no grid and no error beside it', async ({ page }) => {
    await gotoEasyclaList(page, stubRows(0));

    await expect(page.getByTestId('org-easycla-empty-state')).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-grid')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-pager')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-error-state')).toHaveCount(0);
  });

  test('shows the error state alone, with no grid and no empty state beside it', async ({ page }) => {
    await gotoEasyclaList(page, (p) =>
      p.route(CLA_GROUPS_ROUTE, (route) =>
        route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 'UPSTREAM_ERROR', message: 'upstream unavailable' }) })
      )
    );

    await expect(page.getByTestId('org-easycla-error-state')).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-grid')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-empty-state')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-card')).toHaveCount(0);
  });
});
