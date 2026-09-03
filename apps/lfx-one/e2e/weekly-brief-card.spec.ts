// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * WG Weekly Brief — AI Assistant Card E2E Tests
 *
 * Covers the AI Assistant card mounted on committee-overview:
 * - Feature-flag gating (wg-weekly-brief OFF → card hidden; paired with a positive
 *   control proving the same fixture renders when LD is reachable)
 * - Empty state render + Generate action, and its disabled state once the weekly
 *   generate quota is exhausted
 * - Generated state render (header, throttle badge, action buttons)
 * - Edit → Save round-trip (PUT request shape + UI re-render to `edited`)
 * - Generate-from-empty: POST (202/generating) → poll GET /current → re-render to
 *   `generated` — upstream's generate call is async, not a completed brief in the
 *   POST response (see weekly-brief.service.ts on the BFF)
 * - A page load landing directly on an already-`generating` brief (no POST from this
 *   tab) also polls to terminal on its own
 * - Read-failure → retryable unavailable state → recovery
 * - Sources chips (LFXV2-3044): no row when source_refs is empty; one chip per ref with a
 *   kind-appropriate label/icon; meeting/vote/members chips click through (meeting-join route /
 *   vote drawer / Members tab); mailing-list and unrecognized-kind chips render unlinked (no
 *   click target)
 * - Sources disclosure & dedupe (LFXV2-3335): the row collapses behind a click-to-expand
 *   "Sources (N)" toggle once raw source_refs count exceeds the collapse threshold; refs
 *   sharing the same (kind, label) collapse into one count-badged chip that expands into
 *   its individually-clickable, ordinally-labeled instances
 *
 * Architecture notes (mirrors repo convention):
 * - API mocking is per-spec via `page.route()` (see org-membership-documentation.spec.ts
 *   for the same pattern).
 * - Authentication is captured once by global-setup and reused via storageState
 *   (see helpers/global-setup.ts).
 * - The repo has no e2e LaunchDarkly override helper. For the flag-ON tests we mock
 *   only the WG weekly-brief endpoints and rely on the `wg-weekly-brief` LD flag being
 *   ON in the dev environment (mirroring how org-membership-documentation.spec.ts relies
 *   on the `org-lens-enabled` flag being ON — see that file's header).
 *   For the flag-OFF test we block the LaunchDarkly SDK endpoints so OpenFeature's
 *   provider fails to initialize and the flag falls back to its `false` default
 *   (see feature-flag.service.ts:getBooleanFlag — returns `defaultValue` when the
 *   client isn't initialized).
 *
 * Prerequisites:
 * - Dev server running on localhost:4200 (auto via Playwright webServer)
 * - User authenticated via Auth0 (auto via global-setup, .env credentials)
 * - `wg-weekly-brief` LaunchDarkly flag ON in the dev environment (for the
 *   flag-ON tests below — the flag-OFF test forces the provider to fail)
 */

import { expect, Page, Route, test } from '@playwright/test';
import { WEEKLY_BRIEF_ERROR_REASON, WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD } from '@lfx-one/shared/constants';
import { CommitteeMemberRole, PollStatus } from '@lfx-one/shared/enums';
import {
  Committee,
  ShareWeeklyBriefResult,
  Vote,
  VoteResultsResponse,
  WeeklyBrief,
  WeeklyBriefCurrentResponse,
  WeeklyBriefThrottle,
} from '@lfx-one/shared/interfaces';

const TEST_COMMITTEE_UID = 'wb-card-e2e-committee-uid';
// Committees are mounted under /groups, not /committees (see committee-about.helper.ts's
// gotoCommitteeTab and app.routes.ts's `path: 'groups'` registration).
const COMMITTEE_URL = `/groups/${TEST_COMMITTEE_UID}`;
const DATA_LOAD_TIMEOUT = 30_000;

test.setTimeout(60_000);

// ─────────────────────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_THROTTLE: WeeklyBriefThrottle = {
  generates_used: 0,
  generates_limit: 2,
  regenerations_used: 0,
  regenerations_limit: 3,
  window_resets_at: '2026-05-31T00:00:00.000Z',
};

const GENERATED_BRIEF: WeeklyBrief = {
  uid: 'brief-uid-1',
  committee_uid: TEST_COMMITTEE_UID,
  window_start: '2026-05-17T00:00:00.000Z',
  window_end: '2026-05-23T23:59:59.000Z',
  state: 'generated',
  brief_text: 'This week the TSC discussed the v2 roadmap, ratified two proposals, and welcomed one new member.',
  source_refs: [],
  prompt_version: 'v1',
  model: 'claude-opus',
  regeneration_count: 0,
  private_source_present: false,
  created_at: '2026-05-22T12:00:00.000Z',
  updated_at: '2026-05-22T12:00:00.000Z',
  revision: 1,
};

const USED_THROTTLE_AFTER_GENERATE: WeeklyBriefThrottle = {
  ...DEFAULT_THROTTLE,
  generates_used: 1,
};

// Covers every kind lfx-v2-committee-service's group_weekly_brief_generator.go actually
// emits today (meeting, mailing-list, vote, members) and an unrecognized kind — the
// open-string fallback a future upstream value must not break. Exactly 5 refs, all with
// distinct (kind, label) pairs — at WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD, so this fixture
// renders flat with no disclosure toggle and no dedupe grouping (see the dedicated "Sources
// disclosure & dedupe (LFXV2-3335)" describe block below for the >threshold / grouped case,
// including "doc" kind coverage via BRIEF_WITH_MANY_SOURCES).
const BRIEF_WITH_SOURCES: WeeklyBrief = {
  ...GENERATED_BRIEF,
  source_refs: [
    { id: 'src-meeting-1', kind: 'meeting', title: 'Weekly Sync' },
    { id: 'src-ml-1', kind: 'mailing-list', title: 'tsc-discuss' },
    { id: 'src-vote-1', kind: 'vote', title: 'Q1 Budget' },
    // Upstream always sets this exact title for "members" — asserted verbatim below rather
    // than the SOURCE_REF_DEFAULT_LABELS fallback, which production never actually renders.
    { id: 'src-members-1', kind: 'members', title: 'Member roster changes' },
    { id: 'src-unknown-1', kind: 'some_future_kind' },
  ],
};
// Fails loudly at collection time, not with an opaque "element not found" from every test
// using this fixture, if WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD ever changes.
if (BRIEF_WITH_SOURCES.source_refs.length !== WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD) {
  throw new Error(
    `BRIEF_WITH_SOURCES must have exactly WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD (${WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD}) source_refs to stay at the flat-render threshold — update this fixture (add/remove a distinct-label ref) to match.`
  );
}

// Two distinct vote refs — for the concurrent-click race test only (PR #1363 review: Copilot,
// Cursor Bugbot, and a human reviewer all independently caught that a single in-flight boolean
// let an earlier fetch's late response overwrite a newer, already-open selection).
const BRIEF_WITH_TWO_VOTES: WeeklyBrief = {
  ...GENERATED_BRIEF,
  source_refs: [
    { id: 'src-vote-1', kind: 'vote', title: 'Q1 Budget' },
    { id: 'src-vote-2', kind: 'vote', title: 'Q2 Budget' },
  ],
};

// Duplicate-label meeting refs (recurring-meeting instances) alongside distinct-kind refs —
// 7 total, over WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD — covering both halves of LFXV2-3335:
// the disclosure gating the row above the threshold, and same-(kind, label) refs collapsing
// into one count-badged, ordinally-labeled group. Also the only fixture covering "doc" — moved
// here from BRIEF_WITH_SOURCES so that fixture could stay exactly at the collapse threshold.
const BRIEF_WITH_MANY_SOURCES: WeeklyBrief = {
  ...GENERATED_BRIEF,
  source_refs: [
    { id: 'src-tc-1', kind: 'meeting', title: 'AAIF Technical Committee Meeting' },
    { id: 'src-tc-2', kind: 'meeting', title: 'AAIF Technical Committee Meeting' },
    { id: 'src-tc-3', kind: 'meeting', title: 'AAIF Technical Committee Meeting' },
    { id: 'src-vote-1', kind: 'vote', title: 'Q1 Budget' },
    { id: 'src-members-1', kind: 'members', title: 'Member roster changes' },
    { id: 'src-ml-1', kind: 'mailing-list', title: 'tsc-discuss' },
    { id: 'src-doc-1', kind: 'doc', title: 'Charter.pdf' },
  ],
};
if (BRIEF_WITH_MANY_SOURCES.source_refs.length <= WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD) {
  throw new Error(
    `BRIEF_WITH_MANY_SOURCES must have more than WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD (${WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD}) source_refs to exercise the disclosure — update this fixture to match.`
  );
}

function buildCommitteeFixture(overrides: Partial<Committee> = {}): Committee {
  return {
    uid: TEST_COMMITTEE_UID,
    name: 'Weekly Brief Test WG',
    category: 'Working Group',
    enable_voting: false,
    public: true,
    sso_group_enabled: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-05-22T00:00:00.000Z',
    total_members: 5,
    total_voting_repos: 0,
    project_uid: 'project-uid-wb',
    writer: true,
    join_mode: 'open',
    // committee-overview wraps its whole "not a visitor" content block (including the
    // weekly-brief card) in @if (!isVisitor()), and isVisitor() is `myRole() === null`.
    // Without a my_role here the card never renders regardless of the flag or canEdit —
    // matches committee-about.helper.ts's buildBaseCommittee, which sets this too.
    my_role: CommitteeMemberRole.CHAIR,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mock the bare minimum committee-view endpoints so committee-overview renders
 * with `canEdit=true` and the weekly-brief card is reachable. Anything not
 * explicitly mocked here (lens, project context, mailing lists, etc.) is left
 * to the dev backend — the card only reads `committee.uid` and `canEdit`.
 */
async function mockCommitteeShell(page: Page, committeeOverrides: Partial<Committee> = {}): Promise<void> {
  await page.route(`**/api/committees/${TEST_COMMITTEE_UID}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCommitteeFixture(committeeOverrides)),
    });
  });

  await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/members*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/children`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // Documents / invites / mailing-lists — also called by committee-overview /
  // committee-view but unrelated to the card under test. Each already has its own
  // catchError fallback so an unmocked 404 wouldn't break rendering, which is exactly
  // why leaving them unmocked was easy to miss — they'd silently hit the live dev
  // backend on every run instead (matches committee-about.helper.ts's convention).
  await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/documents*`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/invites*`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/mailing-lists*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // Meetings / votes / surveys called by committee-overview — return empty
  // collections / zero counts so the page settles deterministically.
  await page.route(`**/api/meetings/count*`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0 }) });
  });
  // committee-overview calls MeetingService.getPastMeetingsByCommittee, which hits
  // /api/past-meetings — NOT /api/meetings (the glob below can't match it; `*` doesn't
  // cross `/` and there's no `/api/meetings` substring in the URL at all). Without this,
  // the request escapes every mock here and hits the live dev backend on every test run.
  await page.route(`**/api/past-meetings*`, async (route) => {
    if (route.request().method() === 'GET') {
      // Unwraps `.data` from a PaginatedResponse — a bare array leaves it `undefined` and
      // throws in [...this.meetings()] during CD (matches committee-about.helper.ts).
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      return;
    }
    await route.fallback();
  });
  await page.route(`**/api/meetings*`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      return;
    }
    await route.fallback();
  });
  await page.route(`**/api/votes*`, async (route) => {
    if (route.request().method() === 'GET') {
      // VoteService.getVotesByCommittee unwraps `.data` from a PaginatedResponse — same
      // envelope requirement as meetings above.
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      return;
    }
    await route.fallback();
  });
  await page.route(`**/api/surveys*`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    await route.fallback();
  });
}

