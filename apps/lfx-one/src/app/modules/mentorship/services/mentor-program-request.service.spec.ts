// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK,
  MENTORSHIP_MENTOR_REQUEST_ERROR_MESSAGES,
  MENTORSHIP_MENTOR_REQUEST_ERROR_SUMMARY,
  MENTORSHIP_MENTOR_REQUEST_SUCCESS_SUMMARY,
  MENTORSHIP_MENTOR_REQUESTS_SUCCESS_SUMMARY,
} from '@lfx-one/shared/constants';
import { MentorshipMentorOpenProgram } from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { MessageService } from 'primeng/api';
import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorProgramRequestService } from './mentor-program-request.service';

describe('MentorProgramRequestService', () => {
  const ALPHA: MentorshipMentorOpenProgram = { id: '11111111-1111-4111-8111-111111111111', name: 'Alpha' };
  const BETA: MentorshipMentorOpenProgram = { id: '22222222-2222-4222-8222-222222222222', name: 'Beta' };
  const GAMMA: MentorshipMentorOpenProgram = { id: '33333333-3333-4333-8333-333333333333', name: 'Gamma' };

  let service: MentorProgramRequestService;
  let add: ReturnType<typeof vi.fn>;
  let requestToMentor: ReturnType<typeof vi.fn<(programId: string) => Observable<void>>>;
  let clearMentorCaches: ReturnType<typeof vi.fn>;
  let markProgramUnavailable: ReturnType<typeof vi.fn>;

  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    add = vi.fn();
    requestToMentor = vi.fn(() => of(undefined));
    clearMentorCaches = vi.fn();
    markProgramUnavailable = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: { add } },
        { provide: MentorshipMentorService, useValue: { requestToMentor, clearMentorCaches, markProgramUnavailable } },
      ],
    });

    service = TestBed.inject(MentorProgramRequestService);
  });

  describe('request', () => {
    it('sends the request, toasts success and emits true', async () => {
      await expect(firstValueFrom(service.request(ALPHA))).resolves.toBe(true);

      expect(requestToMentor).toHaveBeenCalledWith(ALPHA.id);
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: MENTORSHIP_MENTOR_REQUEST_SUCCESS_SUMMARY }));
    });

    it.each([404, 409])('shows the %i copy naming the program, re-reads the requests and emits false', async (status) => {
      requestToMentor.mockReturnValueOnce(throwError(() => httpError(status, { error: 'upstream text' })));

      await expect(firstValueFrom(service.request(ALPHA))).resolves.toBe(false);

      expect(add).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          summary: MENTORSHIP_MENTOR_REQUEST_ERROR_SUMMARY,
          detail: `${ALPHA.name}: ${MENTORSHIP_MENTOR_REQUEST_ERROR_MESSAGES[status]}`,
        })
      );
      expect(clearMentorCaches).toHaveBeenCalledTimes(1);
    });

    it('marks the program unavailable on a 404 only, since a 409 program still exists', async () => {
      requestToMentor.mockReturnValueOnce(throwError(() => httpError(404))).mockReturnValueOnce(throwError(() => httpError(409)));

      await firstValueFrom(service.request(ALPHA));
      await firstValueFrom(service.request(BETA));

      expect(markProgramUnavailable).toHaveBeenCalledTimes(1);
      expect(markProgramUnavailable).toHaveBeenCalledWith(ALPHA.id);
    });

    it('shows the server message for the impersonation 403 and keeps the requests', async () => {
      const message = 'This action is not available while impersonating a user';
      requestToMentor.mockReturnValueOnce(throwError(() => httpError(403, { error: message, code: 'IMPERSONATION_READ_ONLY' })));

      await expect(firstValueFrom(service.request(ALPHA))).resolves.toBe(false);

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: `${ALPHA.name}: ${message}` }));
      expect(clearMentorCaches).not.toHaveBeenCalled();
    });

    it.each([0, 400, 500])('shows the fallback for a %i and keeps the requests', async (status) => {
      requestToMentor.mockReturnValueOnce(throwError(() => httpError(status)));

      await expect(firstValueFrom(service.request(ALPHA))).resolves.toBe(false);

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: `${ALPHA.name}: ${MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK}` }));
      expect(clearMentorCaches).not.toHaveBeenCalled();
    });
  });

  describe('requestMany', () => {
    it('sends each request in order and shows one success toast listing them', async () => {
      await expect(firstValueFrom(service.requestMany([ALPHA, BETA]))).resolves.toEqual([ALPHA, BETA]);

      expect(requestToMentor.mock.calls.map(([id]) => id)).toEqual([ALPHA.id, BETA.id]);
      expect(add).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success', summary: MENTORSHIP_MENTOR_REQUESTS_SUCCESS_SUMMARY, detail: 'Alpha, Beta' })
      );
    });

    it('keeps going after a failure, toasting it by name, and emits only the programs sent', async () => {
      requestToMentor.mockImplementation((id) => (id === BETA.id ? throwError(() => httpError(409)) : of(undefined)));

      await expect(firstValueFrom(service.requestMany([ALPHA, BETA, GAMMA]))).resolves.toEqual([ALPHA, GAMMA]);

      expect(requestToMentor).toHaveBeenCalledTimes(3);
      expect(add).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ severity: 'error', detail: `${BETA.name}: ${MENTORSHIP_MENTOR_REQUEST_ERROR_MESSAGES[409]}` })
      );
      expect(add).toHaveBeenNthCalledWith(2, expect.objectContaining({ severity: 'success', detail: 'Alpha, Gamma' }));
    });

    it('shows no success toast when every request fails', async () => {
      requestToMentor.mockReturnValue(throwError(() => httpError(500)));

      await expect(firstValueFrom(service.requestMany([ALPHA, BETA]))).resolves.toEqual([]);

      expect(add).toHaveBeenCalledTimes(2);
      expect(add).not.toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    });

    it('emits an empty list and toasts nothing for no programs', async () => {
      await expect(firstValueFrom(service.requestMany([]))).resolves.toEqual([]);

      expect(requestToMentor).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    });
  });
});
