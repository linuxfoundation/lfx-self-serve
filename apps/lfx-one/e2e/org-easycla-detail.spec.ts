// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA CLA Group detail — content E2E (GH-1978).
 *
 * The content half of the repository's dual E2E architecture; `org-easycla-detail-robust.spec.ts`
 * is the structural half. This one reads the page the way a CLA manager does after clicking a card
 * — who signed, when, what it covers, and getting the document out — and asserts on the words they
 * end up looking at.
 *
 * The component tests cover the same behaviours in jsdom, where the list is handed to the component
 * directly. Three things sit between an HTTP response and this page's text and none of them are
 * exercised there: the route param that selects the row, the client service, and the template. The
 * detail page depends on all three at once, because it renders one row picked out of a list
 * response by a `:signatureId` it reads from the URL.
 *
 * Several cases below are about statements the page must not make. An agreement missing from the
 * organization's list must read as not found rather than as a load failure; a failed load must not
 * read as not found; and an unsigned agreement must offer no document, because the presigned URL
 * would point at a file that was never written.
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
  gotoEasyclaList,
  PAGE_LOAD_TIMEOUT,
  PDF_URL_ROUTE,
  skipWithoutCredentials,
} from './helpers/org-easycla.helper';

const SIGNED = claGroup({
  id: 'sig-signed',
  claGroupName: 'Nimbus Foundation CLA',
  signedBy: 'Dana Okonkwo',
  signedOn: '2024-03-11T09:20:00Z',
  projects: [
    { projectSfid: 'a09410000182dD3AAI', projectName: 'Cascade' },
    { projectSfid: 'a09410000182dD4AAI', projectName: 'Driftwood' },
  ],
});

/** Unsigned, so `signed`, the status and the date all agree — an unsigned row has no document. */
const UNSIGNED = claGroup({
  id: 'sig-unsigned',
  claGroupName: 'Lumen CLA',
  status: 'not-started',
  signed: false,
  signedOn: undefined,
  signedBy: undefined,
});

function stubList(rows = [SIGNED, UNSIGNED]) {
  return (page: Page) => fulfillJson(page, CLA_GROUPS_ROUTE, claGroupList(rows));
}

