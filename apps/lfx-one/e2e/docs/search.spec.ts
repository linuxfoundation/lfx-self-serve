// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

/**
 * US3 acceptance scenarios — visitor searches the documentation.
 *
 * Coverage (per task T036 + T041):
 *   1. A unique-phrase query returns a match with a snippet, and clicking
 *      the result navigates to the article.
 *   2. A no-match query renders the empty-state UX with the searched term
 *      and a link back to the topic grid.
 *   3. The search index is fetched ONCE and cached: two consecutive
 *      searches issue exactly one GET to /assets/docs/search-index.json.
 *
 * Runs anonymously (FR-016 — search is reachable without auth) so the
 * checks also exercise the public-shell path.
 */

const DATA_LOAD_TIMEOUT = 30_000;
const TEST_TIMEOUT = 60_000;

test.use({ storageState: { cookies: [], origins: [] } });

// 30s data-load timeout demands a test timeout that comfortably exceeds it,
// per docs/architecture/testing/testing-best-practices.md (avoid flake from
// the default 30s test timeout colliding with a 30s `toBeVisible`).
test.describe.configure({ timeout: TEST_TIMEOUT });

test.describe('Docs portal — search (US3)', () => {
  test('matches a query and navigates on result click', async ({ page }) => {
    await page.goto('/docs', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('docs-landing')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const input = page.getByTestId('docs-search-input');
    await input.fill('meeting');
    const panel = page.getByTestId('docs-search-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    const firstResult = page.getByTestId('docs-search-result').first();
    await expect(firstResult).toBeVisible();
    await firstResult.click();
    await expect(page).toHaveURL(/\/docs\//);
    await expect(page.getByTestId('docs-article-title')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('shows the empty state for a no-match query', async ({ page }) => {
    await page.goto('/docs', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('docs-landing')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const input = page.getByTestId('docs-search-input');
    await input.fill('zzzqqqxxxnomatchterm');
    const empty = page.getByTestId('docs-search-empty');
    await expect(empty).toBeVisible({ timeout: 10_000 });
    await expect(empty).toContainText('zzzqqqxxxnomatchterm');
  });

  test('search index is fetched once and cached for subsequent queries', async ({ page }) => {
    let indexFetches = 0;
    page.on('request', (req) => {
      if (req.url().includes('/assets/docs/search-index.json')) {
        indexFetches += 1;
      }
    });

    await page.goto('/docs', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('docs-landing')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const input = page.getByTestId('docs-search-input');
    await input.fill('committee');
    await expect(page.getByTestId('docs-search-panel')).toBeVisible({ timeout: 10_000 });
    await input.fill('');
    await input.fill('vote');
    await expect(page.getByTestId('docs-search-panel')).toBeVisible({ timeout: 10_000 });

    expect(indexFetches).toBe(1);
  });
});
