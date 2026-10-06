// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The import graph transitively reaches Angular's partially-compiled @angular/common,
// which needs the JIT compiler under vitest.
import '@angular/compiler';

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

  const PROGRAM_ID = '3f2b8c1e-7a44-4d0e-9b55-0c1d2e3f4a5b';
  const TERM_ID = '9a1c2d3e-4b5f-4a6b-8c7d-1e2f3a4b5c6d';
  const statusCodes = () => vi.mocked(next).mock.calls.map(([error]) => (error as { statusCode?: number }).statusCode);

  describe('getProgram', () => {
    it('answers with the program page', async () => {
      const page = { program: { id: PROGRAM_ID } } as never;
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getProgramPage').mockResolvedValue(page);

      await controller.getProgram(buildReq({}, { programId: ` ${PROGRAM_ID} ` }), res, next);

      expect(read).toHaveBeenCalledWith(expect.anything(), PROGRAM_ID);
      expect(res.json).toHaveBeenCalledWith(page);
    });

    it('rejects a program id that is not a UUID with a 400', async () => {
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getProgramPage');

      await controller.getProgram(buildReq({}, { programId: 'program-one' }), res, next);

      expect(statusCodes()).toEqual([400]);
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe('getProgramMentees', () => {
    const emptyPage = { data: [], total: 0 };

    it('passes the query to the service, defaulting to offset 0 and limit 10', async () => {
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getProgramMentees').mockResolvedValue(emptyPage);

      await controller.getProgramMentees(buildReq({ type: 'current' }, { programId: PROGRAM_ID }), res, next);

      expect(read).toHaveBeenCalledWith(expect.anything(), PROGRAM_ID, {
        type: 'current',
        status: undefined,
        termId: undefined,
        search: undefined,
        offset: 0,
        limit: 10,
      });
      expect(res.json).toHaveBeenCalledWith(emptyPage);
    });

    it('passes the trimmed search, status, term and paging', async () => {
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getProgramMentees').mockResolvedValue(emptyPage);

      await controller.getProgramMentees(
        buildReq({ type: 'past', status: 'pending', termId: TERM_ID, search: '  ada ', offset: '10', limit: '50' }, { programId: PROGRAM_ID }),
        res,
        next
      );

      expect(read).toHaveBeenCalledWith(expect.anything(), PROGRAM_ID, {
        type: 'past',
        status: 'pending',
        termId: TERM_ID,
        search: 'ada',
        offset: 10,
        limit: 50,
      });
    });

    it.each([
      ['a bad program id', {}, { programId: 'nope' }],
      ['a missing type', {}, { programId: PROGRAM_ID }],
      ['an unknown type', { type: 'all' }, { programId: PROGRAM_ID }],
      ['an unknown status', { type: 'current', status: 'hold' }, { programId: PROGRAM_ID }],
      ['a bad term id', { type: 'current', termId: 'spring' }, { programId: PROGRAM_ID }],
      ['a bad offset', { type: 'current', offset: '-1' }, { programId: PROGRAM_ID }],
      ['a limit above 50', { type: 'current', limit: '51' }, { programId: PROGRAM_ID }],
      ['a limit of 0', { type: 'current', limit: '0' }, { programId: PROGRAM_ID }],
      ['a repeated type', { type: ['current', 'past'] }, { programId: PROGRAM_ID }],
    ])('rejects %s with a 400', async (_label, query, params) => {
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getProgramMentees');

      await controller.getProgramMentees(buildReq(query, params), res, next);

      expect(statusCodes()).toEqual([400]);
      expect(read).not.toHaveBeenCalled();
    });

    it('never logs the search text', async () => {
      vi.spyOn(MentorshipAdminService.prototype, 'getProgramMentees').mockResolvedValue(emptyPage);

      await controller.getProgramMentees(buildReq({ type: 'current', search: 'secret-name' }, { programId: PROGRAM_ID }), res, next);

      expect(JSON.stringify(vi.mocked(logger.success).mock.calls.map((call) => call[3]))).not.toContain('secret-name');
    });

    it('passes a service failure to next', async () => {
      const error = new Error('boom');
      vi.spyOn(MentorshipAdminService.prototype, 'getProgramMentees').mockRejectedValue(error);

      await controller.getProgramMentees(buildReq({ type: 'current' }, { programId: PROGRAM_ID }), res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('getProgramMentors', () => {
    const emptyPage = { data: [], total: 0 };

    it('passes the query to the service, defaulting to offset 0 and limit 10', async () => {
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getProgramMentors').mockResolvedValue(emptyPage);

      await controller.getProgramMentors(buildReq({}, { programId: PROGRAM_ID }), res, next);

      expect(read).toHaveBeenCalledWith(expect.anything(), PROGRAM_ID, { status: undefined, search: undefined, offset: 0, limit: 10 });
      expect(res.json).toHaveBeenCalledWith(emptyPage);
    });

    it('passes the trimmed search, status and paging', async () => {
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getProgramMentors').mockResolvedValue(emptyPage);

      await controller.getProgramMentors(buildReq({ status: 'active', search: '  ada ', offset: '10', limit: '50' }, { programId: PROGRAM_ID }), res, next);

      expect(read).toHaveBeenCalledWith(expect.anything(), PROGRAM_ID, { status: 'active', search: 'ada', offset: 10, limit: 50 });
    });

    it.each([
      ['a bad program id', {}, { programId: 'nope' }],
      ['an unknown status', { status: 'approved' }, { programId: PROGRAM_ID }],
      ['a repeated status', { status: ['active', 'invited'] }, { programId: PROGRAM_ID }],
      ['a bad offset', { offset: '-1' }, { programId: PROGRAM_ID }],
      ['a limit above 50', { limit: '51' }, { programId: PROGRAM_ID }],
      ['a limit of 0', { limit: '0' }, { programId: PROGRAM_ID }],
    ])('rejects %s with a 400', async (_label, query, params) => {
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getProgramMentors');

      await controller.getProgramMentors(buildReq(query, params), res, next);

      expect(statusCodes()).toEqual([400]);
      expect(read).not.toHaveBeenCalled();
    });

    it('never logs the search text', async () => {
      vi.spyOn(MentorshipAdminService.prototype, 'getProgramMentors').mockResolvedValue(emptyPage);

      await controller.getProgramMentors(buildReq({ search: 'secret-name' }, { programId: PROGRAM_ID }), res, next);

      expect(JSON.stringify(vi.mocked(logger.success).mock.calls.map((call) => call[3]))).not.toContain('secret-name');
    });

    it('passes a service failure to next', async () => {
      const error = new Error('boom');
      vi.spyOn(MentorshipAdminService.prototype, 'getProgramMentors').mockRejectedValue(error);

      await controller.getProgramMentors(buildReq({}, { programId: PROGRAM_ID }), res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('getProgramTerms', () => {
    const emptyPage = { data: [], total: 0 };

    it('passes the paging to the service, defaulting to offset 0 and limit 10', async () => {
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getProgramTerms').mockResolvedValue(emptyPage);

      await controller.getProgramTerms(buildReq({}, { programId: PROGRAM_ID }), res, next);

      expect(read).toHaveBeenCalledWith(expect.anything(), PROGRAM_ID, { offset: 0, limit: 10 });
      expect(res.json).toHaveBeenCalledWith(emptyPage);
    });

    it.each([
      ['a bad program id', {}, { programId: 'nope' }],
      ['a bad offset', { offset: 'x' }, { programId: PROGRAM_ID }],
      ['a limit above 50', { limit: '51' }, { programId: PROGRAM_ID }],
    ])('rejects %s with a 400', async (_label, query, params) => {
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getProgramTerms');

      await controller.getProgramTerms(buildReq(query, params), res, next);

      expect(statusCodes()).toEqual([400]);
      expect(read).not.toHaveBeenCalled();
    });

    it('passes a service failure to next', async () => {
      const error = new Error('boom');
      vi.spyOn(MentorshipAdminService.prototype, 'getProgramTerms').mockRejectedValue(error);

      await controller.getProgramTerms(buildReq({}, { programId: PROGRAM_ID }), res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('getApplicationTasks', () => {
    it('answers with the tasks', async () => {
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getApplicationTasks').mockResolvedValue([]);

      await controller.getApplicationTasks(buildReq({}, { applicationId: PROGRAM_ID }), res, next);

      expect(read).toHaveBeenCalledWith(expect.anything(), PROGRAM_ID);
      expect(res.json).toHaveBeenCalledWith([]);
    });

    it('rejects an application id that is not a UUID with a 400', async () => {
      const read = vi.spyOn(MentorshipAdminService.prototype, 'getApplicationTasks');

      await controller.getApplicationTasks(buildReq({}, { applicationId: '12' }), res, next);

      expect(statusCodes()).toEqual([400]);
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe('application decisions', () => {
    const APPLICATION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
    const TERM_ID = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
    const writeRes = () => ({ json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() }) as unknown as Response;

    it('updateApplicationStatus passes the validated body and answers 204', async () => {
      const write = vi.spyOn(MentorshipAdminService.prototype, 'updateApplicationStatus').mockResolvedValue();
      const out = writeRes();
      const req = { ...buildReq({}, { applicationId: APPLICATION_ID }), body: { status: 'accepted', attendanceType: 'full_time', extra: 1 } } as Request;

      await controller.updateApplicationStatus(req, out, next);

      expect(write).toHaveBeenCalledWith(expect.anything(), APPLICATION_ID, { status: 'accepted', attendanceType: 'full_time' });
      expect(out.status).toHaveBeenCalledWith(204);
      expect(next).not.toHaveBeenCalled();
    });

    it.each([
      ['an accept without an attendance type', { status: 'accepted' }],
      ['an accept with an unknown attendance type', { status: 'accepted', attendanceType: 'weekends' }],
      ['a status the admin cannot set', { status: 'withdrawn' }],
      ['no body', undefined],
    ])('updateApplicationStatus rejects %s with a 400 and no upstream call', async (_label, body) => {
      const write = vi.spyOn(MentorshipAdminService.prototype, 'updateApplicationStatus');
      const req = { ...buildReq({}, { applicationId: APPLICATION_ID }), body } as Request;

      await controller.updateApplicationStatus(req, writeRes(), next);

      expect(statusCodes()).toEqual([400]);
      expect(write).not.toHaveBeenCalled();
    });

    describe('updateApplicationNote', () => {
      const noteReq = (body: unknown, applicationId = APPLICATION_ID): Request => ({ ...buildReq({}, { applicationId }), body }) as Request;

      it('passes the trimmed note and answers 204', async () => {
        const write = vi.spyOn(MentorshipAdminService.prototype, 'updateApplicationNote').mockResolvedValue();
        const out = writeRes();

        await controller.updateApplicationNote(noteReq({ note: '  needs a second look  ' }), out, next);

        expect(write).toHaveBeenCalledWith(expect.anything(), APPLICATION_ID, 'needs a second look');
        expect(out.status).toHaveBeenCalledWith(204);
        expect(next).not.toHaveBeenCalled();
      });

      it('passes an empty note on, which clears it', async () => {
        const write = vi.spyOn(MentorshipAdminService.prototype, 'updateApplicationNote').mockResolvedValue();

        await controller.updateApplicationNote(noteReq({ note: '   ' }), writeRes(), next);

        expect(write).toHaveBeenCalledWith(expect.anything(), APPLICATION_ID, '');
      });

      it('accepts a note of exactly the largest length', async () => {
        const write = vi.spyOn(MentorshipAdminService.prototype, 'updateApplicationNote').mockResolvedValue();

        await controller.updateApplicationNote(noteReq({ note: 'a'.repeat(MENTORSHIP_MENTEE_NOTE_MAX) }), writeRes(), next);

        expect(write).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
      });

      it.each([
        ['an application id that is not a UUID', { note: 'x' }, '12'],
        ['no body', undefined, APPLICATION_ID],
        ['a note that is not a string', { note: 5 }, APPLICATION_ID],
        ['a note over the largest length', { note: 'a'.repeat(MENTORSHIP_MENTEE_NOTE_MAX + 1) }, APPLICATION_ID],
      ])('rejects %s with a 400 and no upstream call', async (_label, body, applicationId) => {
        const write = vi.spyOn(MentorshipAdminService.prototype, 'updateApplicationNote');

        await controller.updateApplicationNote(noteReq(body, applicationId), writeRes(), next);

        expect(statusCodes()).toEqual([400]);
        expect(write).not.toHaveBeenCalled();
      });

      it('passes an upstream 409 on to next', async () => {
        vi.spyOn(MentorshipAdminService.prototype, 'updateApplicationNote').mockRejectedValue(Object.assign(new Error('changed'), { statusCode: 409 }));

        await controller.updateApplicationNote(noteReq({ note: 'x' }), writeRes(), next);

        expect(statusCodes()).toEqual([409]);
      });

      it('logs the application id and the note length, never the note', async () => {
        vi.spyOn(MentorshipAdminService.prototype, 'updateApplicationNote').mockResolvedValue();

        await controller.updateApplicationNote(noteReq({ note: 'private-reviewer-text' }), writeRes(), next);

        // The request is the first argument of every call, so only the rest is what the controller chose to log.
        const logged = JSON.stringify([...vi.mocked(logger.startOperation).mock.calls, ...vi.mocked(logger.success).mock.calls].map((call) => call.slice(1)));
        expect(logged).toContain(APPLICATION_ID);
        expect(logged).toContain(`"noteLength":${'private-reviewer-text'.length}`);
        expect(logged).not.toContain('private-reviewer-text');
      });
    });

    describe('createTasks', () => {
      const taskReq = (body: unknown): Request => ({ ...buildReq({}, {}), body }) as Request;
      const validBody = { applicationIds: [APPLICATION_ID], name: ' Read the guide ', description: 'private-task-text', dueDate: '2030-01-31' };

      it('passes the validated request on and answers with the created and failed ids', async () => {
        const write = vi.spyOn(MentorshipAdminService.prototype, 'createTasks').mockResolvedValue({ created: [APPLICATION_ID], failed: [] });
        const out = writeRes();

        await controller.createTasks(taskReq({ ...validBody, requiresFileSubmission: true }), out, next);

        expect(write).toHaveBeenCalledWith(expect.anything(), {
          applicationIds: [APPLICATION_ID],
          name: 'Read the guide',
          description: 'private-task-text',
          dueDate: '2030-01-31',
          requiresFileSubmission: true,
        });
        expect(out.json).toHaveBeenCalledWith({ created: [APPLICATION_ID], failed: [] });
        expect(next).not.toHaveBeenCalled();
      });

      it.each([
        ['no body', undefined],
        ['no applications', { ...validBody, applicationIds: [] }],
        ['an application id that is not a UUID', { ...validBody, applicationIds: ['12'] }],
        ['a blank name', { ...validBody, name: '   ' }],
        ['no description', { ...validBody, description: undefined }],
        ['a due date that is not a calendar date', { ...validBody, dueDate: '2030-02-31' }],
        ['a file requirement that is not a boolean', { ...validBody, requiresFileSubmission: 'yes' }],
      ])('rejects %s with a 400 and no upstream call', async (_label, body) => {
        const write = vi.spyOn(MentorshipAdminService.prototype, 'createTasks');

        await controller.createTasks(taskReq(body), writeRes(), next);

        expect(statusCodes()).toEqual([400]);
        expect(write).not.toHaveBeenCalled();
      });

      it.each([403, 404, 409])('passes an upstream %i on to next', async (statusCode) => {
        vi.spyOn(MentorshipAdminService.prototype, 'createTasks').mockRejectedValue(Object.assign(new Error('upstream'), { statusCode }));

        await controller.createTasks(taskReq(validBody), writeRes(), next);

        expect(statusCodes()).toEqual([statusCode]);
      });

      it('logs the application count and the outcome counts, never the task text', async () => {
        vi.spyOn(MentorshipAdminService.prototype, 'createTasks').mockResolvedValue({ created: [APPLICATION_ID], failed: [] });

        await controller.createTasks(taskReq(validBody), writeRes(), next);

        const logged = JSON.stringify([...vi.mocked(logger.startOperation).mock.calls, ...vi.mocked(logger.success).mock.calls].map((call) => call.slice(1)));
        expect(logged).toContain('"application_count":1');
        expect(logged).toContain('"created_count":1');
        expect(logged).toContain('"failed_count":0');
        expect(logged).not.toContain('private-task-text');
        expect(logged).not.toContain('Read the guide');
      });
    });

    it('withdrawApplication answers 204', async () => {
      const write = vi.spyOn(MentorshipAdminService.prototype, 'withdrawApplication').mockResolvedValue();
      const out = writeRes();

      await controller.withdrawApplication(buildReq({}, { applicationId: APPLICATION_ID }), out, next);

      expect(write).toHaveBeenCalledWith(expect.anything(), APPLICATION_ID);
      expect(out.status).toHaveBeenCalledWith(204);
    });

    it('declinePendingForTerm answers with the declined count', async () => {
      const write = vi.spyOn(MentorshipAdminService.prototype, 'declinePendingForTerm').mockResolvedValue({ declinedCount: 3 });
      const out = writeRes();

      await controller.declinePendingForTerm(buildReq({}, { programId: PROGRAM_ID, termId: TERM_ID }), out, next);

      expect(write).toHaveBeenCalledWith(expect.anything(), PROGRAM_ID, TERM_ID);
      expect(out.json).toHaveBeenCalledWith({ declinedCount: 3 });
    });

    it('rejects ids that are not UUIDs with a 400', async () => {
      const withdraw = vi.spyOn(MentorshipAdminService.prototype, 'withdrawApplication');
      const decline = vi.spyOn(MentorshipAdminService.prototype, 'declinePendingForTerm');

      await controller.withdrawApplication(buildReq({}, { applicationId: '12' }), writeRes(), next);
      await controller.declinePendingForTerm(buildReq({}, { programId: PROGRAM_ID, termId: 'x' }), writeRes(), next);

      expect(statusCodes()).toEqual([400, 400]);
      expect(withdraw).not.toHaveBeenCalled();
      expect(decline).not.toHaveBeenCalled();
    });

    it('passes an upstream failure to next', async () => {
      vi.spyOn(MentorshipAdminService.prototype, 'withdrawApplication').mockRejectedValue(Object.assign(new Error('changed'), { statusCode: 409 }));

      await controller.withdrawApplication(buildReq({}, { applicationId: APPLICATION_ID }), writeRes(), next);

      expect(statusCodes()).toEqual([409]);
    });
  });

  describe('updateProgramMentor', () => {
    const MEMBER_ID = '4e5f6a7b-8c9d-4e0f-9a1b-3c4d5e6f7a8b';
    const writeRes = () => ({ json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() }) as unknown as Response;
    const mentorReq = (body: unknown, params: Record<string, unknown> = { programId: PROGRAM_ID, memberId: MEMBER_ID }): Request =>
      ({ ...buildReq({}, params), body }) as Request;

    it('passes the validated status on and answers 204', async () => {
      const write = vi.spyOn(MentorshipAdminService.prototype, 'updateProgramMentor').mockResolvedValue();
      const out = writeRes();

      await controller.updateProgramMentor(mentorReq({ status: 'active', extra: 1 }), out, next);

      expect(write).toHaveBeenCalledWith(expect.anything(), PROGRAM_ID, MEMBER_ID, { status: 'active' });
      expect(out.status).toHaveBeenCalledWith(204);
      expect(next).not.toHaveBeenCalled();
    });

    it.each([
      ['a program id that is not a UUID', { status: 'active' }, { programId: '12', memberId: MEMBER_ID }],
      ['a member id that is not a UUID', { status: 'active' }, { programId: PROGRAM_ID, memberId: 'abc' }],
      ['a status the admin cannot set', { status: 'requested' }, undefined],
      ['a status that is not a string', { status: 1 }, undefined],
      ['no body', undefined, undefined],
    ])('rejects %s with a 400 and no upstream call', async (_label, body, params) => {
      const write = vi.spyOn(MentorshipAdminService.prototype, 'updateProgramMentor');

      await controller.updateProgramMentor(mentorReq(body, params), writeRes(), next);

      expect(statusCodes()).toEqual([400]);
      expect(write).not.toHaveBeenCalled();
    });

    it('passes an upstream 409 on', async () => {
      vi.spyOn(MentorshipAdminService.prototype, 'updateProgramMentor').mockRejectedValue(Object.assign(new Error('changed'), { statusCode: 409 }));

      await controller.updateProgramMentor(mentorReq({ status: 'declined' }), writeRes(), next);

      expect(statusCodes()).toEqual([409]);
    });

    it('logs ids and the status only', async () => {
      vi.spyOn(MentorshipAdminService.prototype, 'updateProgramMentor').mockResolvedValue();

      await controller.updateProgramMentor(mentorReq({ status: 'withdrawn', name: 'private-mentor-name' }), writeRes(), next);

      const logged = JSON.stringify([...vi.mocked(logger.startOperation).mock.calls, ...vi.mocked(logger.success).mock.calls].map((call) => call.slice(1)));
      expect(logged).toContain(MEMBER_ID);
      expect(logged).toContain('withdrawn');
      expect(logged).not.toContain('private-mentor-name');
    });
  });

  describe('term writes', () => {
    const TERM = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
    const termBody = {
      name: 'Fall 2026',
      startDate: '2026-09-01',
      endDate: '2026-12-01',
      applicationStartDate: '2026-07-01',
      applicationEndDate: '2026-08-15',
    };
    const writeRes = () => ({ json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() }) as unknown as Response;
    const termReq = (body: unknown, params: Record<string, unknown> = { programId: PROGRAM_ID, termId: TERM }): Request =>
      ({ ...buildReq({}, params), body }) as Request;
    const row = {
      id: TERM,
      name: 'Fall 2026',
      status: 'open',
      pending: 0,
      declined: 0,
      accepted: 0,
      graduated: 0,
      startDate: '',
      endDate: '',
      applicationStartDate: '',
      applicationEndDate: '',
    };

    it('creates a term and answers 201 with the row', async () => {
      const write = vi.spyOn(MentorshipAdminService.prototype, 'createTerm').mockResolvedValue(row as never);
      const out = writeRes();

      await controller.createTerm(termReq({ ...termBody, name: '  Fall 2026 ', extra: 1 }, { programId: PROGRAM_ID }), out, next);

      expect(write).toHaveBeenCalledWith(expect.anything(), PROGRAM_ID, termBody);
      expect(out.status).toHaveBeenCalledWith(201);
      expect(out.json).toHaveBeenCalledWith(row);
    });

    it('edits a term and answers 200 with the row', async () => {
      const write = vi.spyOn(MentorshipAdminService.prototype, 'updateTerm').mockResolvedValue(row as never);
      const out = writeRes();

      await controller.updateTerm(termReq(termBody), out, next);

      expect(write).toHaveBeenCalledWith(expect.anything(), PROGRAM_ID, TERM, termBody);
      expect(out.json).toHaveBeenCalledWith(row);
    });

    it.each([
      ['closeTerm', 'closeTerm'],
      ['reopenTerm', 'reopenTerm'],
      ['deleteTerm', 'deleteTerm'],
    ] as const)('%s answers 204', async (method, serviceMethod) => {
      const write = vi.spyOn(MentorshipAdminService.prototype, serviceMethod).mockResolvedValue();
      const out = writeRes();

      await controller[method](termReq(undefined), out, next);

      expect(write).toHaveBeenCalledWith(expect.anything(), PROGRAM_ID, TERM);
      expect(out.status).toHaveBeenCalledWith(204);
    });

    it.each([
      ['a blank name', { ...termBody, name: '   ' }],
      ['a name over the limit', { ...termBody, name: 'x'.repeat(51) }],
      ['a date that is not ISO', { ...termBody, startDate: '09/01/2026' }],
      ['a date that is not on the calendar', { ...termBody, startDate: '2026-02-30' }],
      ['an application end on its start', { ...termBody, applicationEndDate: '2026-07-01' }],
      ['a start on the application end', { ...termBody, startDate: '2026-08-15' }],
      ['an end on the start', { ...termBody, endDate: '2026-09-01' }],
      ['no body', undefined],
    ])('rejects %s with a 400 and no upstream call', async (_label, body) => {
      const create = vi.spyOn(MentorshipAdminService.prototype, 'createTerm');
      const update = vi.spyOn(MentorshipAdminService.prototype, 'updateTerm');

      await controller.createTerm(termReq(body, { programId: PROGRAM_ID }), writeRes(), next);
      await controller.updateTerm(termReq(body), writeRes(), next);

      expect(statusCodes()).toEqual([400, 400]);
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it.each([
      ['a program id that is not a UUID', { programId: '12', termId: TERM }],
      ['a term id that is not a UUID', { programId: PROGRAM_ID, termId: 'abc' }],
    ])('rejects %s with a 400 and no upstream call', async (_label, params) => {
      const close = vi.spyOn(MentorshipAdminService.prototype, 'closeTerm');
      const del = vi.spyOn(MentorshipAdminService.prototype, 'deleteTerm');

      await controller.closeTerm(termReq(undefined, params), writeRes(), next);
      await controller.deleteTerm(termReq(undefined, params), writeRes(), next);

      expect(statusCodes()).toEqual([400, 400]);
      expect(close).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    });

    it('passes an upstream 409 on', async () => {
      vi.spyOn(MentorshipAdminService.prototype, 'closeTerm').mockRejectedValue(Object.assign(new Error('accepted'), { statusCode: 409 }));

      await controller.closeTerm(termReq(undefined), writeRes(), next);

      expect(statusCodes()).toEqual([409]);
    });

    it('logs ids only, never the term name', async () => {
      vi.spyOn(MentorshipAdminService.prototype, 'createTerm').mockResolvedValue(row as never);

      await controller.createTerm(termReq({ ...termBody, name: 'private-term-name' }, { programId: PROGRAM_ID }), writeRes(), next);

      const logged = JSON.stringify([...vi.mocked(logger.startOperation).mock.calls, ...vi.mocked(logger.success).mock.calls].map((call) => call.slice(1)));
      expect(logged).toContain(PROGRAM_ID);
      expect(logged).not.toContain('private-term-name');
    });
  });

  describe('with no signed-in user', () => {
    it.each([
      ['getProgram', 'getProgramPage', { programId: PROGRAM_ID }, {}],
      ['getProgramMentees', 'getProgramMentees', { programId: PROGRAM_ID }, { type: 'current' }],
      ['getProgramMentors', 'getProgramMentors', { programId: PROGRAM_ID }, {}],
      ['getProgramTerms', 'getProgramTerms', { programId: PROGRAM_ID }, {}],
      ['getApplicationTasks', 'getApplicationTasks', { applicationId: PROGRAM_ID }, {}],
      ['updateApplicationNote', 'updateApplicationNote', { applicationId: PROGRAM_ID }, {}],
      ['createTasks', 'createTasks', {}, {}],
      ['updateProgramMentor', 'updateProgramMentor', { programId: PROGRAM_ID, memberId: PROGRAM_ID }, {}],
      ['createTerm', 'createTerm', { programId: PROGRAM_ID }, {}],
      ['updateTerm', 'updateTerm', { programId: PROGRAM_ID, termId: PROGRAM_ID }, {}],
      ['closeTerm', 'closeTerm', { programId: PROGRAM_ID, termId: PROGRAM_ID }, {}],
      ['reopenTerm', 'reopenTerm', { programId: PROGRAM_ID, termId: PROGRAM_ID }, {}],
      ['deleteTerm', 'deleteTerm', { programId: PROGRAM_ID, termId: PROGRAM_ID }, {}],
    ] as const)('%s passes an AuthenticationError to next without reading upstream', async (method, serviceMethod, params, query) => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const read = vi.spyOn(MentorshipAdminService.prototype, serviceMethod);

      await controller[method](buildReq(query, params), res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
      expect(read).not.toHaveBeenCalled();
    });
  });
});
