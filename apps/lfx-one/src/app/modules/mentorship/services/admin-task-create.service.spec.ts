// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_ADMIN_TASK_CREATE_ERROR_FALLBACK,
  MENTORSHIP_ADMIN_TASK_CREATE_ERROR_MESSAGES,
  MENTORSHIP_ADMIN_TASK_CREATE_ERROR_SUMMARY,
  MENTORSHIP_ADMIN_TASK_CREATE_SUCCESS_SUMMARY,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import { MentorshipMentorTaskCreateRequest, MentorshipMentorTaskCreateResponse } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MessageService } from 'primeng/api';
import { firstValueFrom, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminTaskCreateService } from './admin-task-create.service';

describe('AdminTaskCreateService', () => {
  const APPLICATION_ID = '5d1c8e2f-3a4b-4c6d-8e9f-0a1b2c3d4e5f';
  const request: MentorshipMentorTaskCreateRequest = { applicationIds: [APPLICATION_ID], name: 'Read the guide', description: 'Start with chapter one' };

  let service: AdminTaskCreateService;
  let add: ReturnType<typeof vi.fn>;
  let createTasks: ReturnType<typeof vi.fn<(request: MentorshipMentorTaskCreateRequest) => Observable<MentorshipMentorTaskCreateResponse>>>;

  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  beforeEach(() => {
    add = vi.fn();
    createTasks = vi.fn(() => of({ created: [APPLICATION_ID], failed: [] }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: { add } },
        { provide: MentorshipAdminService, useValue: { createTasks } },
      ],
    });

    service = TestBed.inject(AdminTaskCreateService);
  });

  it('creates the task, toasts success and emits true', async () => {
    await expect(firstValueFrom(service.create(request))).resolves.toBe(true);

    expect(createTasks).toHaveBeenCalledWith(request);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: MENTORSHIP_ADMIN_TASK_CREATE_SUCCESS_SUMMARY }));
  });

  it.each([400, 403, 404])('shows the %i copy and emits false', async (status) => {
    createTasks.mockReturnValueOnce(throwError(() => httpError(status, { error: 'upstream text' })));

    await expect(firstValueFrom(service.create(request))).resolves.toBe(false);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: MENTORSHIP_ADMIN_TASK_CREATE_ERROR_SUMMARY,
        detail: MENTORSHIP_ADMIN_TASK_CREATE_ERROR_MESSAGES[status],
      })
    );
  });

  it.each([409, 502])('sends the admin to the mentee row for a %i, which has no copy of its own', async (status) => {
    createTasks.mockReturnValueOnce(throwError(() => httpError(status)));

    await expect(firstValueFrom(service.create(request))).resolves.toBe(false);

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_ADMIN_TASK_CREATE_ERROR_FALLBACK }));
  });

  it('reports the mentee as getting a task from the subscribe until the create settles', () => {
    const response = new Subject<MentorshipMentorTaskCreateResponse>();
    createTasks.mockReturnValueOnce(response);
    const create = service.create(request);

    expect(service.isCreating(APPLICATION_ID)).toBe(false);
    create.subscribe();
    expect(service.isCreating(APPLICATION_ID)).toBe(true);

    response.next({ created: [APPLICATION_ID], failed: [] });
    response.complete();
    expect(service.isCreating(APPLICATION_ID)).toBe(false);
  });

  it('stops reporting the mentee as getting a task once the create fails', async () => {
    createTasks.mockReturnValueOnce(throwError(() => httpError(502)));

    await firstValueFrom(service.create(request));

    expect(service.isCreating(APPLICATION_ID)).toBe(false);
  });

  it("shows the server's message for the impersonation guard's 403", async () => {
    createTasks.mockReturnValueOnce(
      throwError(() => httpError(403, { error: 'Read-only while impersonating.', code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE }))
    );

    await expect(firstValueFrom(service.create(request))).resolves.toBe(false);

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Read-only while impersonating.' }));
  });

  it('treats an application listed as failed as a failure', async () => {
    createTasks.mockReturnValueOnce(of({ created: [], failed: [APPLICATION_ID] }));

    await expect(firstValueFrom(service.create(request))).resolves.toBe(false);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_ADMIN_TASK_CREATE_ERROR_FALLBACK }));
  });
});
