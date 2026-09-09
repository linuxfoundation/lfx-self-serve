// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA list — content E2E (GH-1978).
 *
 * The content half of the repository's dual E2E architecture; `org-easycla-list-robust.spec.ts` is
 * the structural half. This one drives the page the way a CLA manager does — read the cards, search
 * for an agreement, page through the rest — and asserts on the words they end up looking at.
 *
 * The unit tests cover the same behaviours in jsdom, where the list is handed to the component
 * directly. What they cannot cover is the path from an HTTP response to rendered text: the client
 * service, the signal wiring, and the template all sit between the two and none of them are
 * exercised by a component test that skips the request.
 *
 * Two of the cases below are about statements the page must not make. A failed request rendering as
 * "no CLAs" and an unsigned agreement rendering as "Signed" are both false claims about an
 * organization's legal position, and both are a one-line change away at all times.
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD
 * - `org-lens-enabled` LaunchDarkly flag toggled ON for the test user
 */

import { expect, Page, test } from '@playwright/test';

import {
  claGroup,
  claGroupList,
  CLA_GROUPS_ROUTE,
  fulfillJson,
  gotoEasyclaList,
  MOCK_ACCOUNT_NAME,
  PAGE_LOAD_TIMEOUT,
  searchInput,
  skipWithoutCredentials,
} from './helpers/org-easycla.helper';

/** Nine rows: one more than the page size, so the pager has something to page. */
function nineClaGroups() {
  return [
    claGroup({ id: 'sig-1', claGroupName: 'Nimbus Foundation CLA', claManagersCount: 2, approvalCriteriaCount: 4 }),
    claGroup({ id: 'sig-2', claGroupName: 'Cascade Project CLA', claManagersCount: 1, approvalCriteriaCount: 1 }),
    claGroup({ id: 'sig-3', claGroupName: 'Driftwood CLA', needsClaManager: true, claManagersCount: 0 }),
    claGroup({ id: 'sig-4', claGroupName: 'Meridian CLA', status: 'sanctioned' }),
    // `signed: false` alongside the status, or the fixture models an impossible row: a
    // not-started agreement that nonetheless has a signed document to download.
    claGroup({ id: 'sig-5', claGroupName: 'Lumen CLA', status: 'not-started', signed: false, signedOn: undefined }),
    claGroup({ id: 'sig-6', claGroupName: 'Harbor CLA', approvalCriteriaCount: undefined }),
    claGroup({ id: 'sig-7', claGroupName: 'Quarry CLA' }),
    claGroup({ id: 'sig-8', claGroupName: 'Ridgeway CLA' }),
    claGroup({ id: 'sig-9', claGroupName: 'Solstice CLA' }),
  ];
}

function stubList(rows: ReturnType<typeof nineClaGroups>) {
  return (page: Page) => fulfillJson(page, CLA_GROUPS_ROUTE, claGroupList(rows));
}

