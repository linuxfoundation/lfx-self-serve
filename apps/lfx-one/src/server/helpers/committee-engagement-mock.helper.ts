// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberRole, CommitteeMemberVotingStatus } from '@lfx-one/shared/enums';
import type { CommitteeEngagementWarehouseRow, CommitteeMember } from '@lfx-one/shared/interfaces';
import crypto from 'crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_30D_DAYS = 30;
const WINDOW_90D_DAYS = 90;
/**
 * Fallback tenure (days) used only when a member has no *usable* real `created_at` (absent, or
 * present but unparseable — see `parseRealJoinedDaysAgo`) — a fully synthetic identity, never a
 * real one being overridden. Applied to the Emeritus slot and the three attendance-pattern demo
 * slots (Inactive/Low/Medium) alike; a member with usable real tenure data — however short —
 * always uses that instead, and `MEMBER_JOINED_AT` is derived from this same fallback whenever
 * it's used, so the emitted date and the numbers computed from it never disagree.
 */
const DEMO_TENURE_FALLBACK_DAYS = 200;
const ORLIN_FORCED_COUNTS = { invited: 5, attended: 5 };

/**
 * Deterministic mock-mode generator for `GET /api/committees/:uid/engagement` (LFXV2-1705),
 * selected by `isEngagementMockBackend()` while the real dbt model isn't deployed. Anchored to the
 * real committee roster (every row's `MEMBER_USER_ID` is a real `CommitteeMember.uid`).
 *
 * Only attendance numbers are fabricated. `MEMBER_ROLE` is always the roster's real `role` (or
 * `'None'` if unset), and `MEMBER_JOINED_AT` is the real `created_at` whenever it parses (see
 * `parseRealJoinedDaysAgo` — a present-but-invalid value is treated the same as absent, never
 * passed through raw). Every fabricated attendance number is computed against that same tenure:
 * for most profiles this is an explicit `effectiveDays` clamp in `computeWindowCounts`; the "Orlin
 * case"'s forced counts skip that clamp, so eligibility for the role itself is gated instead (see
 * `planRosterIdentities`) on tenure long enough that the forced count stays plausible. Either way,
 * a member's numbers never imply meetings that happened before their shown join date.
 * `MEMBER_VOTING_STATUS` prefers the real `voting.status` too — including a real `'None'`, which is
 * itself a recorded status and never overwritten — falling back to a hash-derived placeholder only
 * for members with no usable real status (no `voting` recorded, or a blank/falsy `status`). Two
 * scenarios (`Emeritus`, "the Orlin case" —
 * see below) are guaranteed visible somewhere in the roster whenever that's possible without
 * overriding a real, known value; when every member's real data already rules a scenario out
 * (e.g. every member has a real non-`Emeritus` status), that scenario simply isn't demonstrated
 * for this specific committee rather than being faked.
 *
 * Every number is derived from stable inputs only — `committeeUid`, `member.uid`, `window`,
 * the member's real `created_at`/`voting.status` where present, the rest of the roster's identity
 * plan, and the current UTC date (via `todayUtcMidnightMs()` — sets the `ytd` window's length, and
 * every member's days-ago tenure, so a member with under-window real tenure can shift by one day's
 * worth of exposure across a UTC day boundary) — combined via SHA-256 hashing, never
 * `Math.random()` or a per-call `Date.now()`. So the same request produces the same response on
 * every reload within a UTC day, and different committees/members/windows produce different
 * numbers.
 */
export function generateMockEngagementRows(committeeUid: string, members: CommitteeMember[]): CommitteeEngagementWarehouseRow[] {
  const sortedMembers = [...members].sort((a, b) => a.uid.localeCompare(b.uid));
  const plan = planRosterIdentities(committeeUid, sortedMembers);
  return sortedMembers.map((member, index) => buildMockRow(committeeUid, member, index, plan));
}

interface MemberIdentity {
  votingStatus: CommitteeMemberVotingStatus;
  /** Real, parseable `created_at` converted to days-ago; `null` when absent/unparseable — the only case a fabricated tenure default is used. */
  realJoinedDaysAgo: number | null;
}

