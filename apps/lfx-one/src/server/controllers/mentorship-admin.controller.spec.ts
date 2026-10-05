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

const { MentorshipAdminController } = await import('./mentorship-admin.controller');
const { MentorshipAdminService } = await import('../services/mentorship-admin.service');
const { AuthenticationError } = await import('../errors');
const { getUsernameFromAuth } = await import('../utils/auth-helper');
const { logger } = await import('../services/logger.service');

describe('MentorshipAdminController', () => {
  let controller: InstanceType<typeof MentorshipAdminController>;
  let res: Response;
  let next: NextFunction;

  const buildReq = (query: Record<string, unknown> = {}, params: Record<string, unknown> = {}): Request => ({ params, query }) as unknown as Request;

  beforeEach(() => {
    controller = new MentorshipAdminController();
    res = { json: vi.fn() } as unknown as Response;
    next = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getPrograms', () => {
    it('answers with the page, defaulting to offset 0 and limit 12', async () => {
      const page = { data: [], total: 0 };
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getPrograms').mockResolvedValue(page);

      await controller.getPrograms(buildReq(), res, next);

      expect(read).toHaveBeenCalledWith(expect.anything(), { search: undefined, status: undefined, offset: 0, limit: 12 });
      expect(res.json).toHaveBeenCalledWith(page);
      expect(next).not.toHaveBeenCalled();
    });

    it('passes the trimmed search, status and paging to the service', async () => {
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getPrograms').mockResolvedValue({ data: [], total: 0 });

      await controller.getPrograms(buildReq({ search: '  grid ', status: 'open', offset: '12', limit: '24' }), res, next);

      expect(read).toHaveBeenCalledWith(expect.anything(), { search: 'grid', status: 'open', offset: 12, limit: 24 });
    });

    it('never logs the search text', async () => {
      vi.spyOn(MentorshipAdminService.prototype, 'getPrograms').mockResolvedValue({ data: [], total: 0 });

      await controller.getPrograms(buildReq({ search: 'secret-name' }), res, next);

      expect(JSON.stringify(vi.mocked(logger.success).mock.calls.map((call) => call[3]))).not.toContain('secret-name');
    });

    it('rejects an unknown status with a 400', async () => {
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getPrograms');

      await controller.getPrograms(buildReq({ status: 'bogus' }), res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(read).not.toHaveBeenCalled();
    });

    it('rejects a limit above 50 and a non-integer offset with a 400', async () => {
      await controller.getPrograms(buildReq({ limit: '51' }), res, next);
      await controller.getPrograms(buildReq({ offset: 'x' }), res, next);

      expect(next).toHaveBeenCalledTimes(2);
      expect(vi.mocked(next).mock.calls.every(([error]) => (error as { statusCode?: number }).statusCode === 400)).toBe(true);
    });

    it('rejects a repeated search, status or offset with a 400', async () => {
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getPrograms');

      await controller.getPrograms(buildReq({ search: ['a', 'b'] }), res, next);
      await controller.getPrograms(buildReq({ status: ['open', 'hidden'] }), res, next);
      await controller.getPrograms(buildReq({ offset: ['0', '12'] }), res, next);

      expect(vi.mocked(next).mock.calls.map(([error]) => (error as { statusCode?: number }).statusCode)).toEqual([400, 400, 400]);
      expect(read).not.toHaveBeenCalled();
    });

    it('passes a service failure to next', async () => {
      const error = new Error('boom');
      vi.spyOn(MentorshipAdminService.prototype, 'getPrograms').mockRejectedValue(error);

      await controller.getPrograms(buildReq(), res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('passes an AuthenticationError to next when no user is signed in', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getPrograms');

      await controller.getPrograms(buildReq(), res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe('getProgram', () => {
    it('answers with the program detail', async () => {
      const detail = { program: { id: 'p-1' } } as never;
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getProgram').mockResolvedValue(detail);

      await controller.getProgram(buildReq({}, { programId: ' p-1 ' }), res, next);

      expect(read).toHaveBeenCalledWith(expect.anything(), 'p-1');
      expect(res.json).toHaveBeenCalledWith(detail);
    });
  });
});
