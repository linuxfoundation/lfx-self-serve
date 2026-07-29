// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors project.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so every runtime import needs a stub. The classifier functions are deep-imported
// from their real implementation (not hand-copied) so a threshold change there fails this suite
// too; their own boundary behavior is exhaustively covered in
// packages/shared/src/utils/committee-engagement-classifier.util.spec.ts.
const { execute, getCommitteeMembers, warning } = vi.hoisted(() => ({
  execute: vi.fn(),
  getCommitteeMembers: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@lfx-one/shared/constants', () => ({ DEFAULT_LFX_ONE_PLATINUM_SCHEMA: 'ANALYTICS.PLATINUM_LFX_ONE' }));
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/committee-engagement-classifier.util')>(
    '../../../../../packages/shared/src/utils/committee-engagement-classifier.util'
  );
  return { classifyCommitteeEngagement: actual.classifyCommitteeEngagement, computeCommitteeEngagementRate: actual.computeCommitteeEngagementRate };
});
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public getCommitteeMembers = getCommitteeMembers;
  },
}));
vi.mock('./snowflake.service', () => ({
  SnowflakeService: {
    getInstance: () => ({ execute }),
    isMissingObjectError: (error: unknown) => (error as { missingObject?: boolean })?.missingObject === true,
  },
}));
vi.mock('./logger.service', () => ({
  logger: { warning },
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
  });

  it('degrades to a zeroed response when the engagement table does not exist yet', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'alice@example.com')]);
    execute.mockRejectedValueOnce({ missingObject: true });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '30d');

    expect(result).toEqual({
      members: [{ uid: 'm1', attended: 0, invited: 0, rate: 0, classification: 'Inactive' }],
      summary: { attendance_rate: 0, active_count: 0, total_count: 1, at_risk_count: 0 },
      computed_at: null,
    });
    expect(warning).toHaveBeenCalledOnce();
  });

  it('rethrows a non-missing-object Snowflake error', async () => {
    getCommitteeMembers.mockResolvedValueOnce([]);
    execute.mockRejectedValueOnce(new Error('circuit open'));

    await expect(service.getCommitteeEngagement(req, 'committee-1', '30d')).rejects.toThrow('circuit open');
  });

  it('rolls classification up into active_count and at_risk_count', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'high@x.com'), member('m2', 'low@x.com'), member('m3', 'inactive@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [
        { MEMBER_EMAIL: 'high@x.com', ATTENDED_COUNT: 10, INVITED_COUNT: 10, COMPUTED_AT: null },
        { MEMBER_EMAIL: 'low@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 10, COMPUTED_AT: null },
        { MEMBER_EMAIL: 'inactive@x.com', ATTENDED_COUNT: 0, INVITED_COUNT: 10, COMPUTED_AT: null },
      ],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', '90d');

    expect(result.summary).toEqual({ attendance_rate: 0.37, active_count: 1, total_count: 3, at_risk_count: 1 });
  });

  it('picks the first non-null computed_at among the rows', async () => {
    getCommitteeMembers.mockResolvedValueOnce([member('m1', 'a@x.com'), member('m2', 'b@x.com')]);
    execute.mockResolvedValueOnce({
      rows: [
        { MEMBER_EMAIL: 'a@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: null },
        { MEMBER_EMAIL: 'b@x.com', ATTENDED_COUNT: 1, INVITED_COUNT: 1, COMPUTED_AT: '2026-07-28T00:00:00.000Z' },
      ],
    });

    const result = await service.getCommitteeEngagement(req, 'committee-1', 'ytd');

    expect(result.computed_at).toBe('2026-07-28T00:00:00.000Z');
  });
});