interface RosterPlan {
  identities: MemberIdentity[];
  /** Sorted index of the member demonstrating the "Orlin case" (forced low-but-100%-rate counts); `null` when no member (excluding any `Emeritus`) can take the role without contradicting real tenure data. */
  orlinIndex: number | null;
  /** Tenure (days) to use for `orlinIndex` when that member has no real join date — computed per committee so the forced counts stay plausible against this committee's own real 30-day meeting cadence; unused when `orlinIndex` is `null` or has real tenure data. */
  orlinFallbackJoinedDaysAgo: number;
  /**
   * Every sorted index except `orlinIndex` and any `Emeritus` member (real or promoted), in
   * order — i.e. every member eligible for a reserved pattern. Only the first
   * `DEMO_ATTENDANCE_PROFILES.length` of these actually receive one (Inactive/Low/Medium); the
   * rest are organic. Kept as a plain eligibility list rather than pre-sliced so
   * `buildAttendanceProfile` can compute the same boundary once, from `indexOf`, for both the
   * tenure default and the pattern assignment.
   */
  demoAttendanceIndices: number[];
}

/**
 * Resolves per-member identity plus which members (if any) take on the two guaranteed
 * demonstration roles, in one pass so both guarantees can be skipped independently when the real
 * roster doesn't leave room for them:
 * - `Emeritus`: real `voting.status` wins for every member — including a real `None`, which is a
 *   recorded status like any other, not an absence of one; if nothing on the roster is naturally
 *   `Emeritus`, the first member with no usable real status (no `voting` recorded, or a blank/falsy
 *   `status`) is promoted — but only that one case. If every member already has a real, known status
 *   (including a committee where everyone is `None` — the common case for a committee without
 *   voting enabled), no member is promoted;
 *   this committee's mock output just won't include an `Emeritus` row. This trades away some demo
 *   value (Emeritus is what proves the classifier's Emeritus short-circuit and the `active_count`
 *   exclusion) for the stronger guarantee of never relabeling a real, recorded status — the same
 *   trade this file makes for tenure data (see the "Known trade-off" note below).
 * - "The Orlin case": eligible candidates exclude every `Emeritus` member (real or promoted) — the
 *   Emeritus profile always takes precedence in `buildAttendanceProfile`, so an Emeritus candidate
 *   would silently swallow the slot without ever rendering it. Among the rest, the most-recently
 *   real-joined member is used *only* if their tenure is at least `minOrlinTenureDays` *and* less
 *   than `WINDOW_30D_DAYS` — the upper bound keeps this specifically the "joined *recently*" case
 *   (the ticket's literal example) rather than any tenured member who happens to clear the lower
 *   bound; without it, nearly every real committee would show the scenario, but on whichever
 *   member happens to be the most recently real-joined eligible one — on a mature roster, likely
 *   someone with years of tenure, not a recent joiner. Otherwise, the first member with no
 *   real join date at all is fabricated exactly `minOrlinTenureDays` of tenure — the shortest
 *   tenure that's still self-consistent with the forced count for *this* committee's cadence. If
 *   every member has real (and either too-recent or too-long) tenure data, no member takes this
 *   role.
 *
 * Known trade-off: `CommitteeMember.created_at` is a required field on real roster data (see
 * `member.interface.ts`), so the "no real join date at all" fallback branch above almost never
 * fires against a real committee — the Orlin case only renders when some real member's tenure
 * happens to land in `[minOrlinTenureDays, WINDOW_30D_DAYS)`, a roughly 5-15 day window. Widening
 * or dropping the upper bound would make the scenario reachable on nearly every real committee
 * without touching any real join date — but at the cost of it no longer demonstrating a *recently
 * joined* member, which is the point of the Orlin case (see above). The remaining alternative,
 * overriding a real member's real join date, is rejected outright: that's the one thing this
 * generator otherwise never does, and would make an already-real person's mock data lie about them
 * specifically. Test fixtures with at least two members and neither real `created_at` nor real
 * `voting.status` data exercise the scenario (both fallbacks in `planRosterIdentities` then have a
 * distinct index to claim); real committees may or may not, depending on roster composition.
 */
