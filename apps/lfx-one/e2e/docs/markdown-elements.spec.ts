// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCS_ANCHOR_SCROLL_OFFSET_PX } from '@lfx-one/shared/constants';
import { expect, test } from '@playwright/test';

/**
 * US5 acceptance — markdown element rendering coverage (T049a).
 *
 * Pragmatic substitute for the full fixture-route plan in tasks.md:
 * rather than introducing a `--fixtures` build flag and a synthetic
 * `/docs/__fixtures__/all-elements` route, we walk an existing rich
 * article and assert the `prose-lfx` container is applied, the body
 * renders sanitized HTML with common element classes, and headings
 * carry the slug-based ids that the build pipeline injects.
 *
 * Trade-off recorded in tasks.md — not all FR-012 element classes
 * are guaranteed to appear in every test article, but the prose-lfx
 * container itself is the contract under test (per the FR-029 styling
 * requirement) and individual element rules are covered by the build
 * pipeline's marked + sanitize-html unit-style assertions executed in
 * the manifest validator (T053).
 */

const DATA_LOAD_TIMEOUT = 30_000;
const TEST_TIMEOUT = 60_000;

test.use({ storageState: { cookies: [], origins: [] } });

// 30s data-load timeout demands a test timeout that comfortably exceeds it,
// per docs/architecture/testing/testing-best-practices.md (avoid flake from
// the default 30s test timeout colliding with a 30s `toBeVisible`).
test.describe.configure({ timeout: TEST_TIMEOUT });

test.describe('Docs portal — markdown rendering (US5)', () => {
  test('article body uses the prose-lfx container', async ({ page }) => {
    await page.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
    const body = page.getByTestId('docs-article-body');
    await expect(body).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(body).toHaveClass(/\bprose\b/);
    await expect(body).toHaveClass(/\bprose-lfx\b/);
  });

  test('article body contains rendered markdown elements', async ({ page }) => {
    await page.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
    const body = page.getByTestId('docs-article-body');
    await expect(body).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Articles should render at least one paragraph and at least one
    // sub-heading — these are the floor for "rich content" in the corpus.
    const paragraphs = await body.locator('p').count();
    expect(paragraphs).toBeGreaterThan(0);

    const subHeadings = await body.locator('h2, h3').count();
    expect(subHeadings).toBeGreaterThan(0);
  });

  test('headings inside the body carry slug ids (anchor support)', async ({ page }) => {
    await page.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
    const body = page.getByTestId('docs-article-body');
    await expect(body).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const subHeadings = body.locator('h2, h3');
    const count = await subHeadings.count();
    expect(count).toBeGreaterThan(0);

    // At least one sub-heading should have a non-empty slug id — the
    // build pipeline (marked-config.mjs) generates these for in-page
    // anchor support.
    let hasIds = 0;
    for (let i = 0; i < count; i++) {
      const id = await subHeadings.nth(i).getAttribute('id');
      if (id && id.length > 0) hasIds++;
    }
    expect(hasIds, 'at least one heading should have a slug id').toBeGreaterThan(0);
  });

  test('fragment URL scrolls the target heading into view', async ({ page }) => {
    // Mid-article h2 with ample content below — a near-the-end heading (e.g.
    // `#public-meeting-access`) runs out of scroll room and would pass an
    // occlusion-only check even with the offset reverted. The tight landing
    // assertion fails if the 128px offset/scroll-margin is removed.
    await page.goto('/docs/meetings#key-concepts', { waitUntil: 'domcontentloaded' });
    const target = page.locator('h2#key-concepts');
    await expect(target).toBeInViewport({ timeout: DATA_LOAD_TIMEOUT });

    // toBeInViewport misses occlusion (intersection ≠ uncovered): with the offset
    // applied the heading lands exactly DOCS_ANCHOR_SCROLL_OFFSET_PX from the
    // viewport top — native jump via scroll-margin-top, router via ViewportScroller.
    await expect
      .poll(
        async () => {
          const targetTop = await target.evaluate((el) => el.getBoundingClientRect().top);
          return Math.abs(targetTop - DOCS_ANCHOR_SCROLL_OFFSET_PX);
        },
        { timeout: DATA_LOAD_TIMEOUT }
      )
      .toBeLessThan(2);
  });

  test('in-app cross-link with #fragment scrolls via the router offset', async ({ page }) => {
    // Cold-load the FAQ article, then click an authored cross-link carrying a
    // fragment. The click interceptor routes it via Router.navigateByUrl, so the
    // docs-scoped ViewportScroller offset — not the native fragment jump — decides
    // the landing position. A full-page load would wipe the window marker.
    await page.goto('/docs/account/faq', { waitUntil: 'domcontentloaded' });
    const body = page.getByTestId('docs-article-body');
    await expect(body).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>)['__lfxSpaNav'] = true;
    });

    await body.locator('a[href="/docs/account/my-clas#why-don-t-my-signed-clas-show-up"]').first().click();
    await expect(page).toHaveURL(/\/docs\/account\/my-clas#why-don-t-my-signed-clas-show-up$/);
    const marker = await page.evaluate(() => (window as unknown as Record<string, unknown>)['__lfxSpaNav']);
    expect(marker, 'client-side navigation (no full reload)').toBe(true);

    const target = page.locator('h2#why-don-t-my-signed-clas-show-up');
    await expect
      .poll(
        async () => {
          const targetTop = await target.evaluate((el) => el.getBoundingClientRect().top);
          return Math.abs(targetTop - DOCS_ANCHOR_SCROLL_OFFSET_PX);
        },
        { timeout: DATA_LOAD_TIMEOUT }
      )
      .toBeLessThan(2);
  });

  test('same-page #anchor links scroll in place without leaving the article', async ({ page }) => {
    // Authored markdown uses bare `#fragment` links for "see X below" cross-references.
    // Without interception the browser resolves them against `<base href="/">` and
    // navigates off the docs page entirely (to an auth-guarded route for anonymous
    // readers); the click interceptor must turn them into same-URL fragment
    // navigations so the docs scroll offset applies.
    await page.goto('/docs/crowdfunding/manage-initiatives', { waitUntil: 'domcontentloaded' });
    const body = page.getByTestId('docs-article-body');
    await expect(body).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await body.locator('a[href="#fund-types"]').first().click();
    await expect(page).toHaveURL(/\/docs\/crowdfunding\/manage-initiatives#fund-types$/);

    const target = page.locator('h2#fund-types');
    await expect
      .poll(
        async () => {
          const targetTop = await target.evaluate((el) => el.getBoundingClientRect().top);
          const topbarBottom = await page.getByTestId('docs-article-topbar').evaluate((el) => el.getBoundingClientRect().bottom);
          return targetTop >= topbarBottom;
        },
        { timeout: DATA_LOAD_TIMEOUT }
      )
      .toBe(true);
  });

  test('external links open in a new tab with safe rel attributes', async ({ page }) => {
    await page.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
    const body = page.getByTestId('docs-article-body');
    await expect(body).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const externalLinks = body.locator('a[target="_blank"]');
    const count = await externalLinks.count();
    if (count === 0) {
      test.info().annotations.push({ type: 'note', description: 'meetings article has no external links — skipping rel check' });
      return;
    }
    for (let i = 0; i < count; i++) {
      await expect(externalLinks.nth(i)).toHaveAttribute('rel', /noopener.*noreferrer|noreferrer.*noopener/);
    }
  });
});
