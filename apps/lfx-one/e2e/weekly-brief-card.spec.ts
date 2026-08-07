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
import { WEEKLY_BRIEF_ERROR_REASON } from '@lfx-one/shared/constants';
import { CommitteeMemberRole } from '@lfx-one/shared/enums';
import { Committee, ShareWeeklyBriefResult, WeeklyBrief, WeeklyBriefCurrentResponse, WeeklyBriefThrottle } from '@lfx-one/shared/interfaces';

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
  // the network on fast runs.
  await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/current`, async (route) => {
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

test.describe('WG Weekly Brief card — Edit → Save round-trip', () => {
  test('PUT request carries the modified brief text, and UI re-renders with the "Edited" badge', async ({ page }) => {
    await mockCommitteeShell(page);
    const briefMock = await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });

    // Intercept PUT (save). Capture body, return the edited brief.
    let capturedPutBody: { brief_text?: string; revision?: number } | null = null;
    const editedText = 'Edited brief — manish reviewed and tightened the language for the maintainers list.';
    const editedBrief: WeeklyBrief = { ...GENERATED_BRIEF, state: 'edited', brief_text: editedText, revision: GENERATED_BRIEF.revision + 1 };

    await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/current`, async (route) => {
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
    await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/current`, async (route) => {
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
    await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/current`, async (route) => {
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
    await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/current`, async (route) => {
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