function planRosterIdentities(committeeUid: string, sortedMembers: CommitteeMember[]): RosterPlan {
  const meetings30d = committeeMeetingsForWindow(committeeUid, WINDOW_30D_DAYS);
  const minOrlinTenureDays = Math.min(WINDOW_30D_DAYS - 1, Math.ceil((ORLIN_FORCED_COUNTS.invited * WINDOW_30D_DAYS) / meetings30d));

  // `NONE` is itself a real, recorded status (a member who genuinely has no voting role) — distinct
  // from `voting` being absent/null, or `voting.status` being an empty/blank passthrough value (no
  // data recorded at all, either way). Only those latter cases count as "no real status" for the
  // Emeritus fallback below; `||`, not `??`, so a falsy-but-non-`NONE` status (e.g. `''`) still
  // falls through instead of being treated as real and blocking the fallback.
  const realVotingStatuses = sortedMembers.map((member) => member.voting?.status || null);
  const realJoinedDaysAgo = sortedMembers.map(parseRealJoinedDaysAgo);

  const votingStatuses = realVotingStatuses.map(
    (real, index) => real ?? organicVotingStatus(hashToUnitInterval(`${committeeUid}:${sortedMembers[index]?.uid}:voting-status`))
  );
  // The two fallback assignments below both prefer "the first member with no real data of the
  // relevant kind" — on a roster with no real data at all (e.g. a bare test fixture), that's the
  // same index for both, so the second fallback must skip whichever index the first one already
  // claimed, or one member would need to simultaneously be Emeritus and the Orlin case.
  let emeritusFallbackIndex = -1;
  if (!votingStatuses.includes(CommitteeMemberVotingStatus.EMERITUS)) {
    emeritusFallbackIndex = realVotingStatuses.findIndex((real) => real === null);
    if (emeritusFallbackIndex !== -1) votingStatuses[emeritusFallbackIndex] = CommitteeMemberVotingStatus.EMERITUS;
  }

  const isEmeritus = (index: number): boolean => votingStatuses[index] === CommitteeMemberVotingStatus.EMERITUS;

  let orlinIndex = realJoinedDaysAgo.reduce<number | null>((mostRecentIndex, days, index) => {
    if (days === null || days < minOrlinTenureDays || days >= WINDOW_30D_DAYS || isEmeritus(index)) return mostRecentIndex;
    if (mostRecentIndex === null || days < (realJoinedDaysAgo[mostRecentIndex] as number)) return index;
    return mostRecentIndex;
  }, null);
  if (orlinIndex === null) {
    const fallbackIndex = realJoinedDaysAgo.findIndex((days, index) => days === null && !isEmeritus(index));
    orlinIndex = fallbackIndex === -1 ? null : fallbackIndex;
  }

  const demoAttendanceIndices = sortedMembers.map((_, index) => index).filter((index) => index !== orlinIndex && !isEmeritus(index));

  return {
    identities: sortedMembers.map((_, index) => ({
      votingStatus: votingStatuses[index] as CommitteeMemberVotingStatus,
      realJoinedDaysAgo: realJoinedDaysAgo[index] as number | null,
    })),
    orlinIndex,
    orlinFallbackJoinedDaysAgo: minOrlinTenureDays,
    demoAttendanceIndices,
  };
}

function parseRealJoinedDaysAgo(member: CommitteeMember): number | null {
  const createdAt = member.created_at ? new Date(member.created_at) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return null;
  return Math.max(0, Math.round((todayUtcMidnightMs() - createdAt.getTime()) / DAY_MS));
}

/** Midnight UTC "today" — the anchor for `windowYtdDays` and the join-date fallback below, so two calls within the same day produce byte-identical output (determinism would otherwise break on the millisecond `Date.now()` naturally advances between calls). */
function todayUtcMidnightMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Days since Jan 1 of the current year — the length of the `ytd` window, so its committee-meetings and invited/attended counts scale with how far into the year it is. */
function windowYtdDays(): number {
  const startOfYear = Date.UTC(new Date().getUTCFullYear(), 0, 1);
  return Math.max(1, Math.round((todayUtcMidnightMs() - startOfYear) / DAY_MS));
}

/** Stable float in `[0, 1)` derived from `seed` — the only source of "randomness" anywhere in this generator. */
function hashToUnitInterval(seed: string): number {
  const hex = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8);
  return parseInt(hex, 16) / 0x100000000;
}

/** One value per `(committeeUid, windowDays)` — committee-wide, shared across every member's row for that window, never per-member. */
function committeeMeetingsForWindow(committeeUid: string, windowDays: number): number {
  const meetingsPerDay = 0.2 + hashToUnitInterval(`${committeeUid}:meetings-per-day`) * 0.15;
  return Math.max(1, Math.round(windowDays * meetingsPerDay));
}

