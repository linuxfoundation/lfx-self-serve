// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Condorcet results (#5969): ballot loading/empty/unavailable states and long sticky candidate names.
 * Uses the real vote-detail route/templates with synthetic BFF reads; requires normal authenticated
 * Playwright storage state and a running app at baseURL. No vote is created or changed.
 */
import { LENS_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';

const VOTE_UID = '00000000-0000-4000-8000-000000005969';
const PROJECT_UID = '00000000-0000-4000-8000-000000005970';
const LONG_NAME = 'Candidate with a very long description '.repeat(5);
const RENDER_TIMEOUT = 30_000;

test.beforeEach(() => skipWhenAuthMissing());

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

async function stubResults(page: Page): Promise<void> {
  const choices = [
    { choice_id: 'choice-a', choice_text: LONG_NAME },
    { choice_id: 'choice-b', choice_text: 'Candidate B' },
  ];
  await page.route(
    (url) => url.pathname === `/api/votes/${VOTE_UID}`,
    (route) =>
      fulfillJson(route, {
        uid: VOTE_UID,
        name: 'Synthetic Condorcet election',
        status: 'ended',
        poll_type: 'condorcet_irv',
        pseudo_anonymity: false,
        writer: true,
        project_uid: PROJECT_UID,
        end_time: '2026-01-01T00:00:00Z',
        poll_questions: [{ question_id: 'question-1', prompt: 'Rank the candidates', type: 'single_choice', choices }],
        total_voting_request_invitations: 2,
        num_response_received: 0,
        allow_abstain: false,
      })
  );
  await page.route(
    (url) => url.pathname === `/api/projects/${PROJECT_UID}`,
    (route) => fulfillJson(route, { uid: PROJECT_UID, slug: 'synthetic-condorcet-project', name: 'Synthetic Condorcet Project', writer: true })
  );
  await page.route(`**/api/votes/${VOTE_UID}/results`, (route) =>
    fulfillJson(route, {
      num_recipients: 2,
      num_votes_cast: 0,
      num_abstained: 0,
      poll_end_time: '2026-01-01T00:00:00Z',
      comment_results: [],
      poll_results: [
        {
          question: { question_id: 'question-1', prompt: 'Rank the candidates', type: 'single_choice', choices },
          ranked_choice_votes: choices.map((choice, index) => ({
            choice_id: choice.choice_id,
            rank_counts: [
              { rank: 1, count: 0 },
              { rank: 2, count: 0 },
            ],
            condorcet_matrix: [
              {
                choice_id: choice.choice_id,
                other_choice_id: choices[1 - index].choice_id,
                choice_id_wins: 0,
                other_choice_id_wins: 0,
                result: '0(0)',
              },
            ],
          })),
          ranked_choice_winner_info: { poll_choices: [], condorcet_irv_used_for_eliminations: false },
        },
      ],
    })
  );
}

/** Enter via the SPA router: page.route cannot intercept SSR API reads on a hard navigation. */
async function openResults(page: Page, origin: string): Promise<void> {
  await page.context().addCookies([{ name: LENS_COOKIE_KEY, value: 'me', url: origin, sameSite: 'Lax' }]);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('main-content')).toBeVisible({ timeout: RENDER_TIMEOUT });
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/votes/${VOTE_UID}?tab=results`);
}

test.describe('Condorcet ballot result states', () => {
  test('shows loading, then the empty state, without falsely calling ballots unavailable', async ({ page, baseURL }) => {
    await stubResults(page);
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/votes/${VOTE_UID}/voters`, async (route) => {
      await ready;
      await fulfillJson(route, []);
    });
    await openResults(page, new URL(baseURL!).origin);
    try {
      await expect(page.getByTestId('vote-condorcet-ballots-loading')).toHaveText('Loading ballot rankings…', { timeout: RENDER_TIMEOUT });
      await expect(page.getByTestId('vote-condorcet-ballots-unavailable')).toHaveCount(0);
    } finally {
      release();
    }
    await expect(page.getByTestId('vote-condorcet-ballots-empty')).toHaveText('No ranked ballots recorded yet.');
    await expect(page.getByTestId('vote-condorcet-ballots-loading')).toHaveCount(0);
    await expect(page.getByTestId('vote-condorcet-ballots').locator('table')).toHaveCount(0);
  });

  test('settles a failed ballot read with the unavailable note, not an empty or loading state', async ({ page, baseURL }) => {
    await stubResults(page);
    await page.route(`**/api/votes/${VOTE_UID}/voters`, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic ballot read unavailable' }),
      })
    );
    await openResults(page, new URL(baseURL!).origin);
    await expect(page.getByTestId('vote-condorcet-ballots-unavailable')).toHaveText("Ballot-by-ballot rankings aren't available for this vote.", {
      timeout: RENDER_TIMEOUT,
    });
    await expect(page.getByTestId('vote-condorcet-ballots-loading')).toHaveCount(0);
    await expect(page.getByTestId('vote-condorcet-ballots-empty')).toHaveCount(0);
  });

  test('keeps long candidate names and data accessible in both sticky tables at phone and desktop widths', async ({ page, baseURL }) => {
    await stubResults(page);
    await page.route(`**/api/votes/${VOTE_UID}/voters`, (route) => fulfillJson(route, []));
    await openResults(page, new URL(baseURL!).origin);
    await expect(page.getByTestId('vote-condorcet-ballots-empty')).toBeVisible({ timeout: RENDER_TIMEOUT });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      for (const id of ['vote-condorcet-pairwise', 'vote-condorcet-rank-summary']) {
        const section = page.getByTestId(id);
        await expect(section).toBeVisible();
        await expect.poll(() => section.locator('.overflow-x-auto').evaluate((element) => element.clientWidth)).toBeGreaterThan(0);
        await expect(section.locator('tbody th').first()).toContainText(LONG_NAME.trim());
        const metrics = await section.evaluate((element) => {
          const wrapper = element.querySelector('.overflow-x-auto') as HTMLElement;
          const name = element.querySelector('tbody th') as HTMLElement;
          const text = name.querySelector('span') as HTMLElement;
          wrapper.scrollLeft = wrapper.scrollWidth;
          return {
            wrapperWidth: wrapper.clientWidth,
            nameWidth: name.getBoundingClientRect().width,
            nameRight: name.getBoundingClientRect().right,
            wrapperRight: wrapper.getBoundingClientRect().right,
            wraps: getComputedStyle(text).whiteSpace === 'normal',
            textFits: text.scrollWidth <= text.clientWidth,
          };
        });
        expect(metrics.nameWidth).toBeLessThan(metrics.wrapperWidth);
        expect(metrics.nameRight).toBeLessThan(metrics.wrapperRight);
        expect(metrics.wraps).toBe(true);
        expect(metrics.textFits).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  });
});
