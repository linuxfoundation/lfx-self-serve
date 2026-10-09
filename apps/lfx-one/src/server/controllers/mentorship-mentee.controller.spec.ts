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
const { AuthenticationError, MicroserviceError, ServiceValidationError } = await import('../errors');
const { getUsernameFromAuth } = await import('../utils/auth-helper');
const { logger } = await import('../services/logger.service');

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

  describe('registerMenteeProfile', () => {
    const body = {
      introduction: '<p>Test intro</p>',
      skillsHave: ['Java'],
      skillsWant: ['Python'],
      additionalNotes: ' Test notes ',
      country: 'KE',
      ageEligible: true,
      workAuthorized: true,
      noDuplicateProfile: true,
      complianceAccepted: true,
      termsAccepted: true,
    };
    const buildRegisterReq = (requestBody: unknown): Request => ({ body: requestBody, query: {} }) as unknown as Request;

    beforeEach(() => {
      res = { json: vi.fn(), status: vi.fn(), send: vi.fn() } as unknown as Response;
      vi.mocked(res.status).mockReturnValue(res);
    });

    it('registers the parsed request and answers 204 with no body', async () => {
      const register = vi.spyOn(MentorshipMenteeService.prototype, 'registerMenteeProfile').mockResolvedValue(undefined);

      await controller.registerMenteeProfile(buildRegisterReq(body), res, next);

      expect(register).toHaveBeenCalledWith(expect.anything(), { ...body, additionalNotes: 'Test notes' });
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledWith();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it.each([undefined, null, 'text', [], { ...body, termsAccepted: 'yes' }, { ...body, skillsHave: [] }])(
      'rejects the body %j with a validation error before calling the service',
      async (requestBody) => {
        const register = vi.spyOn(MentorshipMenteeService.prototype, 'registerMenteeProfile');

        await controller.registerMenteeProfile(buildRegisterReq(requestBody), res, next);

        expect(register).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
        expect(res.status).not.toHaveBeenCalled();
      }
    );

    it('passes a service failure to next', async () => {
      const error = new Error('boom');
      vi.spyOn(MentorshipMenteeService.prototype, 'registerMenteeProfile').mockRejectedValue(error);

      await controller.registerMenteeProfile(buildRegisterReq(body), res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('requires an authenticated user', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const register = vi.spyOn(MentorshipMenteeService.prototype, 'registerMenteeProfile');

      await controller.registerMenteeProfile(buildRegisterReq(body), res, next);

      expect(register).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
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

  describe('updateMenteeTaskStatus', () => {
    const taskId = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
    const buildTaskReq = (params: Record<string, unknown>, body?: unknown): Request => ({ params, body, query: {} }) as unknown as Request;

    beforeEach(() => {
      res = { json: vi.fn(), status: vi.fn(), send: vi.fn() } as unknown as Response;
      vi.mocked(res.status).mockReturnValue(res);
    });

    it.each(['in_progress', 'submitted'])('updates the trimmed task id to %s and answers 204 with no body', async (status) => {
      const update = vi.spyOn(MentorshipMenteeService.prototype, 'updateMenteeTaskStatus').mockResolvedValue(undefined);

      await controller.updateMenteeTaskStatus(buildTaskReq({ taskId: ` ${taskId} ` }, { status }), res, next);

      expect(update).toHaveBeenCalledWith(expect.anything(), taskId, status);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledWith();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('logs the operation, task and status on success', async () => {
      vi.spyOn(MentorshipMenteeService.prototype, 'updateMenteeTaskStatus').mockResolvedValue(undefined);

      await controller.updateMenteeTaskStatus(buildTaskReq({ taskId }, { status: 'submitted' }), res, next);

      expect(logger.success).toHaveBeenCalledWith(expect.anything(), 'update_mentorship_mentee_task_status', 0, { taskId, status: 'submitted' });
    });

    it('ignores a file in the body and forwards only the task id and status', async () => {
      const update = vi.spyOn(MentorshipMenteeService.prototype, 'updateMenteeTaskStatus').mockResolvedValue(undefined);

      await controller.updateMenteeTaskStatus(buildTaskReq({ taskId }, { status: 'submitted', file: 'https://files.example.com/upload.pdf' }), res, next);

      expect(update).toHaveBeenCalledTimes(1);
      expect(update.mock.calls[0]).toEqual([expect.anything(), taskId, 'submitted']);
    });

    it.each([{}, { taskId: '' }, { taskId: 'task-1' }, { taskId: [taskId] }])(
      'rejects the params %j on the taskId field before calling the service',
      async (params) => {
        const update = vi.spyOn(MentorshipMenteeService.prototype, 'updateMenteeTaskStatus');

        await controller.updateMenteeTaskStatus(buildTaskReq(params, { status: 'in_progress' }), res, next);

        expect(update).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
        expect(vi.mocked(next).mock.calls[0][0]).toMatchObject({ validationErrors: [{ field: 'taskId' }] });
      }
    );

    it.each([
      undefined,
      {},
      { status: '' },
      { status: 'pending' },
      { status: 'incomplete' },
      { status: 'complete' },
      { status: 'IN_PROGRESS' },
      { status: ['submitted'] },
    ])('rejects the body %j on the status field before calling the service', async (body) => {
      const update = vi.spyOn(MentorshipMenteeService.prototype, 'updateMenteeTaskStatus');

      await controller.updateMenteeTaskStatus(buildTaskReq({ taskId }, body), res, next);

      expect(update).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(vi.mocked(next).mock.calls[0][0]).toMatchObject({ validationErrors: [{ field: 'status' }] });
    });

    it('passes an upstream failure to the error handler', async () => {
      const error = new Error('conflict');
      vi.spyOn(MentorshipMenteeService.prototype, 'updateMenteeTaskStatus').mockRejectedValue(error);

      await controller.updateMenteeTaskStatus(buildTaskReq({ taskId }, { status: 'in_progress' }), res, next);

      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(error);
    });

    it('requires an authenticated user', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const update = vi.spyOn(MentorshipMenteeService.prototype, 'updateMenteeTaskStatus');

      await controller.updateMenteeTaskStatus(buildTaskReq({ taskId }, { status: 'in_progress' }), res, next);

      expect(update).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
  });

  describe('uploadMenteeTaskFile', () => {
    const taskId = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
    const fileName = 'private-report-name.pdf';
    const file = Buffer.from('%PDF-1.7 test');
    const uploaded = { fileName: 'private-report-name.pdf', contentType: 'application/pdf', size: file.byteLength };
    // `fileNameHeader: undefined` leaves the header off; any other value is sent as is, so callers encode it themselves.
    const buildUploadReq = (
      overrides: { params?: Record<string, unknown>; query?: Record<string, unknown>; fileNameHeader?: unknown; contentType?: string; body?: unknown } = {}
    ): Request => {
      const { params = { taskId }, query = {}, contentType = 'application/octet-stream' } = overrides;
      const body = 'body' in overrides ? overrides.body : file;
      const fileNameHeader = 'fileNameHeader' in overrides ? overrides.fileNameHeader : encodeURIComponent(fileName);
      const headers: Record<string, unknown> = { 'content-type': contentType };
      if (fileNameHeader !== undefined) headers['x-file-name'] = fileNameHeader;
      return { params, query, body, path: `/tasks/${taskId}/file`, headers } as unknown as Request;
    };
    const nextError = () => vi.mocked(next).mock.calls[0][0] as unknown as { statusCode?: number; code?: string };

    beforeEach(() => {
      res = { json: vi.fn(), status: vi.fn(), send: vi.fn() } as unknown as Response;
      vi.mocked(res.status).mockReturnValue(res);
    });

    it('uploads the trimmed task id, file name and bytes and answers 201 with the stored file', async () => {
      const upload = vi.spyOn(MentorshipMenteeService.prototype, 'uploadMenteeTaskFile').mockResolvedValue(uploaded);

      await controller.uploadMenteeTaskFile(
        buildUploadReq({ params: { taskId: ` ${taskId} ` }, fileNameHeader: encodeURIComponent(` ${fileName} `) }),
        res,
        next
      );

      expect(upload).toHaveBeenCalledWith(expect.anything(), taskId, fileName, file);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(uploaded);
      expect(next).not.toHaveBeenCalled();
    });

    it.each(['application/octet-stream; charset=binary', 'Application/Octet-Stream'])('accepts the content type %s', async (contentType) => {
      const upload = vi.spyOn(MentorshipMenteeService.prototype, 'uploadMenteeTaskFile').mockResolvedValue(uploaded);

      await controller.uploadMenteeTaskFile(buildUploadReq({ contentType }), res, next);

      expect(upload).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
    });

    it.each(['report.PDF', 'notes.txt', 'essay.doc', 'essay.DocX', 'my résumé (final).pdf', '履歴書.docx'])('accepts the file name %s', async (name) => {
      const upload = vi.spyOn(MentorshipMenteeService.prototype, 'uploadMenteeTaskFile').mockResolvedValue(uploaded);

      await controller.uploadMenteeTaskFile(buildUploadReq({ fileNameHeader: encodeURIComponent(name) }), res, next);

      expect(upload).toHaveBeenCalledWith(expect.anything(), taskId, name, file);
    });

    it.each([
      ['a/b.pdf', 'a_b.pdf'],
      ['../report.pdf', '._report.pdf'],
      ['dir\\report.pdf', 'dir_report.pdf'],
      ['say "hi".pdf', 'say _hi_.pdf'],
      ['resume v2..final.pdf', 'resume v2.final.pdf'],
      ['report\r\n.pdf', 'report__.pdf'],
      ['tab\there.txt', 'tab_here.txt'],
    ])('sanitises the file name %j to %j and forwards it', async (name, sanitised) => {
      const upload = vi.spyOn(MentorshipMenteeService.prototype, 'uploadMenteeTaskFile').mockResolvedValue(uploaded);

      await controller.uploadMenteeTaskFile(buildUploadReq({ fileNameHeader: encodeURIComponent(name) }), res, next);

      expect(upload).toHaveBeenCalledWith(expect.anything(), taskId, sanitised, file);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(next).not.toHaveBeenCalled();
    });

    it('logs the task id and the size, never the file name', async () => {
      vi.spyOn(MentorshipMenteeService.prototype, 'uploadMenteeTaskFile').mockResolvedValue(uploaded);

      await controller.uploadMenteeTaskFile(buildUploadReq(), res, next);

      expect(logger.success).toHaveBeenCalledWith(expect.anything(), 'upload_mentorship_mentee_task_file', 0, { taskId, sizeBytes: file.byteLength });
      const logged = JSON.stringify([...vi.mocked(logger.startOperation).mock.calls, ...vi.mocked(logger.success).mock.calls].map((call) => call.slice(1)));
      expect(logged).not.toContain('private-report-name');
    });

    it.each([{}, { taskId: '' }, { taskId: 'task-1' }, { taskId: [taskId] }])(
      'rejects the params %j on the taskId field before calling the service',
      async (params) => {
        const upload = vi.spyOn(MentorshipMenteeService.prototype, 'uploadMenteeTaskFile');

        await controller.uploadMenteeTaskFile(buildUploadReq({ params }), res, next);

        expect(upload).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
        expect(nextError()).toMatchObject({ validationErrors: [{ field: 'taskId' }] });
      }
    );

    it.each(['', 'application/pdf', 'multipart/form-data; boundary=x', 'text/plain'])(
      'refuses the content type %j with a 415 before calling the service',
      async (contentType) => {
        const upload = vi.spyOn(MentorshipMenteeService.prototype, 'uploadMenteeTaskFile');

        // The raw parser leaves any other type unparsed, so the controller sees no bytes.
        await controller.uploadMenteeTaskFile(buildUploadReq({ contentType, body: {} }), res, next);

        expect(upload).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(MicroserviceError));
        expect(nextError()).toMatchObject({ statusCode: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
      }
    );

    it('refuses a request with no content type with a 415', async () => {
      const upload = vi.spyOn(MentorshipMenteeService.prototype, 'uploadMenteeTaskFile');
      const req = { ...buildUploadReq(), headers: {} } as unknown as Request;

      await controller.uploadMenteeTaskFile(req, res, next);

      expect(upload).not.toHaveBeenCalled();
      expect(nextError()).toMatchObject({ statusCode: 415 });
    });

    it.each([
      ['no header', undefined],
      ['an empty header', ''],
      ['a blank name', encodeURIComponent('   ')],
      ['a repeated header', ['a.pdf', 'b.pdf']],
      ['an undecodable header', '%E0%A4%A'],
      ['a lone percent sign', 'report%.pdf'],
    ])('rejects %s on the fileName field before calling the service', async (_label, fileNameHeader) => {
      const upload = vi.spyOn(MentorshipMenteeService.prototype, 'uploadMenteeTaskFile');

      await controller.uploadMenteeTaskFile(buildUploadReq({ fileNameHeader }), res, next);

      expect(upload).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(nextError()).toMatchObject({ statusCode: 400, validationErrors: [{ field: 'fileName' }] });
    });

    it('never reads the file name from the query', async () => {
      const upload = vi.spyOn(MentorshipMenteeService.prototype, 'uploadMenteeTaskFile');

      await controller.uploadMenteeTaskFile(buildUploadReq({ query: { fileName }, fileNameHeader: undefined }), res, next);

      expect(upload).not.toHaveBeenCalled();
      expect(nextError()).toMatchObject({ statusCode: 400, validationErrors: [{ field: 'fileName' }] });
    });

    it.each(['report', 'report.exe', 'report.pdf.exe', 'image.png', 'report.pdfx', 'report.'])(
      'refuses the file name %s with a 415 before calling the service',
      async (name) => {
        const upload = vi.spyOn(MentorshipMenteeService.prototype, 'uploadMenteeTaskFile');

        await controller.uploadMenteeTaskFile(buildUploadReq({ fileNameHeader: encodeURIComponent(name) }), res, next);

        expect(upload).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(MicroserviceError));
        expect(nextError()).toMatchObject({ statusCode: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
      }
    );

    it.each([
      ['an empty buffer', Buffer.alloc(0)],
      ['no body', undefined],
      ['an unparsed body', {}],
      ['a string', 'bytes'],
    ])('rejects %s on the file field before calling the service', async (_label, body) => {
      const upload = vi.spyOn(MentorshipMenteeService.prototype, 'uploadMenteeTaskFile');

      await controller.uploadMenteeTaskFile(buildUploadReq({ body }), res, next);

      expect(upload).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(nextError()).toMatchObject({ statusCode: 400, validationErrors: [{ field: 'file' }] });
    });

    it.each([400, 403, 409, 413, 415, 503])('passes an upstream %i to the error handler', async (statusCode) => {
      const error = new MicroserviceError('upstream', statusCode, 'UPSTREAM');
      vi.spyOn(MentorshipMenteeService.prototype, 'uploadMenteeTaskFile').mockRejectedValue(error);

      await controller.uploadMenteeTaskFile(buildUploadReq(), res, next);

      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(error);
    });

    it('requires an authenticated user', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const upload = vi.spyOn(MentorshipMenteeService.prototype, 'uploadMenteeTaskFile');

      await controller.uploadMenteeTaskFile(buildUploadReq(), res, next);

      expect(upload).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
  });

  describe('deleteMenteeTaskFile', () => {
    const taskId = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
    const buildDeleteReq = (params: Record<string, unknown>): Request => ({ params, query: {} }) as unknown as Request;

    beforeEach(() => {
      res = { json: vi.fn(), status: vi.fn(), send: vi.fn() } as unknown as Response;
      vi.mocked(res.status).mockReturnValue(res);
    });

    it('removes the file of the trimmed task id and answers 204 with no body', async () => {
      const remove = vi.spyOn(MentorshipMenteeService.prototype, 'deleteMenteeTaskFile').mockResolvedValue(undefined);

      await controller.deleteMenteeTaskFile(buildDeleteReq({ taskId: ` ${taskId} ` }), res, next);

      expect(remove).toHaveBeenCalledWith(expect.anything(), taskId);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledWith();
      expect(res.json).not.toHaveBeenCalled();
      expect(logger.success).toHaveBeenCalledWith(expect.anything(), 'delete_mentorship_mentee_task_file', 0, { taskId });
      expect(next).not.toHaveBeenCalled();
    });

    it.each([{}, { taskId: '' }, { taskId: 'task-1' }, { taskId: [taskId] }])(
      'rejects the params %j on the taskId field before calling the service',
      async (params) => {
        const remove = vi.spyOn(MentorshipMenteeService.prototype, 'deleteMenteeTaskFile');

        await controller.deleteMenteeTaskFile(buildDeleteReq(params), res, next);

        expect(remove).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
        expect(vi.mocked(next).mock.calls[0][0]).toMatchObject({ validationErrors: [{ field: 'taskId' }] });
      }
    );

    it('passes an upstream failure to the error handler', async () => {
      const error = new MicroserviceError('conflict', 409, 'CONFLICT');
      vi.spyOn(MentorshipMenteeService.prototype, 'deleteMenteeTaskFile').mockRejectedValue(error);

      await controller.deleteMenteeTaskFile(buildDeleteReq({ taskId }), res, next);

      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(error);
    });

    it('requires an authenticated user', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const remove = vi.spyOn(MentorshipMenteeService.prototype, 'deleteMenteeTaskFile');

      await controller.deleteMenteeTaskFile(buildDeleteReq({ taskId }), res, next);

      expect(remove).not.toHaveBeenCalled();
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
  describe('updateMenteeProfile', () => {
    type UpdateResponse = Awaited<ReturnType<InstanceType<typeof MentorshipMenteeService>['updateMenteeProfile']>>;
    const updated = { profile: { aboutMe: '<p>Test</p>', skillsHave: ['Go'], skillsWant: ['Rust'] } } as UpdateResponse;
    const buildUpdateReq = (body: unknown): Request => ({ body, query: {} }) as unknown as Request;

    it('answers 200 with the service result and passes the normalized request to the service', async () => {
      const update = vi.spyOn(MentorshipMenteeService.prototype, 'updateMenteeProfile').mockResolvedValue(updated);

      await controller.updateMenteeProfile(
        buildUpdateReq({ introduction: '<p>Hello</p>', skillSet: { skillsHave: [' Go '], skillsWant: ['Rust'] } }),
        res,
        next
      );

      expect(update).toHaveBeenCalledWith(expect.anything(), { introduction: '<p>Hello</p>', skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'] } });
      expect(res.json).toHaveBeenCalledWith(updated);
      expect(next).not.toHaveBeenCalled();
    });

    it.each([undefined, null, [], {}, { unknown: 'x' }, { introduction: 3 }, { demographics: { age: '' } }])(
      'rejects the body %j before calling the service',
      async (body) => {
        const update = vi.spyOn(MentorshipMenteeService.prototype, 'updateMenteeProfile');

        await controller.updateMenteeProfile(buildUpdateReq(body), res, next);

        expect(update).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      }
    );

    it('logs the changed group names, never the values', async () => {
      vi.spyOn(MentorshipMenteeService.prototype, 'updateMenteeProfile').mockResolvedValue(updated);

      await controller.updateMenteeProfile(buildUpdateReq({ introduction: 'Private text', demographics: { age: '20-39' } }), res, next);

      expect(logger.success).toHaveBeenCalledWith(expect.anything(), 'update_mentorship_mentee_profile', expect.anything(), {
        changed_groups: ['introduction', 'demographics'],
      });
      expect(JSON.stringify(vi.mocked(logger.success).mock.calls.map((call) => call[3]))).not.toContain('Private text');
    });

    it('passes an upstream failure to the error handler', async () => {
      const error = new Error('conflict');
      vi.spyOn(MentorshipMenteeService.prototype, 'updateMenteeProfile').mockRejectedValue(error);

      await controller.updateMenteeProfile(buildUpdateReq({ introduction: 'Hello' }), res, next);

      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(error);
    });

    it('requires an authenticated user', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const update = vi.spyOn(MentorshipMenteeService.prototype, 'updateMenteeProfile');

      await controller.updateMenteeProfile(buildUpdateReq({ introduction: 'Hello' }), res, next);

      expect(update).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });
  });
});
