// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The import graph transitively reaches Angular's partially-compiled @angular/common,
// which needs the JIT compiler under vitest.
import '@angular/compiler';

import type {
  MentorshipMentorProfileResponse,
  MentorshipMentorProfileUpdateResponse,
  MentorshipMentorProgramDetail,
  MentorshipMentorProgramsResponse,
} from '@lfx-one/shared/interfaces';
import { MENTORSHIP_MENTEE_NOTE_MAX } from '@lfx-one/shared/constants';
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
const { logger } = await import('../services/logger.service');

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

  describe('mentor requests', () => {
    const PROGRAM_ID = '7b0f2a52-55a4-4a3e-9d8c-1f3a2b4c5d6e';
    const REQUEST_ID = '0c6e2d3a-8f71-4b5e-a2c9-3d4e5f6a7b8c';
    const INVITE_TOKEN = 'eyJwcm9ncmFtX2lkIjoicDEifQ.c2lnbmF0dXJl';
    const buildWriteReq = (requestBody: unknown, params: Record<string, unknown> = {}): Request =>
      ({ body: requestBody, params, query: {} }) as unknown as Request;

    beforeEach(() => {
      res = { json: vi.fn(), status: vi.fn(), send: vi.fn() } as unknown as Response;
      vi.mocked(res.status).mockReturnValue(res);
    });

    it('answers with the page of open programs the query asks for', async () => {
      const response = { data: [{ id: PROGRAM_ID, name: 'Test Program' }], total: 1 };
      const read = vi.spyOn(MentorshipMentorService.prototype, 'getOpenPrograms').mockResolvedValue(response);

      await controller.getOpenPrograms({ params: {}, query: { search: ' test ', offset: '20' } } as unknown as Request, res, next);

      expect(read).toHaveBeenCalledWith(expect.anything(), { search: 'test', offset: 20 });
      expect(res.json).toHaveBeenCalledWith(response);
      expect(next).not.toHaveBeenCalled();
    });

    it('passes a ServiceValidationError to next for a bad offset, without reading', async () => {
      const read = vi.spyOn(MentorshipMentorService.prototype, 'getOpenPrograms');

      await controller.getOpenPrograms({ params: {}, query: { offset: '-1' } } as unknown as Request, res, next);

      expect(read).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    });

    it('answers with the requests', async () => {
      const response = { data: [{ id: REQUEST_ID, programId: PROGRAM_ID, programName: 'Test Program', status: 'pending' as const }], invitedProgramIds: [] };
      vi.spyOn(MentorshipMentorService.prototype, 'getMentorRequests').mockResolvedValue(response);

      await controller.getMentorRequests(buildReq(), res, next);

      expect(res.json).toHaveBeenCalledWith(response);
      expect(next).not.toHaveBeenCalled();
    });

    it('sends a request for the trimmed program id and answers 204', async () => {
      const request = vi.spyOn(MentorshipMentorService.prototype, 'requestToMentor').mockResolvedValue(undefined);

      await controller.requestToMentor(buildWriteReq({ programId: ` ${PROGRAM_ID} ` }), res, next);

      expect(request).toHaveBeenCalledWith(expect.anything(), PROGRAM_ID);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(next).not.toHaveBeenCalled();
    });

    it.each([undefined, null, {}, { programId: '' }, { programId: 'test-program' }, { programId: 42 }])(
      'rejects the request body %j before calling the service',
      async (requestBody) => {
        const request = vi.spyOn(MentorshipMentorService.prototype, 'requestToMentor');

        await controller.requestToMentor(buildWriteReq(requestBody), res, next);

        expect(request).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      }
    );

    it('withdraws the request and answers 204', async () => {
      const withdraw = vi.spyOn(MentorshipMentorService.prototype, 'withdrawMentorRequest').mockResolvedValue(undefined);

      await controller.withdrawMentorRequest(buildWriteReq(undefined, { requestId: REQUEST_ID }), res, next);

      expect(withdraw).toHaveBeenCalledWith(expect.anything(), REQUEST_ID);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a request id that is not a UUID before calling the service', async () => {
      const withdraw = vi.spyOn(MentorshipMentorService.prototype, 'withdrawMentorRequest');

      await controller.withdrawMentorRequest(buildWriteReq(undefined, { requestId: 'request-1' }), res, next);

      expect(withdraw).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    });

    it('passes a service failure to next', async () => {
      const error = new Error('boom');
      vi.spyOn(MentorshipMentorService.prototype, 'requestToMentor').mockRejectedValue(error);

      await controller.requestToMentor(buildWriteReq({ programId: PROGRAM_ID }), res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });

    it.each(['getOpenPrograms', 'getMentorRequests', 'requestToMentor', 'withdrawMentorRequest', 'acceptMentorInvite', 'declineMentorInvite'] as const)(
      '%s requires an authenticated user',
      async (method) => {
        vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
        const call = vi.spyOn(
          MentorshipMentorService.prototype,
          method === 'acceptMentorInvite' || method === 'declineMentorInvite' ? 'respondToMentorInvite' : method
        );

        await controller[method](buildWriteReq({ programId: PROGRAM_ID, token: INVITE_TOKEN }, { requestId: REQUEST_ID }), res, next);

        expect(call).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
      }
    );

    it.each([
      ['acceptMentorInvite', 'accept'],
      ['declineMentorInvite', 'decline'],
    ] as const)('%s answers the invitation with the trimmed token and answers 204', async (method, decision) => {
      const respond = vi.spyOn(MentorshipMentorService.prototype, 'respondToMentorInvite').mockResolvedValue(undefined);

      await controller[method](buildWriteReq({ token: ` ${INVITE_TOKEN} ` }), res, next);

      expect(respond).toHaveBeenCalledWith(expect.anything(), INVITE_TOKEN, decision);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(next).not.toHaveBeenCalled();
    });

    it.each([undefined, {}, { token: '' }, { token: 'no-signature' }, { token: 'a.b/c' }, { token: `${'a'.repeat(512)}.b` }, { token: 42 }])(
      'rejects the invite body %j before calling the service',
      async (requestBody) => {
        const respond = vi.spyOn(MentorshipMentorService.prototype, 'respondToMentorInvite');

        await controller.acceptMentorInvite(buildWriteReq(requestBody), res, next);

        expect(respond).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      }
    );

    it('passes an invite failure to next', async () => {
      const error = new Error('boom');
      vi.spyOn(MentorshipMentorService.prototype, 'respondToMentorInvite').mockRejectedValue(error);

      await controller.declineMentorInvite(buildWriteReq({ token: INVITE_TOKEN }), res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
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
    const PROGRAM_ID = '1a2b3c4d-0000-4000-8000-000000000001';

    it('trims the program id and answers with the program detail', async () => {
      const detail = { program: { id: PROGRAM_ID } } as unknown as MentorshipMentorProgramDetail;
      const read = vi.spyOn(MentorshipMentorService.prototype, 'getMentorProgram').mockResolvedValue(detail);

      await controller.getMentorProgram(buildReq({ programId: `  ${PROGRAM_ID}  ` }), res, next);

      expect(read).toHaveBeenCalledWith(expect.anything(), PROGRAM_ID);
      expect(res.json).toHaveBeenCalledWith(detail);
      expect(next).not.toHaveBeenCalled();
    });

    it.each([undefined, '', '   ', 'gridflow', '../applications'])('passes a ServiceValidationError to next for the program id %j', async (programId) => {
      const read = vi.spyOn(MentorshipMentorService.prototype, 'getMentorProgram');

      await controller.getMentorProgram(buildReq({ programId }), res, next);

      expect(read).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    });

    it('passes an AuthenticationError to next when no user is signed in', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const read = vi.spyOn(MentorshipMentorService.prototype, 'getMentorProgram');

      await controller.getMentorProgram(buildReq({ programId: PROGRAM_ID }), res, next);

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

  describe('updateMentorProfile', () => {
    const buildUpdateReq = (requestBody: unknown): Request => ({ body: requestBody, query: {} }) as unknown as Request;
    const response: MentorshipMentorProfileUpdateResponse = { profile: { aboutMe: '<p>Updated</p>', skills: ['Kubernetes'] } };

    it('saves the parsed request and answers with the saved profile', async () => {
      const update = vi.spyOn(MentorshipMentorService.prototype, 'updateMentorProfile').mockResolvedValue(response);

      await controller.updateMentorProfile(buildUpdateReq({ introduction: '<p>Updated</p>', skills: ['Kubernetes', 'kubernetes'] }), res, next);

      expect(update).toHaveBeenCalledWith(expect.anything(), { introduction: '<p>Updated</p>', skills: ['Kubernetes'] });
      expect(res.json).toHaveBeenCalledWith(response);
      expect(next).not.toHaveBeenCalled();
    });

    it.each([undefined, null, 'text', [], {}, { skills: [] }, { introduction: null }, { resumeFileName: 'cv.pdf' }])(
      'rejects the body %j with a validation error before calling the service',
      async (requestBody) => {
        const update = vi.spyOn(MentorshipMentorService.prototype, 'updateMentorProfile');

        await controller.updateMentorProfile(buildUpdateReq(requestBody), res, next);

        expect(update).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
        expect(res.json).not.toHaveBeenCalled();
      }
    );

    it('passes a service failure to next', async () => {
      const error = new Error('boom');
      vi.spyOn(MentorshipMentorService.prototype, 'updateMentorProfile').mockRejectedValue(error);

      await controller.updateMentorProfile(buildUpdateReq({ introduction: '<p>Updated</p>' }), res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('passes an AuthenticationError to next when no user is signed in', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const update = vi.spyOn(MentorshipMentorService.prototype, 'updateMentorProfile');

      await controller.updateMentorProfile(buildUpdateReq({ introduction: '<p>Updated</p>' }), res, next);

      expect(update).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
  });

  describe('updateApplicationNote', () => {
    const APPLICATION_ID = '5d1c8e2f-3a4b-4c6d-8e9f-0a1b2c3d4e5f';
    const buildNoteReq = (requestBody: unknown, applicationId: unknown = APPLICATION_ID): Request =>
      ({ body: requestBody, params: { applicationId }, query: {} }) as unknown as Request;

    beforeEach(() => {
      res = { json: vi.fn(), status: vi.fn(), send: vi.fn() } as unknown as Response;
      vi.mocked(res.status).mockReturnValue(res);
    });

    it('saves the trimmed note and answers 204, logging only the id and whether it was cleared', async () => {
      const save = vi.spyOn(MentorshipMentorService.prototype, 'updateApplicationNote').mockResolvedValue(undefined);

      await controller.updateApplicationNote(buildNoteReq({ note: '  Strong screening call.  ' }, ` ${APPLICATION_ID} `), res, next);

      expect(save).toHaveBeenCalledWith(expect.anything(), APPLICATION_ID, { note: 'Strong screening call.' });
      expect(res.status).toHaveBeenCalledWith(204);
      expect(next).not.toHaveBeenCalled();
      expect(logger.success).toHaveBeenCalledWith(expect.anything(), 'update_mentorship_application_note', expect.anything(), {
        applicationId: APPLICATION_ID,
        cleared: false,
      });
    });

    it('clears the note when it is blank once trimmed', async () => {
      const save = vi.spyOn(MentorshipMentorService.prototype, 'updateApplicationNote').mockResolvedValue(undefined);

      await controller.updateApplicationNote(buildNoteReq({ note: '   ' }), res, next);

      expect(save).toHaveBeenCalledWith(expect.anything(), APPLICATION_ID, { note: '' });
      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('accepts a note of exactly the maximum length', async () => {
      const save = vi.spyOn(MentorshipMentorService.prototype, 'updateApplicationNote').mockResolvedValue(undefined);
      const note = 'x'.repeat(MENTORSHIP_MENTEE_NOTE_MAX);

      await controller.updateApplicationNote(buildNoteReq({ note }), res, next);

      expect(save).toHaveBeenCalledWith(expect.anything(), APPLICATION_ID, { note });
    });

    it.each([
      ['an application id that is not a UUID', { note: 'Note' }, 'application-1'],
      ['a missing note', {}, APPLICATION_ID],
      ['a note that is not a string', { note: 42 }, APPLICATION_ID],
      ['a note over the maximum length', { note: 'x'.repeat(MENTORSHIP_MENTEE_NOTE_MAX + 1) }, APPLICATION_ID],
    ])('rejects %s before calling the service', async (_label, requestBody, applicationId) => {
      const save = vi.spyOn(MentorshipMentorService.prototype, 'updateApplicationNote');

      await controller.updateApplicationNote(buildNoteReq(requestBody, applicationId), res, next);

      expect(save).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    });

    it('passes a service failure to next', async () => {
      const error = new Error('boom');
      vi.spyOn(MentorshipMentorService.prototype, 'updateApplicationNote').mockRejectedValue(error);

      await controller.updateApplicationNote(buildNoteReq({ note: 'Note' }), res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('passes an AuthenticationError to next when no user is signed in', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const save = vi.spyOn(MentorshipMentorService.prototype, 'updateApplicationNote');

      await controller.updateApplicationNote(buildNoteReq({ note: 'Note' }), res, next);

      expect(save).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
  });

  describe('reviewMenteeTask', () => {
    const TASK_ID = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    const buildReviewReq = (requestBody: unknown, taskId: unknown = TASK_ID): Request =>
      ({ body: requestBody, params: { taskId }, query: {} }) as unknown as Request;

    beforeEach(() => {
      res = { json: vi.fn(), status: vi.fn(), send: vi.fn() } as unknown as Response;
      vi.mocked(res.status).mockReturnValue(res);
    });

    it.each(['complete', 'incomplete'] as const)('sends %s for the trimmed task id and answers 204, logging only the id and status', async (status) => {
      const review = vi.spyOn(MentorshipMentorService.prototype, 'reviewMenteeTask').mockResolvedValue(undefined);

      await controller.reviewMenteeTask(buildReviewReq({ status, comment: 'ignored' }, ` ${TASK_ID} `), res, next);

      expect(review).toHaveBeenCalledWith(expect.anything(), TASK_ID, status);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(next).not.toHaveBeenCalled();
      expect(logger.success).toHaveBeenCalledWith(expect.anything(), 'review_mentorship_mentee_task', expect.anything(), { taskId: TASK_ID, status });
    });

    it.each([
      ['a task id that is not a UUID', { status: 'complete' }, 'task-1'],
      ['a missing status', {}, TASK_ID],
      ['a missing body', undefined, TASK_ID],
      ['a mentee status', { status: 'submitted' }, TASK_ID],
      ['the app status name', { status: 'completed' }, TASK_ID],
    ])('rejects %s before calling the service', async (_label, requestBody, taskId) => {
      const review = vi.spyOn(MentorshipMentorService.prototype, 'reviewMenteeTask');

      await controller.reviewMenteeTask(buildReviewReq(requestBody, taskId), res, next);

      expect(review).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    });

    it('passes a service failure to next', async () => {
      const error = new Error('boom');
      vi.spyOn(MentorshipMentorService.prototype, 'reviewMenteeTask').mockRejectedValue(error);

      await controller.reviewMenteeTask(buildReviewReq({ status: 'complete' }), res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('passes an AuthenticationError to next when no user is signed in', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const review = vi.spyOn(MentorshipMentorService.prototype, 'reviewMenteeTask');

      await controller.reviewMenteeTask(buildReviewReq({ status: 'complete' }), res, next);

      expect(review).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
  });
});