interface AttendanceProfile {
  joinedDaysAgo: number;
  invitationRate: number;
  /** `undefined` lets the per-window hash decide; a number pins the same rate across all three windows. */
  attendanceRateOverride?: number;
  /** The "Orlin case" — invited/attended forced to exact values for every window, overriding the invitation/attendance-rate formula entirely. */
  forcedCounts?: { invited: number; attended: number };
}

/**
 * The three attendance *patterns* (never identity) demonstrating Inactive/Low/Medium, assigned in
 * `RosterPlan.demoAttendanceIndices` order (not fixed sorted positions — see `planRosterIdentities`
 * for why the assignable set excludes the Orlin and any real-Emeritus members).
 */
const DEMO_ATTENDANCE_PROFILES: Omit<AttendanceProfile, 'joinedDaysAgo'>[] = [
  { invitationRate: 0.8, attendanceRateOverride: 0 }, // Inactive: invited but never attends.
  { invitationRate: 0.7, attendanceRateOverride: 0.2 }, // Low / at-risk: ~20% personal attendance.
  { invitationRate: 0.8, attendanceRateOverride: 0.55 }, // Medium: ~55% personal attendance.
];

function organicVotingStatus(p: number): CommitteeMemberVotingStatus {
  if (p < 0.15) return CommitteeMemberVotingStatus.OBSERVER;
  if (p < 0.2) return CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP;
  return CommitteeMemberVotingStatus.VOTING_REP;
}

function organicJoinedDaysAgo(p: number): number {
  // ~8% of an organic roster (when no real join date is available) is treated as recently joined
  // (5-25 days ago), exercising tenure clipping; the rest are long enough ago (200-1100 days) that
  // tenure clipping never applies (effective_days always equals the full window).
  if (p < 0.08) return Math.round(5 + p * 250);
  return Math.round(200 + p * 900);
}

function buildAttendanceProfile(committeeUid: string, member: CommitteeMember, index: number, identity: MemberIdentity, plan: RosterPlan): AttendanceProfile {
  const seed = `${committeeUid}:${member.uid}`;
  const isEmeritus = identity.votingStatus === CommitteeMemberVotingStatus.EMERITUS;
  // Only the first `DEMO_ATTENDANCE_PROFILES.length` of `demoAttendanceIndices` actually receive a
  // reserved pattern below (the rest are organic) — the tenure floor must line up with that same
  // boundary, or an organic member would get flattened to exactly `DEMO_TENURE_FALLBACK_DAYS`
  // instead of `organicJoinedDaysAgo`'s varied range.
  const demoSlot = plan.demoAttendanceIndices.indexOf(index);
  const isReservedDemoSlot = demoSlot >= 0 && demoSlot < DEMO_ATTENDANCE_PROFILES.length;
  // Usable real tenure always wins when it exists, however short. The fabricated defaults below
  // apply only when there's none to use (`identity.realJoinedDaysAgo === null`) — the same case in
  // which `buildMockRow` derives `MEMBER_JOINED_AT` from this value instead of `member.created_at`
  // — so whichever tenure is used here is always the one the emitted join date agrees with.
  const joinedDaysAgo =
    identity.realJoinedDaysAgo ?? (isEmeritus || isReservedDemoSlot ? DEMO_TENURE_FALLBACK_DAYS : organicJoinedDaysAgo(hashToUnitInterval(`${seed}:tenure`)));

  if (isEmeritus) {
    // Matches the model's real observed pattern (Jordan's Jira comment): near-total invitation
    // rate, ~5% attendance — proves the classifier's Emeritus short-circuit does something, since
    // these numbers alone would otherwise classify Inactive.
    return { joinedDaysAgo, invitationRate: 0.97, attendanceRateOverride: 0.05 };
  }

  if (index === plan.orlinIndex) {
    return { joinedDaysAgo: identity.realJoinedDaysAgo ?? plan.orlinFallbackJoinedDaysAgo, invitationRate: 1, forcedCounts: ORLIN_FORCED_COUNTS };
  }

  if (isReservedDemoSlot) {
    return { joinedDaysAgo, ...DEMO_ATTENDANCE_PROFILES[demoSlot] };
  }

  return {
    joinedDaysAgo,
    invitationRate: 0.4 + hashToUnitInterval(`${seed}:invitation-rate`) * 0.6,
  };
}

