// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * WG Weekly Brief — AI Assistant Card E2E Tests
 *
 * Covers the AI Assistant card mounted on committee-overview:
 * - Feature-flag gating (wg-weekly-brief OFF → card hidden)
 * - Empty state render + Generate action
 * - Generated state render (header, throttle badge, action buttons)
 * - Edit → Save round-trip (PUT request shape + UI re-render to `edited`)
 * - Generate-from-empty happy path (POST → re-render to `generated`)
 *
 * Architecture notes (mirrors repo convention):
 * - API mocking is per-spec via `page.route()` (see org-membership-documentation.spec.ts
 *   for the same pattern).
 * - Authentication is captured once by global-setup and reused via storageState
 *   (see helpers/global-setup.ts).
 * - The repo has no e2e LaunchDarkly override helper. For the flag-ON tests we mock
 *   only the WG weekly-brief endpoints and rely on the `wg-weekly-brief` LD flag being
 *   ON in the dev environment (mirroring how the spec 016 board-committee tests rely on
 *   `org-lens-enabled` being ON; see org-membership-board-committee.spec.ts header).
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
import { Committee, WeeklyBrief, WeeklyBriefCurrentResponse, WeeklyBriefThrottle } from '@lfx-one/shared/interfaces';

const TEST_COMMITTEE_UID = 'wb-card-e2e-committee-uid';
const COMMITTEE_URL = `/committees/${TEST_COMMITTEE_UID}`;
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

function buildCommitteeFixture(): Committee {
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
async function mockCommitteeShell(page: Page): Promise<void> {
  await page.route(`**/api/committees/${TEST_COMMITTEE_UID}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCommitteeFixture()),
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

  // Meetings / votes / surveys called by committee-overview — return empty
  // collections / zero counts so the page settles deterministically.
  await page.route(`**/api/meetings/count*`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0 }) });
  });
  await page.route(`**/api/meetings*`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    await route.continue();
  });
  await page.route(`**/api/votes*`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    await route.continue();
  });
  await page.route(`**/api/surveys*`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    await route.continue();
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
      await route.continue();
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

    // Wait for committee-overview to actually mount so the @if has had a chance
    // to evaluate — the stats grid is a stable signal that overview is rendered.
    await expect(page.getByTestId('committee-overview-stats')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // The host wrapper testid on the lfx-weekly-brief-card element must not appear.
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toHaveCount(0);
  });
});

test.describe('WG Weekly Brief card — empty state (flag ON)', () => {
  test('renders empty state with Generate enabled and the "No brief yet" copy', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: null, throttle: DEFAULT_THROTTLE });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });

    // The card wrapper appears once the flag resolves ON and canEdit is true.
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const emptyState = page.getByTestId('weekly-brief-card-empty-state');
    await expect(emptyState).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(emptyState).toContainText('No brief yet');

    const generateBtn = page.getByTestId('weekly-brief-card-generate-button');
    await expect(generateBtn).toBeVisible();
    await expect(generateBtn).toBeEnabled();
  });
});

test.describe('WG Weekly Brief card — generated state (flag ON)', () => {
  test('renders brief text, week label, throttle badge, and primary actions', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockCurrentBrief(page, { brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Brief body text is rendered (no testid on the <pre> — assert via text).
    await expect(page.getByText(GENERATED_BRIEF.brief_text)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Week label "May 17 – May 23, 2026" — assert on the human format.
    await expect(page.getByText(/May\s+17/)).toBeVisible();
    await expect(page.getByText(/May\s+23,\s+2026/)).toBeVisible();

    // "Generated" state badge.
    await expect(page.getByText('Generated', { exact: true })).toBeVisible();

    // Throttle text: "1/2 generates · 0/3 regenerations used this week"
    await expect(page.getByText(/1\/2 generates/)).toBeVisible();
    await expect(page.getByText(/0\/3 regenerations/)).toBeVisible();

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
      await route.continue(); // GET falls through to mockCurrentBrief
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByText(GENERATED_BRIEF.brief_text)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Enter edit mode.
    await page.getByTestId('weekly-brief-card-edit-button').click();

    const textarea = page.getByTestId('weekly-brief-card-edit-textarea');
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
    await expect(page.getByTestId('weekly-brief-card-edit-textarea')).toHaveCount(0, { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByText('Edited', { exact: true })).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByText(editedText)).toBeVisible();
  });
});

test.describe('WG Weekly Brief card — Generate from empty', () => {
  test('clicking Generate fires POST and the UI re-renders to the generated state', async ({ page }) => {
    await mockCommitteeShell(page);
    const briefMock = await mockCurrentBrief(page, { brief: null, throttle: DEFAULT_THROTTLE });

    // Intercept POST (generate). On success, swap the GET response to the generated brief.
    let capturedPostBody: { revision?: number } | null = null;
    await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/generate`, async (route) => {
      capturedPostBody = (route.request().postDataJSON() ?? {}) as { revision?: number };
      briefMock.setResponse({ brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ brief: GENERATED_BRIEF, throttle: USED_THROTTLE_AFTER_GENERATE }),
      });
    });

    await page.goto(COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('weekly-brief-card-empty-state')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const postPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes(`/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/generate`),
      { timeout: DATA_LOAD_TIMEOUT }
    );
    await page.getByTestId('weekly-brief-card-generate-button').click();
    await postPromise;

    // First generate from empty → no prior revision in the request body.
    expect(capturedPostBody).not.toBeNull();
    expect(capturedPostBody!.revision).toBeUndefined();

    // Empty state disappears and the generated content takes over.
    await expect(page.getByTestId('weekly-brief-card-empty-state')).toHaveCount(0, { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByText(GENERATED_BRIEF.brief_text)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('weekly-brief-card-regenerate-button')).toBeVisible();
    await expect(page.getByTestId('weekly-brief-card-edit-button')).toBeVisible();
    await expect(page.getByTestId('weekly-brief-card-copy-button')).toBeVisible();
  });
});

test.describe('WG Weekly Brief card — read failure (flag ON)', () => {
  test('shows a retryable unavailable state when GET current fails, then recovers on retry', async ({ page }) => {
    await mockCommitteeShell(page);

    // First read fails (e.g. upstream 503 "bucket not initialized"); the retry
    // succeeds with an empty envelope. Verifies a failed read renders the
    // distinct unavailable state instead of masquerading as "no brief yet".
    let calls = 0;
    await page.route(`**/api/committees/${TEST_COMMITTEE_UID}/weekly-briefs/current`, async (route) => {
      calls += 1;
      if (calls === 1) {
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
    await expect(page.getByTestId('committee-overview-weekly-brief-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Failed read → distinct unavailable state, NOT the empty "No brief yet" prompt.
    const unavailable = page.getByTestId('weekly-brief-card-unavailable-state');
    await expect(unavailable).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(unavailable).toContainText('temporarily unavailable');
    await expect(page.getByTestId('weekly-brief-card-empty-state')).toHaveCount(0);

    // Retry re-fetches; the now-succeeding read swaps to the empty state.
    await page.getByTestId('weekly-brief-card-unavailable-retry-button').click();
    await expect(page.getByTestId('weekly-brief-card-empty-state')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('weekly-brief-card-unavailable-state')).toHaveCount(0);
  });
});

// Generated with [Claude Code](https://claude.ai/code)
