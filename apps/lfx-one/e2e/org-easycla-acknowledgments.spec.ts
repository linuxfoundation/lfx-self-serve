// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA Contributor Acknowledgments — content E2E (#2806).
 *
 * The content half of the repository's dual E2E architecture; `org-easycla-acknowledgments-robust.spec.ts`
 * is the structural half. This one asserts the words a CLA manager reads and the query the tab
 * sends for search and Load more.
 *
 * The unit tests cover the mapper and the component with the next response handed in directly.
 * What they cannot cover is the chain: the tab that mounts the panel, the GET that fills it,
 * the search box that debounces into that GET, and Load more appending the next page.
 *
 * **Nothing in this file may reach a real CLA service.** The acknowledgments GET is stubbed.
 *
 * Prerequisites: as `org-easycla-detail.spec.ts`.
 */

import { expect, test } from '@playwright/test';

import { acknowledgment, acknowledgmentList, gotoAcknowledgments, PAGE_LOAD_TIMEOUT, skipWithoutCredentials } from './helpers/org-easycla.helper';

test.setTimeout(120_000);

const ROW = acknowledgment();
const POPULATED = acknowledgmentList({ list: [ROW], resultCount: 1, totalCount: 2, nextKey: 'cursor-2' });

test.describe('Org Lens EasyCLA acknowledgments — content', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('shows the name, the LF Login, and Authorized', async ({ page }) => {
    await gotoAcknowledgments(page, { initial: POPULATED });

    await expect(page.getByTestId('org-easycla-acknowledgment-name')).toHaveText('Ada Lovelace', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-acknowledgment-identity')).toHaveText('ada');
    await expect(page.getByTestId('org-easycla-acknowledgment-state-acknowledged')).toHaveText('Authorized');
  });

  test('sends the search term and shows the no-match copy when nothing matches', async ({ page }) => {
    const pending = page.waitForRequest((request) => request.url().includes('/acknowledgments') && request.url().includes('search=nobody'));

    await gotoAcknowledgments(page, {
      initial: POPULATED,
      search: acknowledgmentList({ list: [], resultCount: 0, totalCount: 0, nextKey: null }),
    });

    await expect(page.getByTestId('org-easycla-acknowledgment-name')).toHaveText('Ada Lovelace', { timeout: PAGE_LOAD_TIMEOUT });
    await page.locator('#org-easycla-acknowledgments-search-input').fill('nobody');
    await pending;

    await expect(page.getByTestId('org-easycla-acknowledgments-search-empty')).toContainText('No acknowledgments match your search.');
    await expect(page.getByTestId('org-easycla-acknowledgments-empty')).toHaveCount(0);
  });

  test('appends the next page when Load more is clicked', async ({ page }) => {
    const pending = page.waitForRequest((request) => request.url().includes('/acknowledgments') && request.url().includes('nextKey=cursor-2'));

    await gotoAcknowledgments(page, {
      initial: POPULATED,
      next: acknowledgmentList({
        list: [acknowledgment({ signatureId: 'ecla-sig-2', name: 'Grace Hopper', lfLogin: 'grace' })],
        resultCount: 1,
        totalCount: 2,
        nextKey: null,
      }),
    });

    await expect(page.getByTestId('org-easycla-acknowledgment-name')).toHaveText('Ada Lovelace', { timeout: PAGE_LOAD_TIMEOUT });
    await page.getByTestId('org-easycla-acknowledgments-load-more').locator('button').click();
    await pending;

    await expect(page.getByTestId('org-easycla-acknowledgment-name')).toHaveText(['Ada Lovelace', 'Grace Hopper']);
    await expect(page.getByTestId('org-easycla-acknowledgments-load-more')).toHaveCount(0);
  });
});
