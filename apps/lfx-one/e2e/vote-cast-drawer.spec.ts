// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Vote cast drawer — always-visible header (GH-2350).
 *
 * The drawer's header (title + close button) is hoisted above the vote-data conditional so the
 * panel stays closable in EVERY state — before the fix the header only rendered once vote data
 * existed, leaving the drawer unclosable while loading. Coverage (all via the Me-lens votes
 * dashboard, the one host that opens the drawer without a warm vote-detail cache):
 *   - loading: header + close button render while the detail request is still pending (content
 *     skeletons show), then the ballot swaps in once the detail lands
 *   - close during load: the header close button dismisses the drawer with the request in flight
 *   - detail failure: the header + close button survive an upstream 500 (catchError falls back to
 *     the list-row data, so the no-questions fallback renders instead of the error block)
 *
 * The literal "Vote Details" fallback title + vote-cast-drawer-error block are NOT covered: they
 * require listVote=null with a failed detail fetch, and neither host can produce that — the votes
 * dashboard always passes listVote (catchError falls back to it), and the dashboard-cast-drawer-host
 * path pre-fetches through the same 10s shareReplay cache (a prefetch failure shows a toast and
 * never opens the drawer).
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import { LENS_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, Route, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const PROJECT_UID = 'p0000000-0000-0000-0000-00000000c501';
const PROJECT_SLUG = 'cast-drawer-e2e-project';
const PROJECT_NAME = 'Cast Drawer E2E Project';
const VOTE_UID = 'v0000000-0000-0000-0000-00000000c501';
const VOTE_NAME = 'Steering Committee Ratification';

const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Manually gated response so the loading state stays asserted-while-pending instead of racing the fetch. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Me-lens row as decorated by the my-votes BFF — ACTIVE + AWAITING_RESPONSE is what routes the row click to the cast drawer. */
function buildMyVoteRow() {
  return {
    uid: VOTE_UID,
    name: VOTE_NAME,
    description: `${VOTE_NAME} — vote-cast-drawer spec fixture`,
    status: 'active',
    response_status: 'awaiting_response',
    project_uid: PROJECT_UID,
    project_slug: PROJECT_SLUG,
    project_name: PROJECT_NAME,
    is_foundation: false,
    poll_type: 'generic',
    allow_abstain: false,
    creation_time: '2099-05-01T00:00:00Z',
    end_time: '2099-06-01T18:00:00Z',
  };
}

/** Detail payload (GET /api/votes/:uid) — the row plus the ballot questions the list payload omits. */
function buildVoteDetail() {
  return {
    ...buildMyVoteRow(),
    poll_questions: [
      {
        question_id: 'q1',
        prompt: 'Approve the amended charter?',
        type: 'single_choice',
        choices: [
          { choice_id: 'c1', choice_text: 'Approve' },
          { choice_id: 'c2', choice_text: 'Reject' },
        ],
      },
    ],
    poll_comment_prompts: [],
  };
}

async function seedMeLens(page: Page): Promise<void> {
  await page.context().addCookies([{ name: LENS_COOKIE_KEY, value: 'me', domain: 'localhost', path: '/', sameSite: 'Lax' }]);
}

async function stubShellFeeds(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, { personas: ['contributor'], personaProjects: {}, projects: [], organizations: [], isRootWriter: false })
  );
  // Without stubbed lens items the app loads the TEST ACCOUNT'S REAL foundations/projects and
  // NavigationService.applyDefaultSelection overrides the stubbed Me-lens context mid-test.
  await page.route('**/api/nav/lens-items*', (route) =>
    fulfillJson(route, {
      items: [{ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, logoUrl: null, isFoundation: false }],
      next_page_token: null,
      upstream_failed: false,
      lens: 'me',
    })
  );
  await page.route('**/api/committees/my-committee-uids*', (route) => fulfillJson(route, []));
  await page.route('**/api/committees*', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== '/api/committees') return route.fallback();
    return fulfillJson(route, []);
  });
}

/**
 * Stubs the Me-lens my-votes feed with a single active/awaiting row, plus empty list/count feeds
 * for the non-Me pipeline. A Playwright `*` glob does not cross `/`, so `**\/api\/votes*` would
 * NOT match `/api/votes/my-votes` — the list/count feed uses a RegExp and my-votes its own route.
 * Both register FIRST so the per-test detail route (registered before gotoMyVotes runs, i.e.
 * consulted after these) still wins — Playwright consults routes in reverse registration order.
 */
