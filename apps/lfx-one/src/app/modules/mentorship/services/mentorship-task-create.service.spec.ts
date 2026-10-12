// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_TASK_CREATE_ERROR_FALLBACK,
  MENTORSHIP_TASK_CREATE_ERROR_MESSAGES,
  MENTORSHIP_TASK_CREATE_ERROR_SUMMARY,
  MENTORSHIP_TASK_CREATE_MAX_APPLICATIONS,
  MENTORSHIP_TASK_CREATE_PARTIAL_SUMMARY,
  MENTORSHIP_TASK_CREATE_SUCCESS_SUMMARY,
} from '@lfx-one/shared/constants';
import { MentorshipTaskCreateRequest, MentorshipTaskCreateResponse } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService } from 'primeng/api';
import { firstValueFrom, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipTaskCreateService } from './mentorship-task-create.service';

describe('MentorshipTaskCreateService', () => {
  const APPLICATION_ID = '5d1c8e2f-3a4b-4c6d-8e9f-0a1b2c3d4e5f';
  const OTHER_APPLICATION_ID = '7a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d';
  const request: MentorshipTaskCreateRequest = { applicationIds: [APPLICATION_ID], name: 'Write a design doc', description: 'One page.' };

  let service: MentorshipTaskCreateService;
  let add: ReturnType<typeof vi.fn>;
  let createTasks: ReturnType<typeof vi.fn<(request: MentorshipTaskCreateRequest) => Observable<MentorshipTaskCreateResponse>>>;

  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  beforeEach(() => {
    add = vi.fn();
    createTasks = vi.fn(() => of({ created: [APPLICATION_ID], failed: [] }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: { add } },
        { provide: MentorshipService, useValue: { createTasks } },
      ],
    });

    service = TestBed.inject(MentorshipTaskCreateService);
  });

  it('creates the task, toasts success and emits the result', async () => {
    await expect(firstValueFrom(service.create(request))).resolves.toEqual({ created: [APPLICATION_ID], failed: [] });

    expect(createTasks).toHaveBeenCalledWith(request);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: MENTORSHIP_TASK_CREATE_SUCCESS_SUMMARY, detail: undefined }));
  });

  it('names how many mentees a group task reached', async () => {
    createTasks.mockReturnValueOnce(of({ created: [APPLICATION_ID, OTHER_APPLICATION_ID], failed: [] }));

    await firstValueFrom(service.create({ ...request, applicationIds: [APPLICATION_ID, OTHER_APPLICATION_ID] }));

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: '2 mentees were given the task.' }));
  });

  it('warns when only some of a group were given the task, naming the missed mentees', async () => {
    createTasks.mockReturnValueOnce(of({ created: [APPLICATION_ID], failed: [OTHER_APPLICATION_ID] }));
    const names = { [APPLICATION_ID]: 'Ada Lovelace', [OTHER_APPLICATION_ID]: 'Grace Hopper' };

    await expect(firstValueFrom(service.create(request, names))).resolves.toEqual({ created: [APPLICATION_ID], failed: [OTHER_APPLICATION_ID] });

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warn',
        summary: MENTORSHIP_TASK_CREATE_PARTIAL_SUMMARY,
        detail: 'Grace Hopper did not get the task. Check their row, and create it there if it is still missing, so the others do not get it twice.',
      })
    );
  });

  it('counts the missed mentees when a name is not known', async () => {
    createTasks.mockReturnValueOnce(of({ created: [APPLICATION_ID], failed: [OTHER_APPLICATION_ID] }));

    await firstValueFrom(service.create(request));

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warn',
        detail: '1 of 2 mentees did not get the task. Check their row, and create it there if it is still missing, so the others do not get it twice.',
      })
    );
  });

  it('shows an error when none of a group was given the task', async () => {
    createTasks.mockReturnValueOnce(of({ created: [], failed: [APPLICATION_ID, OTHER_APPLICATION_ID] }));

    await firstValueFrom(service.create(request));

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: MENTORSHIP_TASK_CREATE_ERROR_SUMMARY,
        detail: "2 of 2 tasks were not created. Check the mentees' rows before trying again.",
      })
    );
  });

  describe('a group past the request cap', () => {
    const ids = Array.from({ length: MENTORSHIP_TASK_CREATE_MAX_APPLICATIONS + 2 }, (_, index) => `app_${index}`);
    const firstBatch = ids.slice(0, MENTORSHIP_TASK_CREATE_MAX_APPLICATIONS);
    const lastBatch = ids.slice(MENTORSHIP_TASK_CREATE_MAX_APPLICATIONS);

    it('sends it in batches and merges the results', async () => {
      createTasks.mockImplementation(({ applicationIds }) => of({ created: applicationIds, failed: [] }));

      await expect(firstValueFrom(service.create({ ...request, applicationIds: ids }))).resolves.toEqual({ created: ids, failed: [] });

      expect(createTasks.mock.calls.map(([sent]) => sent.applicationIds)).toEqual([firstBatch, lastBatch]);
      expect(add).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: `${ids.length} mentees were given the task.` }));
    });

    it("counts a failed batch's mentees as failed and keeps going", async () => {
      createTasks
        .mockReturnValueOnce(throwError(() => httpError(503)))
        .mockImplementationOnce(({ applicationIds }) => of({ created: applicationIds, failed: [] }));

      await expect(firstValueFrom(service.create({ ...request, applicationIds: ids }))).resolves.toEqual({ created: lastBatch, failed: firstBatch });

      expect(add).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: MENTORSHIP_TASK_CREATE_PARTIAL_SUMMARY }));
    });

    it("stops at the impersonation guard's 403 and shows the server's message", async () => {
      createTasks.mockReturnValue(
        throwError(() => httpError(403, { error: 'Read-only while impersonating.', code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE }))
      );

      await expect(firstValueFrom(service.create({ ...request, applicationIds: ids }))).resolves.toBeNull();

      expect(createTasks).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Read-only while impersonating.' }));
    });
  });

  it.each([400, 403, 404])('shows the %i copy and emits null', async (status) => {
    createTasks.mockReturnValueOnce(throwError(() => httpError(status, { error: 'upstream text' })));

    await expect(firstValueFrom(service.create(request))).resolves.toBeNull();

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: MENTORSHIP_TASK_CREATE_ERROR_SUMMARY,
        detail: MENTORSHIP_TASK_CREATE_ERROR_MESSAGES[status],
      })
    );
  });

  it("shows the server's message for the impersonation guard's 403", async () => {
    createTasks.mockReturnValueOnce(
      throwError(() => httpError(403, { error: 'Read-only while impersonating.', code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE }))
    );

    await expect(firstValueFrom(service.create(request))).resolves.toBeNull();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Read-only while impersonating.' }));
  });

  it('shows the fallback for any other failure', async () => {
    createTasks.mockReturnValueOnce(throwError(() => httpError(503)));

    await expect(firstValueFrom(service.create(request))).resolves.toBeNull();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_TASK_CREATE_ERROR_FALLBACK }));
  });

  it('shows the fallback when the one application is listed as failed', async () => {
    createTasks.mockReturnValueOnce(of({ created: [], failed: [APPLICATION_ID] }));

    await expect(firstValueFrom(service.create(request))).resolves.toEqual({ created: [], failed: [APPLICATION_ID] });

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_TASK_CREATE_ERROR_FALLBACK }));
  });

  it('reports the mentees as getting a task from the subscribe until the create settles', () => {
    const response = new Subject<MentorshipTaskCreateResponse>();
    createTasks.mockReturnValueOnce(response);
    const create = service.create({ ...request, applicationIds: [APPLICATION_ID, OTHER_APPLICATION_ID] });

    expect(service.isCreating(APPLICATION_ID)).toBe(false);
    create.subscribe();
    expect(service.isCreating(APPLICATION_ID)).toBe(true);
    expect(service.isCreating(OTHER_APPLICATION_ID)).toBe(true);

    response.next({ created: [APPLICATION_ID, OTHER_APPLICATION_ID], failed: [] });
    response.complete();
    expect(service.isCreating(APPLICATION_ID)).toBe(false);
    expect(service.isCreating(OTHER_APPLICATION_ID)).toBe(false);
  });

  it('stops reporting the mentee as getting a task once the create fails', async () => {
    createTasks.mockReturnValueOnce(throwError(() => httpError(502)));

    await firstValueFrom(service.create(request));

    expect(service.isCreating(APPLICATION_ID)).toBe(false);
  });
});
