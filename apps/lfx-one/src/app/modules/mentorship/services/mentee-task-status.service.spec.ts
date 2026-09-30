// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_MENTEE_TASK_STATUS_ERROR_FALLBACK,
  MENTORSHIP_MENTEE_TASK_STATUS_ERROR_MESSAGES,
  MENTORSHIP_MENTEE_TASK_STATUS_ERROR_SUMMARY,
  MENTORSHIP_MENTEE_TASK_STATUS_SUCCESS_DETAIL,
  MENTORSHIP_MENTEE_TASK_STATUS_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_TASK_STATUS_TOAST_LIFE,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeUpdatableTaskStatus } from '@lfx-one/shared/interfaces';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeTaskStatusService } from './mentee-task-status.service';

describe('MenteeTaskStatusService', () => {
  const TASK_ID = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';

  let service: MenteeTaskStatusService;
  let add: ReturnType<typeof vi.fn>;
  let updateMenteeTaskStatus: ReturnType<typeof vi.fn<(id: string, status: MentorshipMenteeUpdatableTaskStatus) => Observable<void>>>;
  let clearMenteeCaches: ReturnType<typeof vi.fn>;

  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  /** Runs one change to completion and returns what it emitted. */
  const change = (status: MentorshipMenteeUpdatableTaskStatus = 'in_progress'): boolean[] => {
    const emitted: boolean[] = [];
    service.changeStatus(TASK_ID, status).subscribe((saved) => emitted.push(saved));
    return emitted;
  };

  beforeEach(() => {
    add = vi.fn();
    updateMenteeTaskStatus = vi.fn(() => of(undefined));
    clearMenteeCaches = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        MenteeTaskStatusService,
        { provide: MessageService, useValue: { add } },
        { provide: MentorshipMenteeService, useValue: { updateMenteeTaskStatus, clearMenteeCaches } },
      ],
    });

    service = TestBed.inject(MenteeTaskStatusService);
  });

  it('saves the status, emits true and toasts success without clearing the cache itself', () => {
    expect(change('submitted')).toEqual([true]);

    expect(updateMenteeTaskStatus).toHaveBeenCalledWith(TASK_ID, 'submitted');
    expect(add).toHaveBeenCalledWith({
      severity: 'success',
      summary: MENTORSHIP_MENTEE_TASK_STATUS_SUCCESS_SUMMARY,
      detail: MENTORSHIP_MENTEE_TASK_STATUS_SUCCESS_DETAIL,
      life: MENTORSHIP_MENTEE_TASK_STATUS_TOAST_LIFE,
    });
    // The data service already drops the cache on success.
    expect(clearMenteeCaches).not.toHaveBeenCalled();
  });

  it('emits false, shows the file-aware copy for a 400 and re-reads the applications', () => {
    updateMenteeTaskStatus.mockReturnValueOnce(throwError(() => httpError(400, { error: 'invalid input' })));

    expect(change('submitted')).toEqual([false]);

    expect(add).toHaveBeenCalledWith({
      severity: 'error',
      summary: MENTORSHIP_MENTEE_TASK_STATUS_ERROR_SUMMARY,
      detail: MENTORSHIP_MENTEE_TASK_STATUS_ERROR_MESSAGES[400],
      life: MENTORSHIP_MENTEE_TASK_STATUS_TOAST_LIFE,
    });
    // A 400 means the cached task no longer says whether a file is needed, so the tasks are re-read.
    expect(clearMenteeCaches).toHaveBeenCalledTimes(1);
  });

  it('shows the server message for the impersonation 403 and keeps the applications', () => {
    const message = 'This action is not available while impersonating a user';
    updateMenteeTaskStatus.mockReturnValueOnce(throwError(() => httpError(403, { error: message, code: 'IMPERSONATION_READ_ONLY' })));

    expect(change()).toEqual([false]);

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: message }));
    expect(clearMenteeCaches).not.toHaveBeenCalled();
  });

  it.each([403, 404, 409])('shows the stale copy for a %i and re-reads the applications', (status) => {
    updateMenteeTaskStatus.mockReturnValueOnce(throwError(() => httpError(status, { error: 'upstream text' })));

    expect(change()).toEqual([false]);

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTEE_TASK_STATUS_ERROR_MESSAGES[status] }));
    expect(clearMenteeCaches).toHaveBeenCalledTimes(1);
  });

  it.each([0, 422, 500, 503])('shows the fallback for a %i and keeps the applications', (status) => {
    updateMenteeTaskStatus.mockReturnValueOnce(throwError(() => httpError(status)));

    expect(change()).toEqual([false]);

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTEE_TASK_STATUS_ERROR_FALLBACK }));
    expect(clearMenteeCaches).not.toHaveBeenCalled();
  });

  it('still toasts and re-reads when the request settles long after the subscriber stopped caring', () => {
    const pending = new Subject<void>();
    updateMenteeTaskStatus.mockReturnValueOnce(pending);

    // No unsubscribe anywhere: the write must outlive whichever view started it.
    service.changeStatus(TASK_ID, 'in_progress').subscribe();
    expect(pending.observed).toBe(true);
    expect(add).not.toHaveBeenCalled();

    pending.error(httpError(409));

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTEE_TASK_STATUS_ERROR_MESSAGES[409] }));
    expect(clearMenteeCaches).toHaveBeenCalledTimes(1);
  });
});
