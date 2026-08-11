// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Shared fixtures/mocks for the committee engagement UI specs (LFXV2-1705).
 *
 * The engagement fixture exercises six of the seven classification tiers the BFF can serve (High /
 * Medium / Low / Inactive-with-invites / Inactive-never-invited / Emeritus) over a roster whose
 * uids match the mocked `/members` response, so the Members-table join and the At-Risk filter
 * behave exactly as they would against the real endpoint. `LF Staff` (LFXV2-3101) has no fixture
 * member here — the classifier's own boundary behavior for it is covered by
 * `committee-engagement-classifier.utils.spec.ts` and `committee-engagement.service.spec.ts`; this
 * suite doesn't currently assert on its UI rendering. Specs mock the BFF over `page.route` and stay
 * independent of the server's ENGAGEMENT_BACKEND mode.
 */

import { COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW } from '@lfx-one/shared/constants';
import type { CommitteeEngagementResponse, CommitteeEngagementWindow } from '@lfx-one/shared/interfaces';
import { expect, Locator, Page, test } from '@playwright/test';

export const PAGE_LOAD_TIMEOUT = 30_000;
export const ELEMENT_TIMEOUT = 10_000;

export const ENGAGEMENT_COMMITTEE_UID = 'e2e-engagement-wg';
export const ENGAGEMENT_PATH = `/api/committees/${ENGAGEMENT_COMMITTEE_UID}/engagement`;

// Gated on env vars rather than URL sniffing so genuine auth-flow regressions still fail loudly
// when creds ARE configured (matching groups-engagement-stats.spec.ts).
const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

export function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

/**
 * Whether `locator` becomes visible within `timeout` — used to detect the LaunchDarkly flag's
 * resolved state. `isVisible({ timeout })` is deprecated/ignored, so a real `waitFor` is required:
 * an immediate check can read `false` before the async flag client resolves.
 */
export async function appearsWithin(locator: Locator, timeout: number): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

export function buildEngagementCommittee(): Record<string, unknown> {
  return {
    uid: ENGAGEMENT_COMMITTEE_UID,
    name: 'E2E Engagement Working Group',
    description: 'A working group used to exercise the engagement UI in e2e tests.',
    category: 'Working Group',
    public: true,
    enable_voting: true,
    join_mode: 'open',
    foundation_name: 'E2E Foundation',
    project_name: 'E2E Project',
    project_uid: 'e2e-project-uid',
    project_slug: 'e2e-project',
    is_foundation: false,
    parent_uid: null,
    parent_project_uid: 'e2e-project-uid',
    total_members: 6,
    created_at: '2025-01-15T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    member_visibility: 'basic_profile',
    writer: false,
    my_role: 'Member',
    my_member_uid: 'm-medium',
    auditors: [],
  };
}

interface RosterSeed {
  uid: string;
  first: string;
  last: string;
  role: string;
  votingStatus: string;
}

const ROSTER: RosterSeed[] = [
  { uid: 'm-high', first: 'Harper', last: 'Chairwood', role: 'Chair', votingStatus: 'Voting Rep' },
  { uid: 'm-medium', first: 'Morgan', last: 'Midrate', role: 'None', votingStatus: 'Voting Rep' },
  { uid: 'm-low', first: 'Lee', last: 'Lowturn', role: 'None', votingStatus: 'Observer' },
  { uid: 'm-inactive-invited', first: 'Ira', last: 'Skipsall', role: 'None', votingStatus: 'Voting Rep' },
  { uid: 'm-inactive-never', first: 'Nova', last: 'Neverasked', role: 'None', votingStatus: 'Observer' },
  { uid: 'm-emeritus', first: 'Evan', last: 'Emeritus', role: 'None', votingStatus: 'Emeritus' },
];

export function buildRoster(): Record<string, unknown>[] {
  return ROSTER.map((seed) => ({
    uid: seed.uid,
    first_name: seed.first,
    last_name: seed.last,
    email: `${seed.uid}@example.org`,
    username: seed.uid,
    organization: { name: 'E2E Org' },
    role: { name: seed.role },
    voting: { status: seed.votingStatus },
  }));
}

/**
 * One engagement response per window; the 90d numbers differ from 30d so a window switch is
 * observable in the UI, not just on the network. `at_risk_count: 2` = m-low (Low) +
 * m-inactive-invited (Inactive with invites); m-inactive-never and m-emeritus are excluded by rule.
 */