async function stubMyVotesFeed(page: Page): Promise<void> {
  await page.route(/\/api\/votes(\/count)?(\?.*)?$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/votes/count') {
      return fulfillJson(route, { count: 0 });
    }
    return fulfillJson(route, { data: [], total: 0, page_size: 0, next_page_token: null });
  });
  await page.route('**/api/votes/my-votes*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfillJson(route, [buildMyVoteRow()]);
  });
}

/** Boots the Me-lens votes dashboard with the castable row rendered. */
async function gotoMyVotes(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await seedMeLens(page);
  await stubShellFeeds(page);
  await stubMyVotesFeed(page);

  await page.goto('/votes', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId(`votes-cast-${VOTE_UID}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

test.describe('Vote cast drawer — always-visible header (GH-2350)', () => {
  test('keeps the header and close button visible while the detail loads, then renders the ballot', async ({ page }) => {
    const gate = deferred<null>();
    await page.route(`**/api/votes/${VOTE_UID}`, async (route) => {
      await gate.promise;
      return fulfillJson(route, buildVoteDetail());
    });
    await gotoMyVotes(page);

    await page.getByTestId(`votes-cast-${VOTE_UID}`).click();

    // GH-2350 regression shape: header (title from the list row) + close button render while the
    // detail request is still pending and the content area is skeletons.
    await expect(page.getByTestId('vote-cast-drawer-header')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('vote-cast-drawer-title')).toHaveText(VOTE_NAME);
    await expect(page.getByTestId('vote-cast-drawer-close')).toBeVisible();
    const content = page.getByTestId('vote-cast-drawer-content');
    await expect(content.locator('.p-skeleton').first()).toBeVisible();

    // Detail lands → the ballot swaps in and the skeletons clear; the header never re-mounts.
    gate.resolve(null);
    await expect(page.getByTestId('vote-cast-question-q1')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(content.locator('.p-skeleton')).toHaveCount(0);
    await expect(page.getByTestId('vote-cast-drawer-title')).toHaveText(VOTE_NAME);
    await expect(page.getByTestId('vote-cast-submit-button')).toBeVisible();
  });

  test('closes from the header close button while the detail request is still pending', async ({ page }) => {
    const gate = deferred<null>();
    await page.route(`**/api/votes/${VOTE_UID}`, async (route) => {
      await gate.promise;
      return fulfillJson(route, buildVoteDetail());
    });
    await gotoMyVotes(page);

    await page.getByTestId(`votes-cast-${VOTE_UID}`).click();
    await expect(page.getByTestId('vote-cast-drawer-header')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // The original bug: the close button only existed once vote data loaded, so this click was
    // impossible while the request was in flight.
    await page.getByTestId('vote-cast-drawer-close').click();
    await expect(page.getByTestId('vote-cast-drawer-header'), 'drawer should close mid-load').toBeHidden({ timeout: ELEMENT_TIMEOUT });

    // Let the in-flight request settle against the already-closed drawer (no crash, no reopen).
    gate.resolve(null);
    await expect(page.getByTestId('vote-cast-drawer-header')).toBeHidden({ timeout: ELEMENT_TIMEOUT });
  });

  test('keeps the header and close button when the detail request fails', async ({ page }) => {
    await page.route(`**/api/votes/${VOTE_UID}`, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await gotoMyVotes(page);

    await page.getByTestId(`votes-cast-${VOTE_UID}`).click();

    // catchError falls back to the list-row data: the header (title + close) must survive the
    // upstream failure; the row carries no questions, so the no-questions fallback renders.
    await expect(page.getByTestId('vote-cast-drawer-header')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('vote-cast-drawer-title')).toHaveText(VOTE_NAME);
    await expect(page.getByTestId('vote-cast-drawer-close')).toBeVisible();
    await expect(page.getByTestId('vote-cast-drawer-no-questions')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await page.getByTestId('vote-cast-drawer-close').click();
    await expect(page.getByTestId('vote-cast-drawer-header'), 'drawer should close after a failed load').toBeHidden({ timeout: ELEMENT_TIMEOUT });
  });
});
