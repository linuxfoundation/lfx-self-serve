// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { generateMockEngagementRows } from './committee-engagement-mock.helper';

function member(uid: string) {
  return { uid } as unknown as import('@lfx-one/shared/interfaces').CommitteeMember;
}

// A roster of 6+ so all 5 reserved slots plus at least one organic member are exercised.
const ROSTER = Array.from({ length: 8 }, (_, i) => member(`m${i}`));

describe('generateMockEngagementRows', () => {
  it('is deterministic: the same committee + roster produces identical rows on repeated calls', () => {
    const first = generateMockEngagementRows('committee-1', ROSTER);
    const second = generateMockEngagementRows('committee-1', ROSTER);
    expect(second).toEqual(first);
  });

  it('anchors every row to a real roster uid — one row per member, no extras or drops', () => {
    const rows = generateMockEngagementRows('committee-1', ROSTER);
    expect(rows.map((r) => r.MEMBER_USER_ID).sort()).toEqual(ROSTER.map((m) => m.uid).sort());
  });

  it('produces different numbers for the same member across different committees', () => {
    const rowsA = generateMockEngagementRows('committee-a', ROSTER);
    const rowsB = generateMockEngagementRows('committee-b', ROSTER);
    // At least one field differs for at least one member — proves the committee uid seeds the hash.
    expect(rowsA).not.toEqual(rowsB);
  });

  it('reserved slot 0 is Emeritus with near-100% invitation rate but ~5% attendance in every window', () => {
    const [row] = generateMockEngagementRows('committee-1', ROSTER);
    expect(row?.MEMBER_VOTING_STATUS).toBe('Emeritus');
    for (const suffix of ['30D', '90D', 'YTD'] as const) {
      const invited = row?.[`INVITED_COUNT_${suffix}`] as number;
      const attended = row?.[`ATTENDED_COUNT_${suffix}`] as number;
      expect(invited).toBeGreaterThan(0);
      expect(attended / invited).toBeLessThan(0.15);
    }
  });

  it('reserved slot 1 is the Orlin case: joined ~20 days ago, invited=attended=5 in every window', () => {
    const rows = generateMockEngagementRows('committee-1', ROSTER);
    const row = rows[1];
    expect(row?.INVITED_COUNT_30D).toBe(5);
    expect(row?.ATTENDED_COUNT_30D).toBe(5);
    expect(row?.INVITED_COUNT_90D).toBe(5);
    expect(row?.ATTENDED_COUNT_90D).toBe(5);
    expect(row?.INVITED_COUNT_YTD).toBe(5);
    expect(row?.ATTENDED_COUNT_YTD).toBe(5);
    const joinedDaysAgo = (Date.now() - new Date(row?.MEMBER_JOINED_AT as string).getTime()) / (24 * 60 * 60 * 1000);
    expect(joinedDaysAgo).toBeLessThan(30);
  });

  it('reserved slot 2 is Inactive: invited but never attends, in every window', () => {
    const rows = generateMockEngagementRows('committee-1', ROSTER);
    const row = rows[2];
    for (const suffix of ['30D', '90D', 'YTD'] as const) {
      expect(row?.[`INVITED_COUNT_${suffix}`]).toBeGreaterThan(0);
      expect(row?.[`ATTENDED_COUNT_${suffix}`]).toBe(0);
    }
  });

  it('reserved slot 3 is Low/at-risk: roughly 20% personal attendance', () => {
    const rows = generateMockEngagementRows('committee-1', ROSTER);
    const row = rows[3];
    const invited = row?.INVITED_COUNT_90D as number;
    const attended = row?.ATTENDED_COUNT_90D as number;
    expect(invited).toBeGreaterThan(0);
    expect(attended / invited).toBeCloseTo(0.2, 1);
  });

  it('reserved slot 4 is Medium: roughly 55% personal attendance', () => {
    const rows = generateMockEngagementRows('committee-1', ROSTER);
    const row = rows[4];
    const invited = row?.INVITED_COUNT_90D as number;
    const attended = row?.ATTENDED_COUNT_90D as number;
    expect(invited).toBeGreaterThan(0);
    expect(attended / invited).toBeCloseTo(0.55, 1);
  });

  it('values differ by window for a long-tenured member (30d < 90d < ytd invited counts)', () => {
    const rows = generateMockEngagementRows('committee-1', ROSTER);
    const row = rows[4]; // reserved Medium slot — long-tenured, so counts scale with window length
    expect(row?.INVITED_COUNT_30D).toBeLessThan(row?.INVITED_COUNT_90D as number);
    expect(row?.INVITED_COUNT_90D).toBeLessThanOrEqual(row?.INVITED_COUNT_YTD as number);
  });

  it('committee_meetings is shared across every member for the same window, not per-member', () => {
    const rows = generateMockEngagementRows('committee-1', ROSTER);
    const meetingsFor90d = new Set(rows.map((r) => r.COMMITTEE_MEETINGS_90D));
    expect(meetingsFor90d.size).toBe(1);
  });

  it('an organic (non-reserved) member gets a real profile with sane bounds', () => {
    const rows = generateMockEngagementRows('committee-1', ROSTER);
    const row = rows[5];
    expect(row).toBeDefined();
    for (const suffix of ['30D', '90D', 'YTD'] as const) {
      const invited = row?.[`INVITED_COUNT_${suffix}`] as number;
      const attended = row?.[`ATTENDED_COUNT_${suffix}`] as number;
      const meetings = row?.[`COMMITTEE_MEETINGS_${suffix}`] as number;
      expect(invited).toBeGreaterThanOrEqual(0);
      expect(invited).toBeLessThanOrEqual(meetings);
      expect(attended).toBeGreaterThanOrEqual(0);
      expect(attended).toBeLessThanOrEqual(invited);
    }
  });

  it('returns an empty array for an empty roster', () => {
    expect(generateMockEngagementRows('committee-1', [])).toEqual([]);
  });
});
