// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens · Project Detail Page E2E Tests (LFXV2-1885)
 *
 * Covers the acceptance criteria for the per-project Org Lens view:
 * - data-testid resolution smoke test (breadcrumb, hero, tabs, card groups, trend)
 * - tab strip switching (click + keyboard) with ?tab= URL persistence
 * - leaderboard ranking, score/metric toggles with ?metric= persistence,
 *   Activity Count hiding the band tags, and server-side pagination + search over the full ranked set
 * - not-found (404) panel for an unknown slug
 *
 * Prerequisites:
 * - Dev server running on the Playwright baseURL
 * - User authenticated with the `org-lens-enabled` flag on and an organization selected
 *
 * Data semantics (v1): the page is served from live Snowflake platinum via the BFF. `k8s` is the real
 * catalog slug for the Kubernetes project (the earlier `kubernetes` was only the removed demo-fixture
 * key); a slug with no catalog row for the selected org returns null → the not-found panel.
 */

import { expect, test } from '@playwright/test';

const DETAIL_URL = '/org/projects/k8s';
const DETAIL_URL_BOGUS = '/org/projects/totally-bogus-project';
const DATA_LOAD_TIMEOUT = 30_000;

test.setTimeout(90_000);

test.describe('Org Project Detail — testid resolution', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('project-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('renders breadcrumb, hero and tab strip', async ({ page }) => {
    await expect(page.getByTestId('project-detail-breadcrumb')).toBeVisible();
    await expect(page.getByTestId('project-detail-hero')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('project-detail-name')).toHaveText('Kubernetes');
    await expect(page.getByTestId('project-detail-first-commit')).toBeVisible();
    await expect(page.getByTestId('project-detail-software-value')).toBeVisible();
    await expect(page.getByTestId('project-detail-health-badge')).toBeVisible();
    await expect(page.getByTestId('project-detail-foundation-pill')).toBeVisible();
    await expect(page.getByTestId('project-detail-tab-pd-influence')).toBeVisible();
    await expect(page.getByTestId('project-detail-tab-pd-leaderboards')).toBeVisible();
  });

  test('renders the Technical and Ecosystem card groups', async ({ page }) => {
    await expect(page.getByTestId('project-detail-technical-card-maintainers')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    for (const key of ['maintainers', 'contributors', 'commits', 'pull-requests']) {
      await expect(page.getByTestId(`project-detail-technical-card-${key}`)).toBeVisible();
    }
    for (const key of ['collaboration', 'meeting-attendance', 'board-members', 'committee-members']) {
      await expect(page.getByTestId(`project-detail-ecosystem-card-${key}`)).toBeVisible();
    }

    await page.getByTestId('project-detail-tab-pd-leaderboards').click();
    await expect(page.getByTestId('project-detail-trend-group')).toBeVisible();
  });
});

test.describe('Org Project Detail — tab strip', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('project-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('defaults to Our Influence and switches to Leaderboards via click + URL', async ({ page }) => {
    await expect(page.getByTestId('project-detail-technical-group')).toBeVisible();
    await page.getByTestId('project-detail-tab-pd-leaderboards').click();
    await expect(page).toHaveURL(/tab=pd-leaderboards/);
    await expect(page.getByTestId('project-detail-leaderboard-technical')).toBeVisible();
  });

  test('deep-links to the Leaderboards tab via ?tab=', async ({ page }) => {
    await page.goto(`${DETAIL_URL}?tab=pd-leaderboards`, { waitUntil: 'domcontentloaded' });
    // The board is fetched lazily on first activation; wait for its table (data present), not just
    // the wrapper that renders during the loading skeleton.
    await expect(page.getByTestId('project-detail-leaderboard-technical-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('arrow keys move between tabs', async ({ page }) => {
    await page.getByTestId('project-detail-tab-pd-influence').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('project-detail-tab-pd-leaderboards')).toBeFocused();
  });
});

