// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberRole, CommitteeMemberVotingStatus } from '@lfx-one/shared/enums';
import type { CommitteeEngagementWarehouseRow, CommitteeMember } from '@lfx-one/shared/interfaces';
import crypto from 'crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_30D_DAYS = 30;
const WINDOW_90D_DAYS = 90;
/** Floor used only for the three attendance-pattern demo slots (Inactive/Low/Medium — see `RESERVED_ATTENDANCE_PROFILES`), so a real member who happens to have joined recently still gets enough effective tenure for their forced rate to produce a meaningful (non-zero) invited count. */
const DEMO_TENURE_FLOOR_DAYS = 200;

/**
 * Deterministic mock-mode generator for `GET /api/committees/:uid/engagement` (LFXV2-1705),
 * selected by `isEngagementMockBackend()` while the real dbt model isn't deployed. Anchored to the
 * real committee roster (every row's `MEMBER_USER_ID` is a real `CommitteeMember.uid`).
 *
 * Only attendance numbers are fabricated — nothing about them exists anywhere yet. `MEMBER_ROLE`
 * and `MEMBER_JOINED_AT` are always the roster's real `role`/`created_at`, and `MEMBER_VOTING_STATUS`
 * prefers the real `voting.status` too, so this view never contradicts what the committee's real
 * Members table shows for the same person. The only synthetic identity data is a same-shape
 * fallback for members with no real voting status recorded, plus two roster-wide guarantees
 * (below) that only kick in when the real roster doesn't already exercise the scenario.
 *
 * Attendance numbers are a pure function of `(committeeUid, member.uid, window)` via SHA-256
 * hashing — no `Math.random()`/`Date.now()` in the formulas — so the same request produces the
 * same response on every reload, and different committees/members/windows produce different
 * numbers.
 */
export function generateMockEngagementRows(committeeUid: string, members: CommitteeMember[]): CommitteeEngagementWarehouseRow[] {
  const sortedMembers = [...members].sort((a, b) => a.uid.localeCompare(b.uid));
  const identities = resolveIdentities(committeeUid, sortedMembers);
  return sortedMembers.map((member, index) => buildMockRow(committeeUid, member, index, identities[index]));
}

interface ResolvedIdentity {
  votingStatus: CommitteeMemberVotingStatus | string;
  /** Real, parseable `created_at`, converted to days-ago; `null` when absent/unparseable. */
  realJoinedDaysAgo: number | null;
}

/**
 * Real `voting.status` wins whenever the roster reports one; members with none get an organic,
 * hash-derived placeholder. Two roster-wide guarantees apply only as a fallback, exactly once,
 * because they can't be satisfied per-member without risking a real contradiction:
 * - If nothing on the roster is naturally `Emeritus`, the first member with no real voting status
 *   is promoted to `Emeritus` — proves the classification short-circuit does something even
 *   against a committee with no real Emeritus members.
 * - Tenure-based recency ("the Orlin case") is handled separately in `buildMockRow`, since it
 *   depends on the per-window comparison, not just the roster-wide resolution done here.
 */