test.describe('Org Lens EasyCLA list — content', () => {
  // The left-nav sidebar is `hidden lg:flex`, so a mobile project would fail visibility checks that
  // have nothing to do with the list.
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('renders a card per agreement, titled for the organization', async ({ page }) => {
    await gotoEasyclaList(page, stubList(nineClaGroups()));

    await expect(page.getByTestId('org-easycla-title')).toContainText(MOCK_ACCOUNT_NAME, { timeout: PAGE_LOAD_TIMEOUT });

    // Eight of nine: the ninth is on page two, which is what the paging case below is about.
    await expect(page.getByTestId('org-easycla-card')).toHaveCount(8);
    await expect(page.getByTestId('org-easycla-card-title').first()).toHaveText('Nimbus Foundation CLA');
  });

  test('states each agreement\u2019s status in the words the design uses', async ({ page }) => {
    await gotoEasyclaList(page, stubList(nineClaGroups()));

    const card = (name: string) => page.getByTestId('org-easycla-card').filter({ hasText: name });

    await expect(card('Nimbus Foundation CLA').getByTestId('org-easycla-card-status')).toHaveText('Signed', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(card('Meridian CLA').getByTestId('org-easycla-card-status')).toHaveText('Sanctioned');

    // The one that matters most: an unsigned agreement described as signed is a false statement
    // about what this organization has agreed to.
    await expect(card('Lumen CLA').getByTestId('org-easycla-card-status')).toHaveText('Not started');
    await expect(card('Lumen CLA').getByTestId('org-easycla-card-status')).not.toHaveText('Signed');

    // And the whole card must agree with its own pill: the signing-entity subline is a second
    // claim about the same agreement, so an unsigned card must not carry "Signed by" beneath a
    // pill that reads "Not started".
    await expect(card('Lumen CLA')).not.toContainText('Signed by');
    await expect(card('Nimbus Foundation CLA').getByTestId('org-easycla-card-signing-entity')).toContainText('Signed by');
  });

  test('reports counts, agreeing in number, and marks an unavailable count as unavailable', async ({ page }) => {
    await gotoEasyclaList(page, stubList(nineClaGroups()));

    const card = (name: string) => page.getByTestId('org-easycla-card').filter({ hasText: name });

    await expect(card('Cascade Project CLA').getByTestId('org-easycla-card-approval-count')).toHaveText('1', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(card('Cascade Project CLA').getByTestId('org-easycla-card-approval-label')).toHaveText('approval entry');
    await expect(card('Cascade Project CLA').getByTestId('org-easycla-card-manager-count')).toHaveText('1');

    await expect(card('Nimbus Foundation CLA').getByTestId('org-easycla-card-approval-label')).toHaveText('approval entries');

    // A deployment that predates the producer's count field shows a dash, not a zero: "no rules"
    // and "we could not read the rules" are different claims.
    await expect(card('Harbor CLA').getByTestId('org-easycla-card-approval-count')).toHaveText('—');

    await expect(card('Driftwood CLA').getByTestId('org-easycla-card-needs-manager')).toBeVisible();
  });

  test('narrows the list to a searched agreement, and says so when nothing matches', async ({ page }) => {
    await gotoEasyclaList(page, stubList(nineClaGroups()));
    await expect(page.getByTestId('org-easycla-card')).toHaveCount(8, { timeout: PAGE_LOAD_TIMEOUT });

    await searchInput(page).fill('Driftwood');

    await expect(page.getByTestId('org-easycla-card')).toHaveCount(1);
    await expect(page.getByTestId('org-easycla-card-title')).toHaveText('Driftwood CLA');

    await searchInput(page).fill('nothing matches this');

    await expect(page.getByTestId('org-easycla-card')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-no-matches-state')).toBeVisible();

    // Clearing restores the full list rather than leaving the page on its no-matches state.
    await searchInput(page).fill('');
    await expect(page.getByTestId('org-easycla-card')).toHaveCount(8);
  });

  test('pages through the agreements that do not fit on the first page', async ({ page }) => {
    await gotoEasyclaList(page, stubList(nineClaGroups()));
    await expect(page.getByTestId('org-easycla-card')).toHaveCount(8, { timeout: PAGE_LOAD_TIMEOUT });

    await expect(page.getByTestId('org-easycla-pager')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-card-title').filter({ hasText: 'Solstice CLA' })).toHaveCount(0);

    await page.getByTestId('org-easycla-next-page').click();

    await expect(page.getByTestId('org-easycla-card')).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-card-title')).toHaveText('Solstice CLA');

    await page.getByTestId('org-easycla-prev-page').click();
    await expect(page.getByTestId('org-easycla-card')).toHaveCount(8);
  });

  // The real reason this needs a browser: the card sits under a stretched link that covers it
  // entirely, so a chip that works in a unit test can still be unclickable — or can navigate to the
  // detail page instead of opening the dialog. Only a real click through the real stacking context
  // tells them apart, which is why the URL is asserted afterwards.
  test('shows what an agreement covers without leaving the list', async ({ page }) => {
    // The shared fixture covers one project, whose name the chip states outright — there is nothing
    // to open, and no control. This case needs the multi-project row that does have one.
    await gotoEasyclaList(
      page,
      stubList([
        claGroup({
          id: 'sig-1',
          claGroupName: 'Nimbus Foundation CLA',
          projects: [
            { projectSfid: 'a09410000182dD3AAI', projectName: 'Cascade' },
            { projectSfid: 'a09410000182dD4AAI', projectName: 'Driftwood' },
          ],
        }),
      ])
    );

    const chip = page.getByTestId('org-easycla-card-coverage-link').first();
    await expect(chip).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await chip.click();

    const projects = page.getByTestId('org-easycla-coverage-project');
    await expect(projects).toHaveCount(2, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-coverage-title')).toHaveText('Projects covered by Nimbus Foundation CLA');
    expect(page.url()).toContain('/org/easycla');
    expect(page.url()).not.toContain('/org/easycla/sig-1');

    await page.getByTestId('org-easycla-coverage-close').click();
    await expect(projects).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-card')).toHaveCount(1);
  });

  test('hides the pager when every agreement fits on one page', async ({ page }) => {
    await gotoEasyclaList(page, stubList([claGroup({ id: 'sig-1', claGroupName: 'Nimbus Foundation CLA' })]));

    await expect(page.getByTestId('org-easycla-card')).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-pager')).toHaveCount(0);
  });

  test('says the organization has signed nothing only when that is what upstream said', async ({ page }) => {
    await gotoEasyclaList(page, stubList([]));

    await expect(page.getByTestId('org-easycla-empty-state')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-error-state')).toHaveCount(0);
  });

  // The counterpart to the case above, and the reason both exist. Upstream answers an organization
  // it has never heard of with the same empty list it gives one that has signed nothing, so a
  // failure quietly rendered as "no CLAs" would be indistinguishable from the truth.
  test('shows a load failure as a failure, never as an organization with no CLAs', async ({ page }) => {
    await gotoEasyclaList(page, (p) =>
      p.route(CLA_GROUPS_ROUTE, (route) =>
        route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 'UPSTREAM_ERROR', message: 'upstream unavailable' }) })
      )
    );

    await expect(page.getByTestId('org-easycla-error-state')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-empty-state')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-card')).toHaveCount(0);
  });
});
