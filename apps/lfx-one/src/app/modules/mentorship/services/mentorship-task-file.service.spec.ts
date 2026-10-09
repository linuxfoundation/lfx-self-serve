// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, HttpHeaders, HttpResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTEE_TASK_FILE_ERROR_FALLBACK,
  MENTORSHIP_MENTEE_TASK_FILE_ERROR_MESSAGES,
  MENTORSHIP_MENTEE_TASK_FILE_MAX_BYTES,
  MENTORSHIP_MENTEE_TASK_FILE_PAST_DUE_MESSAGE,
  MENTORSHIP_MENTEE_TASK_FILE_REMOVE_ERROR_SUMMARY,
  MENTORSHIP_MENTEE_TASK_FILE_REMOVE_SUCCESS_DETAIL,
  MENTORSHIP_MENTEE_TASK_FILE_REMOVE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_TASK_FILE_TOO_LARGE_MESSAGE,
  MENTORSHIP_MENTEE_TASK_FILE_TYPE_MESSAGE,
  MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_ERROR_SUMMARY,
  MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_SUCCESS_DETAIL,
  MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_TASK_PAST_DUE_ERROR_CODE,
  MENTORSHIP_MENTEE_TASK_STATUS_TOAST_LIFE,
  MENTORSHIP_TASK_FILE_DOWNLOAD_ERROR_FALLBACK,
  MENTORSHIP_TASK_FILE_DOWNLOAD_ERROR_MESSAGES,
  MENTORSHIP_TASK_FILE_DOWNLOAD_ERROR_SUMMARY,
  MENTORSHIP_TASK_FILE_DOWNLOAD_FALLBACK_NAME,
  MENTORSHIP_TASK_FILE_DOWNLOAD_TOAST_LIFE,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeTaskFileUploadResponse } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipTaskFileService } from './mentorship-task-file.service';

