// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Voting on a phone (#4148) — the in-room QR path: a voter lands on /votes/:id, the cast drawer
 * opens as a full-height sheet, they pick one choice and submit.
 *
 * Coverage (mobile-chrome, 390x844; the no-overflow check also runs at 360x800):
 *   - /votes/:id -> cast drawer -> single choice -> Submit pinned in the footer -> submitted, for a
 *     generic, a majority and a meek_stv poll. Majority renders as single choice (#4075) and
 *     meek_stv is a ranked method, so its "single choice" is the default ranked order submitted as-is.
 *   - no horizontal scroll with the drawer open at 360 wide
 *   - My Votes renders cards, not table columns, and keeps the status tab counts visible
 *
 * The session is the saved Playwright storageState (the app needs a real session to SSR the shell);
 * every vote API is stubbed with page.route. The permalink is entered through the SPA router because
 * page.route cannot intercept the server-side fetch of a hard navigation.
 *
 * The only shared import is `@lfx-one/shared/constants`; never import the `utils` barrel here, since
 * vote.utils.ts pulls in @angular/forms, which this Node runtime can't load
 * (.claude/rules/development-rules.md § Testing).
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import { LENS_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';

test.beforeEach(() => skipWhenAuthMissing());

const RENDER_TIMEOUT = 30_000;

test.describe.configure({ timeout: 90_000 });

const PROJECT_UID = 'p0000000-0000-0000-0000-00000000a148';
const PROJECT_SLUG = 'vote-mobile-e2e-project';
const PROJECT_NAME = 'Vote Mobile E2E Project';
const VOTE_UID = 'v0000000-0000-0000-0000-00000000a148';
const RESPONSE_UID = 'r0000000-0000-0000-0000-00000000a148';

type PollTypeUnderTest = 'generic' | 'majority' | 'meek_stv';

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function buildMyVoteRow(pollType: PollTypeUnderTest) {
  return {
    uid: VOTE_UID,
    name: 'Approve the amended charter, including appendix B and the new governance section',
    description: '<p>Synthetic description for the mobile voting flow.</p>',
    status: 'active',
    response_status: 'awaiting_response',
    project_uid: PROJECT_UID,
    project_slug: PROJECT_SLUG,
    project_name: PROJECT_NAME,
    is_foundation: false,
    poll_type: pollType,
    allow_abstain: false,
    creation_time: '2099-05-01T00:00:00Z',
    end_time: '2099-06-01T18:00:00Z',
  };
}

function buildVoteDetail(pollType: PollTypeUnderTest) {
  return {
    ...buildMyVoteRow(pollType),
    poll_questions: [
      {
        question_id: 'q1',
        prompt: 'Do you approve the amended charter as written, with no further changes to the governance section?',
        type: 'single_choice',
        choices: [
          { choice_id: 'c1', choice_text: 'Approve the amended charter as written, with no further changes' },
          { choice_id: 'c2', choice_text: 'Reject' },
          { choice_id: 'c3', choice_text: 'Defer to the next meeting' },
        ],
      },
    ],
    poll_comment_prompts: [],
  };
}

async function stubVoteApis(page: Page, pollType: PollTypeUnderTest): Promise<{ posted: unknown[] }> {
  const posted: unknown[] = [];
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
    // The object shape carries `complete: true`; the legacy bare array would suppress the status counts.
    return fulfillJson(route, { votes: [buildMyVoteRow(pollType)], complete: true });
  });
  await page.route(`**/api/votes/${VOTE_UID}`, (route) => fulfillJson(route, buildVoteDetail(pollType)));
  await page.route(`**/api/votes/${VOTE_UID}/my-response`, (route) =>
    fulfillJson(route, { uid: RESPONSE_UID, vote_uid: VOTE_UID, vote_status: 'awaiting_response' })
  );
  await page.route('**/api/votes/responses', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posted.push(route.request().postDataJSON());
    return fulfillJson(route, {});
  });
  return { posted };
}

