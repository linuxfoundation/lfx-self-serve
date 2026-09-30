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