/**
 * Mock GET /api/committees/:uid/weekly-briefs/current with a custom response.
 * Returns a handle to swap the response mid-test (e.g. after save/generate).
 */
async function mockCurrentBrief(page: Page, initial: WeeklyBriefCurrentResponse): Promise<{ setResponse: (next: WeeklyBriefCurrentResponse) => void }> {
  let current = initial;
  // Await the route registration so it's installed before any page.goto()
  // — `void page.route(...)` races with navigation and can leak through to
  // the network on fast runs. Trailing `*` on the glob (GH-1922) — the client now appends
  // `?includeCurrentActivity=...` to this exact URL (weekly-brief.service.ts's getWeeklyBrief),
  // and Playwright's route glob anchors against the full URL including the query string, so a
  // bare glob silently stops matching and every test using this mock falls through to the live
  // dev backend instead of the fixture.
  await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/current*`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(current),
    });
  });
  return {
    setResponse: (next: WeeklyBriefCurrentResponse) => {
      current = next;
    },
  };
}

/**
 * Mock POST /api/committees/:uid/weekly-briefs/share with a fixed status/body.
 */
async function mockShareBrief(
  page: Page,
  status: number,
  body: ShareWeeklyBriefResult | { error: string; code: string; errors?: { field: string; message: string; code: string }[] }
): Promise<void> {
  await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/share`, async (route) => {
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

/**
 * Mock POST/DELETE /api/committees/:uid/weekly-briefs/:briefUid/rating. `onRequest` receives
 * the intercepted route and decides how to fulfill it — kept generic (rather than a fixed
 * status/body like `mockShareBrief`) since the rating tests need different handling per HTTP
 * method (POST for rate, DELETE for clear) on the same URL.
 */
async function mockRating(page: Page, briefUid: string, onRequest: (route: Route) => Promise<void>): Promise<void> {
  await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/${briefUid}/rating`, onRequest);
}

/**
 * Block LaunchDarkly SDK traffic so the OpenFeature provider fails to initialize
 * inside the browser. With no provider, FeatureFlagService#getBooleanFlag returns
 * the supplied `defaultValue` (false for `wg-weekly-brief`). Net effect: the
 * card host wrapper does NOT render. See feature-flag.service.ts +
 * feature-flag.provider.ts.
 */
async function blockLaunchDarkly(page: Page): Promise<void> {
  const abort = (route: Route): Promise<void> => route.abort();
  await page.route('**/*.launchdarkly.com/**', abort);
  await page.route('**/events.launchdarkly.com/**', abort);
  await page.route('**/clientstream.launchdarkly.com/**', abort);
  await page.route('**/app.launchdarkly.com/**', abort);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('WG Weekly Brief card — feature-flag gating', () => {
  test('card is NOT rendered when wg-weekly-brief flag is OFF', async ({ page }) => {
    // Force OpenFeature provider initialization to fail → flag returns default (false).
    await blockLaunchDarkly(page);
    await mockCommitteeShell(page);

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    // If global-setup didn't pin auth state, the page redirects to Auth0's login screen
    // and every assertion below would just be validating the login page.
    await expect(page).not.toHaveURL(/auth0\.com/);

    // Wait for committee-overview to actually mount so the @if has had a chance
    // to evaluate — the stats grid is a stable signal that overview is rendered.
    await expect(page.getByTestId('committee-overview-stats')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // The host wrapper testid on the lfx-weekly-brief-card element must not appear.
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toHaveCount(0);
  });

  // Positive control for the OFF case above: same committee fixture, LaunchDarkly left
  // reachable (not blocked) — proves the card's absence above is actually caused by the
  // flag, not by a fixture/rendering issue that would hide it either way.
  test('card IS rendered for the same fixture when LaunchDarkly is reachable', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: null, throttle: DEFAULT_THROTTLE });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    // If global-setup didn't pin auth state, the page redirects to Auth0's login screen
    // and every assertion below would just be validating the login page.
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });
});

test.describe('WG Weekly Brief card — empty state (flag ON)', () => {
  test('renders empty state with Generate enabled and the "No brief yet" copy', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: null, throttle: DEFAULT_THROTTLE });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    // If global-setup didn't pin auth state, the page redirects to Auth0's login screen
    // and every assertion below would just be validating the login page.
    await expect(page).not.toHaveURL(/auth0\.com/);

    // The card wrapper appears once the flag resolves ON and canEdit is true.
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const emptyState = page.getByTestId('weekly-brief-card-empty-state');
    await expect(emptyState).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(emptyState).toContainText('No brief yet');

    const generateBtn = page.getByTestId('weekly-brief-card-generate-button');
    await expect(generateBtn).toBeVisible();
    // data-testid sits on the <lfx-button> host, not the native <button> PrimeNG
    // renders inside it — toBeEnabled() on the host is always true regardless of the
    // real [disabled] binding. Assert on the inner button instead.
    await expect(generateBtn.locator('button')).toBeEnabled();
  });

  test('Generate is disabled once the weekly generate quota is exhausted', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: null, throttle: { ...DEFAULT_THROTTLE, generates_used: DEFAULT_THROTTLE.generates_limit } });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    // If global-setup didn't pin auth state, the page redirects to Auth0's login screen
    // and every assertion below would just be validating the login page.
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('weekly-brief-card-empty-state')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const generateBtn = page.getByTestId('weekly-brief-card-generate-button');
    await expect(generateBtn.locator('button')).toBeDisabled();
  });
});

test.describe('WG Weekly Brief card — error states (flag ON)', () => {
  // LFXV2-3000: state:'error' + error_reason:NO_SOURCES means the committee had no
  // activity in the lookback window, not a real generation failure — regenerating can
  // never succeed and would only spend a regeneration slot, so this renders a calm empty
  // state with a quota-free "Check again" refresh instead of the quota-spending "Try
  // again" the generic failure state below uses.
  test('renders the quiet-week empty state, and "Check again" issues a plain GET without ever hitting the generate/regenerate endpoint', async ({ page }) => {
    await mockCommitteeShell(page);
    const briefMock = await mockCurrentBrief(page, {
      brief: { ...GENERATED_BRIEF, state: 'error', error_reason: WEEKLY_BRIEF_ERROR_REASON.NO_SOURCES },
      throttle: USED_THROTTLE_AFTER_GENERATE,
    });

    // If "Check again" ever regresses to firing a generate/regenerate call (spending a
    // throttle slot on a state a retry can never resolve), fail loudly instead of just
    // silently 404ing against an unmocked route.
    let generateCalled = false;
    await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/generate`, async (route) => {
      generateCalled = true;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected generate call' }) });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const quietWeekState = page.getByTestId('weekly-brief-card-quiet-week-state');
    await expect(quietWeekState).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(quietWeekState).toContainText('Quiet week');

    await expect(page.getByTestId('weekly-brief-card-error-state')).toHaveCount(0);
    await expect(page.getByTestId('weekly-brief-card-error-retry-button')).toHaveCount(0);

    // Swap the mocked GET to a visibly distinct state (generated, not quiet-week) before
    // clicking — asserting the card actually re-renders to it is a stronger proof of a
    // real re-fetch than waiting on the request alone (a stale DOM would still be showing
    // quiet-week either way), and it stays distinct from the generic failure state's
    // "Try again", which calls onGenerate() instead of this quota-free refresh.
    briefMock.setResponse({ brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });
    const responsePromise = page.waitForResponse(
      (res) => res.request().method() === 'GET' && res.url().includes(`/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/current`),
      { timeout: DATA_LOAD_TIMEOUT }
    );
    await page.getByTestId('weekly-brief-card-quiet-week-refresh-button').click();
    await responsePromise;

    await expect(page.getByTestId('weekly-brief-card-body')).toHaveText(GENERATED_BRIEF.brief_text, { timeout: DATA_LOAD_TIMEOUT });
    await expect(quietWeekState).toHaveCount(0);
    expect(generateCalled).toBe(false);
  });

  test('renders the generic failure state with a Try again button when error_reason is absent', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, {
      brief: { ...GENERATED_BRIEF, state: 'error' },
      throttle: USED_THROTTLE_AFTER_GENERATE,
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const errorState = page.getByTestId('weekly-brief-card-error-state');
    await expect(errorState).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(errorState).toContainText('Brief generation failed for this week.');

    await expect(page.getByTestId('weekly-brief-card-error-retry-button')).toBeVisible();
    await expect(page.getByTestId('weekly-brief-card-quiet-week-state')).toHaveCount(0);
  });

  // ai_error is the other documented upstream value (lfx-v2-committee-service
  // docs/indexer-contract.md; LFXV2-2989) — the genuinely retryable failure path,
  // unlike no_sources above. Pins that a real generation failure still renders the
  // failure card with an active retry, not the quiet-week treatment.
  test('renders the generic failure state with an enabled Try again for an ai_error', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, {
      brief: { ...GENERATED_BRIEF, state: 'error', error_reason: 'ai_error' },
      throttle: USED_THROTTLE_AFTER_GENERATE,
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await expect(page.getByTestId('weekly-brief-card-error-state')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('weekly-brief-card-quiet-week-state')).toHaveCount(0);

    const retryBtn = page.getByTestId('weekly-brief-card-error-retry-button');
    await expect(retryBtn).toBeVisible();
    await expect(retryBtn.locator('button')).toBeEnabled();
  });

  // Covers the open-enum fallback for a value upstream has never documented — distinct
  // from the ai_error case above, which pins a real contract value's behavior.
  test('renders the generic failure state (not quiet-week) for an unrecognized error_reason', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, {
      brief: { ...GENERATED_BRIEF, state: 'error', error_reason: 'some_future_upstream_value' },
      throttle: USED_THROTTLE_AFTER_GENERATE,
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await expect(page.getByTestId('weekly-brief-card-error-state')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('weekly-brief-card-quiet-week-state')).toHaveCount(0);
  });
});

