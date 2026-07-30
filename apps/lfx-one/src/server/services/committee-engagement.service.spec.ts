// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors project.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so every runtime import needs a stub. The classifier functions are deep-imported
// from their real implementation (not hand-copied) so a threshold change there fails this suite
// too; their own boundary behavior is exhaustively covered in
// packages/shared/src/utils/committee-engagement-classifier.util.spec.ts.
const { execute, getCommitteeMembers, warning, debug, withCommitteeCache } = vi.hoisted(() => ({
  execute: vi.fn(),
  getCommitteeMembers: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
  // Passthrough by default (always calls the fetcher) so every existing test still exercises the
  // join logic directly; the caching-specific tests below override this per-case.
  withCommitteeCache: vi.fn((_committeeUid: string, _subResource: string, _ttl: number, fetcher: () => unknown) => fetcher()),
}));

vi.mock('@lfx-one/shared/constants', () => ({
  DEFAULT_LFX_ONE_PLATINUM_SCHEMA: 'ANALYTICS.PLATINUM_LFX_ONE',
  VALKEY_CACHE: { COMMITTEE_ENGAGEMENT_TTL_SECONDS: 3600 },
}));
vi.mock('./valkey.service', () => ({ withCommitteeCache }));
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
vi.mock('./snowflake.service', async () => {
  // `SnowflakeService` itself is mocked wholesale (constructing the real class pulls in the
  // snowflake-sdk connection pool and OTel instrumentation), but `isMissingObjectError` is a pure
  // function with no such dependencies, so it's deep-imported for real here rather than
  // hand-copied — a change to the real predicate now fails this suite instead of silently leaving
  // a stale copy green. This only exercises the extracted helper, not
  // `SnowflakeService.isMissingObjectError`'s one-line delegation to it (untested — every spec
  // that touches this class, including this one, mocks it wholesale).
  const { isMissingObjectError } = await vi.importActual<typeof import('../helpers/snowflake-error.helper')>('../helpers/snowflake-error.helper');
  return {
    SnowflakeService: {
      getInstance: () => ({ execute }),
      isMissingObjectError,
    },
  };
});
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
    // Cleared, not reset — resetting would drop the passthrough default implementation set in
    // vi.hoisted above, which every test other than the caching-specific ones below relies on.
    withCommitteeCache.mockClear();
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

  it('rethrows a wrong-column-name compilation error rather than degrading to data_available:false', async () => {
    // Pins the engagementTable() TODO's claim: a wrong column name is a different Snowflake
    // compilation error than isMissingObjectError's "does not exist or not authorized" match, so it
    // correctly 500s instead of silently degrading like a genuinely-not-deployed-yet table would.
    getCommitteeMembers.mockResolvedValueOnce([]);
    execute.mockRejectedValueOnce(
      new Error("Snowflake query execution failed: SQL compilation error: error line 2 at position 13\ninvalid identifier 'MEMBER_EMAIL'")
    );

    await expect(service.getCommitteeEngagement(req, 'committee-1', '30d')).rejects.toThrow('invalid identifier');
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

  it('treats an unparseable COMPUTED_AT string as absent rather than passing it through, and warns with its redacted shape', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: 'N/A' }],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result.computed_at).toBeNull();
    // Distinct from a row that simply never reported COMPUTED_AT (routine, no signal) — this row
    // reported a value and it was rejected, which is worth an operator's attention. The value's
    // *shape* is attached, not its content: digits/letters are redacted to '9'/'a', and only a
    // closed, non-sensitive allowlist of timestamp punctuation (e.g. the '/' below) survives
    // verbatim as shape signal — everything else is substituted before it reaches the log.
    expect(warning).toHaveBeenCalledWith(
      req,
      'get_committee_engagement',
      expect.stringContaining('unparseable COMPUTED_AT'),
      expect.objectContaining({ committee_uid: 'committee-1', rejected_count: 1, row_count: 1, rejected_sample: ['a/a'] })
    );
  });

  it('bounds the redacted shape to 24 characters for a long rejected COMPUTED_AT value', async () => {
    const longValue = 'x'.repeat(500);
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: longValue }],
    });

    await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(warning).toHaveBeenCalledWith(
      req,
      'get_committee_engagement',
      expect.stringContaining('unparseable COMPUTED_AT'),
      expect.objectContaining({ rejected_sample: ['a'.repeat(24)] })
    );
  });

  it('bounds the redacted shape to 24 Unicode code points, not 24 UTF-16 units', async () => {
    // Each 👍 is one code point but two UTF-16 units. A truncation bug that counted UTF-16 units
    // (e.g. `String(raw).slice(0, 24)` before walking, rather than the `for...of` code-point walk
    // the doc comment describes) would yield only 12 redacted characters here, not 24 — a case no
    // other fixture in this file reaches the 24-code-point bound (the astral case at line ~303
    // below is only 9 code points, nowhere near it).
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: '👍'.repeat(30) }],
    });

    await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(warning).toHaveBeenCalledWith(
      req,
      'get_committee_engagement',
      expect.stringContaining('unparseable COMPUTED_AT'),
      expect.objectContaining({ rejected_sample: ['?'.repeat(24)] })
    );
  });

  it('resolves computed_at from the valid rows and reports only the invalid ones as rejected, when a committee has both', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'good@x.com'), member('m2', 'bad@x.com'), member('m3', 'absent@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [
        { MEMBER_EMAIL: 'good@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: '2026-07-28T00:00:00.000Z' },
        { MEMBER_EMAIL: 'bad@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: 'garbage' },
        { MEMBER_EMAIL: 'absent@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: null },
      ],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result.computed_at).toBe('2026-07-28T00:00:00.000Z');
    expect(warning).toHaveBeenCalledWith(
      req,
      'get_committee_engagement',
      expect.stringContaining('unparseable COMPUTED_AT'),
      expect.objectContaining({ rejected_count: 1, row_count: 3, rejected_sample: ['aaaaaaa'] })
    );
  });

  it('normalizes a TIMESTAMP_TZ-shaped COMPUTED_AT (space before the offset) into a canonical UTC ISO string', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: '2026-07-28 00:00:00.000 -0700' }],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result.computed_at).toBe('2026-07-28T07:00:00.000Z');
  });

  it('rejects a date-only COMPUTED_AT string rather than fabricating a 00:00:00 time, and redacts its digits in the warning sample', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: '2026-07-28' }],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result.computed_at).toBeNull();
    // This is the diagnostically valuable half of the redaction: a timestamp-shaped-but-rejected
    // value should still read as timestamp-shaped after redaction, not just "not a timestamp".
    expect(warning).toHaveBeenCalledWith(
      req,
      'get_committee_engagement',
      expect.stringContaining('unparseable COMPUTED_AT'),
      expect.objectContaining({ rejected_sample: ['9999-99-99'] })
    );
  });

  it('redacts symbols and non-Latin letters (default-deny, not default-allow) in the warning sample', async () => {
    // Redacting only known digit/letter classes and letting anything else — symbols, emoji,
    // combining marks — through unchanged wouldn't actually guarantee "no content reaches the log".
    // Cyrillic letters must redact like Latin ones, and a character that's neither a recognized
    // digit/letter nor known timestamp punctuation (👍) must become the '?' placeholder rather than
    // passing through verbatim.
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: 'Алексей 👍' }],
    });

    await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(warning).toHaveBeenCalledWith(
      req,
      'get_committee_engagement',
      expect.stringContaining('unparseable COMPUTED_AT'),
      expect.objectContaining({ rejected_sample: ['aaaaaaa ?'] })
    );
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

  it('warns with duplicate_email_row_count when the warehouse returns multiple rows for one member email, and the last row wins', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [
        { MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 10, COMPUTED_AT: null },
        { MEMBER_EMAIL: 'A@X.COM', ATTENDED_COUNT: 9, INVITED_COUNT: 10, COMPUTED_AT: null },
      ],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    // Pins the message's claim: without this assertion, flipping the join to first-wins would
    // leave every other test green while making "last row wins" false.
    expect(result.members[0]).toEqual({ uid: 'm1', attended: 9, invited: 10, rate: 0.9, classification: 'High' });
    expect(warning).toHaveBeenCalledWith(
      req,
      'get_committee_engagement',
      expect.stringContaining('dropped or overwritten'),
      expect.objectContaining({ committee_uid: 'committee-1', duplicate_email_row_count: 1, blank_email_row_count: 0, row_count: 2 })
    );
  });

  it('warns with blank_email_row_count (not duplicate_email_row_count) when a warehouse row has a blank member email', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [
        { MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 10, COMPUTED_AT: null },
        { MEMBER_EMAIL: '', ATTENDED_COUNT: 1, INVITED_COUNT: 10, COMPUTED_AT: null },
      ],
    });

    await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(warning).toHaveBeenCalledWith(
      req,
      'get_committee_engagement',
      expect.stringContaining('dropped or overwritten'),
      expect.objectContaining({ duplicate_email_row_count: 0, blank_email_row_count: 1, row_count: 2 })
    );
  });

  it('does not warn about dropped rows when every warehouse row has a distinct, non-blank email', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com'), member('m2', 'b@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [
        { MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 10, COMPUTED_AT: null },
        { MEMBER_EMAIL: 'b@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 10, COMPUTED_AT: null },
      ],
    });

    await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(warning).not.toHaveBeenCalled();
  });

  it('warns with duplicate_roster_email_count when two distinct roster members share a normalized email', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'shared@x.com'), member('m2', 'SHARED@X.COM')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'shared@x.com', ATTENDED_COUNT: 5, INVITED_COUNT: 10, COMPUTED_AT: null }],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    // Both roster entries resolve to the same warehouse row and each contribute it to the summary
    // totals — documents the current behavior rather than silently masking it.
    expect(result.members[0]).toMatchObject({ attended: 5, invited: 10, rate: 0.5, classification: 'Medium' });
    expect(result.members[1]).toMatchObject({ attended: 5, invited: 10, rate: 0.5, classification: 'Medium' });
    expect(result.summary.total_count).toBe(2);
    expect(warning).toHaveBeenCalledWith(
      req,
      'get_committee_engagement',
      expect.stringContaining('share a normalized email'),
      expect.objectContaining({ committee_uid: 'committee-1', duplicate_roster_email_count: 1, roster_size: 2 })
    );
  });

  it('does not warn about roster email collisions when every roster member has a distinct email', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com'), member('m2', 'b@x.com')]);
    execute.mockResolvedValueOnce({ rows: [] });

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

  it('treats an unparseable INVITED_COUNT as 0 (not the same silent path as an unmatched member) and warns', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com'), member('m2', 'unmatched@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [{ MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 5, INVITED_COUNT: 'not-a-number', COMPUTED_AT: null }],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result.members[0]).toEqual({ uid: 'm1', attended: 0, invited: 0, rate: 0, classification: 'Inactive' });
    expect(warning).toHaveBeenCalledWith(
      req,
      'get_committee_engagement',
      expect.stringContaining('unparseable ATTENDED_COUNT/INVITED_COUNT'),
      expect.objectContaining({ committee_uid: 'committee-1', unparseable_count_row_count: 1, roster_size: 2 })
    );
  });

  it('does not warn about unparseable counts for a member with no matching row at all', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({ rows: [] });

    await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(warning).not.toHaveBeenCalled();
  });

  it('reads through the committee-scoped cache, keyed by committee uid and window', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com')]);
    execute.mockResolvedValueOnce({ rows: [] });

    await service.getCommitteeEngagement(req, 'committee-1', '90d');

    expect(withCommitteeCache).toHaveBeenCalledWith('committee-1', 'engagement:90d', 3600, expect.any(Function));
  });

  it('returns the cached response without querying the roster or Snowflake on a cache hit', async () => {
    const cached = { members: [], summary: { attendance_rate: 0, active_count: 0, total_count: 0, at_risk_count: 0 }, computed_at: null, data_available: true };
    withCommitteeCache.mockResolvedValueOnce(cached);

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result).toBe(cached);
    expect(getCommitteeMembers).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
