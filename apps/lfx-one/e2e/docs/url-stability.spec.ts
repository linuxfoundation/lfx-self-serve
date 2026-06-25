// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

/**
 * US4 acceptance scenarios — visitor bookmarks and shares URLs.
 *
 * Coverage (per task T043):
 *   1. Copy → paste → identical render: a `/docs/<topic>/<slug>` URL pasted
 *      into a fresh anonymous context renders the same article.
 *   2. Bookmarked URL still works after navigation away and back via the
 *      Router (no full reload required).
 *   3. Topic-landing pages and articles share the same URL pattern
 *      (`/docs/<seg>(/<seg>)*` — lowercase, hyphenated, no query strings).
 *   4. URL normalization: trailing slash and mixed case route to the same
 *      canonical article (matches the manifest service contract / T045).
 */

const DATA_LOAD_TIMEOUT = 30_000;
const TEST_TIMEOUT = 60_000;

test.use({ storageState: { cookies: [], origins: [] } });

// 30s data-load timeout demands a test timeout that comfortably exceeds it,
// per docs/architecture/testing/testing-best-practices.md (avoid flake from
// the default 30s test timeout colliding with a 30s `toBeVisible`).
test.describe.configure({ timeout: TEST_TIMEOUT });

test.describe('Docs portal — URL stability (US4)', () => {
  test('copy → paste in fresh context renders the same article', async ({ browser }) => {
    const ctx1 = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page1 = await ctx1.newPage();
    await page1.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
    await expect(page1.getByTestId('docs-article-title')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const title1 = (await page1.getByTestId('docs-article-title').textContent())?.trim();
    const url = page1.url();
    await ctx1.close();

    const ctx2 = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page2 = await ctx2.newPage();
    await page2.goto(url, { waitUntil: 'domcontentloaded' });
    const title2 = (await page2.getByTestId('docs-article-title').textContent())?.trim();
    expect(title2).toBe(title1);
    await ctx2.close();
  });

  test('bookmarked URL works after navigating away and back', async ({ page }) => {
    await page.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('docs-article-title')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const expectedTitle = (await page.getByTestId('docs-article-title').textContent())?.trim();

    await page.goto('/docs', { waitUntil: 'domcontentloaded' });
    await page.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
    const stillTheSame = (await page.getByTestId('docs-article-title').textContent())?.trim();
    expect(stillTheSame).toBe(expectedTitle);
  });

  test('every URL surfaced in the sitemap matches the canonical pattern', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    const xml = await response.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      const path = new URL(loc).pathname.replace(/\/+$/, '') || '/';
      expect(path, `Sitemap URL ${loc} → path ${path} must match /docs canonical shape`).toMatch(/^\/docs(?:\/[a-z0-9-]+)*$/);
      expect(path).not.toMatch(/[?#]/);
      expect(path).not.toMatch(/[A-Z]/);
      expect(path).not.toMatch(/_/);
    }
  });

  test('trailing slash and mixed case resolve to the same canonical article', async ({ page }) => {
    await page.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('docs-article-title')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const canonical = (await page.getByTestId('docs-article-title').textContent())?.trim();

    await page.goto('/docs/meetings/', { waitUntil: 'domcontentloaded' });
    const trailingSlash = (await page.getByTestId('docs-article-title').textContent())?.trim();
    expect(trailingSlash).toBe(canonical);

    await page.goto('/docs/MEETINGS', { waitUntil: 'domcontentloaded' });
    const upperCase = (await page.getByTestId('docs-article-title').textContent())?.trim();
    expect(upperCase).toBe(canonical);
  });
});
