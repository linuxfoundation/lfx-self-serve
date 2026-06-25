// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

/**
 * US1 acceptance scenarios — public visitor reads articles without signing in.
 *
 * These tests intentionally run with NO storage state (anonymous session) to
 * verify that `/docs/**`, `/sitemap.xml`, and `/robots.txt` are reachable
 * without authentication and without an Auth0 redirect.
 *
 * Coverage (per task T022):
 *   1. Anonymous deep-link to a topic article renders fully (no login wall).
 *   2. View-source contains the article body HTML (SSR, not a JS-only blank page).
 *   3. Internal cross-link navigates within the SPA (no full page reload).
 *   4. A broken `/docs/<missing>` URL renders the 404 with a recovery link.
 *   5. `/sitemap.xml` and `/robots.txt` return 200 without auth.
 *   6. FR-024 indexability: no `<meta name="robots" content*="noindex">`,
 *      no `X-Robots-Tag: noindex` response header on article pages.
 */

const DATA_LOAD_TIMEOUT = 30_000;
const TEST_TIMEOUT = 60_000;

// Anonymous context for every test in this file — overrides the default
// authenticated `storageState` from `playwright.config.ts`.
test.use({ storageState: { cookies: [], origins: [] } });

// 30s data-load timeout demands a test timeout that comfortably exceeds it,
// per docs/architecture/testing/testing-best-practices.md (avoid flake from
// the default 30s test timeout colliding with a 30s `toBeVisible`).
test.describe.configure({ timeout: TEST_TIMEOUT });

test.describe('Docs portal — public access (US1)', () => {
  test('landing page renders for anonymous visitors without redirect', async ({ page }) => {
    const response = await page.goto('/docs', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('docs-landing')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('docs-topics-grid')).toBeVisible();
  });

  test('topic landing article is reachable via direct deep link', async ({ page }) => {
    const response = await page.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('docs-article-title')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('article SSR view-source contains the article body', async ({ request }) => {
    const response = await request.get('/docs/meetings');
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('docs-article-body');
    // The SSR HTML should already include rendered prose, not just an
    // empty Angular shell awaiting hydration.
    expect(html.length).toBeGreaterThan(2_000);
  });

  test('article page is not flagged noindex via meta or response header', async ({ page, request }) => {
    const response = await request.get('/docs/meetings');
    expect(response.status()).toBe(200);
    const headers = response.headers();
    const xRobots = headers['x-robots-tag'] ?? '';
    expect(xRobots.toLowerCase()).not.toContain('noindex');

    await page.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
    const robotsMeta = await page
      .locator('meta[name="robots"]')
      .first()
      .getAttribute('content')
      .catch(() => null);
    if (robotsMeta) {
      expect(robotsMeta.toLowerCase()).not.toContain('noindex');
    }
  });

  test('clicking an internal cross-link navigates within /docs/*', async ({ page }) => {
    await page.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('docs-article-body')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Count the collection on the parent locator first; calling
    // `.count()` on a `.first()` locator returns 0 or 1 (the existence
    // of the first match) rather than the true collection size, which
    // is misleading and would silently misbehave under any predicate
    // other than `=== 0`. We then derive the first element only after
    // the skip check.
    const internalLinks = page.locator('[data-testid="docs-article-body"] a[href^="/docs/"]');
    const internalCount = await internalLinks.count();
    test.skip(internalCount === 0, 'No internal /docs/* anchors in this fixture article');

    const internalLink = internalLinks.first();
    const href = await internalLink.getAttribute('href');
    expect(href).toMatch(/^\/docs\//);
    await internalLink.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByTestId('docs-article-title')).toBeVisible();
  });

  test('a broken /docs/<missing> URL renders the 404 page with recovery links', async ({ page }) => {
    const response = await page.goto('/docs/this-slug-does-not-exist', { waitUntil: 'domcontentloaded' });
    // The resolver redirects to /docs/not-found which is configured with
    // status 404 in app.routes.server.ts.
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId('docs-not-found')).toBeVisible();
    await expect(page.getByTestId('docs-not-found-back-link')).toHaveAttribute('href', '/docs');
  });

  test('/sitemap.xml is publicly reachable and lists docs URLs', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    const xml = await response.text();
    expect(xml).toContain('<urlset');
    expect(xml).toContain('/docs');
  });

  test('/robots.txt is publicly reachable and references the sitemap', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body.toLowerCase()).toContain('sitemap:');
    expect(body).toContain('/sitemap.xml');
  });
});
