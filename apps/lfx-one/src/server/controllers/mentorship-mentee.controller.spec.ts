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

  describe('getMenteeOverview', () => {
    it('passes a valid, trimmed phase through to the service', async () => {
      const overview = { phase: 'applicant' } as Awaited<ReturnType<InstanceType<typeof MentorshipMenteeService>['getMenteeOverview']>>;
      const getMenteeOverview = vi.spyOn(MentorshipMenteeService.prototype, 'getMenteeOverview').mockResolvedValue(overview);

      await controller.getMenteeOverview(buildReq({ phase: ' applicant ' }), res, next);

      expect(getMenteeOverview).toHaveBeenCalledWith(expect.anything(), 'applicant');
      expect(res.json).toHaveBeenCalledWith(overview);
      expect(next).not.toHaveBeenCalled();
    });

    it('lets the service pick the phase when none is given', async () => {
      const overview = { phase: 'empty' } as Awaited<ReturnType<InstanceType<typeof MentorshipMenteeService>['getMenteeOverview']>>;
      const getMenteeOverview = vi.spyOn(MentorshipMenteeService.prototype, 'getMenteeOverview').mockResolvedValue(overview);

      await controller.getMenteeOverview(buildReq({}), res, next);

      expect(getMenteeOverview).toHaveBeenCalledWith(expect.anything(), undefined);
    });

    it('rejects a phase outside the allow-list before calling the service', async () => {
      const getMenteeOverview = vi.spyOn(MentorshipMenteeService.prototype, 'getMenteeOverview');

      await controller.getMenteeOverview(buildReq({ phase: 'bogus' }), res, next);

      expect(getMenteeOverview).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    });

    it('requires an authenticated user', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const getMenteeOverview = vi.spyOn(MentorshipMenteeService.prototype, 'getMenteeOverview');

      await controller.getMenteeOverview(buildReq({ phase: 'applicant' }), res, next);

      expect(getMenteeOverview).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
  });

  describe('getMenteeApplyTarget', () => {
    it('passes the trimmed program and term ids through to the service', async () => {
      const target = { programName: 'Program' } as Awaited<ReturnType<InstanceType<typeof MentorshipMenteeService>['getMenteeApplyTarget']>>;
      const getMenteeApplyTarget = vi.spyOn(MentorshipMenteeService.prototype, 'getMenteeApplyTarget').mockResolvedValue(target);

      await controller.getMenteeApplyTarget(buildReq({ programId: ' p-1 ', programTermId: 't-1' }), res, next);

      expect(getMenteeApplyTarget).toHaveBeenCalledWith(expect.anything(), 'p-1', 't-1');
      expect(res.json).toHaveBeenCalledWith(target);
      expect(next).not.toHaveBeenCalled();
    });

    it.each([
      { programTermId: 't-1' },
      { programId: '   ', programTermId: 't-1' },
      { programId: 'p-1' },
      { programId: 'p-1', programTermId: '' },
      { programId: ['p-1'], programTermId: 't-1' },
    ])('rejects the query %j before calling the service', async (query) => {
      const getMenteeApplyTarget = vi.spyOn(MentorshipMenteeService.prototype, 'getMenteeApplyTarget');

      await controller.getMenteeApplyTarget(buildReq(query), res, next);

      expect(getMenteeApplyTarget).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    });
  });
});
