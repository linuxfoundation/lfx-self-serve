// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Login-free voting from a personalized vote link (#4363): `/votes/:id#vote_token=...` renders a ballot for an
 * anonymous visitor, submits it with the token in the request body only, and never puts the token in a URL.
 *
 * Coverage (mobile-chrome, 390x844, and desktop):
 *   - anonymous visit with a fragment token -> ballot renders, no login redirect, the fragment is dropped from the
 *     address bar, Submit calls POST /public/api/votes/link-responses with the token in the body and in no URL
 *   - an already-voted ballot offers an update and saves with PUT
 *   - a tampered token (upstream 404) -> the invalid-link state
 *   - no fragment -> today's behaviour (the authenticated permalink sends an anonymous visitor to login)
 *
 * Runs without a session: the saved storageState is cleared. Every public API call is stubbed with page.route; the
 * server never sees the fragment, so a hard navigation exercises the real client-side token path.
 *
 * Written even though the CI e2e job is disabled; `yarn e2e:check-collection` still guards that this file loads.
 * Only `@playwright/test` is imported: never the `utils` barrel (.claude/rules/development-rules.md § Testing).
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 */

import { expect, Page, Route, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 90_000 });

const RENDER_TIMEOUT = 30_000;
const VOTE_UID = 'v0000000-0000-0000-0000-00000000a363';
// A synthetic placeholder, never a real credential.
const TOKEN = 'v1.synthetic.e2e-token';

const BALLOT = {
  vote_uid: VOTE_UID,
  name: 'Synthetic vote-link e2e ballot',
  description: '<p>Synthetic description.</p>',
  status: 'active',
  end_time: '2099-01-01T00:00:00Z',
  poll_type: 'generic',
  allow_abstain: true,
  pseudo_anonymity: false,
  poll_questions: [
    {
      question_id: 'q1',
      prompt: 'Approve the synthetic proposal?',
      type: 'single_choice',
      choices: [
        { choice_id: 'c-yes', choice_text: 'Yes' },
        { choice_id: 'c-no', choice_text: 'No' },
      ],
    },
  ],
  ballot: { vote_status: 'awaiting_response', already_voted: false, voter_removed: false },
};

function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Stubs the public vote-link API and records every request URL and body the page sends. */
async function stubVoteLinks(page: Page, ballot: unknown = BALLOT, ballotStatus = 200) {
  const requests: { method: string; url: string; body: string | null }[] = [];
  await page.route('**/public/api/votes/link-ballot', (route) => {
    requests.push({ method: route.request().method(), url: route.request().url(), body: route.request().postData() });
    return fulfillJson(route, ballotStatus, ballotStatus === 200 ? ballot : { error: 'invalid voting link' });
  });
  await page.route('**/public/api/votes/link-responses', (route) => {
    requests.push({ method: route.request().method(), url: route.request().url(), body: route.request().postData() });
    return route.fulfill({ status: 204 });
  });
  return requests;
}

test.describe('Vote link ballot (anonymous)', () => {
  test('renders the ballot without a login redirect and submits with the token only in the body', async ({ page }) => {
    const requests = await stubVoteLinks(page);

    await page.goto(`/votes/${VOTE_UID}#vote_token=${TOKEN}`);

    await expect(page.getByTestId('vote-link-title')).toBeVisible({ timeout: RENDER_TIMEOUT });
    expect(page.url()).not.toContain('/login');
    expect(page.url()).toBe(new URL(`/votes/${VOTE_UID}`, page.url()).toString());

    await page.getByTestId('vote-link-choice-c-yes').click();
    await page.getByTestId('vote-link-submit-button').click();

    await expect(page.getByTestId('vote-link-submitted')).toBeVisible({ timeout: RENDER_TIMEOUT });

    const submit = requests.find((r) => r.url.endsWith('/link-responses'));
    expect(submit?.method).toBe('POST');
    expect(JSON.parse(submit?.body ?? '{}')).toMatchObject({ vote_token: TOKEN, abstain: false });
    for (const request of requests) {
      expect(request.url).not.toContain(TOKEN);
      expect(request.url).not.toContain('vote_token');
    }
  });

  test('offers an update for an already-voted ballot and saves with PUT', async ({ page }) => {
    const voted = {
      ...BALLOT,
      ballot: {
        vote_status: 'responded',
        already_voted: true,
        voter_removed: false,
        abstained: false,
        poll_answers: [
          { question_id: 'q1', prompt: 'Approve the synthetic proposal?', type: 'single_choice', user_choice: [{ choice_id: 'c-no', choice_text: 'No' }] },
        ],
      },
    };
    const requests = await stubVoteLinks(page, voted);

    await page.goto(`/votes/${VOTE_UID}#vote_token=${TOKEN}`);

    await expect(page.getByTestId('vote-link-update-prompt')).toBeVisible({ timeout: RENDER_TIMEOUT });
    await page.getByTestId('vote-link-update-button').click();
    await page.getByTestId('vote-link-submit-button').click();

    await expect(page.getByTestId('vote-link-updated')).toBeVisible({ timeout: RENDER_TIMEOUT });
    expect(requests.find((r) => r.url.endsWith('/link-responses'))?.method).toBe('PUT');
  });

  test('shows the invalid-link state for a tampered token', async ({ page }) => {
    await stubVoteLinks(page, null, 404);

    await page.goto(`/votes/${VOTE_UID}#vote_token=${TOKEN}tampered`);

    await expect(page.getByTestId('vote-link-invalid')).toBeVisible({ timeout: RENDER_TIMEOUT });
    await expect(page.getByTestId('vote-link-ballot-form')).toHaveCount(0);
  });

  test('has no horizontal scroll at 360x800', async ({ page }) => {
    await stubVoteLinks(page);
    await page.setViewportSize({ width: 360, height: 800 });

    await page.goto(`/votes/${VOTE_UID}#vote_token=${TOKEN}`);

    await expect(page.getByTestId('vote-link-title')).toBeVisible({ timeout: RENDER_TIMEOUT });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("keeps today's behaviour without a fragment: the authenticated permalink redirects an anonymous visitor to login", async ({ page }) => {
    const requests = await stubVoteLinks(page);

    await page.goto(`/votes/${VOTE_UID}`);

    await expect(page).toHaveURL(/\/login|auth0|\/auth/, { timeout: RENDER_TIMEOUT });
    expect(requests).toHaveLength(0);
  });
});
