// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Vote permalink — `/votes/:id` (#3659), rendered by the vote detail page (#3913, #3915).
 *
 * Coverage:
 *   - an unknown vote uid is a real upstream 404 (or a gateway 403): SSR answers HTTP 404 with the
 *     shared not-found card, in place, with the URL kept — a missing vote and a forbidden one look
 *     identical, so the page never confirms that a vote exists
 *   - the My Votes table's row "More" (⋮) menu offers Copy link
 *   - a view-only permalink shows the neutral non-participant panel on active and ended votes, with no
 *     ballot, tallies or results request (client-side navigation keeps synthetic vote requests
 *     inside page.route stubs)
 *
 * A forbidden-but-existing vote can't be faked end to end — `page.route` stubs don't intercept the
 * SSR fetch — so the 403 → not-found mapping is covered by vote-detail.component.spec.ts.
 *
 * The permalink path is hardcoded rather than built with `votePermalinkPath`: vote.utils.ts imports
 * @angular/forms, which this Node runtime can't load (.claude/rules/development-rules.md § Testing).
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import { LENS_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';

test.beforeEach(() => skipWhenAuthMissing());

const TEST_TIMEOUT = 60_000;
const RENDER_TIMEOUT = 30_000;

test.describe.configure({ timeout: TEST_TIMEOUT });

// UUID-shaped so it passes the BFF's uid validation and reaches the upstream, which has no such vote.
const UNKNOWN_VOTE_PATH = '/votes/00000000-0000-4000-8000-00000e3659ff';

const PROJECT_UID = 'p0000000-0000-0000-0000-00000000e659';
const PROJECT_SLUG = 'vote-permalink-e2e-project';
const PROJECT_NAME = 'Vote Permalink E2E Project';
const VOTE_UID = 'v0000000-0000-0000-0000-00000000e659';

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Me-lens row as decorated by the my-votes BFF. */
function buildMyVoteRow() {
  return {
    uid: VOTE_UID,
    name: 'Permalink Ratification',
    status: 'active',
    response_status: 'awaiting_response',
    project_uid: PROJECT_UID,
    project_slug: PROJECT_SLUG,
    project_name: PROJECT_NAME,
    is_foundation: false,
    poll_type: 'generic',
    creation_time: '2099-05-01T00:00:00Z',
    end_time: '2099-06-01T18:00:00Z',
  };
}

/** Boots the Me-lens votes dashboard with one stubbed active row (same stubs as vote-cast-drawer.spec.ts). */
async function gotoMyVotes(page: Page): Promise<void> {
  await page.context().addCookies([{ name: LENS_COOKIE_KEY, value: 'me', domain: 'localhost', path: '/', sameSite: 'Lax' }]);
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, { personas: ['contributor'], personaProjects: {}, projects: [], organizations: [], isRootWriter: false })
  );
  await page.route('**/api/nav/lens-items*', (route) =>
    fulfillJson(route, {
      items: [{ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, logoUrl: null, isFoundation: false }],
      next_page_token: null,
      upstream_failed: false,
      lens: 'me',
    })
  );
  await page.route('**/api/committees/my-committee-uids*', (route) => fulfillJson(route, []));
  await page.route(/\/api\/votes(\/count)?(\?.*)?$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/votes/count') return fulfillJson(route, { count: 0 });
    return fulfillJson(route, { data: [], total: 0, page_size: 0, next_page_token: null });
  });
  await page.route('**/api/votes/my-votes*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfillJson(route, [buildMyVoteRow()]);
  });

  // A hard navigation to /votes would seed the client with real SSR transfer-cache data,
  // bypassing these browser-only stubs. Enter the stubbed dashboard through the SPA router.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: RENDER_TIMEOUT });
  await page.evaluate(() => {
    window.history.pushState({}, '', '/votes');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

test.describe('Vote permalink (#3659)', () => {
  // Desktop width so the shell sidebar and the table's actions column are visible in every project.
  test.use({ viewport: { width: 1440, height: 900 } });

  test('SSR responds with HTTP 404 and the not-found card for an unknown vote', async ({ request }) => {
    const response = await request.get(UNKNOWN_VOTE_PATH);

    expect(response.status()).toBe(404);
    expect(await response.text()).toContain('not-found-card');
  });

  test('renders the not-found view in place, keeping the URL', async ({ page }) => {
    const response = await page.goto(UNKNOWN_VOTE_PATH, { waitUntil: 'domcontentloaded' });

    expect(response?.status()).toBe(404);
    await expect(page).toHaveURL(/\/votes\/00000000-0000-4000-8000-00000e3659ff$/);
    await expect(page.getByTestId('not-found-card')).toBeVisible({ timeout: RENDER_TIMEOUT });
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: RENDER_TIMEOUT });
  });

  test('offers Copy link in the row More menu on My Votes', async ({ page }) => {
    await gotoMyVotes(page);

    const more = page.getByTestId(`votes-more-${VOTE_UID}`);
    await expect(more).toBeVisible({ timeout: RENDER_TIMEOUT });
    await more.locator('button').click();

    await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible();
    // An active awaiting row opens an in-place ballot; the menu must trigger neither that nor navigation.
    await expect(page).not.toHaveURL(new RegExp(`/votes/${VOTE_UID}`));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('vote-cast-drawer-header')).toHaveCount(0);
  });

  for (const status of ['active', 'ended']) {
    test(`shows only basic vote information to a non-participant (${status})`, async ({ page }) => {
      const linkedVote = { ...buildMyVoteRow(), status, response_status: undefined, description: '<p>Review the proposed charter.</p>' };
      await page.route(`**/api/votes/${VOTE_UID}`, (route) => fulfillJson(route, linkedVote));
      await page.route(`**/api/votes/${VOTE_UID}/my-response`, (route) => route.fulfill({ status: 404, body: '{}' }));
      const resultsRequests: string[] = [];
      await page.route(`**/api/votes/${VOTE_UID}/results`, (route) => {
        resultsRequests.push(route.request().url());
        return fulfillJson(route, null);
      });
      await page.route(`**/api/projects/${PROJECT_SLUG}`, (route) =>
        fulfillJson(route, { uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, writer: false })
      );
      await gotoMyVotes(page);
      await expect(page.getByTestId(`votes-more-${VOTE_UID}`)).toBeVisible({ timeout: RENDER_TIMEOUT });

      // SPA navigation exercises the actual permalink route and the vote page without an SSR
      // request for this synthetic vote (page.route cannot intercept the server-side fetch).
      await page.evaluate((url) => {
        window.history.pushState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, `/votes/${VOTE_UID}`);

      await expect(page).toHaveURL(new RegExp(`/votes/${VOTE_UID}$`));
      await expect(page.getByRole('heading', { name: "You're not a voter on this vote", exact: true })).toBeVisible({ timeout: RENDER_TIMEOUT });
      await expect(page.getByTestId('vote-detail-voter-not-participant')).toBeVisible();
      await expect(page.getByTestId('vote-detail-header-title')).toHaveText(linkedVote.name);
      await expect(page.getByTestId('vote-detail-header-status')).toBeVisible();
      await expect(page.getByTestId('vote-detail-description')).toHaveCount(0);
      await expect(page.getByTestId('vote-detail-facts')).toHaveCount(0);
      for (const suffix of ['privacy', 'group', 'method', 'close-date', 'ended-early', 'invited', 'view-results', 'tabs']) {
        await expect(page.getByTestId(`vote-detail-header-${suffix}`)).toHaveCount(0);
      }
      await expect(page.getByTestId('vote-detail-voter-access-denied')).toHaveCount(0);
      await expect(page.getByTestId('vote-detail-header-cast-vote')).toHaveCount(0);
      await expect(page.getByTestId('vote-detail-voter-cast-vote')).toHaveCount(0);
      await expect(page.getByTestId('vote-detail-overview-results')).toHaveCount(0);
      await expect(page.getByTestId('vote-cast-drawer-header')).toHaveCount(0);
      expect(resultsRequests).toEqual([]);
    });
  }
});