test.describe('WG Weekly Brief card — generated state (flag ON)', () => {
  test('renders brief text, week label, throttle badge, and primary actions', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    // If global-setup didn't pin auth state, the page redirects to Auth0's login screen
    // and every assertion below would just be validating the login page.
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await expect(page.getByTestId('weekly-brief-card-body')).toHaveText(GENERATED_BRIEF.brief_text, { timeout: DATA_LOAD_TIMEOUT });

    // Week label "May 17 – May 23, 2026" — assert on the human format.
    await expect(page.getByText(/May\s+17/)).toBeVisible();
    await expect(page.getByText(/May\s+23,\s+2026/)).toBeVisible();

    // "Generated" state badge.
    await expect(page.getByTestId('weekly-brief-card-state-badge')).toHaveText('Generated');

    // Throttle text: "1/2 generates · 0/3 regenerations used this week"
    await expect(page.getByTestId('weekly-brief-card-throttle')).toContainText('1/2 generates');
    await expect(page.getByTestId('weekly-brief-card-throttle')).toContainText('0/3 regenerations');

    // All three primary action buttons are visible.
    await expect(page.getByTestId('weekly-brief-card-regenerate-button')).toBeVisible();
    await expect(page.getByTestId('weekly-brief-card-edit-button')).toBeVisible();
    await expect(page.getByTestId('weekly-brief-card-copy-button')).toBeVisible();
  });
});

