// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { validateUidParameter, parseCommitteeActivityQuery, getCommitteeActivity, logger } = vi.hoisted(() => ({
  validateUidParameter: vi.fn(),
  parseCommitteeActivityQuery: vi.fn(),
  getCommitteeActivity: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('../helpers/validation.helper', () => ({ validateUidParameter }));
vi.mock('../helpers/committee-activity-query.helper', () => ({ parseCommitteeActivityQuery }));
vi.mock('../services/committee-activity.service', () => ({
  CommitteeActivityService: class {
    public getCommitteeActivity = getCommitteeActivity;
  },
}));
vi.mock('../services/logger.service', () => ({ logger }));

import { CommitteeActivityController } from './committee-activity.controller';

const COMMITTEE_UID = 'committee-1';

function buildReq(query: Record<string, unknown> = {}): Request {
  return { params: { uid: COMMITTEE_UID }, query, path: '/test' } as unknown as Request;
}

function buildRes(): Response {
  return { json: vi.fn() } as unknown as Response;
}

describe('CommitteeActivityController.getActivity', () => {
  let controller: CommitteeActivityController;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CommitteeActivityController();
    next = vi.fn();
    validateUidParameter.mockReturnValue(true);
    parseCommitteeActivityQuery.mockReturnValue({ since: undefined, cursor: undefined, limit: 8 });
  });

  it('validates the uid, parses the query, and calls the service — in that order', async () => {
    const response = { data: [], page_token: undefined };
    getCommitteeActivity.mockResolvedValueOnce(response);
    const res = buildRes();

    await controller.getActivity(buildReq(), res, next);

    expect(validateUidParameter).toHaveBeenCalledWith(COMMITTEE_UID, expect.anything(), next, expect.objectContaining({ operation: 'get_committee_activity' }));
    expect(parseCommitteeActivityQuery).toHaveBeenCalledWith(expect.anything(), 'get_committee_activity');
    expect(getCommitteeActivity).toHaveBeenCalledWith(expect.anything(), COMMITTEE_UID, { since: undefined, cursor: undefined, limit: 8 });

    const validateOrder = validateUidParameter.mock.invocationCallOrder[0];
    const parseOrder = parseCommitteeActivityQuery.mock.invocationCallOrder[0];
    const serviceOrder = getCommitteeActivity.mock.invocationCallOrder[0];
    expect(validateOrder).toBeLessThan(parseOrder);
    expect(parseOrder).toBeLessThan(serviceOrder);

    expect(res.json).toHaveBeenCalledWith(response);
    expect(next).not.toHaveBeenCalled();
  });

  it('stops after validateUidParameter returns false, without parsing the query or calling the service', async () => {
    validateUidParameter.mockReturnValue(false);

    await controller.getActivity(buildReq(), buildRes(), next);

    expect(parseCommitteeActivityQuery).not.toHaveBeenCalled();
    expect(getCommitteeActivity).not.toHaveBeenCalled();
  });

  it('propagates a query-validation error via next without calling the service', async () => {
    const validationError = new Error('limit must be an integer between 1 and 50');
    parseCommitteeActivityQuery.mockImplementation(() => {
      throw validationError;
    });

    await controller.getActivity(buildReq({ limit: 'abc' }), buildRes(), next);

    expect(getCommitteeActivity).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(validationError);
  });

  it('propagates a service error via next', async () => {
    const upstreamError = new Error('circuit open');
    getCommitteeActivity.mockRejectedValueOnce(upstreamError);
    const res = buildRes();

    await controller.getActivity(buildReq(), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(upstreamError);
  });

  it('returns the response verbatim, including an undefined page_token, without reshaping it', async () => {
    const response = { data: [{ type: 'meeting_held' }], page_token: 'token(2026-01-01T00:00:00Z)' };
    getCommitteeActivity.mockResolvedValueOnce(response);
    const res = buildRes();

    await controller.getActivity(buildReq(), res, next);

    expect(res.json).toHaveBeenCalledWith(response);
  });
});
