// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The import graph transitively reaches Angular's partially-compiled @angular/common,
// which needs the JIT compiler under vitest.
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../utils/auth-helper', () => ({
  getUsernameFromAuth: vi.fn(async () => 'test-user'),
}));

const { MentorshipController } = await import('./mentorship.controller');
const { MentorshipService } = await import('../services/mentorship.service');
const { MicroserviceError, ServiceValidationError } = await import('../errors');

describe('MentorshipController program review', () => {
  const programId = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  const review = { id: programId, name: 'Test Program', status: 'published' as const };
  let controller: InstanceType<typeof MentorshipController>;
  let res: Response;
  let next: NextFunction;

  const buildReq = (params: Record<string, string>, body?: unknown): Request => ({ params, body }) as unknown as Request;

  beforeEach(() => {
    controller = new MentorshipController();
    res = { json: vi.fn() } as unknown as Response;
    next = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the review for a program UUID', async () => {
    const getProgramReview = vi.spyOn(MentorshipService.prototype, 'getProgramReview').mockResolvedValue({ ...review, status: 'pending' });

    await controller.getProgramReview(buildReq({ programId }), res, next);

    expect(getProgramReview).toHaveBeenCalledWith(expect.anything(), programId);
    expect(res.json).toHaveBeenCalledWith({ ...review, status: 'pending' });
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['mp_gridflow_fall26', 'not-a-uuid', ' '])('rejects the non-UUID program id %j before calling upstream', async (badId) => {
    const getProgramReview = vi.spyOn(MentorshipService.prototype, 'getProgramReview');

    await controller.getProgramReview(buildReq({ programId: badId }), res, next);

    expect(getProgramReview).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
  });

  it('submits a valid decision and returns the updated review', async () => {
    const submit = vi.spyOn(MentorshipService.prototype, 'submitProgramDecision').mockResolvedValue(review);

    await controller.submitProgramDecision(buildReq({ programId }, { decision: 'approve' }), res, next);

    expect(submit).toHaveBeenCalledWith(expect.anything(), programId, 'approve');
    expect(res.json).toHaveBeenCalledWith(review);
  });

  it.each([{ decision: 'publish' }, { decision: 'published' }, {}, undefined])('rejects the decision body %j', async (body) => {
    const submit = vi.spyOn(MentorshipService.prototype, 'submitProgramDecision');

    await controller.submitProgramDecision(buildReq({ programId }, body), res, next);

    expect(submit).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
  });

  // The page maps 403 to forbidden and 409 to already decided, so the upstream status must reach the error handler unchanged.
  const upstreamError = (status: number, path: string) => MicroserviceError.fromMicroserviceResponse(status, 'Upstream', {}, 'LFX_V2_SERVICE', path);

  it.each([403, 404, 409])('passes an upstream %i on load to the error handler with its status', async (status) => {
    const error = upstreamError(status, `/mentorship/v1/programs/${programId}`);
    vi.spyOn(MentorshipService.prototype, 'getProgramReview').mockRejectedValue(error);

    await controller.getProgramReview(buildReq({ programId }), res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: status }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it.each([403, 409])('passes an upstream %i on the decision to the error handler with its status', async (status) => {
    const error = upstreamError(status, `/mentorship/v1/programs/${programId}/decision`);
    vi.spyOn(MentorshipService.prototype, 'submitProgramDecision').mockRejectedValue(error);

    await controller.submitProgramDecision(buildReq({ programId }, { decision: 'approve' }), res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: status }));
    expect(res.json).not.toHaveBeenCalled();
  });
});