test.describe('WG Weekly Brief card — Sources chips (flag ON)', () => {
  test('no Sources row renders when source_refs is empty', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('weekly-brief-card-body')).toHaveText(GENERATED_BRIEF.brief_text, { timeout: DATA_LOAD_TIMEOUT });

    await expect(page.getByTestId('weekly-brief-card-sources')).toHaveCount(0);
  });

  test('renders one chip per source ref, and mailing-list/unrecognized-kind chips are unlinked', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: BRIEF_WITH_SOURCES, throttle: USED_THROTTLE_AFTER_GENERATE });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    const sources = page.getByTestId('weekly-brief-card-sources');
    await expect(sources).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await expect(sources.getByTestId('weekly-brief-card-source-chip-src-meeting-1')).toContainText('Weekly Sync');
    await expect(sources.getByTestId('weekly-brief-card-source-chip-src-ml-1')).toContainText('tsc-discuss');
    await expect(sources.getByTestId('weekly-brief-card-source-chip-src-vote-1')).toContainText('Q1 Budget');
    // Upstream always sets this exact title for a "members" ref — never the "Members" default.
    await expect(sources.getByTestId('weekly-brief-card-source-chip-src-members-1')).toContainText('Member roster changes');
    // Unrecognized kind with no title falls back to the raw kind string, not a blank chip.
    await expect(sources.getByTestId('weekly-brief-card-source-chip-src-unknown-1')).toContainText('some_future_kind');

    // mailing-list has no resolvable archive URL in this contract, and the unrecognized kind
    // has no route mapping — both render as a plain (non-interactive) chip, not a <button>.
    // Clicking either must not navigate or change the active committee tab.
    await sources.getByTestId('weekly-brief-card-source-chip-src-ml-1').click({ force: true });
    await sources.getByTestId('weekly-brief-card-source-chip-src-unknown-1').click({ force: true });
    // Plain string, not a hand-built RegExp — COMMITTEE_URL has no metacharacters that need
    // escaping today, but a regex built via string replacement is fragile if it ever does
    // (CodeQL: incomplete escaping). toHaveURL resolves a relative string against baseURL.
    await expect(page).toHaveURL(COMMITTEE_URL);
    await expect(page.getByTestId('members-tab-bar')).toHaveCount(0);
  });

  test('clicking a meeting chip requests the meeting by its source-ref id', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: BRIEF_WITH_SOURCES, throttle: USED_THROTTLE_AFTER_GENERATE });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('weekly-brief-card-sources')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // `/meetings/:id` is MeetingJoinComponent (app.routes.ts), not a details route — it
    // resolves the id via getPublicMeeting (GET /public/api/meetings/:id), falling back to
    // getPublicPastMeeting (GET /public/api/meetings/past/:id) on a 404. Mocked to a
    // deterministic 404 here rather than left to the live dev backend (this synthetic id's
    // resolution isn't this spec's concern — that's meeting-join's own e2e surface) — matches
    // this file's own mocking convention (see mockCommitteeShell's past-meetings note above).
    // waitForRequest is registered before the click so it can't miss a request that fires
    // synchronously with the router push.
    await page.route('**/public/api/meetings/**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
        return;
      }
      await route.fallback();
    });
    const meetingRequest = page.waitForRequest((req) => req.method() === 'GET' && /\/public\/api\/meetings\/(past\/)?src-meeting-1(\?|$)/.test(req.url()), {
      timeout: DATA_LOAD_TIMEOUT,
    });
    await page.getByTestId('weekly-brief-card-source-chip-src-meeting-1').click();
    await meetingRequest;
  });

  test('clicking a vote chip opens the vote results drawer for that vote (cache hit)', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: BRIEF_WITH_SOURCES, throttle: USED_THROTTLE_AFTER_GENERATE });

    // Overrides mockCommitteeShell's default empty /api/votes* mock so the vote is present in
    // committee-overview's votes() signal — openVoteDrawer's fast path (no by-uid fetch needed).
    const voteFixture: Vote = {
      uid: 'src-vote-1',
      name: 'Q1 Budget',
      end_time: '2026-06-01T00:00:00.000Z',
      status: PollStatus.ACTIVE,
      project_uid: 'project-uid-wb',
    };
    await page.route('**/api/votes*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [voteFixture] }) });
        return;
      }
      await route.fallback();
    });
    // '**/api/votes*' above only matches the list endpoint — Playwright's `*` doesn't cross
    // `/`, so it can't also cover the drawer's own by-id fetches (getVote, getVoteResults,
    // getMyVoteResponse) once it opens; without a trailing `**` here (which does cross `/`),
    // those would escape to the live dev backend.
    await page.route('**/api/votes/src-vote-1**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const url = route.request().url();
      if (url.includes('/results')) {
        const results: VoteResultsResponse = {
          poll_results: [],
          comment_results: [],
          num_recipients: 0,
          num_votes_cast: 0,
          num_abstained: 0,
          poll_end_time: voteFixture.end_time,
        };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
        return;
      }
      if (url.includes('/my-response')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(voteFixture) });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('weekly-brief-card-sources')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('weekly-brief-card-source-chip-src-vote-1').click();
    await expect(page.getByTestId('vote-results-drawer')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('vote-results-drawer-title')).toContainText('Q1 Budget');
  });

  test("clicking a vote chip still opens the drawer when the vote is outside votes()'s cache (cache miss fallback)", async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: BRIEF_WITH_SOURCES, throttle: USED_THROTTLE_AFTER_GENERATE });

    // Leaves mockCommitteeShell's default empty /api/votes* (list) mock in place — the vote is
    // deliberately absent from committee-overview's votes() cache (page_size=100 by
    // updated_at), matching a weekly-brief vote ref older than that window. Only the by-uid
    // fetch is mocked, so the drawer opening at all proves openVoteDrawer's fetch-on-miss
    // fallback fired (Copilot review, PR #1363) rather than the votes()-cache fast path.
    const voteFixture: Vote = {
      uid: 'src-vote-1',
      name: 'Q1 Budget',
      end_time: '2026-06-01T00:00:00.000Z',
      status: PollStatus.ACTIVE,
      project_uid: 'project-uid-wb',
    };
    await page.route('**/api/votes/src-vote-1**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const url = route.request().url();
      if (url.includes('/results')) {
        const results: VoteResultsResponse = {
          poll_results: [],
          comment_results: [],
          num_recipients: 0,
          num_votes_cast: 0,
          num_abstained: 0,
          poll_end_time: voteFixture.end_time,
        };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
        return;
      }
      if (url.includes('/my-response')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(voteFixture) });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('weekly-brief-card-sources')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('weekly-brief-card-source-chip-src-vote-1').click();
    await expect(page.getByTestId('vote-results-drawer')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('vote-results-drawer-title')).toContainText('Q1 Budget');
  });

  test('clicking a vote chip shows a neutral unavailable toast when voting is disabled for the committee', async ({ page }) => {
    // mockCommitteeShell's default fixture has enable_voting: false — committee-view hides the
    // Votes tab in that state, so the toast must not point at a tab that doesn't exist (Copilot
    // review, PR #1363: a weekly-brief vote chip deliberately still renders even when voting is
    // off, since a brief's window can predate voting being disabled).
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: BRIEF_WITH_SOURCES, throttle: USED_THROTTLE_AFTER_GENERATE });

    // Both the list cache (mockCommitteeShell's default) and the by-uid fetch miss — a genuine
    // fetch failure, not just a cache-window gap, so the toast fallback is the correct outcome.
    await page.route('**/api/votes/src-vote-1**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('weekly-brief-card-sources')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('weekly-brief-card-source-chip-src-vote-1').click();
    await expect(page.getByText('This vote could not be found.', { exact: true })).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByText(/Try the Votes tab instead/i)).toHaveCount(0);
    // p-drawer's host element can remain in the DOM while closed (PrimeNG toggles visibility,
    // not presence) — assert not-visible, not absent, so this holds regardless of that detail.
    await expect(page.getByTestId('vote-results-drawer')).not.toBeVisible();
  });

  test('clicking a vote chip mentions the Votes tab in the unavailable toast when voting is enabled', async ({ page }) => {
    await mockCommitteeShell(page, { enable_voting: true });
    await mockCurrentBrief(page, { brief: BRIEF_WITH_SOURCES, throttle: USED_THROTTLE_AFTER_GENERATE });

    await page.route('**/api/votes/src-vote-1**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('weekly-brief-card-sources')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('weekly-brief-card-source-chip-src-vote-1').click();
    await expect(page.getByText(/This vote could not be found\. Try the Votes tab instead\./i)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('a slower, superseded vote fetch does not overwrite a faster, newer selection (concurrent click race)', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: BRIEF_WITH_TWO_VOTES, throttle: USED_THROTTLE_AFTER_GENERATE });

    // Vote A: absent from the list, so clicking it triggers openVoteDrawer's fetch fallback —
    // deliberately delayed so it's still in flight when vote B is clicked next.
    const voteA: Vote = {
      uid: 'src-vote-1',
      name: 'Q1 Budget',
      end_time: '2026-06-01T00:00:00.000Z',
      status: PollStatus.ACTIVE,
      project_uid: 'project-uid-wb',
    };
    // Vote B: present in the list, so it's a votes()-cache hit — opens synchronously.
    const voteB: Vote = {
      uid: 'src-vote-2',
      name: 'Q2 Budget',
      end_time: '2026-06-08T00:00:00.000Z',
      status: PollStatus.ACTIVE,
      project_uid: 'project-uid-wb',
    };
    const resultsFor = (v: Vote): VoteResultsResponse => ({
      poll_results: [],
      comment_results: [],
      num_recipients: 0,
      num_votes_cast: 0,
      num_abstained: 0,
      poll_end_time: v.end_time,
    });

    await page.route('**/api/votes*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [voteB] }) });
        return;
      }
      await route.fallback();
    });
    await page.route('**/api/votes/src-vote-1**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      // The delay is the point: vote B must be clicked and open before this resolves.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const url = route.request().url();
      if (url.includes('/results')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resultsFor(voteA)) });
        return;
      }
      if (url.includes('/my-response')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(voteA) });
    });
    // Vote B is a votes()-cache hit for committee-overview's own lookup, but
    // VoteResultsDrawerComponent still independently re-fetches by uid once it's open.
    await page.route('**/api/votes/src-vote-2**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const url = route.request().url();
      if (url.includes('/results')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resultsFor(voteB)) });
        return;
      }
      if (url.includes('/my-response')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(voteB) });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('weekly-brief-card-sources')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Click A (starts its delayed fetch), then immediately click B (cached — opens synchronously)
    // before A's fetch resolves.
    await page.getByTestId('weekly-brief-card-source-chip-src-vote-1').click();
    await page.getByTestId('weekly-brief-card-source-chip-src-vote-2').click();
    await expect(page.getByTestId('vote-results-drawer-title')).toContainText('Q2 Budget');

    // Give A's delayed (1s) mocked response comfortable room to land — a tight margin here
    // previously left this assertion able to pass even if A would go on to clobber B moments
    // later (Copilot review, PR #1363) — then confirm it did NOT clobber B's drawer. This is
    // the regression this test exists to catch.
    await page.waitForTimeout(2500);
    await expect(page.getByTestId('vote-results-drawer-title')).toContainText('Q2 Budget');
  });

  test('clicking a members chip switches the committee page to the Members tab', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: BRIEF_WITH_SOURCES, throttle: USED_THROTTLE_AFTER_GENERATE });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('weekly-brief-card-sources')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('weekly-brief-card-source-chip-src-members-1').click();
    // committee-view's activeTab flips locally (no route change) — the Members tab's own
    // panel rendering is the observable proof, not a URL change.
    await expect(page.getByTestId('members-tab-bar')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });
});

