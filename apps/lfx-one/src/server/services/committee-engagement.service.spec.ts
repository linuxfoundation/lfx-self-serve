// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors project.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so every runtime import needs a stub. The classifier functions are deep-imported
// from their real implementation (not hand-copied) so a decision-table change there fails this
// suite too; their own boundary behavior is exhaustively covered in
// packages/shared/src/utils/committee-engagement-classifier.utils.spec.ts.
const {
  execute,
  getCommitteeMembers,
  generateMockEngagementRows,
  resolveCommitteeV2UidsToV1Ids,
  warning,
  info,
  debug,
  buildCommitteeCacheKey,
  getJson,
  setJson,
} = vi.hoisted(() => ({
  execute: vi.fn(),
  getCommitteeMembers: vi.fn(),
  generateMockEngagementRows: vi.fn(),
  // Defaults to a 1:1 v2-uid -> "warehouse-<uid>" mapping so existing 'committee-1'-based tests
  // don't need per-test setup; tests exercising an unresolved uid override this explicitly.
  resolveCommitteeV2UidsToV1Ids: vi.fn(async (_req: unknown, _nats: unknown, uids: string[]) => new Map(uids.map((uid) => [uid, `warehouse-${uid}`]))),
  warning: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  // Returns null by default (cache bypassed → direct fetch) so live-mode tests exercise the
  // Snowflake fetch path directly unless a test overrides it.
  buildCommitteeCacheKey: vi.fn<(committeeUid: string, subResource: string) => string | null>(() => null),
  getJson: vi.fn(),
  setJson: vi.fn(),
}));

vi.mock('@lfx-one/shared/constants', () => ({
  DEFAULT_LFX_ONE_PLATINUM_SCHEMA: 'ANALYTICS.PLATINUM_LFX_ONE',
  VALKEY_CACHE: { COMMITTEE_ENGAGEMENT_TTL_SECONDS: 3600, COMMITTEE_ENGAGEMENT_DEGRADE_TTL_SECONDS: 120 },
}));
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/committee-engagement-classifier.utils')>(
    '../../../../../packages/shared/src/utils/committee-engagement-classifier.utils'
  );
  return {
    classifyCommitteeEngagement: actual.classifyCommitteeEngagement,
    computeCommitteeEngagementRate: actual.computeCommitteeEngagementRate,
    isCommitteeMemberActive: actual.isCommitteeMemberActive,
    isCommitteeMemberAtRisk: actual.isCommitteeMemberAtRisk,
    isJoinedWithinWindow: actual.isJoinedWithinWindow,
  };
});
vi.mock('../helpers/committee-engagement-mock.helper', () => ({ generateMockEngagementRows }));
vi.mock('../helpers/committee-v1-mapping.helper', () => ({ resolveCommitteeV2UidsToV1Ids }));
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public getCommitteeMembers = getCommitteeMembers;
  },
}));
vi.mock('./nats.service', () => ({ NatsService: class {} }));
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
vi.mock('./valkey.service', () => ({ buildCommitteeCacheKey, valkeyService: { getJson, setJson } }));
vi.mock('./logger.service', () => ({
  logger: { warning, info, debug },
}));

import { CommitteeEngagementService } from './committee-engagement.service';

const req = {} as unknown as Request;
const ENGAGEMENT_BACKEND_KEY = 'ENGAGEMENT_BACKEND';
const NODE_ENV_KEY = 'NODE_ENV';
const originalEngagementBackend = process.env[ENGAGEMENT_BACKEND_KEY];
const originalNodeEnv = process.env[NODE_ENV_KEY];

function member(
  uid: string,
  overrides: Partial<import('@lfx-one/shared/interfaces').CommitteeMember> = {}
): import('@lfx-one/shared/interfaces').CommitteeMember {
  return { uid, ...overrides } as unknown as import('@lfx-one/shared/interfaces').CommitteeMember;
}

function row(overrides: Partial<import('@lfx-one/shared/interfaces').CommitteeEngagementWarehouseRow> = {}) {
  return {
    MEMBER_USER_ID: 'm1',
    MEMBER_JOINED_AT: '2020-01-01T00:00:00.000Z',
    MEMBER_ROLE: 'None',
    MEMBER_VOTING_STATUS: 'Voting Rep',
    INVITED_COUNT_30D: 0,
    ATTENDED_COUNT_30D: 0,
    COMMITTEE_MEETINGS_30D: 0,
    INVITED_COUNT_90D: 0,
    ATTENDED_COUNT_90D: 0,
    COMMITTEE_MEETINGS_90D: 0,
    INVITED_COUNT_YTD: 0,
    ATTENDED_COUNT_YTD: 0,
    COMMITTEE_MEETINGS_YTD: 0,
    ...overrides,
  };
}