function resolveIdentities(committeeUid: string, sortedMembers: CommitteeMember[]): ResolvedIdentity[] {
  const identities = sortedMembers.map((member) => {
    const realVotingStatus = member.voting?.status;
    const hasRealVotingStatus = Boolean(realVotingStatus) && realVotingStatus !== CommitteeMemberVotingStatus.NONE;
    return {
      votingStatus: hasRealVotingStatus
        ? (realVotingStatus as CommitteeMemberVotingStatus)
        : organicVotingStatus(hashToUnitInterval(`${committeeUid}:${member.uid}:voting-status`)),
      realJoinedDaysAgo: parseRealJoinedDaysAgo(member),
      hasRealVotingStatus,
    };
  });

  const hasEmeritus = identities.some((identity) => identity.votingStatus === CommitteeMemberVotingStatus.EMERITUS);
  if (!hasEmeritus) {
    const fallbackIndex = identities.findIndex((identity) => !identity.hasRealVotingStatus);
    const index = fallbackIndex === -1 ? 0 : fallbackIndex;
    identities[index] = { ...identities[index], votingStatus: CommitteeMemberVotingStatus.EMERITUS };
  }

  return identities.map(({ votingStatus, realJoinedDaysAgo }) => ({ votingStatus, realJoinedDaysAgo }));
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
 * Attendance *patterns* only (never identity) reserved by sorted index, so every roster —
 * including a small unit-test fixture — visibly demonstrates all five classification tiers rather
 * than depending on the hash to produce every one by chance:
 * - index 1 ("Orlin case", only applied if the roster has no naturally-recent joiner — see
 *   `buildMockRow`): invited=attended=5 in every window, matching the ticket's literal example.
 * - index 2: long-tenured, invited but never attends → `Inactive`.
 * - index 3: long-tenured, ~20% personal attendance → `Low`/at-risk.
 * - index 4: long-tenured, ~55% personal attendance → `Medium`.
 * Index 0 gets no reserved attendance pattern — whichever member resolves to `Emeritus` (real or
 * the fallback in `resolveIdentities`) gets a forced low attendance rate directly in `buildMockRow`,
 * matching the model's real observed ~5%-attendance/~100%-invitation pattern for that seat type.
 */
const ORLIN_INDEX = 1;
const ORLIN_FALLBACK_JOINED_DAYS_AGO = 20;
const ORLIN_FORCED_COUNTS = { invited: 5, attended: 5 };

const RESERVED_ATTENDANCE_PROFILES: Record<number, Omit<AttendanceProfile, 'joinedDaysAgo'>> = {
  2: { invitationRate: 0.8, attendanceRateOverride: 0 },
  3: { invitationRate: 0.7, attendanceRateOverride: 0.2 },
  4: { invitationRate: 0.8, attendanceRateOverride: 0.55 },
};

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

function buildAttendanceProfile(
  committeeUid: string,
  memberUid: string,
  index: number,
  isEmeritus: boolean,
  realJoinedDaysAgo: number | null
): AttendanceProfile {
  const seed = `${committeeUid}:${memberUid}`;
  const fallbackJoinedDaysAgo = realJoinedDaysAgo ?? organicJoinedDaysAgo(hashToUnitInterval(`${seed}:tenure`));

  if (isEmeritus) {
    // Matches the model's real observed pattern (Jordan's Jira comment): near-total invitation
    // rate, ~5% attendance — proves the classifier's Emeritus short-circuit does something, since
    // these numbers alone would otherwise classify Inactive.
    return { joinedDaysAgo: Math.max(fallbackJoinedDaysAgo, DEMO_TENURE_FLOOR_DAYS), invitationRate: 0.97, attendanceRateOverride: 0.05 };
  }

  if (index === ORLIN_INDEX) {
    // Opposite of the other reserved slots: this scenario specifically needs *short* tenure, so a
    // real join date is used as-is only when it's already recent enough to tell the same story;
    // otherwise this is the one case where a short join date is forced rather than floored, since
    // "joined mid-window" is the entire point of the scenario.
    const joinedDaysAgo = realJoinedDaysAgo !== null && realJoinedDaysAgo < WINDOW_30D_DAYS ? realJoinedDaysAgo : ORLIN_FALLBACK_JOINED_DAYS_AGO;
    return { joinedDaysAgo, invitationRate: 1, forcedCounts: ORLIN_FORCED_COUNTS };
  }

  const reserved = RESERVED_ATTENDANCE_PROFILES[index];
  if (reserved) {
    // Reserved demo slots need enough tenure for their forced rate to produce a non-zero invited
    // count; a real member who happens to have joined very recently still gets the floor.
    return { joinedDaysAgo: Math.max(fallbackJoinedDaysAgo, DEMO_TENURE_FLOOR_DAYS), ...reserved };
  }

  return {
    joinedDaysAgo: fallbackJoinedDaysAgo,
    invitationRate: 0.4 + hashToUnitInterval(`${seed}:invitation-rate`) * 0.6,
  };
}

/** Personal invited/attended for one window, given a member's stable profile and that window's committee-wide meeting count. `effectiveDays` clips exposure to how long the member has actually been on the roster, so a recent joiner's numbers don't imply meetings that happened before they joined. */
function computeWindowCounts(
  committeeUid: string,
  memberUid: string,
  window: string,
  windowDays: number,
  committeeMeetings: number,
  profile: AttendanceProfile
): { invited: number; attended: number } {
  if (profile.forcedCounts) {
    // Clamped to the committee-wide ceiling: a very short `ytd` window early in the calendar year
    // can have fewer total meetings than the forced count, which would otherwise imply this
    // member was invited to more meetings than the committee held.
    const invited = Math.min(profile.forcedCounts.invited, committeeMeetings);
    return { invited, attended: Math.min(profile.forcedCounts.attended, invited) };
  }

  const effectiveDays = Math.min(windowDays, profile.joinedDaysAgo);
  const invited = Math.max(0, Math.round(committeeMeetings * (effectiveDays / windowDays) * profile.invitationRate));
  const attendanceRate = profile.attendanceRateOverride ?? hashToUnitInterval(`${committeeUid}:${memberUid}:${window}:attendance`);
  const attended = Math.min(Math.round(invited * attendanceRate), invited);
  return { invited, attended };
}

function buildMockRow(committeeUid: string, member: CommitteeMember, index: number, identity: ResolvedIdentity): CommitteeEngagementWarehouseRow {
  const isEmeritus = identity.votingStatus === CommitteeMemberVotingStatus.EMERITUS;
  const profile = buildAttendanceProfile(committeeUid, member.uid, index, isEmeritus, identity.realJoinedDaysAgo);

  const meetings30d = committeeMeetingsForWindow(committeeUid, WINDOW_30D_DAYS);
  const meetings90d = committeeMeetingsForWindow(committeeUid, WINDOW_90D_DAYS);
  const meetingsYtd = committeeMeetingsForWindow(committeeUid, windowYtdDays());

  const counts30d = computeWindowCounts(committeeUid, member.uid, '30d', WINDOW_30D_DAYS, meetings30d, profile);
  const counts90d = computeWindowCounts(committeeUid, member.uid, '90d', WINDOW_90D_DAYS, meetings90d, profile);
  const countsYtd = computeWindowCounts(committeeUid, member.uid, 'ytd', windowYtdDays(), meetingsYtd, profile);

  const joinedAt = member.created_at ?? new Date(todayUtcMidnightMs() - profile.joinedDaysAgo * DAY_MS).toISOString();

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
