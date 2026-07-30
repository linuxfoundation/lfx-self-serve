// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors project.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so every runtime import needs a stub. The classifier functions are deep-imported
// from their real implementation (not hand-copied) so a threshold change there fails this suite
// too; their own boundary behavior is exhaustively covered in
// packages/shared/src/utils/committee-engagement-classifier.util.spec.ts.
const { execute, getCommitteeMembers, warning, debug } = vi.hoisted(() => ({
  execute: vi.fn(),
  getCommitteeMembers: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@lfx-one/shared/constants', () => ({ DEFAULT_LFX_ONE_PLATINUM_SCHEMA: 'ANALYTICS.PLATINUM_LFX_ONE' }));
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/committee-engagement-classifier.util')>(
    '../../../../../packages/shared/src/utils/committee-engagement-classifier.util'
  );
  return {
    classifyCommitteeEngagement: actual.classifyCommitteeEngagement,
    computeCommitteeEngagementRate: actual.computeCommitteeEngagementRate,
    isCommitteeMemberAtRisk: actual.isCommitteeMemberAtRisk,
  };
});
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public getCommitteeMembers = getCommitteeMembers;
  },
}));
vi.mock('./snowflake.service', () => ({
  SnowflakeService: {
    getInstance: () => ({ execute }),
    // Mirrors SnowflakeService.isMissingObjectError's actual regex (copied, not imported — the
    // real class is mocked wholesale here) against a realistically wrapped error message, rather
    // than a hand-rolled `missingObject` flag. This still can't catch the real regex changing out
    // from under this copy, since snowflake.service.ts has no spec of its own today (see the
    // regex at snowflake.service.ts's `isMissingObjectError` if this ever needs re-syncing).
    isMissingObjectError: (error: unknown) => /does not exist or not authorized/i.test(error instanceof Error ? error.message : String(error)),
  },
}));
vi.mock('./logger.service', () => ({
  logger: { warning, debug },
}));

import { CommitteeEngagementService } from './committee-engagement.service';

const req = {} as unknown as Request;

function member(uid: string, email: string) {
  return { uid, email } as unknown as import('@lfx-one/shared/interfaces').CommitteeMember;
}

