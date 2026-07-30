// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { generateMockEngagementRows } from './committee-engagement-mock.helper';

function member(uid: string, overrides: Partial<import('@lfx-one/shared/interfaces').CommitteeMember> = {}) {
  return { uid, ...overrides } as unknown as import('@lfx-one/shared/interfaces').CommitteeMember;
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

  it('reserved slot 1 is the Orlin case: joined recently (within the plausible-tenure fallback), invited=attended=5 in every window', () => {
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

  it('gives organic members varied tenure, not the demo-slot tenure floor flattened across all of them', () => {
    // Regression: the eligibility list for the 3 reserved demo patterns (indices 2-4 in a bare
    // roster) previously also matched every later organic member (5+), flattening all of their
    // fallback tenure to the same fixed floor instead of organicJoinedDaysAgo's varied range.
    const rows = generateMockEngagementRows('committee-1', ROSTER);
    const organicJoinDates = rows.slice(5).map((r) => r.MEMBER_JOINED_AT);
    expect(new Set(organicJoinDates).size).toBeGreaterThan(1);
  });

  it('invited never exceeds committee_meetings for any row, including the forced-count Orlin slot', () => {
    const rows = generateMockEngagementRows('committee-1', ROSTER);
    for (const row of rows) {
      for (const suffix of ['30D', '90D', 'YTD'] as const) {
        expect(row[`INVITED_COUNT_${suffix}`]).toBeLessThanOrEqual(row[`COMMITTEE_MEETINGS_${suffix}`]);
        expect(row[`ATTENDED_COUNT_${suffix}`]).toBeLessThanOrEqual(row[`INVITED_COUNT_${suffix}`]);
      }
    }
  });

  describe('real roster identity data (never fabricated)', () => {
    it('always passes through the real role, never a synthesized one', () => {
      const roster = [member('m0', { role: { name: 'Chair' } as never }), member('m1', { role: { name: 'Secretary' } as never }), ...ROSTER.slice(2)];
      const rows = generateMockEngagementRows('committee-1', roster);
      expect(rows.find((r) => r.MEMBER_USER_ID === 'm0')?.MEMBER_ROLE).toBe('Chair');
      expect(rows.find((r) => r.MEMBER_USER_ID === 'm1')?.MEMBER_ROLE).toBe('Secretary');
    });

    it('defaults role to None when the roster has no real role, rather than fabricating one', () => {
      const rows = generateMockEngagementRows('committee-1', [member('m0')]);
      expect(rows[0]?.MEMBER_ROLE).toBe('None');
    });

    it('always passes through the real created_at as MEMBER_JOINED_AT', () => {
      const realJoinDate = '2019-03-01T00:00:00.000Z';
      const rows = generateMockEngagementRows('committee-1', [member('m0', { created_at: realJoinDate }), ...ROSTER.slice(1)]);
      expect(rows.find((r) => r.MEMBER_USER_ID === 'm0')?.MEMBER_JOINED_AT).toBe(realJoinDate);
    });

    it('prefers a real non-None voting status over fabrication, even at the reserved Emeritus slot', () => {
      const roster = [member('m0', { voting: { status: 'Observer' } as never }), ...ROSTER.slice(1)];
      const rows = generateMockEngagementRows('committee-1', roster);
      expect(rows.find((r) => r.MEMBER_USER_ID === 'm0')?.MEMBER_VOTING_STATUS).toBe('Observer');
    });

    it('does not force an Emeritus override anywhere when the roster already has a real one', () => {
      const roster = [
        member('m0', { voting: { status: 'Voting Rep' } as never }),
        member('m1', { voting: { status: 'Emeritus' } as never }),
        ...ROSTER.slice(2),
      ];
      const rows = generateMockEngagementRows('committee-1', roster);
      const emeritusRows = rows.filter((r) => r.MEMBER_VOTING_STATUS === 'Emeritus');
      expect(emeritusRows).toHaveLength(1);
      expect(emeritusRows[0]?.MEMBER_USER_ID).toBe('m1');
      expect(rows.find((r) => r.MEMBER_USER_ID === 'm0')?.MEMBER_VOTING_STATUS).toBe('Voting Rep');
    });

    it('still guarantees an Emeritus member (fallback) when no real member has one', () => {
      const roster = [member('m0', { voting: { status: 'Voting Rep' } as never }), ...ROSTER.slice(1)];
      const rows = generateMockEngagementRows('committee-1', roster);
      expect(rows.some((r) => r.MEMBER_VOTING_STATUS === 'Emeritus')).toBe(true);
      // The member with a real (non-Emeritus) status is never the one overridden.
      expect(rows.find((r) => r.MEMBER_USER_ID === 'm0')?.MEMBER_VOTING_STATUS).toBe('Voting Rep');
    });

    it('never assigns the Orlin case to a real Emeritus member, even if they are the most-recently-joined real member — a different eligible member takes it instead', () => {
      // Regression: buildAttendanceProfile checks isEmeritus before the Orlin slot, so an
      // Emeritus candidate would silently absorb the role without ever rendering forced counts —
      // and without redirecting to anyone else. Asserting only "the Emeritus member doesn't show
      // 5/5" isn't enough to catch that: it's also true, coincidentally, in some cases even without
      // the exclusion, since the Emeritus profile's own numbers rarely happen to equal 5/5 anyway.
      // The real assertion is that *someone else* renders the scenario once the most-recent
      // candidate is excluded for being Emeritus.
      const mostRecentJoin = new Date(Date.now() - 27 * 24 * 60 * 60 * 1000).toISOString();
      const secondMostRecentJoin = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
      const roster = [
        member('m0', { voting: { status: 'Emeritus' } as never, created_at: mostRecentJoin }),
        member('m1', { voting: { status: 'Voting Rep' } as never, created_at: secondMostRecentJoin }),
        ...ROSTER.slice(2),
      ];
      const rows = generateMockEngagementRows('committee-1', roster);
      const m0 = rows.find((r) => r.MEMBER_USER_ID === 'm0');
      const m1 = rows.find((r) => r.MEMBER_USER_ID === 'm1');
      expect(m0?.MEMBER_VOTING_STATUS).toBe('Emeritus');
      expect(m0?.INVITED_COUNT_30D).not.toBe(5);
      expect(m1).toMatchObject({ INVITED_COUNT_30D: 5, ATTENDED_COUNT_30D: 5, MEMBER_JOINED_AT: secondMostRecentJoin });
    });

    it('does not force the literal Orlin counts on a real member whose tenure is too short to plausibly support them', () => {
      // A member who really joined yesterday cannot honestly show 5 real meetings attended,
      // regardless of the ticket's literal example — the forced counts must stay off unless real
      // (or fabricated-fallback) tenure is long enough for this committee's real meeting cadence.
      const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
      const roster = [member('m0'), member('m1', { created_at: yesterday }), ...ROSTER.slice(2)];
      const rows = generateMockEngagementRows('committee-1', roster);
      const row = rows.find((r) => r.MEMBER_USER_ID === 'm1');
      expect(row?.MEMBER_JOINED_AT).toBe(yesterday);
      expect(row?.INVITED_COUNT_30D).not.toBe(5);
      expect(row?.INVITED_COUNT_30D as number).toBeLessThanOrEqual(1);
    });

    it('a present but unparseable created_at is treated as absent, not passed through raw', () => {
      const rows = generateMockEngagementRows('committee-1', [member('m0', { created_at: 'not-a-real-date' }), ...ROSTER.slice(1)]);
      const row = rows.find((r) => r.MEMBER_USER_ID === 'm0');
      expect(row?.MEMBER_JOINED_AT).not.toBe('not-a-real-date');
      expect(Number.isNaN(new Date(row?.MEMBER_JOINED_AT as string).getTime())).toBe(false);
    });

    it('a real, already-recent join date exercises the Orlin scenario organically (forced invited=attended=5), not just a passthrough date', () => {
      // 27 days: recent enough to be Orlin-eligible (< 30d) but comfortably above
      // minOrlinTenureDays for any committee-meetings cadence this generator can produce (the
      // 15-day value this test previously used could fall below that per-committee threshold —
      // see the tenure-plausibility test below for the case where it does).
      const recentJoin = new Date(Date.now() - 27 * 24 * 60 * 60 * 1000).toISOString();
      const roster = [member('m0'), member('m1', { created_at: recentJoin }), ...ROSTER.slice(2)];
      const rows = generateMockEngagementRows('committee-1', roster);
      const row = rows.find((r) => r.MEMBER_USER_ID === 'm1');
      expect(row?.MEMBER_JOINED_AT).toBe(recentJoin);
      expect(row).toMatchObject({
        INVITED_COUNT_30D: 5,
        ATTENDED_COUNT_30D: 5,
        INVITED_COUNT_90D: 5,
        ATTENDED_COUNT_90D: 5,
        INVITED_COUNT_YTD: 5,
        ATTENDED_COUNT_YTD: 5,
      });
    });

    it('does not fabricate an Emeritus member when every real member already has a known, non-Emeritus status', () => {
      const roster = ROSTER.map((m, i) => member(m.uid, { voting: { status: i % 2 === 0 ? 'Voting Rep' : 'Observer' } as never }));
      const rows = generateMockEngagementRows('committee-1', roster);
      expect(rows.some((r) => r.MEMBER_VOTING_STATUS === 'Emeritus')).toBe(false);
    });

    it('treats a real, recorded "None" voting status as known — never overwrites it, including at the Emeritus slot', () => {
      // Regression: `None` is a legitimate real value (a member genuinely has no voting role), not
      // an absence of data. Only `voting` being unset/null means "no real status recorded" and is
      // eligible for the Emeritus fallback; a real `None` must pass through exactly like any other
      // real status. Every member here has a real `None`, so no fallback should ever fire.
      const roster = ROSTER.map((m) => member(m.uid, { voting: { status: 'None' } as never }));
      const rows = generateMockEngagementRows('committee-1', roster);
      expect(rows.every((r) => r.MEMBER_VOTING_STATUS === 'None')).toBe(true);
    });

    it('treats a blank/falsy voting status as unrecorded, not as a real value to preserve', () => {
      // Regression: `||`, not `??`, on `member.voting?.status` — an empty-string passthrough from
      // upstream is falsy-but-non-null and must still fall through to the organic/Emeritus fallback
      // rather than being treated as a real recorded status and emitted verbatim.
      const roster = [member('m0', { voting: { status: '' } as never }), ...ROSTER.slice(1)];
      const rows = generateMockEngagementRows('committee-1', roster);
      expect(rows.find((r) => r.MEMBER_USER_ID === 'm0')?.MEMBER_VOTING_STATUS).not.toBe('');
    });

    it('a real, moderately-recent tenure at a reserved demo slot (not the Orlin case — >=30 real days) produces smaller counts than the fully-synthetic floor would, never a mismatch between the shown join date and the numbers', () => {
      // 45 real days: short enough that a floored (~200-day) synthetic default would clearly
      // overstate this member's exposure, but >=30 days so it isn't swept into the Orlin path
      // instead (any real join within the 30d window takes that path — see the test above).
      const moderatelyRecentJoin = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
      const rosterWithRealTenure = [ROSTER[0], ROSTER[1], member(ROSTER[2].uid, { created_at: moderatelyRecentJoin }), ...ROSTER.slice(3)];

      const rowsWithRealTenure = generateMockEngagementRows('committee-1', rosterWithRealTenure);
      const rowsAllSynthetic = generateMockEngagementRows('committee-1', ROSTER);

      const realRow = rowsWithRealTenure.find((r) => r.MEMBER_USER_ID === ROSTER[2].uid);
      const syntheticRow = rowsAllSynthetic.find((r) => r.MEMBER_USER_ID === ROSTER[2].uid);

      expect(realRow?.MEMBER_JOINED_AT).toBe(moderatelyRecentJoin);
      expect(realRow?.INVITED_COUNT_90D as number).toBeLessThan(syntheticRow?.INVITED_COUNT_90D as number);
    });
  });
});