export function buildEngagementResponse(window: CommitteeEngagementWindow, overrides: Partial<CommitteeEngagementResponse> = {}): CommitteeEngagementResponse {
  const is90d = window === '90d';
  return {
    members: [
      {
        uid: 'm-high',
        attended: is90d ? 20 : 12,
        invited: is90d ? 24 : 12,
        rate: is90d ? 0.83 : 1,
        classification: 'High',
        role: 'Chair',
        voting_status: 'Voting Rep',
        committee_meetings: is90d ? 24 : 12,
      },
      { uid: 'm-medium', attended: 7, invited: 12, rate: 0.58, classification: 'Medium', role: 'None', voting_status: 'Voting Rep', committee_meetings: 12 },
      { uid: 'm-low', attended: 2, invited: 10, rate: 0.2, classification: 'Low', role: 'None', voting_status: 'Observer', committee_meetings: 12 },
      {
        uid: 'm-inactive-invited',
        attended: 0,
        invited: 8,
        rate: 0,
        classification: 'Inactive',
        role: 'None',
        voting_status: 'Voting Rep',
        committee_meetings: 12,
      },
      {
        uid: 'm-inactive-never',
        attended: 0,
        invited: 0,
        rate: 0,
        classification: 'Inactive',
        role: 'None',
        voting_status: 'Observer',
        committee_meetings: 12,
      },
      { uid: 'm-emeritus', attended: 1, invited: 10, rate: 0.1, classification: 'Emeritus', role: 'None', voting_status: 'Emeritus', committee_meetings: 12 },
    ],
    summary: { attendance_rate: 0.78, active_count: 3, total_count: 6, at_risk_count: 2 },
    computed_at: null,
    data_available: true,
    data_source: 'live',
    ...overrides,
  };
}

export function buildDegradedEngagementResponse(window: CommitteeEngagementWindow): CommitteeEngagementResponse {
  const base = buildEngagementResponse(window);
  return {
    ...base,
    members: base.members.map((m) => ({
      ...m,
      attended: 0,
      invited: 0,
      rate: 0,
      committee_meetings: 0,
      classification: m.voting_status === 'Emeritus' ? 'Emeritus' : 'Inactive',
    })),
    summary: { attendance_rate: 0, active_count: 0, total_count: 6, at_risk_count: 0 },
    data_available: false,
  };
}

export interface EngagementMockHandle {
  requestedWindows: () => string[];
}

/**
 * Mock the engagement endpoint, serving `responseFor(window)` and recording every request's
 * resolved `window` param (the endpoint defaults an omitted param to 30d — mirrored here).
 */
export async function mockEngagementApi(
  page: Page,
  responseFor: (window: CommitteeEngagementWindow) => CommitteeEngagementResponse
): Promise<EngagementMockHandle> {
  const windows: string[] = [];
  await page.route(`**${ENGAGEMENT_PATH}*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    const window = (url.searchParams.get('window') ?? COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW) as CommitteeEngagementWindow;
    windows.push(window);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseFor(window)) });
  });
  return { requestedWindows: () => [...windows] };
}

/**
 * Mock the engagement endpoint as a hard failure (e.g. the expected 403 for non-auditor callers —
 * the endpoint is `committee#auditor`-gated, stricter than roster visibility). The service maps
 * any error to `null`, so the UI must degrade to its "unavailable" states with the roster intact.
 */
export async function mockEngagementFailure(page: Page, status: number): Promise<void> {
  await page.route(`**${ENGAGEMENT_PATH}*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) });
  });
}

/** Mock every non-engagement API the committee detail page touches, deterministically. */
export async function mockCommitteeShell(page: Page): Promise<void> {
  const uid = ENGAGEMENT_COMMITTEE_UID;
  await page.route(`**/api/committees/${uid}*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildEngagementCommittee()) });
  });
  await page.route(`**/api/committees/${uid}/children`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`**/api/committees/${uid}/members*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildRoster()) })
  );
  await page.route(`**/api/committees/${uid}/invites*`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`**/api/committees/${uid}/documents*`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/mailing-lists*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/user/pending-invitations', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/meetings/count*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0 }) }));
  await page.route('**/api/meetings*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/past-meetings*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/votes*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/surveys*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

/**
 * Block LaunchDarkly SDK traffic so the OpenFeature provider fails to initialize and
 * `wg-engagement-metrics` resolves to its `false` default — the deterministic flag-OFF path
 * (matching weekly-brief-card.spec.ts's blockLaunchDarkly).
 */
export async function blockLaunchDarkly(page: Page): Promise<void> {
  await page.route('**/*.launchdarkly.com/**', (route) => route.abort());
}

export async function gotoEngagementCommitteeTab(page: Page, tab: 'members' | 'overview'): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(`/groups/${ENGAGEMENT_COMMITTEE_UID}?tab=${tab}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
}
