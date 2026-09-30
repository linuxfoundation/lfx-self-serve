// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The import graph transitively reaches Angular's partially-compiled @angular/common,
// which needs the JIT compiler under vitest.
import '@angular/compiler';

import type { MentorshipMentorProfileResponse, MentorshipMentorProgramDetail, MentorshipMentorProgramsResponse } from '@lfx-one/shared/interfaces';
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

const { MentorshipMentorController } = await import('./mentorship-mentor.controller');
const { MentorshipMentorService } = await import('../services/mentorship-mentor.service');
const { AuthenticationError, ServiceValidationError } = await import('../errors');
const { getUsernameFromAuth } = await import('../utils/auth-helper');

describe('MentorshipMentorController', () => {
  let controller: InstanceType<typeof MentorshipMentorController>;
  let res: Response;
  let next: NextFunction;

  const buildReq = (params: Record<string, unknown> = {}): Request => ({ params, query: {} }) as unknown as Request;

  beforeEach(() => {
    controller = new MentorshipMentorController();
    res = { json: vi.fn() } as unknown as Response;
    next = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('hasMentorProfile', () => {
    it('answers with the has-profile result', async () => {
      const check = vi.spyOn(MentorshipMentorService.prototype, 'hasMentorProfile').mockResolvedValue({ hasProfile: true });

      await controller.hasMentorProfile(buildReq(), res, next);

      expect(check).toHaveBeenCalledWith(expect.anything());
      expect(res.json).toHaveBeenCalledWith({ hasProfile: true });
      expect(next).not.toHaveBeenCalled();
    });

    it('passes a service failure to next', async () => {
      const error = new Error('boom');
      vi.spyOn(MentorshipMentorService.prototype, 'hasMentorProfile').mockRejectedValue(error);

      await controller.hasMentorProfile(buildReq(), res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('passes an AuthenticationError to next when no user is signed in', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const check = vi.spyOn(MentorshipMentorService.prototype, 'hasMentorProfile');

      await controller.hasMentorProfile(buildReq(), res, next);

      expect(check).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
  });

  describe('registerMentorProfile', () => {
    const body = {
      introduction: '<p>Test intro</p>',
      skills: ['Kubernetes'],
      complianceAccepted: true,
      termsAccepted: true,
    };
    const buildRegisterReq = (requestBody: unknown): Request => ({ body: requestBody, query: {} }) as unknown as Request;

    beforeEach(() => {
      res = { json: vi.fn(), status: vi.fn(), send: vi.fn() } as unknown as Response;
      vi.mocked(res.status).mockReturnValue(res);
    });

    it('registers the parsed request and answers 204 with no body', async () => {
      const register = vi.spyOn(MentorshipMentorService.prototype, 'registerMentorProfile').mockResolvedValue(undefined);

      await controller.registerMentorProfile(buildRegisterReq({ ...body, resumeFileName: 'resume.pdf' }), res, next);

      expect(register).toHaveBeenCalledWith(expect.anything(), body);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledWith();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it.each([undefined, null, 'text', [], { ...body, termsAccepted: 'yes' }, { ...body, skills: [] }])(
      'rejects the body %j with a validation error before calling the service',
      async (requestBody) => {
        const register = vi.spyOn(MentorshipMentorService.prototype, 'registerMentorProfile');

        await controller.registerMentorProfile(buildRegisterReq(requestBody), res, next);

        expect(register).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
        expect(res.status).not.toHaveBeenCalled();
      }
    );

    it('passes a service failure to next', async () => {
      const error = new Error('boom');
      vi.spyOn(MentorshipMentorService.prototype, 'registerMentorProfile').mockRejectedValue(error);

      await controller.registerMentorProfile(buildRegisterReq(body), res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('requires an authenticated user', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const register = vi.spyOn(MentorshipMentorService.prototype, 'registerMentorProfile');

      await controller.registerMentorProfile(buildRegisterReq(body), res, next);

      expect(register).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
  });

  describe('getMentorPrograms', () => {
    it('answers with the mentor programs', async () => {
      const programs: MentorshipMentorProgramsResponse = { data: [], total: 0 };
      const read = vi.spyOn(MentorshipMentorService.prototype, 'getMentorPrograms').mockResolvedValue(programs);

      await controller.getMentorPrograms(buildReq(), res, next);

      expect(read).toHaveBeenCalledWith(expect.anything());
      expect(res.json).toHaveBeenCalledWith(programs);
      expect(next).not.toHaveBeenCalled();
    });

    it('passes an AuthenticationError to next when no user is signed in', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const read = vi.spyOn(MentorshipMentorService.prototype, 'getMentorPrograms');

      await controller.getMentorPrograms(buildReq(), res, next);

      expect(read).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
  });

  describe('getMentorProgram', () => {
    it('trims the program id and answers with the program detail', async () => {
      const detail = { program: { id: 'mp_test' } } as unknown as MentorshipMentorProgramDetail;
      const read = vi.spyOn(MentorshipMentorService.prototype, 'getMentorProgram').mockResolvedValue(detail);

      await controller.getMentorProgram(buildReq({ programId: '  mp_test  ' }), res, next);

      expect(read).toHaveBeenCalledWith(expect.anything(), 'mp_test');
      expect(res.json).toHaveBeenCalledWith(detail);
      expect(next).not.toHaveBeenCalled();
    });

    it.each([undefined, '', '   '])('passes a ServiceValidationError to next for the program id %j', async (programId) => {
      const read = vi.spyOn(MentorshipMentorService.prototype, 'getMentorProgram');

      await controller.getMentorProgram(buildReq({ programId }), res, next);

      expect(read).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    });

    it('passes an AuthenticationError to next when no user is signed in', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const read = vi.spyOn(MentorshipMentorService.prototype, 'getMentorProgram');

      await controller.getMentorProgram(buildReq({ programId: 'mp_test' }), res, next);

      expect(read).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
  });

  describe('getMentorProfile', () => {
    it('answers with the mentor profile', async () => {
      const profile: MentorshipMentorProfileResponse = { profile: { aboutMe: '', skills: [] }, history: [] };
      const read = vi.spyOn(MentorshipMentorService.prototype, 'getMentorProfile').mockResolvedValue(profile);

      await controller.getMentorProfile(buildReq(), res, next);

      expect(read).toHaveBeenCalledWith(expect.anything());
      expect(res.json).toHaveBeenCalledWith(profile);
      expect(next).not.toHaveBeenCalled();
    });

    it('passes an AuthenticationError to next when no user is signed in', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const read = vi.spyOn(MentorshipMentorService.prototype, 'getMentorProfile');

      await controller.getMentorProfile(buildReq(), res, next);

      expect(read).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
  });
});
