// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const COMMITTEE_ID = 'a0000000-0000-0000-0000-000000000001';
const BRIEF_UID = 'wb_00000000-0000-0000-0000-000000000001';

const { weeklyBriefSvc, assertCommitteeRead, assertCommitteeWrite } = vi.hoisted(() => ({
  weeklyBriefSvc: {
    getCurrentBrief: vi.fn(),
    getActionItems: vi.fn(),
    generateBrief: vi.fn(),
    saveBrief: vi.fn(),
    shareBrief: vi.fn(),
    shareToSlack: vi.fn(),
    rateBrief: vi.fn(),
    clearBriefRating: vi.fn(),
  },
  assertCommitteeRead: vi.fn(),
  assertCommitteeWrite: vi.fn(),
}));

vi.mock('../helpers/committee-read-access.helper', () => ({ assertCommitteeRead }));
vi.mock('../helpers/committee-write-access.helper', () => ({ assertCommitteeWrite }));

// The `@lfx-one/shared/*` alias isn't wired into the server-side vitest config —
// mocked defensively even though this controller's usage is type-only (matches
// committee.controller.spec.ts's convention).
vi.mock('@lfx-one/shared/interfaces', () => ({}));
// `constants` is a real runtime import here (WEEKLY_BRIEF_TEXT_MAX_LENGTH), unlike
// `interfaces` above — must be mocked or the real module load re-triggers the
// Angular JIT-compilation failure this file's mocks otherwise avoid.
vi.mock('@lfx-one/shared/constants', () => ({ WEEKLY_BRIEF_TEXT_MAX_LENGTH: 20_000 }));

// validation.helper.ts pulls in @lfx-one/shared/constants + /utils for functions this
// controller never calls (only validateUidParameter is used) — mock the whole module
// rather than let those unrelated imports execute (matches committee.controller.spec.ts).
vi.mock('../helpers/validation.helper', () => ({
  validateUidParameter: (uid: unknown, req: unknown, next: (err: Error) => void): uid is string => {
    if (typeof uid !== 'string' || uid.trim() === '') {
      next(new Error('uid is required'));
      return false;
    }
    return true;
  },
  // Real implementation (not a stub) — this spec's includeCurrentActivity tests exercise the
  // actual narrowing behavior (undefined on a missing/non-string query value), not a canned
  // return.
  getStringQueryParam: (req: { query: Record<string, unknown> }, name: string): string | undefined => {
    const value = req.query[name];
    return typeof value === 'string' ? value : undefined;
  },
}));

