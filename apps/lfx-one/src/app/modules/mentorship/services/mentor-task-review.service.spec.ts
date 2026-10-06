// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTOR_TASK_REVIEW_ERROR_FALLBACK,
  MENTORSHIP_MENTOR_TASK_REVIEW_ERROR_MESSAGES,
  MENTORSHIP_MENTOR_TASK_REVIEW_ERROR_SUMMARY,
  MENTORSHIP_MENTOR_TASK_REVIEW_SUCCESS_SUMMARIES,
} from '@lfx-one/shared/constants';
import { MentorshipMentorTaskReviewDecision } from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { MessageService } from 'primeng/api';
import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorTaskReviewService } from './mentor-task-review.service';

describe('MentorTaskReviewService', () => {
  const TASK_ID = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

  let service: MentorTaskReviewService;
  let add: ReturnType<typeof vi.fn>;
  let reviewMenteeTask: ReturnType<typeof vi.fn<(taskId: string, status: MentorshipMentorTaskReviewDecision) => Observable<void>>>;

  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    add = vi.fn();
    reviewMenteeTask = vi.fn(() => of(undefined));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: { add } },
        { provide: MentorshipMentorService, useValue: { reviewMenteeTask } },
      ],
    });

    service = TestBed.inject(MentorTaskReviewService);
  });

  it.each(['complete', 'incomplete'] as const)('sends %s, toasts its success copy and emits true', async (status) => {
    await expect(firstValueFrom(service.review(TASK_ID, status))).resolves.toBe(true);

    expect(reviewMenteeTask).toHaveBeenCalledWith(TASK_ID, status);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: MENTORSHIP_MENTOR_TASK_REVIEW_SUCCESS_SUMMARIES[status] }));
  });

  it.each([403, 404, 409])('shows the %i copy and emits false', async (status) => {
    reviewMenteeTask.mockReturnValueOnce(throwError(() => httpError(status, { error: 'upstream text' })));

    await expect(firstValueFrom(service.review(TASK_ID, 'complete'))).resolves.toBe(false);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: MENTORSHIP_MENTOR_TASK_REVIEW_ERROR_SUMMARY,
        detail: MENTORSHIP_MENTOR_TASK_REVIEW_ERROR_MESSAGES[status],
      })
    );
  });

  it("shows the server's message for the impersonation guard's 403", async () => {
    reviewMenteeTask.mockReturnValueOnce(
      throwError(() => httpError(403, { error: 'Read-only while impersonating.', code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE }))
    );

    await expect(firstValueFrom(service.review(TASK_ID, 'incomplete'))).resolves.toBe(false);

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Read-only while impersonating.' }));
  });

  it('shows the fallback for any other failure', async () => {
    reviewMenteeTask.mockReturnValueOnce(throwError(() => httpError(503)));

    await expect(firstValueFrom(service.review(TASK_ID, 'complete'))).resolves.toBe(false);

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTOR_TASK_REVIEW_ERROR_FALLBACK }));
  });
});
