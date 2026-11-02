// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Votes table row menu: Close vote (#4740), through the project route with synthetic BFF reads.
 * Requires the normal Playwright authenticated storage state and a running app at baseURL.
 * Not run in CI (e2e job disabled); collected by `yarn e2e:check-collection`.
 */
import { LENS_COOKIE_KEY, PERSONA_COOKIE_KEY, SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, Route, test } from '@playwright/test';

const PROJECT_UID = 'p0000000-0000-0000-0000-000000004740';
const PROJECT_SLUG = 'synthetic-votes-close';
const PROJECT_NAME = 'Synthetic Votes Close';
const VOTE_UID = 'v0000000-0000-0000-0000-000000004740';
const PAGE_LOAD_TIMEOUT = 20_000;

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function vote(status: string): Record<string, unknown> {
  return {
    uid: VOTE_UID,
    name: 'Approve the 2027 budget',
    status,
    poll_type: 'generic',
    committee_name: 'Governing Board',
    project_uid: PROJECT_UID,
    creation_time: '2099-05-01T00:00:00Z',
    end_time: '2099-06-01T18:00:00Z',
    num_response_received: 2,
    total_voting_request_invitations: 10,
    writer: true,
  };
}

async function seed(page: Page, origin: string): Promise<void> {
  await page.context().addCookies([
    { name: LENS_COOKIE_KEY, value: 'project', url: origin, sameSite: 'Lax' },
    {
      name: PERSONA_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ primary: 'executive-director', all: ['executive-director'] })),
      url: origin,
      sameSite: 'Lax',
    },
    {
      name: SELECTED_PROJECT_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME })),
      url: origin,
      sameSite: 'Lax',
    },
  ]);
}

async function stub(page: Page, state: { status: string; endRequests: number; endStatus: number }): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true })
  );
  await page.route('**/api/nav/lens-items*', (route) => {
    const lens = new URL(route.request().url()).searchParams.get('lens');
    const items = lens === 'project' ? [{ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, isFoundation: false, logoUrl: null }] : [];
    return fulfillJson(route, { items, next_page_token: null, upstream_failed: false, lens });
  });
  await page.route(`**/api/projects/${PROJECT_SLUG}*`, (route) =>
    fulfillJson(route, { uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, parent_uid: '', writer: true })
  );
  await page.route('**/api/projects/*/sfid*', (route) => fulfillJson(route, { sfid: null }));
  await page.route('**/api/committees/my-committee-uids*', (route) => fulfillJson(route, []));
  await page.route('**/api/committees?*', (route) => fulfillJson(route, []));
  await page.route(`**/api/votes/${VOTE_UID}/end`, (route) => {
    state.endRequests += 1;
    if (state.endStatus !== 200) return fulfillJson(route, { error: 'poll has not started' }, state.endStatus);
    state.status = 'ended';
    return fulfillJson(route, vote('ended'));
  });
  await page.route(
    (url) => url.pathname === '/api/votes' || url.pathname.startsWith('/api/votes/'),
    (route) => {
      switch (new URL(route.request().url()).pathname) {
        case '/api/votes':
          return fulfillJson(route, { data: [vote(state.status)], total_records: 1 });
        case '/api/votes/count':
          return fulfillJson(route, { count: 1 });
        case '/api/votes/summary':
          return fulfillJson(route, { active_votes: 1, closing_soon: 0, as_of: '2026-10-18T12:00:00Z' });
        case '/api/votes/status-counts':
          return fulfillJson(route, { all: 1, active: state.status === 'active' ? 1 : 0, disabled: 0, ended: state.status === 'ended' ? 1 : 0 });
        case '/api/votes/my-votes':
          return fulfillJson(route, { votes: [], complete: true });
        default:
          return route.fallback();
      }
    }
  );
}

async function openVotes(page: Page, origin: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  await seed(page, origin);
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/votes?project=${PROJECT_SLUG}`);
}

test.describe('Votes table: Close vote from the row menu (#4740)', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test.beforeEach(() => {
    if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  });

  test('asks first, then ends the vote and the row leaves the active state', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const state = { status: 'active', endRequests: 0, endStatus: 200 };
    await seed(page, origin);
    await stub(page, state);
    await openVotes(page, origin);

    await page.getByTestId(`votes-more-${VOTE_UID}`).getByRole('button').click({ timeout: PAGE_LOAD_TIMEOUT });
    await page.getByRole('menuitem', { name: 'Close vote' }).click();
    await expect(page.getByText('Close the vote now? Members can no longer cast or change ballots.')).toBeVisible();
    expect(state.endRequests).toBe(0);

    await page.getByRole('alertdialog', { name: 'Close vote' }).getByRole('button', { name: 'Close vote' }).click();

    await expect(page.getByText('Vote closed')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    expect(state.endRequests).toBe(1);
    await page.getByTestId(`votes-more-${VOTE_UID}`).getByRole('button').click();
    await expect(page.getByRole('menuitem', { name: 'Close vote' })).toHaveCount(0);
  });

  test('a rejected close shows the upstream message and keeps Close available', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const state = { status: 'active', endRequests: 0, endStatus: 409 };
    await seed(page, origin);
    await stub(page, state);
    await openVotes(page, origin);

    await page.getByTestId(`votes-more-${VOTE_UID}`).getByRole('button').click({ timeout: PAGE_LOAD_TIMEOUT });
    await page.getByRole('menuitem', { name: 'Close vote' }).click();
    await page.getByRole('alertdialog', { name: 'Close vote' }).getByRole('button', { name: 'Close vote' }).click();

    await expect(page.getByText('poll has not started')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await page.getByTestId(`votes-more-${VOTE_UID}`).getByRole('button').click();
    await expect(page.getByRole('menuitem', { name: 'Close vote' })).toBeVisible();
  });
});
