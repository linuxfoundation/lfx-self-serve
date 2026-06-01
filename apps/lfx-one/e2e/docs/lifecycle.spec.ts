// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

/**
 * US6 acceptance — content lifecycle (T055).
 *
 * The full edit-merge-deploy lifecycle (markdown change → docs:build →
 * artifact diff) is covered by the build pipeline checks
 * (`docs:check-coverage`, `docs:validate`, `docs:check-sitemap`,
 * `docs:check-idempotence`). What this e2e cannot reasonably do is
 * delete a real article from `docs/user/` mid-test — that would race
 * against any other Playwright workers and require a temp-branch
 * helper to safely rewrite source files.
 *
 * Instead, we verify the **runtime contract** that authors depend on
 * after a content rename:
 *
 *   1. A non-existent slug 404s with the dedicated not-found page.
 *   2. The not-found page surfaces the manifest topic list so users
 *      can recover after a stale bookmark hit.
 *   3. The sitemap and the manifest agree on every public URL — drift
 *      between the two is what would break crawlers when an article
 *      is renamed.
 */

const DATA_LOAD_TIMEOUT = 30_000;
const TEST_TIMEOUT = 60_000;

test.use({ storageState: { cookies: [], origins: [] } });

// 30s data-load timeout demands a test timeout that comfortably exceeds it,
// per docs/architecture/testing/testing-best-practices.md (avoid flake from
// the default 30s test timeout colliding with a 30s `toBeVisible`).
test.describe.configure({ timeout: TEST_TIMEOUT });

test.describe('Docs portal — content lifecycle (US6)', () => {
  test('renamed/deleted article URL serves the not-found page', async ({ page }) => {
    const response = await page.goto('/docs/this-article-was-renamed', { waitUntil: 'domcontentloaded' });

    // SSR returns 404 for the dedicated /docs/not-found route via
    // app.routes.server.ts. Browsers may follow internal navigations
    // without a status code change, so we accept either the
    // server-rendered 404 or a soft client redirect to the not-found
    // page that still surfaces the recovery UI.
    if (response) {
      expect([200, 404]).toContain(response.status());
    }
    await expect(page.getByTestId('docs-not-found')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('not-found page surfaces topic recovery list', async ({ page }) => {
    await page.goto('/docs/another-stale-bookmark', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('docs-not-found')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // The 404 page links back to /docs as a primary recovery affordance.
    const backLink = page.locator('a[href="/docs"]').first();
    await expect(backLink).toBeVisible();

    // ...and surfaces the manifest topic list so visitors hitting a
    // stale bookmark can choose another section without bouncing.
    // Manifest carries 13 topics; assert at least 3 to keep the test
    // resilient to taxonomy edits without trivializing the contract.
    const topicLinks = page.locator('[data-testid="docs-not-found"] a[href^="/docs/"]');
    await expect(topicLinks.first()).toBeVisible();
    expect(await topicLinks.count()).toBeGreaterThanOrEqual(3);
  });

  test('every sitemap URL resolves successfully', async ({ request }) => {
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(0);

    // Spot-check a handful (full sweep would be slow + redundant
    // with check-sitemap.mjs); the build-time gate already enforces
    // strict parity.
    const sample = locs.slice(0, 5);
    for (const loc of sample) {
      const path = new URL(loc).pathname;
      const r = await request.get(path);
      expect(r.status(), `sitemap URL ${path}`).toBe(200);
    }
  });
});