test.describe('WG Weekly Brief card — Sources disclosure & dedupe (LFXV2-3335)', () => {
  test('collapses behind a disclosure toggle above the threshold, and expanding reveals deduped, sectioned, group-expandable chips', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: BRIEF_WITH_MANY_SOURCES, throttle: USED_THROTTLE_AFTER_GENERATE });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    const sources = page.getByTestId('weekly-brief-card-sources');
    await expect(sources).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Raw refs > the threshold — collapsed behind the disclosure, no chips visible yet.
    const toggle = page.getByTestId('weekly-brief-card-sources-toggle');
    await expect(toggle).toContainText(`Sources (${BRIEF_WITH_MANY_SOURCES.source_refs.length})`);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(sources.getByTestId('weekly-brief-card-source-chip-src-vote-1')).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Three same-(kind, label) meeting refs collapse into one count-badged group chip, not
    // three individual chips.
    const groupToggle = sources.getByTestId('weekly-brief-card-source-group-toggle-src-tc-1');
    await expect(groupToggle).toBeVisible();
    await expect(groupToggle).toContainText('AAIF Technical Committee Meeting (3)');
    await expect(groupToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(sources.getByTestId('weekly-brief-card-source-chip-src-tc-2')).toHaveCount(0);

    // Distinct-kind refs render as individual chips immediately — no grouping needed.
    await expect(sources.getByTestId('weekly-brief-card-source-chip-src-vote-1')).toContainText('Q1 Budget');
    await expect(sources.getByTestId('weekly-brief-card-source-chip-src-members-1')).toContainText('Member roster changes');
    await expect(sources.getByTestId('weekly-brief-card-source-chip-src-ml-1')).toContainText('tsc-discuss');
    await expect(sources.getByTestId('weekly-brief-card-source-chip-src-doc-1')).toContainText('Charter.pdf');

    await groupToggle.click();
    await expect(groupToggle).toHaveAttribute('aria-expanded', 'true');

    // Expanding the group reveals each instance, ordinally labeled, individually clickable.
    await expect(sources.getByTestId('weekly-brief-card-source-chip-src-tc-1')).toContainText('AAIF Technical Committee Meeting #1');
    await expect(sources.getByTestId('weekly-brief-card-source-chip-src-tc-2')).toContainText('AAIF Technical Committee Meeting #2');
    await expect(sources.getByTestId('weekly-brief-card-source-chip-src-tc-3')).toContainText('AAIF Technical Committee Meeting #3');

    // Same meeting-join mocking as the flat-row test above — proves a specific expanded
    // instance still deep-links to its own ref id, not the group's.
    await page.route('**/public/api/meetings/**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
        return;
      }
      await route.fallback();
    });
    const meetingRequest = page.waitForRequest((req) => req.method() === 'GET' && /\/public\/api\/meetings\/(past\/)?src-tc-2(\?|$)/.test(req.url()), {
      timeout: DATA_LOAD_TIMEOUT,
    });
    await sources.getByTestId('weekly-brief-card-source-chip-src-tc-2').click();
    await meetingRequest;
  });
});

