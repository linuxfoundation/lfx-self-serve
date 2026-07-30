// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberRole, CommitteeMemberVotingStatus } from '@lfx-one/shared/enums';
import type { CommitteeEngagementWarehouseRow, CommitteeMember } from '@lfx-one/shared/interfaces';
import crypto from 'crypto';

/**
 * Deterministic mock-mode generator for `GET /api/committees/:uid/engagement` (LFXV2-1705),
 * selected by `isEngagementMockBackend()` while the real dbt model isn't deployed. Anchored to the
 * real committee roster (every row's `MEMBER_USER_ID` is a real `CommitteeMember.uid` — chips
 * attach to real rows), with fabricated but deterministic attendance data in the shape the
 * finalized `platinum_lfx_one_committee_meeting_attendance` model will eventually return.
 *
 * Everything is a pure function of `(committeeUid, member.uid, window)` via SHA-256 hashing — no
 * `Math.random()`/`Date.now()` in the numeric formulas — so the same request produces the same
 * response on every reload, and different committees/members/windows produce different numbers.
 *
 * The first five roster members (sorted by uid, for a stable ordering independent of whatever
 * order query-service returns) are reserved for guaranteed scenarios rather than left to chance:
 * a real roster could be too small, or the hash could simply not produce every required tier. The
 * remaining members are fully hash-derived, giving a real 255-member roster a realistic organic
 * spread on top of the five guaranteed cases.
 */
export function generateMockEngagementRows(committeeUid: string, members: CommitteeMember[]): CommitteeEngagementWarehouseRow[] {
  const sortedMembers = [...members].sort((a, b) => a.uid.localeCompare(b.uid));
  return sortedMembers.map((member, index) => buildMockRow(committeeUid, member, index));
}

const WINDOW_30D_DAYS = 30;
const WINDOW_90D_DAYS = 90;

