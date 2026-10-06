// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_ADMIN_TASK_UPDATE_ERROR_FALLBACK,
  MENTORSHIP_ADMIN_TASK_UPDATE_ERROR_MESSAGES,
  MENTORSHIP_ADMIN_TASK_UPDATE_ERROR_SUMMARY,
  MENTORSHIP_ADMIN_TASK_UPDATE_SUCCESS_SUMMARY,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import { MentorshipAdminTaskUpdate, MentorshipApplicantTask } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MessageService } from 'primeng/api';
import { firstValueFrom, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminTaskUpdateService } from './admin-task-update.service';

describe('AdminTaskUpdateService', () => {
  const TASK_ID = '7e2d9f30-4b5c-4d7e-9f01-1b2c3d4e5f60';
  const body: MentorshipAdminTaskUpdate = { status: 'completed' };
  const saved: MentorshipApplicantTask = {
    id: TASK_ID,
    name: 'Read the guide',
    description: 'Start with chapter one',
    prerequisite: false,
    status: 'completed',
    createdOn: '2026-05-14',
    updatedOn: '2026-10-06',
  };

  let service: AdminTaskUpdateService;
  let add: ReturnType<typeof vi.fn>;
  let updateTask: ReturnType<typeof vi.fn<(taskId: string, body: MentorshipAdminTaskUpdate) => Observable<MentorshipApplicantTask>>>;

  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  beforeEach(() => {
    add = vi.fn();
    updateTask = vi.fn(() => of(saved));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: { add } },
        { provide: MentorshipAdminService, useValue: { updateTask } },
      ],
    });

    service = TestBed.inject(AdminTaskUpdateService);
  });

  it('saves the change and emits the task as saved, without a toast for a status change', async () => {
    await expect(firstValueFrom(service.update(TASK_ID, body, false))).resolves.toEqual(saved);

    expect(updateTask).toHaveBeenCalledWith(TASK_ID, body);
    expect(add).not.toHaveBeenCalled();
  });

  it('toasts success after an edit', async () => {
    await expect(firstValueFrom(service.update(TASK_ID, { name: 'Read the new guide' }, true))).resolves.toEqual(saved);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: MENTORSHIP_ADMIN_TASK_UPDATE_SUCCESS_SUMMARY }));
  });

  it.each([400, 403, 404])('shows the %i copy and emits null', async (status) => {
    updateTask.mockReturnValueOnce(throwError(() => httpError(status, { error: 'upstream text' })));

    await expect(firstValueFrom(service.update(TASK_ID, { status: 'submitted' }, false))).resolves.toBeNull();

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: MENTORSHIP_ADMIN_TASK_UPDATE_ERROR_SUMMARY,
        detail: MENTORSHIP_ADMIN_TASK_UPDATE_ERROR_MESSAGES[status],
      })
    );
  });

  it('shows the file copy for a 400 on a change to the file requirement', async () => {
    updateTask.mockReturnValueOnce(throwError(() => httpError(400)));

    await firstValueFrom(service.update(TASK_ID, { requiresFileSubmission: true }, true));

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_ADMIN_TASK_UPDATE_ERROR_MESSAGES[400] }));
  });

  it.each<MentorshipAdminTaskUpdate>([{ status: 'completed' }, { name: 'Read the new guide' }])(
    'shows the generic copy for a 400 on a change that cannot trip the file guard (%o)',
    async (change) => {
      updateTask.mockReturnValueOnce(throwError(() => httpError(400)));

      await firstValueFrom(service.update(TASK_ID, change, false));

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_ADMIN_TASK_UPDATE_ERROR_FALLBACK }));
    }
  );

  it.each([409, 502])('shows the generic copy for a %i, which has none of its own', async (status) => {
    updateTask.mockReturnValueOnce(throwError(() => httpError(status)));

    await expect(firstValueFrom(service.update(TASK_ID, body, false))).resolves.toBeNull();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_ADMIN_TASK_UPDATE_ERROR_FALLBACK }));
  });

  it("shows the server's message for the impersonation guard's 403", async () => {
    updateTask.mockReturnValueOnce(
      throwError(() => httpError(403, { error: 'Read-only while impersonating.', code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE }))
    );

    await expect(firstValueFrom(service.update(TASK_ID, body, false))).resolves.toBeNull();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Read-only while impersonating.' }));
  });

  it('reports the task as being saved from the subscribe until the save settles', () => {
    const response = new Subject<MentorshipApplicantTask>();
    updateTask.mockReturnValueOnce(response);
    const update = service.update(TASK_ID, body, false);

    expect(service.isUpdating(TASK_ID)).toBe(false);
    update.subscribe();
    expect(service.isUpdating(TASK_ID)).toBe(true);

    response.next(saved);
    response.complete();
    expect(service.isUpdating(TASK_ID)).toBe(false);
  });

  it('stops reporting the task as being saved once the save fails', async () => {
    updateTask.mockReturnValueOnce(throwError(() => httpError(502)));

    await firstValueFrom(service.update(TASK_ID, body, false));

    expect(service.isUpdating(TASK_ID)).toBe(false);
  });
});
