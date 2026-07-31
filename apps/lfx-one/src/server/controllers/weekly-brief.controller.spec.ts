// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const COMMITTEE_ID = 'a0000000-0000-0000-0000-000000000001';

const { weeklyBriefSvc, assertCommitteeRead, assertCommitteeWrite } = vi.hoisted(() => ({
  weeklyBriefSvc: {
    getCurrentBrief: vi.fn(),
    generateBrief: vi.fn(),
    saveBrief: vi.fn(),
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

function buildReq(body: unknown = {}): any {
  return { params: { committeeId: COMMITTEE_ID }, body, path: '/test', log: {} };
}

function buildRes(): any {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
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
  });
});