describe('CommitteeEngagementService.getCommitteeEngagement', () => {
  let service: CommitteeEngagementService;

  beforeEach(() => {
    execute.mockReset();
    getCommitteeMembers.mockReset();
    warning.mockReset();
    debug.mockReset();
    service = new CommitteeEngagementService();
  });

  it('joins warehouse rows to the roster by case/whitespace-normalized email', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'Alice@Example.com '), member('m2', 'bob@example.com')]);
    execute.mockResolvedValueOnce({
      rows: [
        { MEMBER_EMAIL: ' alice@example.com', ATTENDED_COUNT: 9, INVITED_COUNT: 10, COMPUTED_AT: '2026-07-28T00:00:00.000Z' },
        // bob has no matching row -> defaults to Inactive
      ],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result.members).toEqual([
      { uid: 'm1', attended: 9, invited: 10, rate: 0.9, classification: 'High' },
      { uid: 'm2', attended: 0, invited: 0, rate: 0, classification: 'Inactive' },
    ]);
    expect(result.data_available).toBe(true);
  });

  it('queries the engagement table with the committee uid and window bound in order, against the resolved schema', async () => {
    getCommitteeMembers.mockResolvedValueOnce([]);
    execute.mockResolvedValueOnce({ rows: [] });

    await service.getCommitteeEngagement(req, 'committee-1', '90d');

    expect(execute).toHaveBeenCalledWith(expect.stringContaining('ANALYTICS.PLATINUM_LFX_ONE.COMMITTEE_MEMBER_MEETING_ATTENDANCE'), ['committee-1', '90d'], {
      expectMissingObject: true,
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE\s+COMMITTEE_UID\s*=\s*\?\s+AND\s+TIME_RANGE_TYPE\s*=\s*\?/),
      expect.anything(),
      expect.anything()
    );
  });

  it('degrades to a zeroed, data_available:false response when the engagement table does not exist yet', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'alice@example.com')]);
    // Realistic wrapped form SnowflakeService.execute() actually throws (see snowflake.service.ts's
    // catch block), not a hand-rolled flag — pins the regex against the wrapping prefix surviving.
    execute.mockRejectedValueOnce(
      new Error(
        "Snowflake query execution failed: SQL compilation error: Object 'ANALYTICS.PLATINUM_LFX_ONE.COMMITTEE_MEMBER_MEETING_ATTENDANCE' does not exist or not authorized."
      )
    );

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result).toEqual({
      members: [{ uid: 'm1', attended: 0, invited: 0, rate: 0, classification: 'Inactive' }],
      summary: { attendance_rate: 0, active_count: 0, total_count: 1, at_risk_count: 0 },
      computed_at: null,
      data_available: false,
    });
    expect(warning).toHaveBeenCalledOnce();
  });

  it('rethrows a non-missing-object Snowflake error', async () => {
    getCommitteeMembers.mockResolvedValueOnce([]);
    execute.mockRejectedValueOnce(new Error('circuit open'));

    await expect(service.getCommitteeEngagement(req, 'committee-1', '30d')).rejects.toThrow('circuit open');
  });

  it('rolls classification up into active_count and at_risk_count, counting invited-but-zero-attendance members as at risk even though their badge reads Inactive', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'high@x.com'), member('m2', 'low@x.com'), member('m3', 'inactive@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [
        { MEMBER_EMAIL: 'high@x.com', ATTENDED_COUNT: 10, INVITED_COUNT: 10, COMPUTED_AT: null },
        { MEMBER_EMAIL: 'low@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 10, COMPUTED_AT: null },
        { MEMBER_EMAIL: 'inactive@x.com', ATTENDED_COUNT: 0, INVITED_COUNT: 10, COMPUTED_AT: null },
      ],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '90d');

    expect(result.summary).toEqual({ attendance_rate: 0.37, active_count: 1, total_count: 3, at_risk_count: 2 });
  });

  it('does not count never-invited (no warehouse row) members as at risk', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'never-invited@x.com')]);
    execute.mockResolvedValueOnce({ rows: [] });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result.summary.at_risk_count).toBe(0);
  });

  it('picks the latest computed_at among the warehouse rows directly, independent of roster order, match, or row order', async () => {
    // 'a' matches no roster member (roster has only 'c'), 'b' has a null COMPUTED_AT, and the
    // latest timestamp ('2026-07-29', row 'c') sorts after an earlier one ('2026-07-28', row
    // 'a') despite appearing later in the result set — the pick must not be "first" or
    // "roster-joined", it must be "latest, across every row Snowflake returned".
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'c@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [
        { MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: '2026-07-28T00:00:00.000Z' },
        { MEMBER_EMAIL: 'b@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: null },
        { MEMBER_EMAIL: 'c@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: '2026-07-29T00:00:00.000Z' },
      ],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', 'ytd');

    expect(result.computed_at).toBe('2026-07-29T00:00:00.000Z');
  });

  it('normalizes a zone-less TIMESTAMP_NTZ-shaped COMPUTED_AT to a real UTC ISO string, not a re-parsed local-time one', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: '2026-07-28 00:00:00.000' }],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result.computed_at).toBe('2026-07-28T00:00:00.000Z');
  });

  it('treats an unparseable COMPUTED_AT string as absent rather than passing it through', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: 'N/A' }],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result.computed_at).toBeNull();
  });

  it('normalizes a TIMESTAMP_TZ-shaped COMPUTED_AT (space before the offset) into a canonical UTC ISO string', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: '2026-07-28 00:00:00.000 -0700' }],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result.computed_at).toBe('2026-07-28T07:00:00.000Z');
  });

  it('rejects a date-only COMPUTED_AT string rather than fabricating a 00:00:00 time', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: '2026-07-28' }],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result.computed_at).toBeNull();
  });

  it('rejects a shape-matching but impossible calendar date instead of letting it roll over to a real one', async () => {
    // '2026-02-30' matches TIMESTAMP_SHAPE (it's digit-shaped), but Date rolls an out-of-range day
    // forward into March rather than failing — the calendar round-trip guard is what catches this,
    // not the post-parse NaN check (which month-13-style shapes fail on their own).
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: '2026-02-30 12:00:00' }],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result.computed_at).toBeNull();
  });

  it('rejects a shape-matching timestamp with an out-of-range hour, exercising the post-match parse guard', async () => {
    // The calendar round-trip guard only validates the date portion, so an invalid *time* (the
    // date '2026-07-28' is real) has to be caught by the final `Number.isNaN(parsed.getTime())`
    // check — this is what would go dead if that guard were ever removed as "unreachable".
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: '2026-07-28 25:00:00' }],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result.computed_at).toBeNull();
  });

  it('logs a warning when warehouse rows exist but none match the roster by email', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'roster@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'unrelated@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: null }],
    });

    await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(warning).toHaveBeenCalledWith(
      req,
      'get_committee_engagement',
      expect.stringContaining('join key mismatch'),
      expect.objectContaining({ committee_uid: 'committee-1', row_count: 1, roster_size: 1 })
    );
  });

  it('does not warn about a join mismatch when the roster is empty (rows may legitimately persist for a since-emptied committee)', async () => {
    getCommitteeMembers.mockResolvedValueOnce([]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'former-member@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: null }],
    });

    await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(warning).not.toHaveBeenCalled();
  });

  it('does not warn about a join mismatch when rows and roster both match', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: null }],
    });

    await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(warning).not.toHaveBeenCalled();
  });

  it('clamps attended to invited when a warehouse row reports ATTENDED_COUNT greater than INVITED_COUNT, and warns once', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'over-attended@x.com'), member('m2', 'normal@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [
        { MEMBER_EMAIL: 'over-attended@x.com', ATTENDED_COUNT: 12, INVITED_COUNT: 10, COMPUTED_AT: null },
        { MEMBER_EMAIL: 'normal@x.com', ATTENDED_COUNT: 5, INVITED_COUNT: 10, COMPUTED_AT: null },
      ],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result.members[0]).toEqual({ uid: 'm1', attended: 10, invited: 10, rate: 1, classification: 'High' });
    expect(result.summary.attendance_rate).toBe(0.75); // (10 + 5) / (10 + 10), not (12 + 5) / (10 + 10)
    expect(warning).toHaveBeenCalledWith(
      req,
      'get_committee_engagement',
      expect.stringContaining('clamped to invited'),
      expect.objectContaining({ committee_uid: 'committee-1', over_attended_row_count: 1, deduped_row_count: 2 })
    );
  });

  it('still detects and warns about an over-attended row that matches no current roster member', async () => {
    // The over-attended row count is scoped to warehouse rows, not roster members, precisely so a
    // grain mismatch affecting rows for members no longer on the roster isn't invisible — unmatched
    // rows are the expected case (see the empty-roster join-mismatch test above), not an edge case.
    // (That row is never clamped — it's dropped before Math.min, since it has no roster match.)
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'current-member@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [
        { MEMBER_EMAIL: 'current-member@x.com', ATTENDED_COUNT: 5, INVITED_COUNT: 10, COMPUTED_AT: null },
        { MEMBER_EMAIL: 'former-member@x.com', ATTENDED_COUNT: 12, INVITED_COUNT: 10, COMPUTED_AT: null },
      ],
    });

    await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(warning).toHaveBeenCalledWith(
      req,
      'get_committee_engagement',
      expect.stringContaining('clamped to invited'),
      expect.objectContaining({ committee_uid: 'committee-1', over_attended_row_count: 1, deduped_row_count: 2 })
    );
  });

  it('does not warn about clamping when every row is within bounds', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 5, INVITED_COUNT: 10, COMPUTED_AT: null }],
    });

    await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(warning).not.toHaveBeenCalled();
  });
});
