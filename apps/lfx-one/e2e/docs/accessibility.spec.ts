// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

/**
 * US5 acceptance — accessibility coverage for the docs portal (T050).
 *
 * We run lightweight a11y assertions without pulling axe-core (no extra
 * dependency budget for this iteration): unique h1, main landmark present,
 * search input fully labelled, every link has an accessible name, keyboard
 * tab order is reachable, and the prose container exposes correct heading
 * hierarchy.
 */

const DATA_LOAD_TIMEOUT = 30_000;
const TEST_TIMEOUT = 60_000;

test.use({ storageState: { cookies: [], origins: [] } });

// 30s data-load timeout demands a test timeout that comfortably exceeds it,
// per docs/architecture/testing/testing-best-practices.md (avoid flake from
// the default 30s test timeout colliding with a 30s `toBeVisible`).
test.describe.configure({ timeout: TEST_TIMEOUT });

test.describe('Docs portal — accessibility (US5)', () => {
  test('landing page has exactly one h1 and a main landmark', async ({ page }) => {
    await page.goto('/docs', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('docs-landing')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBe(1);

    await expect(page.locator('main')).toBeVisible();
  });

  test('article page has exactly one h1 and a main landmark', async ({ page }) => {
    await page.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('docs-article-title')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBe(1);

    await expect(page.locator('main')).toBeVisible();
  });

  test('search input is fully labelled and keyboard-reachable', async ({ page }) => {
    await page.goto('/docs', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('docs-landing-search')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const input = page.getByTestId('docs-search-input');
    await expect(input).toHaveAttribute('aria-label', /search/i);
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('aria-autocomplete', 'list');
    await expect(input).toHaveAttribute('aria-expanded', /true|false/);

    await input.focus();
    await expect(input).toBeFocused();
  });

  test('every visible link on the landing page has an accessible name', async ({ page }) => {
    await page.goto('/docs', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('docs-landing')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const namelessLinks = await page.locator('main a:visible').evaluateAll((links) =>
      links
        .filter((link) => {
          const text = (link.textContent ?? '').trim();
          const ariaLabel = link.getAttribute('aria-label')?.trim() ?? '';
          const ariaLabelledBy = link.getAttribute('aria-labelledby')?.trim() ?? '';
          const title = link.getAttribute('title')?.trim() ?? '';
          return !text && !ariaLabel && !ariaLabelledBy && !title;
        })
        .map((link) => link.outerHTML)
    );

    expect(namelessLinks, 'links missing accessible name').toEqual([]);
  });

  test('article body preserves heading hierarchy (no h1 inside markdown)', async ({ page }) => {
    await page.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('docs-article-body')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const h1InsideBody = await page.locator('[data-testid="docs-article-body"] h1').count();
    expect(h1InsideBody, 'rendered markdown body must not contain an h1 (page heading is outside)').toBe(0);
  });
});