describe('MentorshipTaskFileService', () => {
  const TASK_ID = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
  const UPLOADED: MentorshipMenteeTaskFileUploadResponse = { fileName: 'report.pdf', contentType: 'application/pdf', size: 4 };

  let service: MentorshipTaskFileService;
  let add: ReturnType<typeof vi.fn>;
  let uploadMenteeTaskFile: ReturnType<typeof vi.fn<(id: string, file: File) => Observable<MentorshipMenteeTaskFileUploadResponse>>>;
  let deleteMenteeTaskFile: ReturnType<typeof vi.fn<(id: string) => Observable<void>>>;
  let clearMenteeCaches: ReturnType<typeof vi.fn>;
  let downloadTaskFile: ReturnType<typeof vi.fn<(id: string) => Observable<HttpResponse<Blob>>>>;

  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });
  const fileOf = (name: string, content: BlobPart[] = ['data']) => new File(content, name);

  const configure = (platformId: 'browser' | 'server' = 'browser') => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        MentorshipTaskFileService,
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: MessageService, useValue: { add } },
        { provide: MentorshipMenteeService, useValue: { uploadMenteeTaskFile, deleteMenteeTaskFile, clearMenteeCaches } },
        { provide: MentorshipService, useValue: { downloadTaskFile } },
      ],
    });
    service = TestBed.inject(MentorshipTaskFileService);
  };

  /** Runs one upload to completion and returns what it emitted. */
  const upload = (file: File = fileOf('report.pdf')): boolean[] => {
    const emitted: boolean[] = [];
    service.upload(TASK_ID, file).subscribe((saved) => emitted.push(saved));
    return emitted;
  };

  /** Runs one removal to completion and returns what it emitted. */
  const remove = (): boolean[] => {
    const emitted: boolean[] = [];
    service.remove(TASK_ID).subscribe((saved) => emitted.push(saved));
    return emitted;
  };

  beforeEach(() => {
    add = vi.fn();
    uploadMenteeTaskFile = vi.fn(() => of(UPLOADED));
    deleteMenteeTaskFile = vi.fn(() => of(undefined));
    clearMenteeCaches = vi.fn();
    downloadTaskFile = vi.fn(() => of(new HttpResponse<Blob>({ body: new Blob(['data']) })));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    configure();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('upload', () => {
    it('sends the file, emits true and toasts success without clearing the cache itself', () => {
      const file = fileOf('report.pdf');

      expect(upload(file)).toEqual([true]);

      expect(uploadMenteeTaskFile).toHaveBeenCalledWith(TASK_ID, file);
      expect(add).toHaveBeenCalledWith({
        severity: 'success',
        summary: MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_SUCCESS_SUMMARY,
        detail: MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_SUCCESS_DETAIL,
        life: MENTORSHIP_MENTEE_TASK_STATUS_TOAST_LIFE,
      });
      // The data service already drops the cache on success.
      expect(clearMenteeCaches).not.toHaveBeenCalled();
    });

    it.each(['notes.PDF', 'essay.doc', 'essay.docx', 'notes.txt', 'archive.v2.Docx'])('accepts %s', (name) => {
      expect(upload(fileOf(name))).toEqual([true]);
      expect(uploadMenteeTaskFile).toHaveBeenCalledTimes(1);
    });

    it.each(['image.png', 'script.exe', 'README', 'report.pdf.zip', '.pdfx'])('refuses %s before sending it', (name) => {
      expect(upload(fileOf(name))).toEqual([false]);

      expect(uploadMenteeTaskFile).not.toHaveBeenCalled();
      expect(add).toHaveBeenCalledWith({
        severity: 'error',
        summary: MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_ERROR_SUMMARY,
        detail: MENTORSHIP_MENTEE_TASK_FILE_TYPE_MESSAGE,
        life: MENTORSHIP_MENTEE_TASK_STATUS_TOAST_LIFE,
      });
      expect(clearMenteeCaches).not.toHaveBeenCalled();
    });

    it('refuses a file over the size cap before sending it', () => {
      const file = fileOf('large.pdf');
      Object.defineProperty(file, 'size', { value: MENTORSHIP_MENTEE_TASK_FILE_MAX_BYTES + 1 });

      expect(upload(file)).toEqual([false]);

      expect(uploadMenteeTaskFile).not.toHaveBeenCalled();
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTEE_TASK_FILE_TOO_LARGE_MESSAGE }));
    });

    it('accepts a file exactly at the size cap', () => {
      const file = fileOf('exact.pdf');
      Object.defineProperty(file, 'size', { value: MENTORSHIP_MENTEE_TASK_FILE_MAX_BYTES });

      expect(upload(file)).toEqual([true]);
      expect(uploadMenteeTaskFile).toHaveBeenCalledTimes(1);
    });

    it('refuses an empty file before sending it', () => {
      expect(upload(fileOf('empty.txt', []))).toEqual([false]);

      expect(uploadMenteeTaskFile).not.toHaveBeenCalled();
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTEE_TASK_FILE_ERROR_MESSAGES[400] }));
    });

    it('shows the past-due copy for the BFF past-due 400 and re-reads the applications', () => {
      uploadMenteeTaskFile.mockReturnValueOnce(throwError(() => httpError(400, { error: 'server text', code: MENTORSHIP_MENTEE_TASK_PAST_DUE_ERROR_CODE })));

      expect(upload()).toEqual([false]);

      expect(add).toHaveBeenCalledWith({
        severity: 'error',
        summary: MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_ERROR_SUMMARY,
        detail: MENTORSHIP_MENTEE_TASK_FILE_PAST_DUE_MESSAGE,
        life: MENTORSHIP_MENTEE_TASK_STATUS_TOAST_LIFE,
      });
      expect(clearMenteeCaches).toHaveBeenCalledTimes(1);
    });

    it('shows the empty-file copy for any other 400 and keeps the applications', () => {
      uploadMenteeTaskFile.mockReturnValueOnce(throwError(() => httpError(400, { error: 'empty file' })));

      expect(upload()).toEqual([false]);

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTEE_TASK_FILE_ERROR_MESSAGES[400] }));
      expect(clearMenteeCaches).not.toHaveBeenCalled();
    });

    it('shows the server message for the impersonation 403 and keeps the applications', () => {
      const message = 'This action is not available while impersonating a user';
      uploadMenteeTaskFile.mockReturnValueOnce(throwError(() => httpError(403, { error: message, code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE })));

      expect(upload()).toEqual([false]);

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: message }));
      expect(clearMenteeCaches).not.toHaveBeenCalled();
    });

    it.each([403, 404, 409])('shows the stale copy for a %i and re-reads the applications', (status) => {
      uploadMenteeTaskFile.mockReturnValueOnce(throwError(() => httpError(status, { error: 'upstream text' })));

      expect(upload()).toEqual([false]);

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTEE_TASK_FILE_ERROR_MESSAGES[status] }));
      expect(clearMenteeCaches).toHaveBeenCalledTimes(1);
    });

    it.each([413, 415, 503])('shows the mapped copy for a %i and keeps the applications', (status) => {
      uploadMenteeTaskFile.mockReturnValueOnce(throwError(() => httpError(status)));

      expect(upload()).toEqual([false]);

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTEE_TASK_FILE_ERROR_MESSAGES[status] }));
      expect(clearMenteeCaches).not.toHaveBeenCalled();
    });

    it.each([0, 422, 500])('shows the fallback for a %i and keeps the applications', (status) => {
      uploadMenteeTaskFile.mockReturnValueOnce(throwError(() => httpError(status)));

      expect(upload()).toEqual([false]);

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTEE_TASK_FILE_ERROR_FALLBACK }));
      expect(clearMenteeCaches).not.toHaveBeenCalled();
    });

    it('logs a failure by status only', () => {
      uploadMenteeTaskFile.mockReturnValueOnce(throwError(() => httpError(500, { error: 'private-upstream-text' })));

      upload();

      expect(console.error).toHaveBeenCalledWith('[MentorshipTaskFileService] upload failed', { status: 500 });
    });

    it('still toasts and re-reads when the request settles long after the subscriber stopped caring', () => {
      const pending = new Subject<MentorshipMenteeTaskFileUploadResponse>();
      uploadMenteeTaskFile.mockReturnValueOnce(pending);

      service.upload(TASK_ID, fileOf('report.pdf')).subscribe();
      expect(pending.observed).toBe(true);
      expect(add).not.toHaveBeenCalled();

      pending.error(httpError(409));

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTEE_TASK_FILE_ERROR_MESSAGES[409] }));
      expect(clearMenteeCaches).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove', () => {
    it('removes the file, emits true and toasts success without clearing the cache itself', () => {
      expect(remove()).toEqual([true]);

      expect(deleteMenteeTaskFile).toHaveBeenCalledWith(TASK_ID);
      expect(add).toHaveBeenCalledWith({
        severity: 'success',
        summary: MENTORSHIP_MENTEE_TASK_FILE_REMOVE_SUCCESS_SUMMARY,
        detail: MENTORSHIP_MENTEE_TASK_FILE_REMOVE_SUCCESS_DETAIL,
        life: MENTORSHIP_MENTEE_TASK_STATUS_TOAST_LIFE,
      });
      expect(clearMenteeCaches).not.toHaveBeenCalled();
    });

    it('shows the past-due copy under the remove summary and re-reads the applications', () => {
      deleteMenteeTaskFile.mockReturnValueOnce(throwError(() => httpError(400, { error: 'server text', code: MENTORSHIP_MENTEE_TASK_PAST_DUE_ERROR_CODE })));

      expect(remove()).toEqual([false]);

      expect(add).toHaveBeenCalledWith({
        severity: 'error',
        summary: MENTORSHIP_MENTEE_TASK_FILE_REMOVE_ERROR_SUMMARY,
        detail: MENTORSHIP_MENTEE_TASK_FILE_PAST_DUE_MESSAGE,
        life: MENTORSHIP_MENTEE_TASK_STATUS_TOAST_LIFE,
      });
      expect(clearMenteeCaches).toHaveBeenCalledTimes(1);
    });

    it('shows the server message for the impersonation 403 and keeps the applications', () => {
      const message = 'This action is not available while impersonating a user';
      deleteMenteeTaskFile.mockReturnValueOnce(throwError(() => httpError(403, { error: message, code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE })));

      expect(remove()).toEqual([false]);

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: MENTORSHIP_MENTEE_TASK_FILE_REMOVE_ERROR_SUMMARY, detail: message }));
      expect(clearMenteeCaches).not.toHaveBeenCalled();
    });

    it.each([403, 404, 409])('shows the stale copy for a %i and re-reads the applications', (status) => {
      deleteMenteeTaskFile.mockReturnValueOnce(throwError(() => httpError(status, { error: 'upstream text' })));

      expect(remove()).toEqual([false]);

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTEE_TASK_FILE_ERROR_MESSAGES[status] }));
      expect(clearMenteeCaches).toHaveBeenCalledTimes(1);
    });

    it('shows the fallback for an unmapped status, keeps the applications and logs the status only', () => {
      deleteMenteeTaskFile.mockReturnValueOnce(throwError(() => httpError(500, { error: 'private-upstream-text' })));

      expect(remove()).toEqual([false]);

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTEE_TASK_FILE_ERROR_FALLBACK }));
      expect(clearMenteeCaches).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('[MentorshipTaskFileService] remove failed', { status: 500 });
    });
  });

  describe('download', () => {
    let createObjectURL: ReturnType<typeof vi.fn>;
    let revokeObjectURL: ReturnType<typeof vi.fn>;
    let savedAs: string[];
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    const responseWith = (body: Blob | null, disposition?: string) =>
      new HttpResponse<Blob>({ body, headers: disposition ? new HttpHeaders({ 'Content-Disposition': disposition }) : new HttpHeaders() });

    beforeEach(() => {
      vi.useFakeTimers();
      createObjectURL = vi.fn(() => 'blob:http://example.com/file-1');
      revokeObjectURL = vi.fn();
      URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
      URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
      savedAs = [];
      // Captures the name `downloadFromUrl` puts on the anchor without letting jsdom navigate.
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        savedAs.push(this.download);
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it('saves the blob under the name from Content-Disposition and revokes the URL afterwards', () => {
      const blob = new Blob(['data'], { type: 'application/pdf' });
      downloadTaskFile.mockReturnValueOnce(of(responseWith(blob, 'attachment; filename="report.pdf"')));

      service.download(TASK_ID);

      expect(downloadTaskFile).toHaveBeenCalledWith(TASK_ID);
      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(savedAs).toEqual(['report.pdf']);
      // Revoked on the next tick, not synchronously.
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://example.com/file-1');
      expect(add).not.toHaveBeenCalled();
    });

    it('prefers the encoded filename* form', () => {
      downloadTaskFile.mockReturnValueOnce(of(responseWith(new Blob(['data']), `attachment; filename="essay.docx"; filename*=UTF-8''final%2Dessay.docx`)));

      service.download(TASK_ID);

      expect(savedAs).toEqual(['final-essay.docx']);
    });

    it('falls back to the default name when the response names no file', () => {
      downloadTaskFile.mockReturnValueOnce(of(responseWith(new Blob(['data']))));

      service.download(TASK_ID);

      expect(savedAs).toEqual([MENTORSHIP_TASK_FILE_DOWNLOAD_FALLBACK_NAME]);
    });

    it('saves nothing when the response has no body', () => {
      downloadTaskFile.mockReturnValueOnce(of(responseWith(null, 'attachment; filename="report.pdf"')));

      service.download(TASK_ID);

      expect(createObjectURL).not.toHaveBeenCalled();
      expect(savedAs).toEqual([]);
      expect(add).not.toHaveBeenCalled();
    });

    it.each([403, 404, 503])('toasts the mapped copy for a %i', (status) => {
      downloadTaskFile.mockReturnValueOnce(throwError(() => httpError(status, new Blob(['{"error":"upstream text"}']))));

      service.download(TASK_ID);

      expect(add).toHaveBeenCalledWith({
        severity: 'error',
        summary: MENTORSHIP_TASK_FILE_DOWNLOAD_ERROR_SUMMARY,
        detail: MENTORSHIP_TASK_FILE_DOWNLOAD_ERROR_MESSAGES[status],
        life: MENTORSHIP_TASK_FILE_DOWNLOAD_TOAST_LIFE,
      });
      expect(createObjectURL).not.toHaveBeenCalled();
    });

    it.each([0, 500])('toasts the fallback for a %i', (status) => {
      downloadTaskFile.mockReturnValueOnce(throwError(() => httpError(status)));

      service.download(TASK_ID);

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_TASK_FILE_DOWNLOAD_ERROR_FALLBACK }));
    });

    it('does nothing on the server', () => {
      configure('server');

      service.download(TASK_ID);

      expect(downloadTaskFile).not.toHaveBeenCalled();
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    });
  });
});