describe('CommitteeEngagementService.getCommitteeEngagement', () => {
  let service: CommitteeEngagementService;

  beforeEach(() => {
    execute.mockReset();
    getCommitteeMembers.mockReset();
    generateMockEngagementRows.mockReset();
    resolveCommitteeV2UidsToV1Ids
      .mockReset()
      .mockImplementation(async (_req: unknown, _nats: unknown, uids: string[]) => new Map(uids.map((uid) => [uid, `warehouse-${uid}`])));
    warning.mockReset();
    info.mockReset();
    debug.mockReset();
    buildCommitteeCacheKey.mockReset().mockReturnValue(null);
    getJson.mockReset();
    setJson.mockReset();
    service = new CommitteeEngagementService();
  });

  describe('mock backend (ENGAGEMENT_BACKEND=mock, explicit opt-in)', () => {
    beforeEach(() => {
      process.env[ENGAGEMENT_BACKEND_KEY] = 'mock';
      delete process.env[NODE_ENV_KEY];
    });

    it('fetches the roster live and generates mock rows from it, without touching Snowflake', async () => {
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);
      generateMockEngagementRows.mockReturnValueOnce([]);

      await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(getCommitteeMembers).toHaveBeenCalledWith(req, 'committee-1');
      expect(generateMockEngagementRows).toHaveBeenCalledWith('committee-1', [member('m1')]);
      expect(execute).not.toHaveBeenCalled();
    });

    it('is always data_available: true and computed_at: null', async () => {
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);
      generateMockEngagementRows.mockReturnValueOnce([row({ MEMBER_USER_ID: 'm1' })]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.data_available).toBe(true);
      expect(result.computed_at).toBeNull();
    });

    it('marks the response data_source: mock and logs at INFO, so a consumer or operator can tell it apart from a real read', async () => {
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);
      generateMockEngagementRows.mockReturnValueOnce([row({ MEMBER_USER_ID: 'm1' })]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.data_source).toBe('mock');
      expect(info).toHaveBeenCalledWith(
        req,
        'get_committee_engagement',
        'ENGAGEMENT_BACKEND=mock — returning deterministic mock rows, not real data',
        expect.objectContaining({ committee_uid: 'committee-1', window: '30d', roster_size: 1 })
      );
    });

    it('classifies a joined-mid-window member with invited=5, attended=5 as High and never at-risk (the Orlin case)', async () => {
      const recentJoin = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);
      generateMockEngagementRows.mockReturnValueOnce([
        row({ MEMBER_USER_ID: 'm1', MEMBER_JOINED_AT: recentJoin, INVITED_COUNT_30D: 5, ATTENDED_COUNT_30D: 5 }),
      ]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.members[0]).toMatchObject({ uid: 'm1', attended: 5, invited: 5, rate: 1, classification: 'High' });
      expect(result.summary.at_risk_count).toBe(0);
    });

    it('falls back to the roster real created_at when a matched row has a null MEMBER_JOINED_AT, so tenure grace still applies', async () => {
      const recentJoin = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      getCommitteeMembers.mockResolvedValueOnce([member('m1', { created_at: recentJoin })]);
      generateMockEngagementRows.mockReturnValueOnce([row({ MEMBER_USER_ID: 'm1', MEMBER_JOINED_AT: null, INVITED_COUNT_30D: 0 })]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.members[0]).toMatchObject({ invited: 0, classification: 'High' });
      expect(result.summary.active_count).toBe(1);
    });

    it('falls back to the roster real created_at when a matched row has a blank MEMBER_JOINED_AT', async () => {
      const recentJoin = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      getCommitteeMembers.mockResolvedValueOnce([member('m1', { created_at: recentJoin })]);
      generateMockEngagementRows.mockReturnValueOnce([row({ MEMBER_USER_ID: 'm1', MEMBER_JOINED_AT: '', INVITED_COUNT_30D: 0 })]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.members[0]).toMatchObject({ invited: 0, classification: 'High' });
      expect(result.summary.active_count).toBe(1);
    });

    it('falls back to the roster real created_at when a matched row has a present but unparseable MEMBER_JOINED_AT, not just a missing/blank one', async () => {
      // A truthy-but-unparseable row date is exactly the case a value-selection fallback
      // (`row value || roster value`) would get wrong — it would pick the bad row value since it's
      // truthy, never falling through to the perfectly good roster one. The independent-OR check
      // must catch this case too.
      const recentJoin = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      getCommitteeMembers.mockResolvedValueOnce([member('m1', { created_at: recentJoin })]);
      generateMockEngagementRows.mockReturnValueOnce([row({ MEMBER_USER_ID: 'm1', MEMBER_JOINED_AT: 'not-a-real-date', INVITED_COUNT_30D: 0 })]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.members[0]).toMatchObject({ invited: 0, classification: 'High' });
      expect(result.summary.active_count).toBe(1);
    });

    it('classifies an Emeritus member as Emeritus regardless of a low real attendance rate, and never at-risk', async () => {
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);
      generateMockEngagementRows.mockReturnValueOnce([
        row({ MEMBER_USER_ID: 'm1', MEMBER_VOTING_STATUS: 'Emeritus', INVITED_COUNT_30D: 20, ATTENDED_COUNT_30D: 1 }),
      ]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.members[0]).toMatchObject({ classification: 'Emeritus', voting_status: 'Emeritus' });
      expect(result.summary.at_risk_count).toBe(0);
      expect(result.summary.active_count).toBe(0);
    });

    it('the new active_count rule counts a Low-classified member (some real attendance) as active', async () => {
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);
      generateMockEngagementRows.mockReturnValueOnce([row({ MEMBER_USER_ID: 'm1', INVITED_COUNT_30D: 100, ATTENDED_COUNT_30D: 10 })]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.members[0]?.classification).toBe('Low');
      expect(result.summary.active_count).toBe(1);
      expect(result.summary.at_risk_count).toBe(1);
    });

    it('classifies a never-invited veteran member as Inactive, and a never-invited-but-joined-within-window member as High', async () => {
      const recentJoin = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      getCommitteeMembers.mockResolvedValueOnce([member('veteran'), member('new-joiner')]);
      generateMockEngagementRows.mockReturnValueOnce([row({ MEMBER_USER_ID: 'veteran' }), row({ MEMBER_USER_ID: 'new-joiner', MEMBER_JOINED_AT: recentJoin })]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.members.find((m) => m.uid === 'veteran')?.classification).toBe('Inactive');
      expect(result.members.find((m) => m.uid === 'new-joiner')?.classification).toBe('High');
    });

    it('computes summary as an aggregation over the (varied, non-zero) members — not hardcoded zeros', async () => {
      getCommitteeMembers.mockResolvedValueOnce([member('m1'), member('m2'), member('m3')]);
      generateMockEngagementRows.mockReturnValueOnce([
        row({ MEMBER_USER_ID: 'm1', INVITED_COUNT_30D: 10, ATTENDED_COUNT_30D: 9 }), // High
        row({ MEMBER_USER_ID: 'm2', INVITED_COUNT_30D: 10, ATTENDED_COUNT_30D: 5 }), // Medium
        row({ MEMBER_USER_ID: 'm3', INVITED_COUNT_30D: 10, ATTENDED_COUNT_30D: 0 }), // Inactive
      ]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.summary.total_count).toBe(3);
      expect(result.summary.attendance_rate).toBe(computeExpectedRate(14, 30));
      expect(result.summary).not.toEqual({ attendance_rate: 0, active_count: 0, total_count: 3, at_risk_count: 0 });

      function computeExpectedRate(attended: number, invited: number): number {
        return Math.round((attended / invited) * 100) / 100;
      }
    });

    it('joins by member uid, tolerating a roster member the mock rows omit (defaults to Inactive/zero)', async () => {
      getCommitteeMembers.mockResolvedValueOnce([member('m1'), member('unmatched')]);
      generateMockEngagementRows.mockReturnValueOnce([row({ MEMBER_USER_ID: 'm1', INVITED_COUNT_30D: 10, ATTENDED_COUNT_30D: 10 })]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.members.find((m) => m.uid === 'unmatched')).toMatchObject({ attended: 0, invited: 0, classification: 'Inactive' });
    });

    it('warns and keeps the last row when two rows share the same MEMBER_USER_ID', async () => {
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);
      generateMockEngagementRows.mockReturnValueOnce([
        row({ MEMBER_USER_ID: 'm1', INVITED_COUNT_30D: 10, ATTENDED_COUNT_30D: 1 }),
        row({ MEMBER_USER_ID: 'm1', INVITED_COUNT_30D: 10, ATTENDED_COUNT_30D: 9 }),
      ]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.members[0]).toMatchObject({ attended: 9 });
      expect(warning).toHaveBeenCalledWith(
        req,
        'get_committee_engagement',
        expect.stringContaining('shared the same member uid'),
        expect.objectContaining({ committee_uid: 'committee-1', duplicate_uid_row_count: 1, row_count: 2 })
      );
    });

    it('exposes role, voting_status, and committee_meetings on each member', async () => {
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);
      generateMockEngagementRows.mockReturnValueOnce([
        row({ MEMBER_USER_ID: 'm1', MEMBER_ROLE: 'Chair', MEMBER_VOTING_STATUS: 'Voting Rep', COMMITTEE_MEETINGS_30D: 12, INVITED_COUNT_30D: 10 }),
      ]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.members[0]).toMatchObject({ role: 'Chair', voting_status: 'Voting Rep', committee_meetings: 12 });
    });

    it('reads the requested window off the row, differing across windows for the same member', async () => {
      getCommitteeMembers.mockResolvedValue([member('m1')]);
      generateMockEngagementRows.mockReturnValue([
        row({ MEMBER_USER_ID: 'm1', INVITED_COUNT_30D: 5, ATTENDED_COUNT_30D: 5, INVITED_COUNT_90D: 15, ATTENDED_COUNT_90D: 10 }),
      ]);

      const result30d = await service.getCommitteeEngagement(req, 'committee-1', '30d');
      const result90d = await service.getCommitteeEngagement(req, 'committee-1', '90d');

      expect(result30d.members[0]).toMatchObject({ attended: 5, invited: 5 });
      expect(result90d.members[0]).toMatchObject({ attended: 10, invited: 15 });
    });

    it('clamps negative warehouse counts to zero (defense-in-depth against a data-quality issue)', async () => {
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);
      generateMockEngagementRows.mockReturnValueOnce([
        row({ MEMBER_USER_ID: 'm1', INVITED_COUNT_30D: -5, ATTENDED_COUNT_30D: -1, COMMITTEE_MEETINGS_30D: -10 }),
      ]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.members[0]).toMatchObject({ invited: 0, attended: 0, committee_meetings: 0 });
    });
  });

  describe('live backend (ENGAGEMENT_BACKEND=live)', () => {
    beforeEach(() => {
      process.env[ENGAGEMENT_BACKEND_KEY] = 'live';
      delete process.env[NODE_ENV_KEY];
    });

    it('resolves the v2 committee uid to its v1 id and binds THAT, not the raw v2 uid, against the resolved schema and real model columns', async () => {
      getCommitteeMembers.mockResolvedValueOnce([]);
      execute.mockResolvedValueOnce({ rows: [] });

      await service.getCommitteeEngagement(req, 'committee-1', '90d');

      expect(resolveCommitteeV2UidsToV1Ids).toHaveBeenCalledWith(req, expect.anything(), ['committee-1']);
      expect(execute).toHaveBeenCalledWith(expect.stringContaining('ANALYTICS.PLATINUM_LFX_ONE.COMMITTEE_MEETING_ATTENDANCE'), ['warehouse-committee-1'], {
        expectMissingObject: true,
      });
      const [sql] = execute.mock.calls[0] as [string];
      expect(sql).toContain('WHERE COMMITTEE_ID = ?');
      expect(sql).toContain('MEMBER_USER_ID');
      expect(sql).toContain('INVITED_COUNT_30D');
      expect(sql).toContain('COMMITTEE_MEETINGS_YTD');
    });

    it('degrades to a zeroed, data_available:false response when the engagement table is missing', async () => {
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);
      execute.mockRejectedValueOnce(new Error('Snowflake query execution failed: Object does not exist or not authorized.'));

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result).toEqual({
        members: [{ uid: 'm1', attended: 0, invited: 0, rate: 0, classification: 'Inactive', role: 'None', voting_status: 'None', committee_meetings: 0 }],
        summary: { attendance_rate: 0, active_count: 0, total_count: 1, at_risk_count: 0 },
        computed_at: null,
        data_available: false,
        data_source: 'live',
      });
    });

    it('falls back to the roster real role/voting-status on a degraded (unmatched) member, so a real Emeritus member still short-circuits', async () => {
      getCommitteeMembers.mockResolvedValueOnce([member('m1', { role: { name: 'Chair' } as never, voting: { status: 'Emeritus' } as never })]);
      execute.mockRejectedValueOnce(new Error('Snowflake query execution failed: Object does not exist or not authorized.'));

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.members[0]).toMatchObject({ role: 'Chair', voting_status: 'Emeritus', classification: 'Emeritus' });
      expect(result.summary.at_risk_count).toBe(0);
    });

    it('does NOT tenure-grace a recently-joined member when the whole committee has no data — classifies Inactive, not High, on a genuinely empty read', async () => {
      // Regression test: the roster created_at fallback used to apply unconditionally, so a
      // recently-joined member classified High (and counted active) purely from tenure — on a
      // committee with zero real engagement rows, contradicting data_available:false and
      // attendance_rate:0 in the same payload. Confirmed against live prod data (LFXV2-1705
      // validation): a committee with genuinely zero synced rows must degrade honestly, not
      // partially compute a misleading summary from roster-only signals.
      const recentJoin = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      getCommitteeMembers.mockResolvedValueOnce([member('m1', { created_at: recentJoin })]);
      execute.mockRejectedValueOnce(new Error('Snowflake query execution failed: Object does not exist or not authorized.'));

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.members[0]).toMatchObject({ invited: 0, attended: 0, classification: 'Inactive' });
      expect(result.summary).toEqual({ attendance_rate: 0, active_count: 0, total_count: 1, at_risk_count: 0 });
    });

    it('returns a fully internally-consistent zeroed payload for a no-rows committee — no member classifies High or counts active, regardless of roster tenure', async () => {
      const recentJoin = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      getCommitteeMembers.mockResolvedValueOnce([
        member('veteran'), // long-tenured, never invited — would classify Inactive either way
        member('new-joiner', { created_at: recentJoin }), // the bug case: recently joined, no data
        member('emeritus-member', { voting: { status: 'Emeritus' } as never }), // seat-type fact, not a computed metric
      ]);
      execute.mockResolvedValueOnce({ rows: [] }); // genuinely empty query, not a missing-object error

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.data_available).toBe(false);
      expect(result.members.find((m) => m.uid === 'veteran')).toMatchObject({ classification: 'Inactive' });
      expect(result.members.find((m) => m.uid === 'new-joiner')).toMatchObject({ classification: 'Inactive', invited: 0, attended: 0 });
      // Emeritus is a roster seat-type fact, independent of engagement data — still shown, but it
      // doesn't count toward active_count/at_risk_count either way (isCommitteeMemberActive excludes it).
      expect(result.members.find((m) => m.uid === 'emeritus-member')).toMatchObject({ classification: 'Emeritus' });
      expect(result.summary).toEqual({ attendance_rate: 0, active_count: 0, total_count: 3, at_risk_count: 0 });
    });

    it('still tenure-graces a roster member added since the model refresh when the committee DOES have real data (data_available:true)', async () => {
      // Distinguishes the fix above: the roster created_at fallback is suppressed only when the
      // whole committee has zero rows. When data_available is true (this committee has real data)
      // and one specific member's row just hasn't landed yet, tenure grace still applies — that's
      // a real, if incomplete, data context, not a fabricated one.
      const recentJoin = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      getCommitteeMembers.mockResolvedValueOnce([member('has-data'), member('new-joiner', { created_at: recentJoin })]);
      execute.mockResolvedValueOnce({ rows: [row({ MEMBER_USER_ID: 'has-data', INVITED_COUNT_30D: 10, ATTENDED_COUNT_30D: 9 })] });

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.data_available).toBe(true);
      expect(result.members.find((m) => m.uid === 'new-joiner')).toMatchObject({ classification: 'High', invited: 0 });
      expect(result.summary.active_count).toBe(2); // both members active: one via real attendance, one via tenure grace
    });

    it('suppresses the roster created_at tenure-grace fallback on a total join-key mismatch — classifies Inactive, not High, even though data_available is true', async () => {
      // Reproduces the live-production bug (LFXV2-1705 validation): MEMBER_USER_ID in the warehouse
      // is a Salesforce/LFID-style id, not the v2 committee-member uid, so rows exist for this
      // committee but none key to any roster member. Unlike the single-late-joiner case above,
      // matchedCount is 0 for the WHOLE roster — the join itself is broken, not just incomplete, so
      // member.created_at can't be trusted as a tenure signal here.
      const recentJoin = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      getCommitteeMembers.mockResolvedValueOnce([member('m1', { created_at: recentJoin }), member('m2', { created_at: recentJoin })]);
      execute.mockResolvedValueOnce({ rows: [row({ MEMBER_USER_ID: '0034100000dh2VLAAY' }), row({ MEMBER_USER_ID: 'lfdVxdHAYKNNhX67DT' })] });

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.data_available).toBe(true);
      expect(result.members.find((m) => m.uid === 'm1')).toMatchObject({ classification: 'Inactive', invited: 0, attended: 0 });
      expect(result.members.find((m) => m.uid === 'm2')).toMatchObject({ classification: 'Inactive', invited: 0, attended: 0 });
      expect(result.summary.active_count).toBe(0);
      expect(warning).toHaveBeenCalledWith(
        req,
        'get_committee_engagement',
        expect.stringContaining('join key mismatch'),
        expect.objectContaining({ committee_uid: 'committee-1', row_count: 2, roster_size: 2 })
      );
    });

    it('rethrows a non-missing-object Snowflake error rather than degrading', async () => {
      getCommitteeMembers.mockResolvedValueOnce([]);
      execute.mockRejectedValueOnce(new Error('Snowflake query execution failed: connection reset'));

      await expect(service.getCommitteeEngagement(req, 'committee-1', '30d')).rejects.toThrow('connection reset');
    });

    it('rethrows a wrong-column-name compilation error rather than degrading to data_available:false', async () => {
      // A wrong table name and a wrong column name are NOT the same failure mode: the former hits
      // isMissingObjectError's "does not exist or not authorized" match (indistinguishable from
      // "not deployed yet"), but the latter is a different Snowflake compilation error than
      // isMissingObjectError's match, so it correctly rethrows as a 500 instead of degrading.
      getCommitteeMembers.mockResolvedValueOnce([]);
      execute.mockRejectedValueOnce(
        new Error("Snowflake query execution failed: SQL compilation error: error line 2 at position 13\ninvalid identifier 'MEMBER_EMAIL'")
      );

      await expect(service.getCommitteeEngagement(req, 'committee-1', '30d')).rejects.toThrow('invalid identifier');
    });

    it('builds the engagement-rows cache key from the committee uid only, since one fetch now covers all three windows', async () => {
      getCommitteeMembers.mockResolvedValueOnce([]);
      execute.mockResolvedValueOnce({ rows: [] });

      await service.getCommitteeEngagement(req, 'committee-1', '90d');

      expect(buildCommitteeCacheKey).toHaveBeenCalledWith('committee-1', 'engagement-rows');
    });

    it('returns cached rows without querying Snowflake on a cache hit, but still fetches the roster live', async () => {
      buildCommitteeCacheKey.mockReturnValue('cache-key');
      getJson.mockResolvedValueOnce([row({ MEMBER_USER_ID: 'm1', INVITED_COUNT_30D: 5, ATTENDED_COUNT_30D: 5 })]);
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(execute).not.toHaveBeenCalled();
      expect(getCommitteeMembers).toHaveBeenCalledOnce();
      expect(result.data_available).toBe(true);
      expect(result.members[0]).toMatchObject({ attended: 5, invited: 5 });
    });

    it('skips the v1-mapping NATS resolution entirely on a cache hit', async () => {
      buildCommitteeCacheKey.mockReturnValue('cache-key');
      getJson.mockResolvedValueOnce([]);
      getCommitteeMembers.mockResolvedValueOnce([]);

      await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(resolveCommitteeV2UidsToV1Ids).not.toHaveBeenCalled();
    });

    it('degrades to a zeroed, data_available:false response (and does not query Snowflake) when the v2 uid has no v1 mapping', async () => {
      buildCommitteeCacheKey.mockReturnValue('cache-key');
      getJson.mockResolvedValueOnce(null);
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);
      resolveCommitteeV2UidsToV1Ids.mockResolvedValueOnce(new Map()); // no entry for 'committee-1'

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(execute).not.toHaveBeenCalled();
      expect(result.data_available).toBe(false);
      expect(setJson).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledWith(
        req,
        'get_committee_engagement',
        expect.stringContaining('Could not resolve committee v2 uid to a v1 id'),
        expect.objectContaining({ committee_uid: 'committee-1' })
      );
    });

    it('returns data_available:false, and negative-caches under the short degrade TTL, when the live query succeeds but returns zero rows for this committee', async () => {
      // The model is roster-anchored with zero-activity members retained, so a currently-populated
      // committee should always yield >=1 row per current roster member. Zero rows most likely means
      // this committee isn't synced/covered by the model yet — treated as "no data yet", not "zero
      // engagement for everyone". Still cached (short TTL) so every page load for an uncovered
      // committee doesn't cost a fresh Snowflake round trip.
      buildCommitteeCacheKey.mockReturnValue('cache-key');
      getJson.mockResolvedValueOnce(null);
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);
      execute.mockResolvedValueOnce({ rows: [] });

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.data_available).toBe(false);
      expect(setJson).toHaveBeenCalledWith('cache-key', [], 120);
    });

    it('derives data_available:false from an empty cached array on a cache hit, not a hardcoded true', async () => {
      buildCommitteeCacheKey.mockReturnValue('cache-key');
      getJson.mockResolvedValueOnce([]);
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(execute).not.toHaveBeenCalled();
      expect(result.data_available).toBe(false);
    });

    it('returns data_available:true and joins real model rows when the live query succeeds with actual rows', async () => {
      buildCommitteeCacheKey.mockReturnValue('cache-key');
      getJson.mockResolvedValueOnce(null);
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);
      execute.mockResolvedValueOnce({ rows: [row({ MEMBER_USER_ID: 'm1', INVITED_COUNT_30D: 10, ATTENDED_COUNT_30D: 8 })] });

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.data_available).toBe(true);
      expect(result.members[0]).toMatchObject({ uid: 'm1', attended: 8, invited: 10, classification: 'High' });
      expect(setJson).toHaveBeenCalledWith('cache-key', [row({ MEMBER_USER_ID: 'm1', INVITED_COUNT_30D: 10, ATTENDED_COUNT_30D: 8 })], 3600);
    });

    it('does not cache the missing-object degrade — "no data yet" must not outlive the real dbt model landing', async () => {
      buildCommitteeCacheKey.mockReturnValue('cache-key');
      getJson.mockResolvedValueOnce(null);
      getCommitteeMembers.mockResolvedValueOnce([member('m1')]);
      execute.mockRejectedValueOnce(new Error('Snowflake query execution failed: Object does not exist or not authorized.'));

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(result.data_available).toBe(false);
      expect(setJson).not.toHaveBeenCalled();
    });
  });

  describe('backend selection defaults and the production hard-block', () => {
    it('defaults to live (not mock) when ENGAGEMENT_BACKEND is unset', async () => {
      delete process.env[ENGAGEMENT_BACKEND_KEY];
      delete process.env[NODE_ENV_KEY];
      getCommitteeMembers.mockResolvedValueOnce([]);
      execute.mockResolvedValueOnce({ rows: [] });

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(execute).toHaveBeenCalled();
      expect(generateMockEngagementRows).not.toHaveBeenCalled();
      expect(result.data_source).toBe('live');
    });

    it('ignores ENGAGEMENT_BACKEND=mock and stays on the live path when NODE_ENV=production', async () => {
      process.env[ENGAGEMENT_BACKEND_KEY] = 'mock';
      process.env[NODE_ENV_KEY] = 'production';
      getCommitteeMembers.mockResolvedValueOnce([]);
      execute.mockResolvedValueOnce({ rows: [] });

      const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

      expect(execute).toHaveBeenCalled();
      expect(generateMockEngagementRows).not.toHaveBeenCalled();
      expect(result.data_source).toBe('live');
    });
  });
});

afterAll(() => {
  if (originalEngagementBackend === undefined) delete process.env[ENGAGEMENT_BACKEND_KEY];
  else process.env[ENGAGEMENT_BACKEND_KEY] = originalEngagementBackend;
  if (originalNodeEnv === undefined) delete process.env[NODE_ENV_KEY];
  else process.env[NODE_ENV_KEY] = originalNodeEnv;
});