test.describe('Org Project Detail — leaderboards', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${DETAIL_URL}?tab=pd-leaderboards`, { waitUntil: 'domcontentloaded' });
    // Gate on the rendered table so per-block lazy loading has resolved before the assertions below.
    await expect(page.getByTestId('project-detail-leaderboard-technical-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('renders both side-by-side boards with the viewing-org row at its ranked position', async ({ page }) => {
    await expect(page.getByTestId('project-detail-leaderboard-technical')).toBeVisible();
    await expect(page.getByTestId('project-detail-leaderboard-ecosystem')).toBeVisible();
    await expect(page.getByTestId('project-detail-trend-group')).toBeVisible();

    // Each board loads on its own request. beforeEach awaits the technical table; await the ecosystem
    // table too so the loop never reads zero rows or skeleton DOM from a board that hasn't resolved yet.
    await expect(page.getByTestId('project-detail-leaderboard-ecosystem-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // The viewing org is no longer pinned to the top. Calculated Influence assigns contiguous ranks,
    // so within the rendered page each row's rank equals the first row's rank plus its offset; a pinned
    // out-of-order row would break that contiguity. This rank-order guard is asserted FIRST and is
    // page-independent (it keys off the first rendered rank, not a hardcoded 1), so a genuine ordering
    // regression surfaces on the rank assertion rather than being masked by a viewing-row precondition.
    //
    // The viewing org is no longer pinned and the list is the full multi-page ranked set, so the
    // viewing row may land on a later page. The viewing-row rank check below is therefore conditional:
    // asserted only when that row happens to render on this first page; otherwise the page-independent
    // rank-order guard above is the coverage.
    for (const board of ['technical', 'ecosystem'] as const) {
      const rows = page.locator(`[data-testid="project-detail-leaderboard-${board}"] tbody tr`);
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);

      const ranks: number[] = [];
      let viewingIndex = -1;
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        ranks.push(Number((await row.locator('td').first().innerText()).trim()));
        if ((await row.getAttribute('data-testid')) === `project-detail-leaderboard-${board}-viewing-row`) {
          viewingIndex = i;
        }
      }

      for (let i = 0; i < ranks.length; i++) {
        expect(ranks[i]).toBe(ranks[0] + i);
      }

      if (viewingIndex >= 0) {
        expect(ranks[viewingIndex]).toBe(ranks[0] + viewingIndex);
      }
    }
  });

  test('activity count mode also renders boards in rank order with the viewing org not pinned', async ({ page }) => {
    // The Activity Count branch drops the pin too, ordering by warehouse rank ascending with
    // unknown-rank rows sorting last and rendering an explicit '—' (never a positional fallback). We
    // assert only the rendered rank order — not the viewing row's presence — because unpinning
    // explicitly allows the viewing org to fall onto a later paginator page.
    //
    // Switching metric triggers a fresh server reload that swaps in skeleton rows, so wait for the
    // activity page-0 response of BOTH boards (not just the tables, which are already on screen from
    // the influence load) and for the skeletons to clear — otherwise the assertion could run against
    // empty skeleton text or stale influence ranks and still pass.
    const activityLoaded = (['technical', 'ecosystem'] as const).map((board) =>
      page.waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return (
            url.pathname.endsWith(`/leaderboard/${board}`) &&
            url.searchParams.get('metric') === 'activity' &&
            url.searchParams.get('page') === '0' &&
            response.status() === 200
          );
        },
        { timeout: DATA_LOAD_TIMEOUT }
      )
    );
    await page.getByTestId('project-detail-metric-activity').click();
    await expect(page).toHaveURL(/metric=activity/);
    await Promise.all(activityLoaded);

    for (const board of ['technical', 'ecosystem'] as const) {
      const rows = page.locator(`[data-testid="project-detail-leaderboard-${board}"] tbody tr`);
      // Wait past the skeleton reload: the first row's rank cell resolves to a real value (a number or '—').
      await expect.poll(async () => (await rows.first().locator('td').first().innerText()).trim()).not.toBe('');
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);

      const rankTexts: string[] = [];
      for (let i = 0; i < count; i++) {
        rankTexts.push((await rows.nth(i).locator('td').first().innerText()).trim());
      }

      // Numeric warehouse ranks come first and must be non-decreasing; unknown-rank rows render '—' and
      // sort last, so once one appears every later row is '—' too. No positional fallback is allowed.
      let seenUnknown = false;
      let prev = -Infinity;
      for (const text of rankTexts) {
        if (text === '—') {
          seenUnknown = true;
          continue;
        }
        expect(seenUnknown, `numeric rank "${text}" must not appear after an unknown '—' row`).toBe(false);
        const rank = Number(text);
        expect(Number.isFinite(rank)).toBe(true);
        expect(rank).toBeGreaterThanOrEqual(prev);
        prev = rank;
      }
    }
  });

  test('metric toggle persists in the URL and switches the score column', async ({ page }) => {
    await expect(page.getByRole('columnheader', { name: 'Influence Score' }).first()).toBeVisible();
    await page.getByTestId('project-detail-metric-activity').click();
    await expect(page).toHaveURL(/metric=activity/);
    await expect(page.getByText('Contribution Activities Leaderboard')).toBeVisible();
    await expect(page.getByText('Collaboration Activities Leaderboard')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Total contributions' })).toHaveCount(1);
    await expect(page.getByRole('columnheader', { name: 'Total collaborations' })).toHaveCount(1);
    await expect(page.getByRole('columnheader', { name: 'Influence Score' })).toHaveCount(0);
  });

  test('time-range toggle persists in the URL and updates the activity column label', async ({ page }) => {
    await page.getByTestId('project-detail-metric-activity').click();
    await page.getByTestId('project-detail-time-range-1y').click();
    await expect(page).toHaveURL(/range=1y/);
    await expect(page.getByRole('columnheader', { name: 'Total contributions' }).first()).toBeVisible();
  });

  // The leaderboard boards are now server-paginated + server-searched over the FULL ranked org set
  // (no top-10 cap). These specs exercise that contract against live data: `k8s` has hundreds of
  // ranked orgs, so the technical board spans many pages. Assertions key off the OUTGOING request
  // params (page / pageSize / search) rather than exact row contents, so they stay stable as the
  // underlying warehouse data shifts. Requires the uncapped platinum leaderboard model in the target
  // environment (shipped by the lf-dbt side of LFXV2-2815).
  const TECH_BOARD = '[data-testid="project-detail-leaderboard-technical"]';

  /** Parse the "Showing X to Y of Z" paginator report into its total (Z). */
  async function boardTotal(page: import('@playwright/test').Page): Promise<number> {
    const report = await page.locator(`${TECH_BOARD} .p-paginator-current`).innerText();
    return Number(report.replace(/,/g, '').match(/of\s+(\d+)/)?.[1] ?? '0');
  }

  test('paginates to organizations ranked beyond the first page (full list, not top-10)', async ({ page }) => {
    const rows = page.locator(`${TECH_BOARD} tbody tr`);

    // Full list — the paginator total exceeds ten (the legacy cap), and the first page starts at rank 1.
    expect(await boardTotal(page), 'k8s technical board should expose more than ten ranked orgs').toBeGreaterThan(10);
    expect(Number((await rows.first().locator('td').first().innerText()).trim())).toBe(1);

    // Advancing the paginator asks the server for page index 1 (a real lazy load, not a client slice).
    const pageRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/leaderboard/technical') && url.searchParams.get('page') === '1';
    });
    await page.locator(`${TECH_BOARD} button[aria-label="Next Page"]`).first().click();
    await pageRequest;

    // The first row on page 2 continues the ascending rank sequence past position ten.
    await expect.poll(async () => Number((await rows.first().locator('td').first().innerText()).trim())).toBeGreaterThan(10);
  });

  test('changing the page size re-pages the full ranked set from the server', async ({ page }) => {
    const rows = page.locator(`${TECH_BOARD} tbody tr`);
    await expect(rows).toHaveCount(10); // default page size
    const totalBefore = await boardTotal(page);

    // Selecting a larger page size issues a fresh server request at pageSize=25 (total is unchanged).
    // Wait for the RESPONSE (not just the request) so we assert against rendered data, not the loading skeletons.
    const sizeResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/leaderboard/technical') && url.searchParams.get('pageSize') === '25' && response.ok();
    });
    await page.locator(`${TECH_BOARD} .p-paginator-rpp-dropdown`).click();
    await page.getByRole('option', { name: '25', exact: true }).click();
    await sizeResponse;

    // Poll on a real rendered rank first (skeleton rows carry no rank text → NaN), so the row count
    // below is asserted against the resolved page rather than the 25 loading skeletons.
    await expect.poll(async () => Number((await rows.first().locator('td').first().innerText()).trim())).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => rows.count()).toBeGreaterThan(10);
    expect(await boardTotal(page), 'total row count is unchanged by page size').toBe(totalBefore);
  });

  test('server-side search finds an organization ranked beyond the first page at its true rank', async ({ page }) => {
    const rows = page.locator(`${TECH_BOARD} tbody tr`);
    expect(await boardTotal(page), 'this spec needs a project whose full list spans multiple pages').toBeGreaterThan(10);

    // Step to page 2 and capture an org that ranks past position ten.
    const pageRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/leaderboard/technical') && url.searchParams.get('page') === '1';
    });
    await page.locator(`${TECH_BOARD} button[aria-label="Next Page"]`).first().click();
    await pageRequest;
    await expect.poll(async () => Number((await rows.first().locator('td').first().innerText()).trim())).toBeGreaterThan(10);

    const targetRank = Number((await rows.first().locator('td').first().innerText()).trim());
    const targetName = (await rows.first().locator('td').nth(1).locator('span.text-gray-900').innerText()).trim();

    // Searching for that org (paginator resets to page 0 on a new query) must still find it — proving
    // the search spans the whole ranked set, not just the current page — and its true rank is preserved.
    // Wait for the OK page-0 search RESPONSE (not just the outgoing request): the board swaps in
    // skeleton rows while the debounced reload is in flight, so a request-only wait can assert before
    // the result is applied.
    const searchResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith('/leaderboard/technical') &&
        (url.searchParams.get('search') ?? '').length > 0 &&
        url.searchParams.get('page') === '0' &&
        response.status() === 200
      );
    });
    await page.locator('[data-test="project-detail-search-technical"]').fill(targetName);
    await searchResponse;

    // The row carrying the target name only renders once the skeletons clear and the real result is
    // applied, so this locator implicitly waits past the loading state before we assert the rank.
    const match = page.locator(`${TECH_BOARD} tbody tr`, { hasText: targetName }).first();
    await expect(match).toBeVisible();
    await expect.poll(async () => (await match.locator('td').first().innerText()).trim()).toBe(String(targetRank));
  });
});

test.describe('Org Project Detail — leaderboard row score-breakdown drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${DETAIL_URL}?tab=pd-leaderboards`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('project-detail-leaderboard-technical-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('project-detail-leaderboard-ecosystem-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  // Category/points data behind this drawer is DEMO data pending a real Snowflake-backed source
  // (LFXV2-2934), so a live k8s row's org may or may not be in the demo lookup — assert the drawer
  // opens with the clicked org's name and renders EITHER the breakdown content OR the graceful empty
  // state, never a crash either way.
  test('clicking a technical leaderboard row opens the drawer for that org', async ({ page }) => {
    const firstRow = page.locator('[data-testid="project-detail-leaderboard-technical"] tbody tr').first();
    const orgName = (await firstRow.locator('td').nth(1).locator('span.text-gray-900').innerText()).trim();

    await firstRow.click();

    await expect(page.getByTestId('org-leaderboard-detail-title')).toBeVisible();
    await expect(page.getByTestId('org-leaderboard-detail-title')).toHaveText(orgName);
    await expect(page.getByText('Technical Influence')).toBeVisible();
    await expect(page.getByTestId('org-leaderboard-detail-content').or(page.getByTestId('org-leaderboard-detail-empty'))).toBeVisible();
  });

  test('clicking an ecosystem leaderboard row opens the drawer for that org', async ({ page }) => {
    const firstRow = page.locator('[data-testid="project-detail-leaderboard-ecosystem"] tbody tr').first();
    const orgName = (await firstRow.locator('td').nth(1).locator('span.text-gray-900').innerText()).trim();

    await firstRow.click();

    await expect(page.getByTestId('org-leaderboard-detail-title')).toBeVisible();
    await expect(page.getByTestId('org-leaderboard-detail-title')).toHaveText(orgName);
    await expect(page.getByText('Ecosystem Influence')).toBeVisible();
    await expect(page.getByTestId('org-leaderboard-detail-content').or(page.getByTestId('org-leaderboard-detail-empty'))).toBeVisible();
  });

  test('closing the leaderboard detail drawer stays on the detail page', async ({ page }) => {
    const firstRow = page.locator('[data-testid="project-detail-leaderboard-technical"] tbody tr').first();
    await firstRow.click();
    await expect(page.getByTestId('org-leaderboard-detail-title')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('org-leaderboard-detail-title')).toBeHidden();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
  });
});

test.describe('Org Project Detail — Contributors drawer deep-link', () => {
  test('auto-opens the Contributors drawer from ?card=contributors', async ({ page }) => {
    await page.goto(`${DETAIL_URL}?card=contributors`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('project-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await expect(page.getByTestId('project-detail-technical-card-contributors')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('influence-card-detail-title')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('influence-card-detail-title')).toHaveText('Contributors');
  });

  test('closing the auto-opened drawer stays on the detail page', async ({ page }) => {
    await page.goto(`${DETAIL_URL}?card=contributors`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('influence-card-detail-title')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('influence-card-detail-title')).toBeHidden();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page).toHaveURL(/\/org\/projects\/k8s/);
  });

  test('ignores an unknown ?card= value and loads the page with no drawer', async ({ page }) => {
    await page.goto(`${DETAIL_URL}?card=bogus-card`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('project-detail-technical-group')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('influence-card-detail-title')).toBeHidden();
  });
});

test.describe('Org Project Detail — not found', () => {
  test('renders the 404 panel for an unknown slug', async ({ page }) => {
    await page.goto(DETAIL_URL_BOGUS, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('project-detail-not-found')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });
});
