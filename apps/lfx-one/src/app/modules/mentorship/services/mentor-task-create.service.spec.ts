// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTOR_TASK_CREATE_ERROR_FALLBACK,
  MENTORSHIP_MENTOR_TASK_CREATE_ERROR_MESSAGES,
  MENTORSHIP_MENTOR_TASK_CREATE_ERROR_SUMMARY,
  MENTORSHIP_MENTOR_TASK_CREATE_PARTIAL_SUMMARY,
  MENTORSHIP_MENTOR_TASK_CREATE_SUCCESS_SUMMARY,
} from '@lfx-one/shared/constants';
import { MentorshipMentorTaskCreateRequest, MentorshipMentorTaskCreateResponse } from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { MessageService } from 'primeng/api';
import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorTaskCreateService } from './mentor-task-create.service';

describe('MentorTaskCreateService', () => {
  const APPLICATION_ID = '5d1c8e2f-3a4b-4c6d-8e9f-0a1b2c3d4e5f';
  const OTHER_APPLICATION_ID = '7a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d';
  const request: MentorshipMentorTaskCreateRequest = { applicationIds: [APPLICATION_ID], name: 'Write a design doc', description: 'One page.' };

  let service: MentorTaskCreateService;
  let add: ReturnType<typeof vi.fn>;
  let createMenteeTasks: ReturnType<typeof vi.fn<(request: MentorshipMentorTaskCreateRequest) => Observable<MentorshipMentorTaskCreateResponse>>>;

  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    add = vi.fn();
    createMenteeTasks = vi.fn(() => of({ created: [APPLICATION_ID], failed: [] }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: { add } },
        { provide: MentorshipMentorService, useValue: { createMenteeTasks } },
      ],
    });

    service = TestBed.inject(MentorTaskCreateService);
  });

  it('creates the task, toasts success and emits the result', async () => {
    await expect(firstValueFrom(service.create(request))).resolves.toEqual({ created: [APPLICATION_ID], failed: [] });

    expect(createMenteeTasks).toHaveBeenCalledWith(request);
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: MENTORSHIP_MENTOR_TASK_CREATE_SUCCESS_SUMMARY, detail: undefined })
    );
  });

  it('names how many mentees a group task reached', async () => {
    createMenteeTasks.mockReturnValueOnce(of({ created: [APPLICATION_ID, OTHER_APPLICATION_ID], failed: [] }));

    await firstValueFrom(service.create({ ...request, applicationIds: [APPLICATION_ID, OTHER_APPLICATION_ID] }));

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: '2 mentees were given the task.' }));
  });

  it('warns when only some of a group were given the task', async () => {
    createMenteeTasks.mockReturnValueOnce(of({ created: [APPLICATION_ID], failed: [OTHER_APPLICATION_ID] }));

    await expect(firstValueFrom(service.create(request))).resolves.toEqual({ created: [APPLICATION_ID], failed: [OTHER_APPLICATION_ID] });

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warn',
        summary: MENTORSHIP_MENTOR_TASK_CREATE_PARTIAL_SUMMARY,
        detail: '1 of 2 tasks were not created. Refresh the page and try again.',
      })
    );
  });

  it('shows an error when none of a group was given the task', async () => {
    createMenteeTasks.mockReturnValueOnce(of({ created: [], failed: [APPLICATION_ID, OTHER_APPLICATION_ID] }));

    await firstValueFrom(service.create(request));

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: MENTORSHIP_MENTOR_TASK_CREATE_ERROR_SUMMARY,
        detail: '2 of 2 tasks were not created. Refresh the page and try again.',
      })
    );
  });

  it.each([400, 403, 404])('shows the %i copy and emits null', async (status) => {
    createMenteeTasks.mockReturnValueOnce(throwError(() => httpError(status, { error: 'upstream text' })));

    await expect(firstValueFrom(service.create(request))).resolves.toBeNull();

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: MENTORSHIP_MENTOR_TASK_CREATE_ERROR_SUMMARY,
        detail: MENTORSHIP_MENTOR_TASK_CREATE_ERROR_MESSAGES[status],
      })
    );
  });

  it("shows the server's message for the impersonation guard's 403", async () => {
    createMenteeTasks.mockReturnValueOnce(
      throwError(() => httpError(403, { error: 'Read-only while impersonating.', code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE }))
    );

    await expect(firstValueFrom(service.create(request))).resolves.toBeNull();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Read-only while impersonating.' }));
  });

  it('shows the fallback for any other failure', async () => {
    createMenteeTasks.mockReturnValueOnce(throwError(() => httpError(503)));

    await expect(firstValueFrom(service.create(request))).resolves.toBeNull();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTOR_TASK_CREATE_ERROR_FALLBACK }));
  });
});
