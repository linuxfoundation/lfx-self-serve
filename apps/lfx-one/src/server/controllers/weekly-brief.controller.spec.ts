// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const COMMITTEE_ID = 'a0000000-0000-0000-0000-000000000001';

const { weeklyBriefSvc } = vi.hoisted(() => ({
  weeklyBriefSvc: {
    getCurrentBrief: vi.fn(),
    generateBrief: vi.fn(),
    saveBrief: vi.fn(),
  },
}));

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
  });

  describe('getCurrentBrief', () => {
    it('propagates a service error via next instead of swallowing it', async () => {
      const upstreamError = new Error('committee not found');
      weeklyBriefSvc.getCurrentBrief.mockRejectedValue(upstreamError);
      const next = vi.fn();

      await controller.getCurrentBrief(buildReq(), buildRes(), next);

      expect(next).toHaveBeenCalledWith(upstreamError);
    });
  });
});
