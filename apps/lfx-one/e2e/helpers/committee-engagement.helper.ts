// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Shared fixtures/mocks for the committee engagement UI specs (LFXV2-1705).
 *
 * The engagement fixture exercises all six classification tiers the BFF can serve (High / Medium /
 * Low / Inactive / Emeritus / LF Staff, LFXV2-3101) over nine fixture scenarios (High, Inactive, and
 * the LF Staff *tier* each appear twice — m-lf-staff (Observer) and m-lf-staff-none (no voting
 * status, broadened in GH-1848) both classify LF Staff; the roster's second LF Staff-*role* seat,
 * m-lf-staff-rep, deliberately does NOT — it's a real Voting Rep) on a roster whose uids match the
 * mocked `/members` response, so
 * the Members-table join and the At-Risk filter behave exactly as they would against the real
 * endpoint. Specs mock the BFF over `page.route` and stay independent of the server's
 * ENGAGEMENT_BACKEND mode.
 */

import { COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW } from '@lfx-one/shared/constants';
import { CommitteeMemberVotingStatus } from '@lfx-one/shared/enums';
import type { CommitteeEngagementResponse, CommitteeEngagementWindow, CommitteeMemberEngagement } from '@lfx-one/shared/interfaces';
// Deep-imported (not the `@lfx-one/shared/utils` category barrel — mirroring the existing e2e
// precedent for deep `utils` imports in org-roi-summary.spec.ts / org-roi-projects.spec.ts /
// org-roi-project-detail.spec.ts / past-meeting-ai-summary-visibility.spec.ts) because the barrel's
// `index.ts` re-exports every utils
// file, including ones that import `@angular/forms`/`@angular/common/http`; Playwright's own module
// loader can't JIT-compile those. This single file's own runtime imports (both Angular-free:
// `../constants/committee-engagement.constants` and `../enums`) don't pull any of that in today, so
// importing it directly sidesteps the barrel entirely instead of hand-copying its predicate — but
// that's a property of its current import graph, not a guarantee; re-check if this file ever gains
// a new runtime dependency.
import { isCommitteeMemberActiveEligible, isLfStaffNonVotingSeat } from '@lfx-one/shared/utils/committee-engagement-classifier.utils';
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
    // Derived from ROSTER (declared below — safe, this function's body only runs at call time,
    // after the module has fully evaluated) rather than a hand-maintained literal, so adding a
    // roster seed can't silently desync this count again.
    total_members: ROSTER.length,
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
  // An LF Staff seat added as an Observer, with no real attendance expectation — must render its
  // own neutral tier, never Low/Inactive/at-risk styling.
  { uid: 'm-lf-staff', first: 'Sam', last: 'Staffer', role: 'LF Staff', votingStatus: 'Observer' },
  // An LF Staff member who is a real Voting Rep — an ED or staff member serving as a genuine
  // board/committee voting representative — must classify and count normally, NOT as the neutral
  // LF Staff tier. Only a non-voting staff seat (Observer, or no voting status at all) is excluded.
  { uid: 'm-lf-staff-rep', first: 'Priya', last: 'Repstaff', role: 'LF Staff', votingStatus: 'Voting Rep' },
  // A committee without voting leaves staff seats with no voting status recorded at all, not
  // Observer. Must render the same neutral LF Staff tier as m-lf-staff above, not the
  // tenure-grace High tier (GH-1848).
  { uid: 'm-lf-staff-none', first: 'Alex', last: 'Nonstatus', role: 'LF Staff', votingStatus: 'None' },
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

// The 30d/ytd engagement row per roster seat (COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS is
// ['30d', '90d', 'ytd'] — only 90d differs, via MEMBER_WINDOW_OVERRIDES below; ytd falls through to
// these same numbers, same as the ternary this replaced). Every row but m-high is window-
// independent, so one seat-identity array covers the non-90d windows instead of duplicating them.
const MEMBER_SEATS: CommitteeMemberEngagement[] = [
  { uid: 'm-high', attended: 12, invited: 12, rate: 1, classification: 'High', role: 'Chair', voting_status: 'Voting Rep', committee_meetings: 12 },
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
  {
    uid: 'm-lf-staff',
    attended: 0,
    invited: 8,
    rate: 0,
    classification: 'LF Staff',
    role: 'LF Staff',
    voting_status: 'Observer',
    committee_meetings: 12,
  },
  {
    uid: 'm-lf-staff-rep',
    attended: 8,
    invited: 10,
    rate: 0.8,
    classification: 'High',
    role: 'LF Staff',
    voting_status: 'Voting Rep',
    committee_meetings: 12,
  },
  {
    uid: 'm-lf-staff-none',
    attended: 0,
    invited: 0,
    rate: 0,
    classification: 'LF Staff',
    role: 'LF Staff',
    voting_status: 'None',
    committee_meetings: 12,
  },
];

// 90d-window overrides, keyed by uid — only m-high differs from the 30d numbers above. Typed to the
// attendance-count fields only (not the full row) so an override can't silently change a seat's
// uid/role/voting_status for one window and escape the drift guard below, which only validates
// MEMBER_SEATS. classification is excluded from the Pick too, but for a different reason: it isn't
// drift-guarded on either array (see the guard's own comment on that gap) — excluding it here just
// stops a window from flipping a seat's tier, it doesn't add coverage that was missing before.
const MEMBER_WINDOW_OVERRIDES: Record<string, Partial<Pick<CommitteeMemberEngagement, 'attended' | 'invited' | 'rate' | 'committee_meetings'>>> = {
  'm-high': { attended: 20, invited: 24, rate: 0.83, committee_meetings: 24 },
};

// ROSTER and MEMBER_SEATS are meant to stay 1:1 by uid, AND agree on role/voting status (every
// roster seed gets an engagement row under the same uid with the same seat type, so the
// Members-table join behaves as it would against the real endpoint — see this file's module doc);
// nothing else enforces that pairing. role/voting_status matter here, not just uid: the engagement
// row's copy feeds production classification (classifyCommitteeEngagement / isLfStaffNonVotingSeat;
// this file's degradedClassification mirrors only the seat-type short-circuits, not the rate tiers)
// and the chip tooltip (committee-members.component.ts's resolveEngagementContext), while the
// roster's copy separately drives the members-table chip filters (initChipFilteredMembers) —
// editing one without the other would pass a uid-only guard and only surface later as a confusing
// tier/chip mismatch, which is why this guard compares seat type too. It still does NOT check each
// row's hand-written `classification` against role/voting_status/attendance — that's on the editor
// making a seat-type change.
//
// Runs at module load (not inside buildEngagementResponse) so a drift throws at import time —
// Playwright reports this as a suite-collection error pointing at this exact file and line —
// rather than inside a page.route handler, where the same throw would surface indirectly as a
// hung/timed-out request instead.
const rosterSeats = ROSTER.map((seat) => `${seat.uid}|${seat.role}|${seat.votingStatus}`).join(',');
const memberSeats = MEMBER_SEATS.map((m) => `${m.uid}|${m.role}|${m.voting_status}`).join(',');
if (memberSeats !== rosterSeats) {
  throw new Error(`committee-engagement fixture drift: engagement rows [${memberSeats}] don't match ROSTER [${rosterSeats}]`);
}

/**
 * One engagement response per window; the 90d numbers differ from 30d (via
 * `MEMBER_WINDOW_OVERRIDES`) so a window switch is observable in the UI, not just on the network.
 * `at_risk_count: 2` = m-low (Low) + m-inactive-invited (Inactive with invites); m-inactive-never,
 * m-emeritus, m-lf-staff, and m-lf-staff-none are excluded by rule (Observer and None respectively,
 * GH-1848) — m-lf-staff-rep is NOT excluded (real Voting Rep, LFXV2-3101 follow-up) and counts like
 * any other real member. `eligible_count` is derived from `isCommitteeMemberActiveEligible` (the
 * real active_count/eligible_count denominator rule) rather than a hand-maintained literal, so it
 * can't drift from MEMBER_SEATS the way a re-typed count could. `active_count`/`at_risk_count`/
 * `attendance_rate` stay fixture literals — they don't need to recompute when a member's numbers
 * change, only to stay a plausible, internally-consistent snapshot alongside the derived count.
 */
export function buildEngagementResponse(window: CommitteeEngagementWindow, overrides: Partial<CommitteeEngagementResponse> = {}): CommitteeEngagementResponse {
  const windowOverrides = window === '90d' ? MEMBER_WINDOW_OVERRIDES : {};
  const members: CommitteeMemberEngagement[] = MEMBER_SEATS.map((seat) => ({ ...seat, ...windowOverrides[seat.uid] }));
  const eligibleCount = members.filter((m) => isCommitteeMemberActiveEligible({ role: m.role, votingStatus: m.voting_status })).length;
  return {
    members,
    // total_count is the full roster size; derived from the array actually returned so the two
    // can't desync.
    summary: { attendance_rate: 0.78, active_count: 4, eligible_count: eligibleCount, total_count: members.length, at_risk_count: 2 },
    computed_at: null,
    data_available: true,
    data_source: 'live',
    ...overrides,
  };
}

/**
 * Degraded-path classification: role/voting_status stay populated (roster passthroughs) even when
 * every count zeroes out, so the Emeritus/LF Staff+non-voting seat-type short-circuits still apply
 * — see `CommitteeEngagementResponse.data_available`'s doc. LF Staff alone is NOT enough (LFXV2-3101
 * follow-up) — m-lf-staff-rep (Voting Rep) must still degrade to Inactive like any other real
 * member. Delegates to the real `isLfStaffNonVotingSeat` (deep-imported above) rather than hand-
 * copying it, so this fixture can't silently drift from production's decision table (GH-1848).
 * This function's output isn't itself asserted on — the degraded UI renders every row's chip as a
 * plain em-dash regardless of classification, per `engagementDataAvailable()`'s gate in
 * committee-members.component.html — but the delegation still closes the drift risk of a second,
 * hand-maintained copy of the condition.
 */
function degradedClassification(member: { voting_status: string; role: string }): CommitteeMemberEngagement['classification'] {
  if (member.voting_status === CommitteeMemberVotingStatus.EMERITUS) return 'Emeritus';
  if (isLfStaffNonVotingSeat({ role: member.role, votingStatus: member.voting_status })) return 'LF Staff';
  return 'Inactive';
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
      classification: degradedClassification(m),
    })),
    // eligible_count and total_count stay roster-known (not zeroed) — spread from `base.summary`
    // rather than re-typed, so this can't drift from the fixture it's built on. See
    // CommitteeEngagementSummary.eligible_count's doc. A field added to that interface later
    // defaults to "roster-known, carries over from base" here unless explicitly zeroed above —
    // revisit this spread when the interface gains a field in the same attendance-derived class as
    // attendance_rate/active_count/at_risk_count.
    summary: { ...base.summary, attendance_rate: 0, active_count: 0, at_risk_count: 0 },
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