/** Midnight UTC "today" — the anchor for both `windowYtdDays` and `MEMBER_JOINED_AT` below, so two calls within the same day produce byte-identical output (determinism would otherwise break on the millisecond `Date.now()` naturally advances between calls). */
function todayUtcMidnightMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Days since Jan 1 of the current year — the length of the `ytd` window, so its committee-meetings and invited/attended counts scale with how far into the year it is. */
function windowYtdDays(): number {
  const startOfYear = Date.UTC(new Date().getUTCFullYear(), 0, 1);
  return Math.max(1, Math.round((todayUtcMidnightMs() - startOfYear) / (24 * 60 * 60 * 1000)));
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

interface ReservedProfile {
  votingStatus: CommitteeMemberVotingStatus;
  role: CommitteeMemberRole;
  joinedDaysAgo: number;
  /** `undefined` lets the organic per-window hash decide; a number pins the same rate across all three windows. */
  attendanceRateOverride?: number;
  invitationRate: number;
  /** The "Orlin case" — invited/attended forced to exact values for every window, overriding the invitation/attendance-rate formula entirely. */
  forcedCounts?: { invited: number; attended: number };
}

/** Index 0-4 (sorted by uid) guarantee the scenarios LFXV2-1705's acceptance criteria require to be visible regardless of roster size or hash luck. */
const RESERVED_PROFILES: ReservedProfile[] = [
  // 0: Emeritus — near-total invitation rate, ~5% attendance, matching the model's real observed pattern. Proves the Emeritus short-circuit does something: absent it, this member's numbers alone would classify Inactive.
  {
    votingStatus: CommitteeMemberVotingStatus.EMERITUS,
    role: CommitteeMemberRole.NONE,
    joinedDaysAgo: 900,
    invitationRate: 0.97,
    attendanceRateOverride: 0.05,
  },
  // 1: "Orlin case" — joined ~20 days ago, invited=attended=5 in every window, matching the ticket's literal example.
  {
    votingStatus: CommitteeMemberVotingStatus.VOTING_REP,
    role: CommitteeMemberRole.CHAIR,
    joinedDaysAgo: 20,
    invitationRate: 1,
    forcedCounts: { invited: 5, attended: 5 },
  },
  // 2: Inactive — long-tenured, invited but never attends.
  { votingStatus: CommitteeMemberVotingStatus.VOTING_REP, role: CommitteeMemberRole.NONE, joinedDaysAgo: 900, invitationRate: 0.8, attendanceRateOverride: 0 },
  // 3: Low / at-risk — long-tenured, ~20% personal attendance.
  { votingStatus: CommitteeMemberVotingStatus.OBSERVER, role: CommitteeMemberRole.NONE, joinedDaysAgo: 900, invitationRate: 0.7, attendanceRateOverride: 0.2 },
  // 4: Medium — long-tenured, ~55% personal attendance.
  {
    votingStatus: CommitteeMemberVotingStatus.VOTING_REP,
    role: CommitteeMemberRole.NONE,
    joinedDaysAgo: 900,
    invitationRate: 0.8,
    attendanceRateOverride: 0.55,
  },
];

function organicVotingStatus(p: number): CommitteeMemberVotingStatus {
  if (p < 0.03) return CommitteeMemberVotingStatus.EMERITUS;
  if (p < 0.15) return CommitteeMemberVotingStatus.OBSERVER;
  if (p < 0.2) return CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP;
  return CommitteeMemberVotingStatus.VOTING_REP;
}

function organicRole(p: number): CommitteeMemberRole {
  if (p < 0.02) return CommitteeMemberRole.VICE_CHAIR;
  if (p < 0.04) return CommitteeMemberRole.SECRETARY;
  return CommitteeMemberRole.NONE;
}

function organicJoinedDaysAgo(p: number): number {
  // ~8% of an organic roster joined recently (5-25 days ago), exercising tenure clipping beyond
  // just the reserved "Orlin" slot; the rest joined long enough ago (200-1100 days) that tenure
  // clipping never applies to them (effective_days always equals the full window).
  if (p < 0.08) return Math.round(5 + p * 250);
  return Math.round(200 + p * 900);
}

interface MemberProfile {
  votingStatus: CommitteeMemberVotingStatus;
  role: CommitteeMemberRole;
  joinedDaysAgo: number;
  invitationRate: number;
  attendanceRateOverride?: number;
  forcedCounts?: { invited: number; attended: number };
}

function buildMemberProfile(committeeUid: string, memberUid: string, index: number): MemberProfile {
  const reserved = RESERVED_PROFILES[index];
  if (reserved) return reserved;

  const seed = `${committeeUid}:${memberUid}`;
  return {
    votingStatus: organicVotingStatus(hashToUnitInterval(`${seed}:voting-status`)),
    role: organicRole(hashToUnitInterval(`${seed}:role`)),
    joinedDaysAgo: organicJoinedDaysAgo(hashToUnitInterval(`${seed}:tenure`)),
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
  profile: MemberProfile
): { invited: number; attended: number } {
  if (profile.forcedCounts) return profile.forcedCounts;

  const effectiveDays = Math.min(windowDays, profile.joinedDaysAgo);
  const invited = Math.max(0, Math.round(committeeMeetings * (effectiveDays / windowDays) * profile.invitationRate));
  const attendanceRate = profile.attendanceRateOverride ?? hashToUnitInterval(`${committeeUid}:${memberUid}:${window}:attendance`);
  const attended = Math.min(Math.round(invited * attendanceRate), invited);
  return { invited, attended };
}

function buildMockRow(committeeUid: string, member: CommitteeMember, index: number): CommitteeEngagementWarehouseRow {
  const profile = buildMemberProfile(committeeUid, member.uid, index);

  const meetings30d = committeeMeetingsForWindow(committeeUid, WINDOW_30D_DAYS);
  const meetings90d = committeeMeetingsForWindow(committeeUid, WINDOW_90D_DAYS);
  const meetingsYtd = committeeMeetingsForWindow(committeeUid, windowYtdDays());

  const counts30d = computeWindowCounts(committeeUid, member.uid, '30d', WINDOW_30D_DAYS, meetings30d, profile);
  const counts90d = computeWindowCounts(committeeUid, member.uid, '90d', WINDOW_90D_DAYS, meetings90d, profile);
  const countsYtd = computeWindowCounts(committeeUid, member.uid, 'ytd', windowYtdDays(), meetingsYtd, profile);

  const joinedAt = new Date(todayUtcMidnightMs() - profile.joinedDaysAgo * 24 * 60 * 60 * 1000).toISOString();

  return {
    MEMBER_USER_ID: member.uid,
    MEMBER_JOINED_AT: joinedAt,
    MEMBER_ROLE: profile.role,
    MEMBER_VOTING_STATUS: profile.votingStatus,
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
