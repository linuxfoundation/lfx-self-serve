// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Vote cast drawer — always-visible header (GH-2350), opened from the vote page.
 *
 * The drawer's header (title + close button) is hoisted above the vote-data conditional so the
 * panel stays closable in EVERY state. The vote page (`/votes/:id`, #3913) is the drawer's host for
 * a voter awaiting their ballot: it auto-opens the drawer once the vote and the viewer's response row
 * load (#3915). Coverage:
 *   - auto-open: header, title, close button and the ballot render for an awaiting voter
 *   - close: the header close button dismisses the drawer and leaves the voter on the page, where
 *     the header's Cast vote action reopens it
 *
 * The page hands the drawer the full vote it already loaded, so the drawer never shows its
 * pending-detail skeleton or its detail-failure fallback here. Those null-`listVote` header states
 * are covered by vote-cast-drawer.component.spec.ts.
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

/** Me-lens row as decorated by the my-votes BFF — an ACTIVE vote awaiting the viewer's ballot. */
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
 * Stubs the vote page's reads for a voter awaiting their ballot: the vote detail, the viewer's
 * response row (what makes the page open the drawer) and a non-writer project, so the page
 * resolves the voter view.
 */
async function stubAwaitingVoter(page: Page): Promise<void> {
  await page.route(`**/api/votes/${VOTE_UID}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfillJson(route, buildVoteDetail());
  });
  await page.route(`**/api/votes/${VOTE_UID}/my-response`, (route) =>
    fulfillJson(route, { uid: 'r0000000-0000-0000-0000-00000000c501', vote_uid: VOTE_UID, vote_status: 'awaiting_response' })
  );
  await page.route(`**/api/projects/${PROJECT_SLUG}*`, (route) =>
    fulfillJson(route, { uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, writer: false })
  );
}

/**
 * Opens the vote page for the stubbed vote. Enters through the SPA router: a hard navigation to
 * /votes/:id would fetch the synthetic vote during SSR, which page.route cannot intercept.
 */
async function gotoVotePage(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await seedMeLens(page);
  await stubShellFeeds(page);
  await stubAwaitingVoter(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/votes/${VOTE_UID}`);
  await expect(page.getByTestId('vote-detail-page')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

test.describe('Vote cast drawer — always-visible header (GH-2350)', () => {
  test('opens on the vote page for an awaiting voter with the header, close button and ballot', async ({ page }) => {
    await gotoVotePage(page);

    await expect(page.getByTestId('vote-cast-drawer-header')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('vote-cast-drawer-title')).toHaveText(VOTE_NAME);
    await expect(page.getByTestId('vote-cast-drawer-close')).toBeVisible();
    await expect(page.getByTestId('vote-cast-question-q1')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('vote-cast-submit-button')).toBeVisible();
  });

  test('closes from the header close button and reopens from the page Cast vote action', async ({ page }) => {
    await gotoVotePage(page);

    await expect(page.getByTestId('vote-cast-drawer-header')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await page.getByTestId('vote-cast-drawer-close').click();
    await expect(page.getByTestId('vote-cast-drawer-header'), 'drawer should close').toBeHidden({ timeout: ELEMENT_TIMEOUT });
    await expect(page).toHaveURL(new RegExp(`/votes/${VOTE_UID}$`));
    await expect(page.getByTestId('vote-detail-page')).toBeVisible();

    await page.getByTestId('vote-detail-header-cast-vote').getByRole('button').click();
    await expect(page.getByTestId('vote-cast-drawer-header')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('vote-cast-question-q1')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });
});
