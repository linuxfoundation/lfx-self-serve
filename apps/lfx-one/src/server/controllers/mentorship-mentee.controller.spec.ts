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

const { MentorshipMenteeController } = await import('./mentorship-mentee.controller');
const { MentorshipMenteeService } = await import('../services/mentorship-mentee.service');
const { AuthenticationError, ServiceValidationError } = await import('../errors');
const { getUsernameFromAuth } = await import('../utils/auth-helper');

describe('MentorshipMenteeController', () => {
  let controller: InstanceType<typeof MentorshipMenteeController>;
  let res: Response;
  let next: NextFunction;

  const buildReq = (query: Record<string, unknown>): Request => ({ query }) as unknown as Request;

  beforeEach(() => {
    controller = new MentorshipMenteeController();
    res = { json: vi.fn() } as unknown as Response;
    next = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getMenteeApplications', () => {
    type ApplicationsResponse = Awaited<ReturnType<InstanceType<typeof MentorshipMenteeService>['getMenteeApplications']>>;
    const applications = { data: [], total: 0 } as ApplicationsResponse;

    it.each([
      [{ withTasks: 'true' }, true],
      [{ withTasks: 'false' }, false],
      [{}, false],
    ])('reads the query %j as withTasks=%s', async (query, withTasks) => {
      const getMenteeApplications = vi.spyOn(MentorshipMenteeService.prototype, 'getMenteeApplications').mockResolvedValue(applications);

      await controller.getMenteeApplications(buildReq(query), res, next);

      expect(getMenteeApplications).toHaveBeenCalledWith(expect.anything(), withTasks);
      expect(res.json).toHaveBeenCalledWith(applications);
      expect(next).not.toHaveBeenCalled();
    });

    it.each([{ withTasks: 'yes' }, { withTasks: '' }, { withTasks: ['true', 'false'] }])('rejects the query %j before calling the service', async (query) => {
      const getMenteeApplications = vi.spyOn(MentorshipMenteeService.prototype, 'getMenteeApplications');

      await controller.getMenteeApplications(buildReq(query), res, next);

      expect(getMenteeApplications).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    });

    it('requires an authenticated user', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const getMenteeApplications = vi.spyOn(MentorshipMenteeService.prototype, 'getMenteeApplications');

      await controller.getMenteeApplications(buildReq({ withTasks: 'true' }), res, next);

      expect(getMenteeApplications).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
  });

  describe('withdrawMenteeApplication', () => {
    const applicationId = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
    const buildWithdrawReq = (params: Record<string, unknown>): Request => ({ params, query: {} }) as unknown as Request;

    beforeEach(() => {
      res = { json: vi.fn(), status: vi.fn(), send: vi.fn() } as unknown as Response;
      vi.mocked(res.status).mockReturnValue(res);
    });

    it('withdraws the trimmed application id and answers 204 with no body', async () => {
      const withdraw = vi.spyOn(MentorshipMenteeService.prototype, 'withdrawMenteeApplication').mockResolvedValue(undefined);

      await controller.withdrawMenteeApplication(buildWithdrawReq({ applicationId: ` ${applicationId} ` }), res, next);

      expect(withdraw).toHaveBeenCalledWith(expect.anything(), applicationId);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledWith();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it.each([{}, { applicationId: '' }, { applicationId: 'app-1' }, { applicationId: [applicationId] }])(
      'rejects the params %j before calling the service',
      async (params) => {
        const withdraw = vi.spyOn(MentorshipMenteeService.prototype, 'withdrawMenteeApplication');

        await controller.withdrawMenteeApplication(buildWithdrawReq(params), res, next);

        expect(withdraw).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      }
    );

    it('passes an upstream failure to the error handler', async () => {
      const error = new Error('conflict');
      vi.spyOn(MentorshipMenteeService.prototype, 'withdrawMenteeApplication').mockRejectedValue(error);

      await controller.withdrawMenteeApplication(buildWithdrawReq({ applicationId }), res, next);

      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(error);
    });

    it('requires an authenticated user', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const withdraw = vi.spyOn(MentorshipMenteeService.prototype, 'withdrawMenteeApplication');

      await controller.withdrawMenteeApplication(buildWithdrawReq({ applicationId }), res, next);

      expect(withdraw).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
  });

  const programId = '3b1f6c0e-2d4a-4e8b-9c1d-5f6a7b8c9d0e';
  const programTermId = '8e2d4c6a-1b3f-4a5c-8d7e-9f0a1b2c3d4e';
  const invalidApplyIds = [
    { programTermId },
    { programId: '   ', programTermId },
    { programId },
    { programId, programTermId: '' },
    { programId: [programId], programTermId },
    { programId: 'test-program', programTermId },
    { programId, programTermId: 'term-1' },
  ];

  describe('getMenteeApplyTarget', () => {
    it('passes the trimmed program and term ids through to the service', async () => {
      const target = { programName: 'Program' } as Awaited<ReturnType<InstanceType<typeof MentorshipMenteeService>['getMenteeApplyTarget']>>;
      const getMenteeApplyTarget = vi.spyOn(MentorshipMenteeService.prototype, 'getMenteeApplyTarget').mockResolvedValue(target);

      await controller.getMenteeApplyTarget(buildReq({ programId: ` ${programId} `, programTermId }), res, next);

      expect(getMenteeApplyTarget).toHaveBeenCalledWith(expect.anything(), programId, programTermId);
      expect(res.json).toHaveBeenCalledWith(target);
      expect(next).not.toHaveBeenCalled();
    });

    it.each(invalidApplyIds)('rejects the query %j before calling the service', async (query) => {
      const getMenteeApplyTarget = vi.spyOn(MentorshipMenteeService.prototype, 'getMenteeApplyTarget');

      await controller.getMenteeApplyTarget(buildReq(query), res, next);

      expect(getMenteeApplyTarget).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    });
  });

  describe('applyToMenteeTerm', () => {
    const buildApplyReq = (body: unknown): Request => ({ body, query: {} }) as unknown as Request;

    beforeEach(() => {
      res = { json: vi.fn(), status: vi.fn(), send: vi.fn() } as unknown as Response;
      vi.mocked(res.status).mockReturnValue(res);
    });

    it('applies with the trimmed ids from the body and answers 204 with no body', async () => {
      const apply = vi.spyOn(MentorshipMenteeService.prototype, 'applyToMenteeTerm').mockResolvedValue(undefined);

      await controller.applyToMenteeTerm(buildApplyReq({ programId, programTermId: ` ${programTermId} ` }), res, next);

      expect(apply).toHaveBeenCalledWith(expect.anything(), programId, programTermId);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledWith();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it.each([undefined, ...invalidApplyIds])('rejects the body %j before calling the service', async (body) => {
      const apply = vi.spyOn(MentorshipMenteeService.prototype, 'applyToMenteeTerm');

      await controller.applyToMenteeTerm(buildApplyReq(body), res, next);

      expect(apply).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    });

    it('passes an upstream failure to the error handler', async () => {
      const error = new Error('conflict');
      vi.spyOn(MentorshipMenteeService.prototype, 'applyToMenteeTerm').mockRejectedValue(error);

      await controller.applyToMenteeTerm(buildApplyReq({ programId, programTermId }), res, next);

      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(error);
    });

    it('requires an authenticated user', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const apply = vi.spyOn(MentorshipMenteeService.prototype, 'applyToMenteeTerm');

      await controller.applyToMenteeTerm(buildApplyReq({ programId, programTermId }), res, next);

      expect(apply).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
  });
});