/** Enters the app through the stubbed shell, then navigates client-side so every vote request hits a stub. */
async function openApp(page: Page, path: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com|sso\.linuxfoundation\.org/);
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(0);
}

test.describe('Mobile voting flow (#4148)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const pollType of ['generic', 'majority', 'meek_stv'] as const) {
    test(`/votes/:id -> cast drawer -> choose -> submit (${pollType})`, async ({ page }) => {
      const { posted } = await stubVoteApis(page, pollType);
      await openApp(page, `/votes/${VOTE_UID}`);

      await expect(page.getByTestId('vote-cast-question-q1')).toBeVisible({ timeout: RENDER_TIMEOUT });

      // Submit is pinned in the footer: visible without scrolling the ballot, inside the viewport.
      const submit = page.getByTestId('vote-cast-submit-button');
      await expect(submit).toBeVisible();
      const box = await submit.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(844);
      expect(box!.height).toBeGreaterThanOrEqual(44);

      if (pollType === 'meek_stv') {
        // Ranked ballot: per-row arrow buttons are the touch path; the default order is already submittable.
        await expect(page.getByTestId('vote-cast-rank-up-c2')).toBeVisible();
        await page.getByTestId('vote-cast-rank-up-c2').click();
      } else {
        // generic and majority both render radios (majority is single choice, #4075).
        await expect(page.getByTestId('vote-cast-rank-c1')).toHaveCount(0);
        await page.getByTestId('vote-cast-choice-c1').locator('label').click();
      }

      await expect(submit).toBeEnabled();
      await submit.click();

      await expect(page.getByText('Vote submitted')).toBeVisible({ timeout: RENDER_TIMEOUT });
      await expect(page.getByTestId('vote-cast-drawer-header')).toBeHidden();
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({ vote_uid: VOTE_UID, vote_response_uid: RESPONSE_UID, abstain: false });
    });
  }

  test('My Votes renders cards and keeps status tab counts visible', async ({ page }) => {
    await stubVoteApis(page, 'generic');
    await openApp(page, '/votes');

    await expect(page.getByTestId(`votes-card-${VOTE_UID}`)).toBeVisible({ timeout: RENDER_TIMEOUT });
    await expect(page.getByTestId('votes-status-tabs')).toBeVisible();
    // Counts are the point of "stay visible": both pills show (1) and sit inside the phone viewport.
    for (const [pill, label] of [
      ['filter-pill-all', /^All\s*\(1\)$/],
      ['filter-pill-active', /^Active\s*\(1\)$/],
    ] as const) {
      const locator = page.getByTestId(pill);
      await expect(locator).toHaveText(label);
      const box = await locator.boundingBox();
      expect(box, `${pill} must be laid out`).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }
    await expect(page.locator('lfx-votes-table thead th')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('Mobile voting at 360 wide (#4148)', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('cast drawer and My Votes have no horizontal scroll', async ({ page }) => {
    await stubVoteApis(page, 'generic');
    await openApp(page, '/votes');
    await expect(page.getByTestId(`votes-card-${VOTE_UID}`)).toBeVisible({ timeout: RENDER_TIMEOUT });
    await expectNoHorizontalScroll(page);

    await page.getByTestId(`votes-cast-${VOTE_UID}`).click();
    await expect(page.getByTestId('vote-cast-question-q1')).toBeVisible({ timeout: RENDER_TIMEOUT });
    await expectNoHorizontalScroll(page);
    // The outer drawer can report zero overflow while its scrolling content region still overflows, so check both scrollports.
    const overflow = await page.evaluate(() => {
      const drawer = document.querySelector('.vote-cast-drawer') as HTMLElement;
      const content = drawer.querySelector('.p-drawer-content') as HTMLElement;
      return { drawer: drawer.scrollWidth - drawer.clientWidth, content: content.scrollWidth - content.clientWidth };
    });
    expect(overflow.drawer, 'drawer root must not overflow horizontally').toBeLessThanOrEqual(0);
    expect(overflow.content, 'drawer content scrollport must not overflow horizontally').toBeLessThanOrEqual(0);
  });
});