/** Personal invited/attended for one window, given a member's stable profile and that window's committee-wide meeting count. For every profile except a forced-count one (the "Orlin case"), `effectiveDays` clips exposure to how long the member has actually been on the roster, so a recent joiner's numbers don't imply meetings that happened before they joined; the forced-count path skips this and is instead kept plausible by an eligibility gate on who can hold that role at all (see `planRosterIdentities`'s `minOrlinTenureDays`). */
function computeWindowCounts(
  committeeUid: string,
  memberUid: string,
  window: string,
  windowDays: number,
  committeeMeetings: number,
  profile: AttendanceProfile
): { invited: number; attended: number } {
  if (profile.forcedCounts) {
    // Only clamped to the committee-wide ceiling here — a very short `ytd` window early in the
    // calendar year can have fewer total meetings than the forced count, which would otherwise
    // imply this member was invited to more meetings than the committee held. Tenure plausibility
    // (this member couldn't honestly show 5 real invites if they joined yesterday) is enforced
    // earlier, as an eligibility gate on who can be assigned this role at all — see
    // `planRosterIdentities`'s `minOrlinTenureDays` — rather than by scaling the count down here.
    const invited = Math.min(profile.forcedCounts.invited, committeeMeetings);
    return { invited, attended: Math.min(profile.forcedCounts.attended, invited) };
  }

  const effectiveDays = Math.min(windowDays, profile.joinedDaysAgo);
  const invited = Math.max(0, Math.round(committeeMeetings * (effectiveDays / windowDays) * profile.invitationRate));
  const attendanceRate = profile.attendanceRateOverride ?? hashToUnitInterval(`${committeeUid}:${memberUid}:${window}:attendance`);
  const attended = Math.min(Math.round(invited * attendanceRate), invited);
  return { invited, attended };
}

function buildMockRow(committeeUid: string, member: CommitteeMember, index: number, plan: RosterPlan): CommitteeEngagementWarehouseRow {
  const identity = plan.identities[index] as MemberIdentity;
  const profile = buildAttendanceProfile(committeeUid, member, index, identity, plan);

  const meetings30d = committeeMeetingsForWindow(committeeUid, WINDOW_30D_DAYS);
  const meetings90d = committeeMeetingsForWindow(committeeUid, WINDOW_90D_DAYS);
  const meetingsYtd = committeeMeetingsForWindow(committeeUid, windowYtdDays());

  const counts30d = computeWindowCounts(committeeUid, member.uid, '30d', WINDOW_30D_DAYS, meetings30d, profile);
  const counts90d = computeWindowCounts(committeeUid, member.uid, '90d', WINDOW_90D_DAYS, meetings90d, profile);
  const countsYtd = computeWindowCounts(committeeUid, member.uid, 'ytd', windowYtdDays(), meetingsYtd, profile);

  // Keyed off `identity.realJoinedDaysAgo`, not `member.created_at` truthiness directly — a
  // present-but-unparseable `created_at` is a non-empty string (truthy), which would otherwise
  // leak the raw invalid value here while the counts above were computed against the fabricated
  // fallback tenure. `realJoinedDaysAgo` is `parseRealJoinedDaysAgo`'s authoritative "was there
  // usable real tenure" signal, so checking it keeps this and `profile.joinedDaysAgo` consistent.
  const joinedAt = identity.realJoinedDaysAgo !== null ? member.created_at : new Date(todayUtcMidnightMs() - profile.joinedDaysAgo * DAY_MS).toISOString();

  return {
    MEMBER_USER_ID: member.uid,
    MEMBER_JOINED_AT: joinedAt,
    MEMBER_ROLE: member.role?.name ?? CommitteeMemberRole.NONE,
    MEMBER_VOTING_STATUS: identity.votingStatus,
    INVITED_COUNT_30D: counts30d.invited,
    ATTENDED_COUNT_30D: counts30d.attended,
    COMMITTEE_MEETINGS_30D: meetings30d,
    INVITED_COUNT_90D: counts90d.invited,
    ATTENDED_COUNT_90D: counts90d.attended,
    COMMITTEE_MEETINGS_90D: meetings90d,
    INVITED_COUNT_YTD: countsYtd.invited,
    ATTENDED_COUNT_YTD: countsYtd.attended,
    COMMITTEE_MEETINGS_YTD: meetingsYtd,
  };
}
