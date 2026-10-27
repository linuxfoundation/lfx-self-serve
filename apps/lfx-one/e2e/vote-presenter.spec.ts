// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Vote presenter view — `/votes/:id/present` (#4140).
 *
 * Coverage:
 *   - a vote#writer opens the presenter, the count updates from polling, and when the vote ends the results
 *     render with `/results` requested only after the transition
 *   - a non-writer is redirected away and never sees the presenter
 *   - network loss shows "Reconnecting" with the last count kept, then recovers without a reload
 *   - the link-first share panel fits at 1920x1080, 1024x768 and a 390x844 phone with no horizontal scroll
 *
 * Every vote request is stubbed with page.route, so navigation goes through the SPA router (page.route cannot
 * intercept the server-side fetch of a hard navigation). axe runs on the open and ended states; the quorum state is
 * not rendered because quorum_percentage is absent from GET /votes/{uid} (#4140).
 *
 * These specs skip locally without TEST_USERNAME / TEST_PASSWORD (shared test credentials, see #4413) and are not
 * run in CI, so they have not been executed against a live server in this PR.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import { LENS_COOKIE_KEY } from '@lfx-one/shared/constants';
import AxeBuilder from '@axe-core/playwright';
import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.describe.configure({ timeout: 90_000 });

const RENDER_TIMEOUT = 30_000;
const POLL_TIMEOUT = 15_000;
const VOTE_UID = 'v0000000-0000-0000-0000-0000004140aa';
const PROJECT_UID = 'p0000000-0000-0000-0000-0000004140aa';

interface StubState {
  vote: Record<string, unknown>;
  writer: boolean;
  offline: boolean;
  resultsRequests: number;
}

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function buildVote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: VOTE_UID,
    name: 'Approve the 2027 budget',
    status: 'active',
    poll_type: 'generic',
    committee_name: 'Governing Board',
    project_uid: PROJECT_UID,
    creation_time: '2099-05-01T00:00:00Z',
    end_time: '2099-06-01T18:00:00Z',
    num_response_received: 2,
    total_voting_request_invitations: 10,
    allow_abstain: false,
    ...overrides,
  };
}

async function stubVote(page: Page, state: StubState): Promise<void> {
  // A predicate, not a glob: the guard's request carries ?include_writer=true, which a bare-path glob would not match.
  await page.route(
    (url) => url.pathname === `/api/votes/${VOTE_UID}`,
    (route) => {
      if (state.offline) return route.abort('failed');
      const wantsWriter = new URL(route.request().url()).searchParams.get('include_writer') === 'true';
      return fulfillJson(route, wantsWriter ? { ...state.vote, writer: state.writer } : state.vote);
    }
  );
  await page.route(`**/api/votes/${VOTE_UID}/results`, (route) => {
    state.resultsRequests += 1;
    return fulfillJson(route, { num_recipients: 10, num_votes_cast: 9, num_abstained: 0, generic_choice_votes: [] });
  });
}