test.describe('WG Weekly Brief card — "This week so far" activity tally (GH-1922)', () => {
  test('renders the multi-kind caption for a governance committee and expands a kind to its underlying items', async ({ page }) => {
    await mockCommitteeShell(page, { category: 'Board' });
    await mockCurrentBrief(page, {
      brief: GENERATED_BRIEF,
      throttle: USED_THROTTLE_AFTER_GENERATE,
      current_activity: {
        window_start: '2026-08-24T00:00:00.000Z',
        window_end: '2026-08-27T12:00:00.000Z',
        source_refs: [
          { id: 'act-meeting-1', kind: 'meeting', title: 'Board Sync' },
          { id: 'act-vote-1', kind: 'vote', title: 'Q3 Resolution' },
        ],
      },
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    const tally = page.getByTestId('weekly-brief-card-current-activity');
    await expect(tally).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(tally).toContainText('This week so far:');
    await expect(tally).toContainText('1 meeting held');
    await expect(tally).toContainText('1 vote closed');
    // Negative side of the GH-1998 truncation-note tests below: a populated, non-truncated
    // tally must not carry the note.
    await expect(page.getByTestId('weekly-brief-card-current-activity-truncation-note')).toHaveCount(0);

    const toggle = page.getByTestId('weekly-brief-card-current-activity-toggle-meeting');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('weekly-brief-card-current-activity-items-meeting')).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('weekly-brief-card-current-activity-items-meeting')).toContainText('Board Sync');
  });

  test('does not render for a non-governance committee, even with current-week activity present', async ({ page }) => {
    await mockCommitteeShell(page); // default category: 'Working Group'
    await mockCurrentBrief(page, {
      brief: GENERATED_BRIEF,
      throttle: USED_THROTTLE_AFTER_GENERATE,
      current_activity: {
        window_start: '2026-08-24T00:00:00.000Z',
        window_end: '2026-08-27T12:00:00.000Z',
        source_refs: [{ id: 'act-meeting-1', kind: 'meeting', title: 'Some Meeting' }],
      },
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('weekly-brief-card-body')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await expect(page.getByTestId('weekly-brief-card-current-activity')).toHaveCount(0);
  });

  test('renders nothing (not "no activity yet") when current_activity is absent — a server-side degrade', async ({ page }) => {
    await mockCommitteeShell(page, { category: 'Board' });
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('weekly-brief-card-body')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await expect(page.getByTestId('weekly-brief-card-current-activity')).toHaveCount(0);
  });

  test('renders "no activity yet" when current_activity is present but empty — a genuine quiet week-so-far, distinct from the absent case above', async ({
    page,
  }) => {
    await mockCommitteeShell(page, { category: 'Board' });
    await mockCurrentBrief(page, {
      brief: GENERATED_BRIEF,
      throttle: USED_THROTTLE_AFTER_GENERATE,
      current_activity: { window_start: '2026-08-24T00:00:00.000Z', window_end: '2026-08-27T12:00:00.000Z', source_refs: [] },
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('weekly-brief-card-current-activity')).toContainText('no activity yet', { timeout: DATA_LOAD_TIMEOUT });
  });

  test('renders the tally PLUS a truncation disclosure when current_activity.truncated is true (GH-1998)', async ({ page }) => {
    await mockCommitteeShell(page, { category: 'Board' });
    await mockCurrentBrief(page, {
      brief: GENERATED_BRIEF,
      throttle: USED_THROTTLE_AFTER_GENERATE,
      current_activity: {
        window_start: '2026-08-24T00:00:00.000Z',
        window_end: '2026-08-27T12:00:00.000Z',
        source_refs: [{ id: 'act-meeting-1', kind: 'meeting', title: 'Board Sync' }],
        truncated: true,
      },
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    const tally = page.getByTestId('weekly-brief-card-current-activity');
    await expect(tally).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(tally).toContainText('1 meeting held');

    const note = page.getByTestId('weekly-brief-card-current-activity-truncation-note');
    await expect(note).toBeVisible();
    // Pins the non-empty-tally variant specifically — the empty-tally variant shares the trailing
    // "see Recent Activity below for the latest events" and wouldn't be caught by that substring
    // alone.
    await expect(note).toContainText('This count may be incomplete');
    // The note's only actionable content is the CTA — keep asserting it survives alongside the
    // variant-specific text above.
    await expect(note).toContainText('see Recent Activity below for the latest events');
  });

  test('renders "activity may be incomplete" (not "no activity yet") when truncated is true but every ref was filtered/unmapped away (GH-1998)', async ({
    page,
  }) => {
    await mockCommitteeShell(page, { category: 'Board' });
    await mockCurrentBrief(page, {
      brief: GENERATED_BRIEF,
      throttle: USED_THROTTLE_AFTER_GENERATE,
      current_activity: {
        window_start: '2026-08-24T00:00:00.000Z',
        window_end: '2026-08-27T12:00:00.000Z',
        source_refs: [],
        truncated: true,
      },
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    const tally = page.getByTestId('weekly-brief-card-current-activity');
    await expect(tally).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(tally).toContainText('activity may be incomplete');
    await expect(tally).not.toContainText('no activity yet');

    const note = page.getByTestId('weekly-brief-card-current-activity-truncation-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('The activity feed hit its page limit, so this week may have had more');
    await expect(note).toContainText('see Recent Activity below for the latest events');
  });
});

test.describe('WG Weekly Brief card — Edit → Save round-trip', () => {
  test('PUT request carries the modified brief text, and UI re-renders with the "Edited" badge', async ({ page }) => {
    await mockCommitteeShell(page);
    const briefMock = await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });

    // Intercept PUT (save). Capture body, return the edited brief.
    let capturedPutBody: { brief_text?: string; revision?: number } | null = null;
    const editedText = 'Edited brief — manish reviewed and tightened the language for the maintainers list.';
    const editedBrief: WeeklyBrief = { ...GENERATED_BRIEF, state: 'edited', brief_text: editedText, revision: GENERATED_BRIEF.revision + 1 };

    await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/current*`, async (route) => {
      if (route.request().method() === 'PUT') {
        capturedPutBody = route.request().postDataJSON() as { brief_text?: string; revision?: number };
        // After save, GET should return the edited brief.
        briefMock.setResponse({ brief: editedBrief, throttle: USED_THROTTLE_AFTER_GENERATE });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(editedBrief) });
        return;
      }
      // route.continue() forwards to the network, NOT the next-registered handler —
      // route.fallback() is what lets mockCurrentBrief's GET handler run.
      await route.fallback();
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    // If global-setup didn't pin auth state, the page redirects to Auth0's login screen
    // and every assertion below would just be validating the login page.
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('weekly-brief-card-body')).toHaveText(GENERATED_BRIEF.brief_text, { timeout: DATA_LOAD_TIMEOUT });

    // Enter edit mode.
    await page.getByTestId('weekly-brief-card-edit-button').click();

    // lfx-textarea forwards dataTest as [attr.data-test] on the inner <textarea>, not
    // data-testid — select it accordingly.
    const textarea = page.locator('[data-test="weekly-brief-card-edit-textarea"]');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue(GENERATED_BRIEF.brief_text);

    // Replace the text.
    await textarea.fill(editedText);

    // Save and wait for the PUT to fly.
    const putPromise = page.waitForRequest(
      (req) => req.method() === 'PUT' && req.url().includes(`/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/current`),
      { timeout: DATA_LOAD_TIMEOUT }
    );
    await page.getByTestId('weekly-brief-card-save-button').click();
    await putPromise;

    // Verify the captured PUT body.
    expect(capturedPutBody).not.toBeNull();
    expect(capturedPutBody!.brief_text).toBe(editedText);
    expect(capturedPutBody!.revision).toBe(GENERATED_BRIEF.revision);

    // UI exits edit mode and shows the new state badge.
    await expect(textarea).toHaveCount(0, { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('weekly-brief-card-state-badge')).toHaveText('Edited', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('weekly-brief-card-body')).toHaveText(editedText);
  });
});

test.describe('WG Weekly Brief card — Generate from empty', () => {
  test('clicking Generate fires POST, polls until terminal, and the UI re-renders to the generated state', async ({ page }) => {
    await mockCommitteeShell(page);

    const GENERATING_BRIEF: WeeklyBrief = { ...GENERATED_BRIEF, state: 'generating', brief_text: '' };

    // Upstream's generate call is a 202 accepted, not a completed brief — the card
    // renders the 202 body's `generating` state immediately (no GET needed for that),
    // then polls GET /current one interval later until the brief lands on a terminal
    // state (LFXV2-2175/2176 review). Keyed off whether generate has been accepted
    // rather than a raw GET count — a flag transiently going false (e.g. LaunchDarkly
    // re-evaluating and remounting the card) can add an extra initial-load GET that
    // would desync a count-based sequence.
    let generateAccepted = false;
    await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/current*`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const body: WeeklyBriefCurrentResponse = generateAccepted
        ? { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE }
        : { brief: null, throttle: DEFAULT_THROTTLE };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    // Intercept POST (generate) — real upstream responds 202 with the brief in the
    // `generating` state; the client renders this body directly, then polls for terminal.
    let capturedPostBody: { force?: boolean } | null = null;
    await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/generate`, async (route) => {
      capturedPostBody = (route.request().postDataJSON() ?? {}) as { force?: boolean };
      generateAccepted = true;
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ brief: GENERATING_BRIEF, throttle: DEFAULT_THROTTLE }),
      });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    // If global-setup didn't pin auth state, the page redirects to Auth0's login screen
    // and every assertion below would just be validating the login page.
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('weekly-brief-card-empty-state')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const postPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes(`/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/generate`),
      { timeout: DATA_LOAD_TIMEOUT }
    );
    await page.getByTestId('weekly-brief-card-generate-button').click();
    await postPromise;

    // First generate from empty → no force flag in the request body.
    expect(capturedPostBody).not.toBeNull();
    expect(capturedPostBody!.force).toBeUndefined();

    // The 202 body lands the card on the generating state immediately — no GET needed.
    await expect(page.getByTestId('weekly-brief-card-generating-state')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Poll's first tick returns the terminal brief — empty state stays gone, generated
    // content and actions take over.
    await expect(page.getByTestId('weekly-brief-card-empty-state')).toHaveCount(0, { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('weekly-brief-card-body')).toHaveText(GENERATED_BRIEF.brief_text, { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('weekly-brief-card-regenerate-button')).toBeVisible();
    await expect(page.getByTestId('weekly-brief-card-edit-button')).toBeVisible();
    await expect(page.getByTestId('weekly-brief-card-copy-button')).toBeVisible();
  });
});

test.describe('WG Weekly Brief card — loads directly into the generating state', () => {
  test('a page load landing on an already-generating brief polls to terminal on its own, without a Generate click', async ({ page }) => {
    await mockCommitteeShell(page);

    const GENERATING_BRIEF: WeeklyBrief = { ...GENERATED_BRIEF, state: 'generating', brief_text: '' };

    // Reproduces a page reload / navigate-back / co-chair-triggered-generation mid-flight:
    // the card's very first read already returns `generating`, with no POST /generate
    // from this tab at all. Regression coverage for a bug where only onGenerate()'s own
    // poll call covered this state, leaving a load-time generating brief a permanent
    // spinner with no recovery (LFXV2-2176 review).
    //
    // Keyed off an explicit flag flipped only after the generating state is confirmed on
    // screen, not a raw GET count — a fixed "call N is terminal" threshold can desync when an
    // extra initial GET fires (e.g. LaunchDarkly re-evaluating and remounting the card) before
    // this test's own assertion runs, letting the remount's first read already observe the
    // terminal brief and skip rendering the generating state at all (Cursor Bugbot: this same
    // count-gate pattern was already replaced with a flag elsewhere in this file for the
    // identical reason — this test hadn't been updated to match).
    let getCount = 0;
    let showTerminal = false;
    await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/current*`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      getCount += 1;
      const body: WeeklyBriefCurrentResponse = showTerminal
        ? { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE }
        : { brief: GENERATING_BRIEF, throttle: DEFAULT_THROTTLE };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // First read(s) already generating — no click happened, so this proves the load pipeline
    // itself started the poll. Any number of incidental extra reads before this point (e.g. a
    // remount) still return 'generating', so this can't skip past the state it's asserting.
    await expect(page.getByTestId('weekly-brief-card-generating-state')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const countAtGenerating = getCount;

    // Only now let the poll's own next tick observe the terminal brief — proves the poll
    // itself (not this flip) carries the card to done, since getCount must have advanced.
    showTerminal = true;
    await expect(page.getByTestId('weekly-brief-card-body')).toHaveText(GENERATED_BRIEF.brief_text, { timeout: DATA_LOAD_TIMEOUT });
    expect(getCount).toBeGreaterThan(countAtGenerating);
  });
});

test.describe('WG Weekly Brief card — read failure (flag ON)', () => {
  test('shows a retryable unavailable state when GET current fails, then recovers on retry', async ({ page }) => {
    await mockCommitteeShell(page);

    // First read fails (e.g. upstream 503 "bucket not initialized"); the retry
    // succeeds with an empty envelope. Verifies a failed read renders the
    // distinct unavailable state instead of masquerading as "no brief yet".
    //
    // Gated on the `retried` flag, not a raw call index (`calls === 1`) — same rationale as
    // the "loads directly into the generating state" test above: LaunchDarkly can remount the
    // card and fire an extra initial GET, which would consume a fixed "first call fails" slot
    // before this test's own assertions run and let the remount observe success early,
    // flaking the unavailable-state assertion below (Cursor Bugbot review). Every GET fails
    // until the test itself flips `retried` right before the explicit Retry click, so any
    // number of incidental remount GETs still land on the failure branch.
    let retried = false;
    await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/current*`, async (route) => {
      if (!retried) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'group-weekly-briefs bucket not initialized' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ brief: null, throttle: DEFAULT_THROTTLE } as WeeklyBriefCurrentResponse),
      });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    // If global-setup didn't pin auth state, the page redirects to Auth0's login screen
    // and every assertion below would just be validating the login page.
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Failed read → distinct unavailable state, NOT the empty "No brief yet" prompt.
    const unavailable = page.getByTestId('weekly-brief-card-unavailable-state');
    await expect(unavailable).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(unavailable).toContainText('temporarily unavailable');
    await expect(page.getByTestId('weekly-brief-card-empty-state')).toHaveCount(0);

    // Retry re-fetches; the now-succeeding read swaps to the empty state.
    retried = true;
    await page.getByTestId('weekly-brief-card-unavailable-retry-button').click();
    await expect(page.getByTestId('weekly-brief-card-empty-state')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('weekly-brief-card-unavailable-state')).toHaveCount(0);
  });
});

test.describe('WG Weekly Brief card — Share to Mailing List (flag ON)', () => {
  test('sends the current brief and shows a success toast', async ({ page }) => {
    await mockCommitteeShell(page, { has_mailing_list: true, mailing_list: 'wg-tsc@lists.example.org' });
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });

    let shareCalled = false;
    await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/share`, async (route) => {
      shareCalled = true;
      const result: ShareWeeklyBriefResult = { committee_name: 'Weekly Brief Test WG', total_recipients: 4 };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const shareBtn = page.getByTestId('weekly-brief-card-share-button');
    await expect(shareBtn).toBeVisible();
    await expect(shareBtn).toBeEnabled();
    await shareBtn.click();

    // Confirm dialog appears, describing the true recipient audience
    // (committee members) — never the Groups.io mailing-list address, which
    // is not who actually receives the email.
    await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.p-confirmdialog')).toContainText('all members of Weekly Brief Test WG');

    const sharePromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes(`/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/share`),
      { timeout: DATA_LOAD_TIMEOUT }
    );
    await page.locator('.p-confirmdialog').getByRole('button', { name: /Send/i }).click();
    await sharePromise;

    expect(shareCalled).toBe(true);
    await expect(page.getByText(/Brief queued for delivery to 4 recipients/i)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('a 200 response with zero recipients shows a warning toast, not a success toast', async ({ page }) => {
    await mockCommitteeShell(page, { has_mailing_list: true, mailing_list: 'wg-tsc@lists.example.org' });
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });

    await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/share`, async (route) => {
      const result: ShareWeeklyBriefResult = { committee_name: 'Weekly Brief Test WG', total_recipients: 0 };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('weekly-brief-card-share-button').click();
    await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });

    const sharePromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes(`/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/share`),
      { timeout: DATA_LOAD_TIMEOUT }
    );
    await page.locator('.p-confirmdialog').getByRole('button', { name: /Send/i }).click();
    await sharePromise;

    await expect(page.getByText(/No recipients were found for this committee/i)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByText(/Brief queued for delivery/i)).toHaveCount(0);
  });
});

test.describe('WG Weekly Brief card — Share disabled (no mailing list)', () => {
  test('Share button is visible but disabled, with a visible hint, when the committee has no mailing list', async ({ page }) => {
    await mockCommitteeShell(page, { has_mailing_list: false });
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const shareBtn = page.getByTestId('weekly-brief-card-share-button');
    await expect(shareBtn).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(shareBtn).toBeDisabled();

    // The disabled reason is a plain visible hint (not a tooltip) so it's
    // reachable without hover/focus for keyboard and screen-reader users.
    const hint = page.getByTestId('weekly-brief-card-share-disabled-hint');
    await expect(hint).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(hint).toContainText('No mailing list configured for this committee');
  });
});

test.describe('WG Weekly Brief card — Share failure', () => {
  test('a failed send surfaces an error toast (no silent drop)', async ({ page }) => {
    await mockCommitteeShell(page, { has_mailing_list: true, mailing_list: 'wg-tsc@lists.example.org' });
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });
    await mockShareBrief(page, 409, { error: 'Committee has no mailing list configured', code: 'NO_MAILING_LIST' });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('weekly-brief-card-share-button').click();
    await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });

    const sharePromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes(`/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/share`),
      { timeout: DATA_LOAD_TIMEOUT }
    );
    await page.locator('.p-confirmdialog').getByRole('button', { name: /Send/i }).click();
    await sharePromise;

    await expect(page.getByText(/No mailing list configured for this committee/i)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('a 400 validation error surfaces the actual field message, not the generic envelope text', async ({ page }) => {
    await mockCommitteeShell(page, { has_mailing_list: true });
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });
    await mockShareBrief(page, 400, {
      error: 'Validation failed for brief_text',
      code: 'VALIDATION_ERROR',
      errors: [
        { field: 'brief_text', message: 'Brief is too long to share (must render to 100000 characters or fewer as HTML)', code: 'FIELD_VALIDATION_ERROR' },
      ],
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('weekly-brief-card-share-button').click();
    await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });
    await page.locator('.p-confirmdialog').getByRole('button', { name: /Send/i }).click();

    await expect(page.getByText(/Brief is too long to share/i)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByText('Validation failed for brief_text', { exact: true })).toHaveCount(0);
  });

  test('a 409 BACKEND_NOT_LIVE reports the environment reason distinctly from a no-mailing-list conflict', async ({ page }) => {
    await mockCommitteeShell(page, { has_mailing_list: true });
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });
    await mockShareBrief(page, 409, { error: 'Sharing is not available in this environment', code: 'BACKEND_NOT_LIVE' });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('weekly-brief-card-share-button').click();
    await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });
    await page.locator('.p-confirmdialog').getByRole('button', { name: /Send/i }).click();

    await expect(page.getByText(/Sharing is not available in this environment yet/i)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('a 409 REVISION_MISMATCH prompts a reload instead of silently sending stale content', async ({ page }) => {
    await mockCommitteeShell(page, { has_mailing_list: true });
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });
    await mockShareBrief(page, 409, { error: 'The brief has been updated since you last viewed it', code: 'REVISION_MISMATCH' });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('weekly-brief-card-share-button').click();
    await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });

    const sharePromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes(`/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/share`),
      { timeout: DATA_LOAD_TIMEOUT }
    );
    const sharedBody = sharePromise.then((req) => req.postDataJSON() as { revision?: number });
    await page.locator('.p-confirmdialog').getByRole('button', { name: /Send/i }).click();
    await sharePromise;

    // The client sends back the revision it displayed — proves the confirmation was
    // tied to a specific version of the brief, not just "whatever is current".
    expect((await sharedBody).revision).toBe(GENERATED_BRIEF.revision);

    await expect(page.getByText(/updated since you last viewed it.*Reload to review the latest version/i)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('a 5xx/ambiguous failure warns that the send may already have gone out, instead of inviting a retry', async ({ page }) => {
    await mockCommitteeShell(page, { has_mailing_list: true });
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });
    await mockShareBrief(page, 503, { error: 'Upstream newsletter service unavailable', code: 'SERVICE_UNAVAILABLE' });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('weekly-brief-card-share-button').click();
    await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });
    await page.locator('.p-confirmdialog').getByRole('button', { name: /Send/i }).click();

    // This is the safeguard that prevents a duplicate send: a 5xx here must
    // NOT render the generic "try again" copy, since the async send may
    // already have been accepted upstream before the failure reached the client.
    await expect(page.getByText(/The send may not have completed/i)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByText('Failed to share brief. Please try again.', { exact: true })).toHaveCount(0);
  });
});

test.describe('WG Weekly Brief card — Regenerate disabled (throttle exhausted)', () => {
  test('Regenerate button is visible but disabled, with a visible hint, when the weekly regeneration limit is reached', async ({ page }) => {
    await mockCommitteeShell(page);
    const exhaustedThrottle: WeeklyBriefThrottle = { ...DEFAULT_THROTTLE, regenerations_used: 3, regenerations_limit: 3 };
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: exhaustedThrottle });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const regenerateBtn = page.getByTestId('weekly-brief-card-regenerate-button');
    await expect(regenerateBtn).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(regenerateBtn).toBeDisabled();

    const hint = page.getByTestId('weekly-brief-card-regenerate-disabled-hint');
    await expect(hint).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(hint).toContainText('Weekly regeneration limit reached');
  });
});

test.describe('WG Weekly Brief card — Rating (flag ON, LFXV2-3042)', () => {
  test('caller_rating from GET /current pre-lights the matching thumb on load', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE, caller_rating: 'up' });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Role-based, not the raw `aria-pressed` DOM attribute: `<lfx-button>` wraps PrimeNG's
    // `<p-button>`, and the real interactive element the browser's accessibility tree exposes
    // as `role=button` may not be the literal node `getByTestId` resolves to — querying by role
    // + accessible name walks the computed accessibility tree instead of relying on which DOM
    // node physically carries the `aria-pressed` attribute.
    await expect(page.getByRole('button', { name: 'Rate this brief helpful', pressed: true })).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByRole('button', { name: 'Rate this brief not helpful', pressed: false })).toBeVisible();
  });

  test('tapping an unrated thumb POSTs the rating and lights it', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE, caller_rating: null });

    let capturedBody: { rating?: string; revision?: number } | null = null;
    await mockRating(page, GENERATED_BRIEF.uid, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      capturedBody = route.request().postDataJSON() as { rating?: string; revision?: number };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rating: 'down' }) });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const downBtn = page.getByRole('button', { name: 'Rate this brief not helpful' });
    const postPromise = page.waitForRequest((req) => req.method() === 'POST' && req.url().includes(`/weekly-briefs/${GENERATED_BRIEF.uid}/rating`), {
      timeout: DATA_LOAD_TIMEOUT,
    });
    await downBtn.click();
    await postPromise;

    expect(capturedBody).toEqual({ rating: 'down', revision: GENERATED_BRIEF.revision });
    await expect(page.getByRole('button', { name: 'Rate this brief not helpful', pressed: true })).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('tapping the active thumb clears the rating via DELETE', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE, caller_rating: 'up' });

    let capturedDeleteBody: { revision?: number } | null = null;
    await mockRating(page, GENERATED_BRIEF.uid, async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.fallback();
        return;
      }
      capturedDeleteBody = route.request().postDataJSON() as { revision?: number };
      await route.fulfill({ status: 204 });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const upBtn = page.getByRole('button', { name: 'Rate this brief helpful', pressed: true });
    await expect(upBtn).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const deletePromise = page.waitForRequest((req) => req.method() === 'DELETE' && req.url().includes(`/weekly-briefs/${GENERATED_BRIEF.uid}/rating`), {
      timeout: DATA_LOAD_TIMEOUT,
    });
    await upBtn.click();
    await deletePromise;

    expect(capturedDeleteBody).toEqual({ revision: GENERATED_BRIEF.revision });
    await expect(page.getByRole('button', { name: 'Rate this brief helpful', pressed: false })).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('a failed rating request rolls back the optimistic thumb and shows an error toast', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE, caller_rating: null });

    await mockRating(page, GENERATED_BRIEF.uid, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal error' }) });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const upBtn = page.getByRole('button', { name: 'Rate this brief helpful' });
    await upBtn.click();

    await expect(page.getByText('Failed to save your rating. Please try again.', { exact: true })).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByRole('button', { name: 'Rate this brief helpful', pressed: false })).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('a 409 revision-mismatch (a co-chair edited between page load and the tap) rolls back the thumb, reloads the current brief, and shows the reload-specific toast', async ({
    page,
  }) => {
    await mockCommitteeShell(page);
    const briefMock = await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE, caller_rating: null });

    // Simulates a co-chair's edit landing between this tab's page load and the rating tap: the
    // POST rejects with the server's real REVISION_MISMATCH shape, and the *next* GET (fired by
    // the component's own refresh$ recovery) returns the brief at its new revision, unrated.
    const editedBrief: WeeklyBrief = { ...GENERATED_BRIEF, state: 'edited', revision: GENERATED_BRIEF.revision + 1 };
    await mockRating(page, GENERATED_BRIEF.uid, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      briefMock.setResponse({ brief: editedBrief, throttle: USED_THROTTLE_AFTER_GENERATE, caller_rating: null });
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'This brief has changed since you last viewed it.', code: 'REVISION_MISMATCH' }),
      });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const upBtn = page.getByRole('button', { name: 'Rate this brief helpful' });
    // The second GET is refresh$'s own recovery fetch, distinct from the initial page-load GET —
    // waiting for it (rather than just the POST) proves the card actually reloads, not just toasts.
    const refreshGetPromise = page.waitForRequest(
      (req) => req.method() === 'GET' && req.url().includes(`/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/current`),
      { timeout: DATA_LOAD_TIMEOUT }
    );
    await upBtn.click();
    await refreshGetPromise;

    await expect(page.getByText('This brief has changed. Reloaded the latest version — please rate again.', { exact: true })).toBeVisible({
      timeout: DATA_LOAD_TIMEOUT,
    });
    // Never the generic message a plain 5xx gets — the two error paths must stay distinguishable.
    await expect(page.getByText('Failed to save your rating. Please try again.', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('weekly-brief-card-state-badge')).toHaveText('Edited', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByRole('button', { name: 'Rate this brief helpful', pressed: false })).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });
});