test.describe('Org Lens EasyCLA detail — content', () => {
  // The left-nav sidebar is `hidden lg:flex`, so a mobile project would fail visibility checks that
  // have nothing to do with the detail page.
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('opens the agreement whose card was clicked, not merely some detail page', async ({ page }) => {
    await gotoEasyclaList(page, stubList());

    // By accessible name rather than by scoping the link under its card: the overlay anchor is a
    // sibling of the card, not a descendant, so a descendant locator would match nothing. The name
    // is also what a screen-reader user picks the link by, which is the thing worth pinning — and
    // it carries the signing entity, because two rows can share a CLA Group name and the entity is
    // the only thing telling them apart.
    const link = page.getByRole('link', { name: 'Open Lumen CLA, Acme Motors GmbH' });
    await expect(link).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });
    await link.click();

    // Both halves: the URL carries the clicked row's signature id, and the page renders that row.
    // Asserting only the URL would pass while the page showed the first agreement in the list.
    await expect(page).toHaveURL(/\/org\/easycla\/sig-unsigned$/, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-detail-title')).toHaveText('Lumen CLA');
  });

  test('names the signer and the date, and says the agreement is signed', async ({ page }) => {
    await gotoEasyclaDetail(page, 'sig-signed', stubList());

    await expect(page.getByTestId('org-easycla-detail-title')).toHaveText('Nimbus Foundation CLA', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-detail-status')).toHaveText('Signed');

    const signedOn = page.getByTestId('org-easycla-detail-signed-on');
    await expect(signedOn).toContainText('Dana Okonkwo');
    await expect(signedOn).toContainText('Signed by');
  });

  test('summarises what the agreement covers, and lists it in full on request', async ({ page }) => {
    await gotoEasyclaDetail(page, 'sig-signed', stubList());

    // Two chips, not one: a named foundation and a multi-project agreement each get their own, and
    // they say different things — one names what the agreement sits under, the other counts what it
    // actually covers. Collapsing them would let the foundation stand in for coverage it does not
    // grant, so both are pinned before either is clicked.
    const chips = page.getByTestId('org-easycla-detail-coverage');
    await expect(chips).toHaveCount(2, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(chips.filter({ hasText: 'Nimbus Foundation' })).toHaveCount(1);

    const projectsChip = chips.filter({ hasText: 'Covers 2 projects' });
    await expect(projectsChip).toHaveCount(1);
    await projectsChip.click();

    const projects = page.getByTestId('org-easycla-coverage-project');
    await expect(projects).toHaveCount(2, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(projects.first()).toHaveText('Cascade');
    await expect(projects.nth(1)).toHaveText('Driftwood');
  });

  test('asks the server for a presigned url and hands the document to the browser', async ({ page }) => {
    await gotoEasyclaDetail(page, 'sig-signed', async (p) => {
      await stubList()(p);
      await fulfillJson(p, PDF_URL_ROUTE, { url: 'https://s3.example.org/nimbus-ccla.pdf' });
      // The presigned URL itself, so the anchor's click resolves against a stub rather than
      // reaching out to a host that does not exist.
      await p.route('https://s3.example.org/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'content-disposition': 'attachment' }, body: '%PDF-1.4' })
      );
    });

    const download = page.getByTestId('org-easycla-detail-download');
    await expect(download).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    const [request] = await Promise.all([page.waitForRequest((r) => r.url().includes('/pdf-url')), download.click()]);

    // The request, and not the saved file: whether a presigned PDF is saved or displayed is
    // Chromium's decision about headers this app does not set, so asserting on it would be testing
    // the browser. What this page owes is a request scoped to the agreement on screen and to the
    // organization holding it — the server refuses a signature that is not on that organization's
    // list, and the URL is how it is told which.
    expect(request.url()).toContain('/lens/cla-groups/sig-signed/pdf-url');

    // And the page it was asked from is the page the viewer is left on.
    await expect(page).toHaveURL(/\/org\/easycla\/sig-signed$/);
  });

  test('reports a refused document as a failure, and stays on the page', async ({ page }) => {
    await gotoEasyclaDetail(page, 'sig-signed', async (p) => {
      await stubList()(p);
      // 403 rather than 404: the producer authorizes the document by project scope, which an
      // organization-only viewer can lack even for an agreement they can see listed.
      await p.route(PDF_URL_ROUTE, (route) =>
        route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'FORBIDDEN', message: 'forbidden' }) })
      );
    });

    await page.getByTestId('org-easycla-detail-download').click();

    await expect(page.locator('.p-toast')).toContainText('Download failed', { timeout: PAGE_LOAD_TIMEOUT });

    // Silence is the real failure here: a refused document that leaves the button to settle back
    // with no message reads as a download that simply did nothing.
    await expect(page).toHaveURL(/\/org\/easycla\/sig-signed$/);
  });

  test('offers no document for an agreement that was never signed', async ({ page }) => {
    await gotoEasyclaDetail(page, 'sig-unsigned', stubList());

    await expect(page.getByTestId('org-easycla-detail-title')).toHaveText('Lumen CLA', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-detail-status')).toHaveText('Not started');

    // Nothing to download and nothing to date. Offering either would assert a signature that does
    // not exist, and the button would presign a URL to a file that was never written.
    await expect(page.getByTestId('org-easycla-detail-download')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-detail-signed-on')).toHaveCount(0);
  });

  test('says an agreement is missing when it is not on this organization\u2019s list', async ({ page }) => {
    await gotoEasyclaDetail(page, 'sig-belongs-to-another-org', stubList());

    await expect(page.getByTestId('org-easycla-detail-not-found-state')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-detail-error-state')).toHaveCount(0);
  });

  // The counterpart to the case above, and the reason both exist. A failed list request leaves the
  // page with no row to show, which looks exactly like an agreement that is not there — so a
  // regression would quietly tell a CLA manager their agreement is gone when the truth is only
  // that it could not be loaded.
  test('shows a load failure as a failure, never as a missing agreement', async ({ page }) => {
    await gotoEasyclaDetail(page, 'sig-signed', (p) =>
      p.route(CLA_GROUPS_ROUTE, (route) =>
        route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 'UPSTREAM_ERROR', message: 'upstream unavailable' }) })
      )
    );

    await expect(page.getByTestId('org-easycla-detail-error-state')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-detail-not-found-state')).toHaveCount(0);
  });
});