/** Boots the app shell, then enters the presenter route through the SPA router. */
async function openPresenter(page: Page): Promise<void> {
  await page.context().addCookies([{ name: LENS_COOKIE_KEY, value: 'me', domain: 'localhost', path: '/', sameSite: 'Lax' }]);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: RENDER_TIMEOUT });
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/votes/${VOTE_UID}/present`);
}

test.describe('Vote presenter (#4140)', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('writer: count updates, then results render only after the vote ends', async ({ page }) => {
    const state: StubState = { vote: buildVote(), writer: true, offline: false, resultsRequests: 0 };
    await stubVote(page, state);
    await openPresenter(page);

    await expect(page.getByTestId('vote-presenter-count')).toHaveText('2 of 10 voters have cast', { timeout: RENDER_TIMEOUT });
    await expect(page.getByTestId('sidebar')).toHaveCount(0);
    await expect(page.getByTestId('vote-presenter-link')).toContainText(`/votes/${VOTE_UID}`);
    expect(state.resultsRequests).toBe(0);

    state.vote = buildVote({ num_response_received: 6 });
    await expect(page.getByTestId('vote-presenter-count')).toHaveText('6 of 10 voters have cast', { timeout: POLL_TIMEOUT });
    expect(state.resultsRequests).toBe(0);

    state.vote = buildVote({ status: 'ended', early_end_time: '2099-05-02T10:00:00Z', num_response_received: 9 });
    await expect(page.getByTestId('vote-presenter-result')).toBeVisible({ timeout: POLL_TIMEOUT });
    await expect(page.getByTestId('vote-presenter-banner')).toContainText('Vote ended');
    expect(state.resultsRequests).toBe(1);
  });

  test('axe: no violations on the open and ended states', async ({ page }) => {
    const state: StubState = { vote: buildVote(), writer: true, offline: false, resultsRequests: 0 };
    await stubVote(page, state);
    await openPresenter(page);
    await expect(page.getByTestId('vote-presenter-open')).toBeVisible({ timeout: RENDER_TIMEOUT });
    await expect(page.getByTestId('vote-qr').locator('path')).toHaveAttribute('d', /.+/, { timeout: RENDER_TIMEOUT });
    expect((await new AxeBuilder({ page }).include('[data-testid="vote-presenter"]').analyze()).violations).toEqual([]);

    state.vote = buildVote({ status: 'ended', num_response_received: 9 });
    await expect(page.getByTestId('vote-presenter-result')).toBeVisible({ timeout: POLL_TIMEOUT });
    expect((await new AxeBuilder({ page }).include('[data-testid="vote-presenter"]').analyze()).violations).toEqual([]);
  });

  test('zero eligible voters shows the empty state with only Exit', async ({ page }) => {
    const state: StubState = {
      vote: buildVote({ total_voting_request_invitations: 0, num_response_received: 0 }),
      writer: true,
      offline: false,
      resultsRequests: 0,
    };
    await stubVote(page, state);
    await openPresenter(page);

    await expect(page.getByTestId('vote-presenter-empty')).toContainText('No eligible voters are assigned to this vote', { timeout: RENDER_TIMEOUT });
    await expect(page.getByTestId('vote-presenter-close')).toHaveCount(0);
  });

  test('non-writer is redirected and never sees the presenter', async ({ page }) => {
    const state: StubState = { vote: buildVote(), writer: false, offline: false, resultsRequests: 0 };
    await stubVote(page, state);
    await openPresenter(page);

    await expect(page).not.toHaveURL(/\/present$/, { timeout: RENDER_TIMEOUT });
    await expect(page.getByTestId('vote-presenter')).toHaveCount(0);
    expect(state.resultsRequests).toBe(0);
  });

  test('network loss keeps the last count, shows Reconnecting, then recovers', async ({ page }) => {
    const state: StubState = { vote: buildVote(), writer: true, offline: false, resultsRequests: 0 };
    await stubVote(page, state);
    await openPresenter(page);
    await expect(page.getByTestId('vote-presenter-count')).toHaveText('2 of 10 voters have cast', { timeout: RENDER_TIMEOUT });

    state.offline = true;
    await expect(page.getByTestId('vote-presenter-reconnecting')).toBeVisible({ timeout: POLL_TIMEOUT });
    await expect(page.getByTestId('vote-presenter-count')).toHaveText('2 of 10 voters have cast');

    state.offline = false;
    state.vote = buildVote({ num_response_received: 4 });
    await expect(page.getByTestId('vote-presenter-reconnecting')).toHaveCount(0, { timeout: POLL_TIMEOUT * 2 });
    await expect(page.getByTestId('vote-presenter-count')).toHaveText('4 of 10 voters have cast');
  });

  for (const viewport of [
    { name: '1920x1080', width: 1920, height: 1080 },
    { name: '1024x768', width: 1024, height: 768 },
    { name: '390x844 phone', width: 390, height: 844 },
  ]) {
    test(`link-first share panel fits without horizontal scroll at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const state: StubState = { vote: buildVote(), writer: true, offline: false, resultsRequests: 0 };
      await stubVote(page, state);
      await openPresenter(page);

      await expect(page.getByTestId('vote-presenter-link')).toBeVisible({ timeout: RENDER_TIMEOUT });
      await expect(page.getByTestId('vote-presenter-copy-link')).toBeVisible();
      await expect(page.getByTestId('vote-qr')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
