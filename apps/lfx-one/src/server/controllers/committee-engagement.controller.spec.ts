// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { validateUidParameter, parseCommitteeEngagementWindow, assertCommitteeRead, getCommitteeEngagement, logger } = vi.hoisted(() => ({
  validateUidParameter: vi.fn(),
  parseCommitteeEngagementWindow: vi.fn(),
  assertCommitteeRead: vi.fn(),
  getCommitteeEngagement: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('../helpers/validation.helper', () => ({ validateUidParameter }));
vi.mock('../helpers/committee-engagement-window.helper', () => ({ parseCommitteeEngagementWindow }));
vi.mock('../helpers/committee-read-access.helper', () => ({ assertCommitteeRead }));
vi.mock('../services/committee-engagement.service', () => ({
  CommitteeEngagementService: class {
    public getCommitteeEngagement = getCommitteeEngagement;
  },
}));
vi.mock('../services/logger.service', () => ({ logger }));

import { CommitteeEngagementController } from './committee-engagement.controller';

const COMMITTEE_UID = 'committee-1';

function buildReq(query: Record<string, unknown> = {}): Request {
  return { params: { uid: COMMITTEE_UID }, query, path: '/test' } as unknown as Request;
}

function buildRes(): Response {
  return { setHeader: vi.fn(), json: vi.fn() } as unknown as Response;
}

describe('CommitteeEngagementController.getEngagement', () => {
  let controller: CommitteeEngagementController;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CommitteeEngagementController();
    next = vi.fn();
    validateUidParameter.mockReturnValue(true);
    parseCommitteeEngagementWindow.mockReturnValue('30d');
    assertCommitteeRead.mockResolvedValue(undefined);
  });

  it('validates the uid, parses the window, and checks access before calling the service — in that order', async () => {
    const response = { members: [], summary: {}, computed_at: null, data_available: true };
    getCommitteeEngagement.mockResolvedValueOnce(response);
    const res = buildRes();

    await controller.getEngagement(buildReq({ window: '30d' }), res, next);

    expect(validateUidParameter).toHaveBeenCalledWith(
      COMMITTEE_UID,
      expect.anything(),
      next,
      expect.objectContaining({ operation: 'get_committee_engagement' })
    );
    expect(parseCommitteeEngagementWindow).toHaveBeenCalledWith('30d', 'get_committee_engagement');
    expect(assertCommitteeRead).toHaveBeenCalledWith(expect.anything(), COMMITTEE_UID, 'get_committee_engagement');
    expect(getCommitteeEngagement).toHaveBeenCalledWith(expect.anything(), COMMITTEE_UID, '30d');

    const validateOrder = validateUidParameter.mock.invocationCallOrder[0];
    const parseOrder = parseCommitteeEngagementWindow.mock.invocationCallOrder[0];
    const accessOrder = assertCommitteeRead.mock.invocationCallOrder[0];
    const serviceOrder = getCommitteeEngagement.mock.invocationCallOrder[0];
    expect(validateOrder).toBeLessThan(parseOrder);
    expect(parseOrder).toBeLessThan(accessOrder);
    expect(accessOrder).toBeLessThan(serviceOrder);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith(response);
    expect(next).not.toHaveBeenCalled();
  });

  it('stops after validateUidParameter returns false, without parsing the window or checking access', async () => {
    validateUidParameter.mockReturnValue(false);

    await controller.getEngagement(buildReq(), buildRes(), next);

    expect(parseCommitteeEngagementWindow).not.toHaveBeenCalled();
    expect(assertCommitteeRead).not.toHaveBeenCalled();
    expect(getCommitteeEngagement).not.toHaveBeenCalled();
  });

  it('propagates a window-validation error via next without checking access', async () => {
    const validationError = new Error('window must be one of: 30d, 90d, ytd');
    parseCommitteeEngagementWindow.mockImplementation(() => {
      throw validationError;
    });

    await controller.getEngagement(buildReq({ window: 'bad' }), buildRes(), next);

    expect(assertCommitteeRead).not.toHaveBeenCalled();
    expect(getCommitteeEngagement).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(validationError);
  });

  it('propagates a 403 from assertCommitteeRead via next without calling the service', async () => {
    const forbidden = Object.assign(new Error('forbidden'), { statusCode: 403 });
    assertCommitteeRead.mockRejectedValueOnce(forbidden);

    await controller.getEngagement(buildReq(), buildRes(), next);

    expect(getCommitteeEngagement).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(forbidden);
  });

  it('propagates a service error via next', async () => {
    const upstreamError = new Error('circuit open');
    getCommitteeEngagement.mockRejectedValueOnce(upstreamError);
    const res = buildRes();

    await controller.getEngagement(buildReq(), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(upstreamError);
  });
});
