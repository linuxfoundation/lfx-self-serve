// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA Contributor Acknowledgments — structural E2E (#2806).
 *
 * The structural half of the repository's dual E2E architecture; `org-easycla-acknowledgments.spec.ts`
 * is the content half. This one asserts the `data-testid` contract — not the copy — so the pair
 * fails independently: reworded empty-state text breaks only the content spec, and a panel rebuilt
 * behind the same testids leaves this one green.
 *
 * Same standing constraint as the content spec: the acknowledgments GET is stubbed.
 *
 * Prerequisites: as `org-easycla-acknowledgments.spec.ts`.
 */

import { expect, test } from '@playwright/test';

import { acknowledgment, acknowledgmentList, gotoAcknowledgments, PAGE_LOAD_TIMEOUT, skipWithoutCredentials } from './helpers/org-easycla.helper';

test.setTimeout(120_000);

test.describe('Org Lens EasyCLA acknowledgments — structure', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('nests the panel, the search box, and the empty state', async ({ page }) => {
    await gotoAcknowledgments(page);

    const panel = page.getByTestId('org-easycla-acknowledgments');
    await expect(panel).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(panel.getByTestId('org-easycla-acknowledgments-search')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-acknowledgments-empty')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-acknowledgments-table')).toHaveCount(0);
    await expect(page.locator('#org-easycla-acknowledgments-search-input')).toHaveCount(1);
  });

  test('nests the table and Load more under the panel when another page exists', async ({ page }) => {
    await gotoAcknowledgments(page, {
      initial: acknowledgmentList({
        list: [acknowledgment()],
        resultCount: 1,
        totalCount: 2,
        nextKey: 'cursor-2',
      }),
    });

    const panel = page.getByTestId('org-easycla-acknowledgments');
    await expect(panel.getByTestId('org-easycla-acknowledgments-table')).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(panel.getByTestId('org-easycla-acknowledgment-name')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-acknowledgment-identity')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-acknowledgment-version')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-acknowledgment-signed-on')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-acknowledgment-state-acknowledged')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-acknowledgments-load-more')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-acknowledgments-empty')).toHaveCount(0);
  });
});