vi.mock('../services/weekly-brief.service', () => ({
  WeeklyBriefService: vi.fn(function () {
    return weeklyBriefSvc;
  }),
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { WeeklyBriefController } from './weekly-brief.controller';

function buildReq(body: unknown = {}, query: Record<string, string> = {}): any {
  return { params: { committeeId: COMMITTEE_ID }, query, body, path: '/test', log: {} };
}

function buildRatingReq(body: unknown = {}): any {
  return { params: { committeeId: COMMITTEE_ID, briefUid: BRIEF_UID }, query: {}, body, path: '/test', log: {} };
}

function buildRes(): any {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), send: vi.fn(), setHeader: vi.fn() };
}

describe('WeeklyBriefController', () => {
  let controller: WeeklyBriefController;

  beforeEach(() => {
    vi.clearAllMocks();
    assertCommitteeRead.mockResolvedValue(undefined);
    assertCommitteeWrite.mockResolvedValue(undefined);
    controller = new WeeklyBriefController();
  });

  describe('generateBrief — request body validation', () => {
    it('accepts an empty body (force defaults to unset)', async () => {
      weeklyBriefSvc.generateBrief.mockResolvedValue({ status: 200, data: { brief: { uid: 'b1' }, throttle: {} } });
      const next = vi.fn();

      await controller.generateBrief(buildReq(undefined), buildRes(), next);

      expect(weeklyBriefSvc.generateBrief).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, { force: undefined });
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts force: true', async () => {
      weeklyBriefSvc.generateBrief.mockResolvedValue({ status: 200, data: { brief: { uid: 'b1' }, throttle: {} } });

      await controller.generateBrief(buildReq({ force: true }), buildRes(), vi.fn());

      expect(weeklyBriefSvc.generateBrief).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, { force: true });
    });

    it('rejects a non-boolean force instead of forwarding it upstream (LFXV2-2175 review: no whitelist previously)', async () => {
      const next = vi.fn();

      await controller.generateBrief(buildReq({ force: 'yes' }), buildRes(), next);

      expect(weeklyBriefSvc.generateBrief).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('rejects an array body instead of treating it as an empty object (dealako review round 3: typeof [] === object)', async () => {
      const next = vi.fn();

      await controller.generateBrief(buildReq([]), buildRes(), next);

      expect(weeklyBriefSvc.generateBrief).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('silently drops unknown fields (e.g. a stale client still sending revision) rather than forwarding them', async () => {
      weeklyBriefSvc.generateBrief.mockResolvedValue({ status: 200, data: { brief: { uid: 'b1' }, throttle: {} } });

      await controller.generateBrief(buildReq({ revision: 7, reason: 'because' }), buildRes(), vi.fn());

      expect(weeklyBriefSvc.generateBrief).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, { force: undefined });
    });
  });

  describe('generateBrief — status code forwarding', () => {
    it('forwards a 202 (accepted, still generating) instead of collapsing to 200', async () => {
      const data = { brief: { uid: 'b1', state: 'generating', revision: 1, regeneration_count: 0 }, throttle: { generates_used: 1, regenerations_used: 0 } };
      weeklyBriefSvc.generateBrief.mockResolvedValue({ status: 202, data });
      const res = buildRes();

      await controller.generateBrief(buildReq({}), res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith(data);
    });
  });

  describe('generateBrief — write access gate', () => {
    it('checks committee write access before generating (dealako review: generate had no server-side authz)', async () => {
      weeklyBriefSvc.generateBrief.mockResolvedValue({ status: 202, data: {} });

      await controller.generateBrief(buildReq({}), buildRes(), vi.fn());

      expect(assertCommitteeWrite).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, 'generate_weekly_brief');
      const accessOrder = assertCommitteeWrite.mock.invocationCallOrder[0];
      const generateOrder = weeklyBriefSvc.generateBrief.mock.invocationCallOrder[0];
      expect(accessOrder).toBeLessThan(generateOrder);
    });

    it('propagates a 403 from assertCommitteeWrite via next without calling the service', async () => {
      const forbidden = new Error('You do not have access to this committee.');
      assertCommitteeWrite.mockRejectedValueOnce(forbidden);
      const next = vi.fn();

      await controller.generateBrief(buildReq({}), buildRes(), next);

      expect(weeklyBriefSvc.generateBrief).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(forbidden);
    });
  });

  describe('saveBrief — request body validation', () => {
    it('rejects an empty brief_text', async () => {
      const next = vi.fn();

      await controller.saveBrief(buildReq({ brief_text: '   ', revision: 1 }), buildRes(), next);

      expect(weeklyBriefSvc.saveBrief).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('rejects a non-integer revision', async () => {
      const next = vi.fn();

      await controller.saveBrief(buildReq({ brief_text: 'x', revision: 1.5 }), buildRes(), next);

      expect(weeklyBriefSvc.saveBrief).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('rejects revision < 1', async () => {
      const next = vi.fn();

      await controller.saveBrief(buildReq({ brief_text: 'x', revision: 0 }), buildRes(), next);

      expect(weeklyBriefSvc.saveBrief).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('accepts a valid body', async () => {
      weeklyBriefSvc.saveBrief.mockResolvedValue({ uid: 'b1', revision: 2, state: 'edited' });

      await controller.saveBrief(buildReq({ brief_text: 'updated', revision: 1 }), buildRes(), vi.fn());

      expect(weeklyBriefSvc.saveBrief).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, { brief_text: 'updated', revision: 1 });
    });

    it('accepts a 15,000-code-point emoji string (30,000 UTF-16 units, under the code-point limit)', async () => {
      weeklyBriefSvc.saveBrief.mockResolvedValue({ uid: 'b1', revision: 2, state: 'edited' });
      const briefText = '😀'.repeat(15_000);

      await controller.saveBrief(buildReq({ brief_text: briefText, revision: 1 }), buildRes(), vi.fn());

      expect(weeklyBriefSvc.saveBrief).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, { brief_text: briefText, revision: 1 });
    });

    it('accepts a 20,000-code-point emoji string (exactly at the limit — WEEKLY_BRIEF_TEXT_MAX_LENGTH is inclusive)', async () => {
      weeklyBriefSvc.saveBrief.mockResolvedValue({ uid: 'b1', revision: 2, state: 'edited' });
      const briefText = '😀'.repeat(20_000);

      await controller.saveBrief(buildReq({ brief_text: briefText, revision: 1 }), buildRes(), vi.fn());

      expect(weeklyBriefSvc.saveBrief).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, { brief_text: briefText, revision: 1 });
    });

    it('rejects a 20,001-code-point emoji string (LFXV2-2175 review: count code points, not UTF-16 units)', async () => {
      const next = vi.fn();
      const briefText = '😀'.repeat(20_001);

      await controller.saveBrief(buildReq({ brief_text: briefText, revision: 1 }), buildRes(), next);

      expect(weeklyBriefSvc.saveBrief).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('saveBrief — write access gate', () => {
    it('checks committee write access before saving (dealako review: save had no server-side authz)', async () => {
      weeklyBriefSvc.saveBrief.mockResolvedValue({ uid: 'b1', revision: 2, state: 'edited' });

      await controller.saveBrief(buildReq({ brief_text: 'updated', revision: 1 }), buildRes(), vi.fn());

      expect(assertCommitteeWrite).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, 'save_weekly_brief');
      const accessOrder = assertCommitteeWrite.mock.invocationCallOrder[0];
      const saveOrder = weeklyBriefSvc.saveBrief.mock.invocationCallOrder[0];
      expect(accessOrder).toBeLessThan(saveOrder);
    });

    it('propagates a 403 from assertCommitteeWrite via next without calling the service', async () => {
      const forbidden = new Error('You do not have access to this committee.');
      assertCommitteeWrite.mockRejectedValueOnce(forbidden);
      const next = vi.fn();

      await controller.saveBrief(buildReq({ brief_text: 'updated', revision: 1 }), buildRes(), next);

      expect(weeklyBriefSvc.saveBrief).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(forbidden);
    });
  });

  describe('getCurrentBrief', () => {
    it('propagates a service error via next instead of swallowing it', async () => {
      const upstreamError = new Error('committee not found');
      weeklyBriefSvc.getCurrentBrief.mockRejectedValue(upstreamError);
      const next = vi.fn();

      await controller.getCurrentBrief(buildReq(), buildRes(), next);

      expect(next).toHaveBeenCalledWith(upstreamError);
    });

    it('checks committee read access before fetching the brief (LFXV2-2175 review: GET had no server-side authz)', async () => {
      weeklyBriefSvc.getCurrentBrief.mockResolvedValue({ brief: null, throttle: null });

      await controller.getCurrentBrief(buildReq(), buildRes(), vi.fn());

      expect(assertCommitteeRead).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, 'get_weekly_brief_current');
      const accessOrder = assertCommitteeRead.mock.invocationCallOrder[0];
      const fetchOrder = weeklyBriefSvc.getCurrentBrief.mock.invocationCallOrder[0];
      expect(accessOrder).toBeLessThan(fetchOrder);
    });

    it('propagates a 403 from assertCommitteeRead via next without calling the service', async () => {
      const forbidden = new Error('You do not have access to this committee.');
      assertCommitteeRead.mockRejectedValueOnce(forbidden);
      const next = vi.fn();

      await controller.getCurrentBrief(buildReq(), buildRes(), next);

      expect(weeklyBriefSvc.getCurrentBrief).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(forbidden);
    });

    it('defaults includeCurrentActivity to true when the query param is absent (GH-1922)', async () => {
      weeklyBriefSvc.getCurrentBrief.mockResolvedValue({ brief: null, throttle: null });

      await controller.getCurrentBrief(buildReq(), buildRes(), vi.fn());

      expect(weeklyBriefSvc.getCurrentBrief).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, { includeCurrentActivity: true });
    });

    it('only opts out of includeCurrentActivity on an exact "false" query value — any other value keeps the default', async () => {
      weeklyBriefSvc.getCurrentBrief.mockResolvedValue({ brief: null, throttle: null });

      await controller.getCurrentBrief(buildReq({}, { includeCurrentActivity: 'false' }), buildRes(), vi.fn());
      await controller.getCurrentBrief(buildReq({}, { includeCurrentActivity: 'nope' }), buildRes(), vi.fn());

      expect(weeklyBriefSvc.getCurrentBrief).toHaveBeenNthCalledWith(1, expect.anything(), COMMITTEE_ID, { includeCurrentActivity: false });
      expect(weeklyBriefSvc.getCurrentBrief).toHaveBeenNthCalledWith(2, expect.anything(), COMMITTEE_ID, { includeCurrentActivity: true });
    });

    it('sets Cache-Control: no-store — the response can carry per-user, FGA-filtered activity/rating content', async () => {
      weeklyBriefSvc.getCurrentBrief.mockResolvedValue({ brief: null, throttle: null });
      const res = buildRes();

      await controller.getCurrentBrief(buildReq(), res, vi.fn());

      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
  });

  describe('getActionItems (LFXV2-3043)', () => {
    it('propagates a service error via next instead of swallowing it', async () => {
      const upstreamError = new Error('extraction failed');
      weeklyBriefSvc.getActionItems.mockRejectedValue(upstreamError);
      const next = vi.fn();

      await controller.getActionItems(buildReq(), buildRes(), next);

      expect(next).toHaveBeenCalledWith(upstreamError);
    });

    it('checks committee read access before fetching action items — same gate as getCurrentBrief, run before the service call', async () => {
      weeklyBriefSvc.getActionItems.mockResolvedValue({ items: [] });

      await controller.getActionItems(buildReq(), buildRes(), vi.fn());

      expect(assertCommitteeRead).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, 'get_weekly_brief_action_items');
      const accessOrder = assertCommitteeRead.mock.invocationCallOrder[0];
      const fetchOrder = weeklyBriefSvc.getActionItems.mock.invocationCallOrder[0];
      expect(accessOrder).toBeLessThan(fetchOrder);
    });

    it('propagates a 403 from assertCommitteeRead via next without calling the service', async () => {
      const forbidden = new Error('You do not have access to this committee.');
      assertCommitteeRead.mockRejectedValueOnce(forbidden);
      const next = vi.fn();

      await controller.getActionItems(buildReq(), buildRes(), next);

      expect(weeklyBriefSvc.getActionItems).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(forbidden);
    });

    it('stops after validateUidParameter rejects an invalid committeeId, without checking access or calling the service', async () => {
      const next = vi.fn();
      const req = { params: { committeeId: '' }, body: {}, path: '/test', log: {} } as any;

      await controller.getActionItems(req, buildRes(), next);

      expect(assertCommitteeRead).not.toHaveBeenCalled();
      expect(weeklyBriefSvc.getActionItems).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('returns the service result as JSON', async () => {
      const items = [{ uid: 'a', text: 'Onboard the new member', source_brief_uid: 'b1', committee_uid: COMMITTEE_ID }];
      weeklyBriefSvc.getActionItems.mockResolvedValue({ items });
      const res = buildRes();

      await controller.getActionItems(buildReq(), res, vi.fn());

      expect(res.json).toHaveBeenCalledWith({ items });
    });
  });

  describe('shareBrief (LFXV2-2914 / LFXV2-3093)', () => {
    it('rejects a missing revision', async () => {
      const next = vi.fn();

      await controller.shareBrief(buildReq({}), buildRes(), next);

      expect(weeklyBriefSvc.shareBrief).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('accepts a valid body and forwards the revision to the service', async () => {
      weeklyBriefSvc.shareBrief.mockResolvedValue({ committee_name: 'Test Committee', total_recipients: 5 });

      await controller.shareBrief(buildReq({ revision: 3 }), buildRes(), vi.fn());

      expect(weeklyBriefSvc.shareBrief).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, 3);
    });

    it('checks committee read access before sharing — the service enforces the real (LFXV2-3093: real-identity) project-writer boundary', async () => {
      weeklyBriefSvc.shareBrief.mockResolvedValue({ committee_name: 'Test Committee', total_recipients: 5 });

      await controller.shareBrief(buildReq({ revision: 1 }), buildRes(), vi.fn());

      expect(assertCommitteeRead).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, 'share_weekly_brief');
      const accessOrder = assertCommitteeRead.mock.invocationCallOrder[0];
      const shareOrder = weeklyBriefSvc.shareBrief.mock.invocationCallOrder[0];
      expect(accessOrder).toBeLessThan(shareOrder);
    });

    it('propagates a service error via next instead of swallowing it (e.g. 403 NOT_PROJECT_WRITER)', async () => {
      const upstreamError = Object.assign(new Error('not a writer'), { statusCode: 403, code: 'NOT_PROJECT_WRITER' });
      weeklyBriefSvc.shareBrief.mockRejectedValue(upstreamError);
      const next = vi.fn();

      await controller.shareBrief(buildReq({ revision: 1 }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(upstreamError);
    });

    it('returns the service result as JSON', async () => {
      const result = { committee_name: 'Test Committee', total_recipients: 5 };
      weeklyBriefSvc.shareBrief.mockResolvedValue(result);
      const res = buildRes();

      await controller.shareBrief(buildReq({ revision: 1 }), res, vi.fn());

      expect(res.json).toHaveBeenCalledWith(result);
    });
  });

  describe('shareToSlack (LFXV2-3080) — request body validation', () => {
    it('rejects a missing revision', async () => {
      const next = vi.fn();

      await controller.shareToSlack(buildReq({}), buildRes(), next);

      expect(weeklyBriefSvc.shareToSlack).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('rejects a non-numeric revision', async () => {
      const next = vi.fn();

      await controller.shareToSlack(buildReq({ revision: 'one' }), buildRes(), next);

      expect(weeklyBriefSvc.shareToSlack).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('rejects a non-integer, non-positive, or unsafe-integer revision — same bound as validateRateBriefBody/validateClearRatingBody, since this now crosses the wire as the committee-service share-to-chat body (UInt64, Minimum(1))', async () => {
      for (const badRevision of [0, -1, 1.5, 1e20]) {
        const next = vi.fn();

        await controller.shareToSlack(buildReq({ revision: badRevision }), buildRes(), next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      }
      expect(weeklyBriefSvc.shareToSlack).not.toHaveBeenCalled();
    });

    it('accepts a valid body and forwards the revision to the service', async () => {
      weeklyBriefSvc.shareToSlack.mockResolvedValue({});

      await controller.shareToSlack(buildReq({ revision: 3 }), buildRes(), vi.fn());

      expect(weeklyBriefSvc.shareToSlack).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, 3);
    });
  });

  describe('shareToSlack (LFXV2-3080) — read access gate', () => {
    it('checks committee read access before sharing — same gate shape as shareBrief: the service enforces the real project-writer boundary', async () => {
      weeklyBriefSvc.shareToSlack.mockResolvedValue({});

      await controller.shareToSlack(buildReq({ revision: 1 }), buildRes(), vi.fn());

      expect(assertCommitteeRead).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, 'share_weekly_brief_slack');
      const accessOrder = assertCommitteeRead.mock.invocationCallOrder[0];
      const shareOrder = weeklyBriefSvc.shareToSlack.mock.invocationCallOrder[0];
      expect(accessOrder).toBeLessThan(shareOrder);
    });

    it('propagates a 403 from assertCommitteeRead via next without calling the service', async () => {
      const forbidden = new Error('You do not have access to this committee.');
      assertCommitteeRead.mockRejectedValueOnce(forbidden);
      const next = vi.fn();

      await controller.shareToSlack(buildReq({ revision: 1 }), buildRes(), next);

      expect(weeklyBriefSvc.shareToSlack).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(forbidden);
    });

    it('stops after validateUidParameter rejects an invalid committeeId, without checking access or calling the service', async () => {
      const next = vi.fn();
      const req = { params: { committeeId: '' }, body: { revision: 1 }, path: '/test', log: {} } as any;

      await controller.shareToSlack(req, buildRes(), next);

      expect(assertCommitteeRead).not.toHaveBeenCalled();
      expect(weeklyBriefSvc.shareToSlack).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('shareToSlack (LFXV2-3080)', () => {
    it('propagates a service error via next instead of swallowing it (e.g. 409 NO_SLACK_WEBHOOK)', async () => {
      const upstreamError = Object.assign(new Error('no webhook'), { statusCode: 409, code: 'NO_SLACK_WEBHOOK' });
      weeklyBriefSvc.shareToSlack.mockRejectedValue(upstreamError);
      const next = vi.fn();

      await controller.shareToSlack(buildReq({ revision: 1 }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(upstreamError);
    });

    it('returns the service result as JSON', async () => {
      const result = {};
      weeklyBriefSvc.shareToSlack.mockResolvedValue(result);
      const res = buildRes();

      await controller.shareToSlack(buildReq({ revision: 1 }), res, vi.fn());

      expect(res.json).toHaveBeenCalledWith(result);
    });
  });

  describe('rateBrief — request body validation', () => {
    it('rejects a missing rating', async () => {
      const next = vi.fn();

      await controller.rateBrief(buildRatingReq({ revision: 1 }), buildRes(), next);

      expect(weeklyBriefSvc.rateBrief).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('rejects a rating value outside the closed up/down type (LFXV2-3042: not a free string)', async () => {
      const next = vi.fn();

      await controller.rateBrief(buildRatingReq({ rating: 'love it', revision: 1 }), buildRes(), next);

      expect(weeklyBriefSvc.rateBrief).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('rejects a missing revision', async () => {
      const next = vi.fn();

      await controller.rateBrief(buildRatingReq({ rating: 'up' }), buildRes(), next);

      expect(weeklyBriefSvc.rateBrief).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('rejects a non-integer revision', async () => {
      const next = vi.fn();

      await controller.rateBrief(buildRatingReq({ rating: 'up', revision: 1.5 }), buildRes(), next);

      expect(weeklyBriefSvc.rateBrief).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('accepts "up"', async () => {
      weeklyBriefSvc.rateBrief.mockResolvedValue({ rating: 'up' });

      await controller.rateBrief(buildRatingReq({ rating: 'up', revision: 1 }), buildRes(), vi.fn());

      expect(weeklyBriefSvc.rateBrief).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, BRIEF_UID, 'up', 1);
    });

    it('accepts "down"', async () => {
      weeklyBriefSvc.rateBrief.mockResolvedValue({ rating: 'down' });

      await controller.rateBrief(buildRatingReq({ rating: 'down', revision: 2 }), buildRes(), vi.fn());

      expect(weeklyBriefSvc.rateBrief).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, BRIEF_UID, 'down', 2);
    });
  });

  describe('rateBrief — read access gate', () => {
    it('checks committee read access before rating (a rating is a personal reaction, not a committee edit)', async () => {
      weeklyBriefSvc.rateBrief.mockResolvedValue({ rating: 'up' });

      await controller.rateBrief(buildRatingReq({ rating: 'up', revision: 1 }), buildRes(), vi.fn());

      expect(assertCommitteeRead).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, 'rate_weekly_brief');
      const accessOrder = assertCommitteeRead.mock.invocationCallOrder[0];
      const rateOrder = weeklyBriefSvc.rateBrief.mock.invocationCallOrder[0];
      expect(accessOrder).toBeLessThan(rateOrder);
    });

    it('propagates a 403 from assertCommitteeRead via next without calling the service', async () => {
      const forbidden = new Error('You do not have access to this committee.');
      assertCommitteeRead.mockRejectedValueOnce(forbidden);
      const next = vi.fn();

      await controller.rateBrief(buildRatingReq({ rating: 'up', revision: 1 }), buildRes(), next);

      expect(weeklyBriefSvc.rateBrief).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(forbidden);
    });
  });

  describe('clearBriefRating — request body validation', () => {
    it('rejects a missing revision', async () => {
      const next = vi.fn();

      await controller.clearBriefRating(buildRatingReq({}), buildRes(), next);

      expect(weeklyBriefSvc.clearBriefRating).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('rejects a non-numeric revision', async () => {
      const next = vi.fn();

      await controller.clearBriefRating(buildRatingReq({ revision: 'one' }), buildRes(), next);

      expect(weeklyBriefSvc.clearBriefRating).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('rejects a non-integer revision — same bound as rateBrief, not the looser finite-number check (PR #1361 review, round 2)', async () => {
      const next = vi.fn();

      await controller.clearBriefRating(buildRatingReq({ revision: 1.5 }), buildRes(), next);

      expect(weeklyBriefSvc.clearBriefRating).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('rejects revision < 1', async () => {
      const next = vi.fn();

      await controller.clearBriefRating(buildRatingReq({ revision: 0 }), buildRes(), next);

      expect(weeklyBriefSvc.clearBriefRating).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('clearBriefRating', () => {
    it('checks committee read access, calls the service, and responds 204 with no body', async () => {
      weeklyBriefSvc.clearBriefRating.mockResolvedValue(undefined);
      const res = buildRes();

      await controller.clearBriefRating(buildRatingReq({ revision: 1 }), res, vi.fn());

      expect(assertCommitteeRead).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, 'clear_weekly_brief_rating');
      expect(weeklyBriefSvc.clearBriefRating).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, BRIEF_UID, 1);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledWith();
    });

    it('propagates a service error via next instead of swallowing it', async () => {
      const upstreamError = new Error('no brief to clear');
      weeklyBriefSvc.clearBriefRating.mockRejectedValue(upstreamError);
      const next = vi.fn();

      await controller.clearBriefRating(buildRatingReq({ revision: 1 }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(upstreamError);
    });

    it('propagates a 403 from assertCommitteeRead via next without calling the service', async () => {
      const forbidden = new Error('You do not have access to this committee.');
      assertCommitteeRead.mockRejectedValueOnce(forbidden);
      const next = vi.fn();

      await controller.clearBriefRating(buildRatingReq({ revision: 1 }), buildRes(), next);

      expect(weeklyBriefSvc.clearBriefRating).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(forbidden);
    });
  });
});
