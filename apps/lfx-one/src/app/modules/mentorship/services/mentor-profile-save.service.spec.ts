// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  ERROR_CODES,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_FALLBACK,
  MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_MESSAGES,
  MENTORSHIP_MENTOR_PROFILE_SAVE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTOR_PROFILE_SAVE_TOAST_LIFE,
} from '@lfx-one/shared/constants';
import { MentorshipMentorProfileUpdateRequest, MentorshipMentorProfileUpdateResponse } from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorProfileSaveService } from './mentor-profile-save.service';

describe('MentorProfileSaveService', () => {
  const request: MentorshipMentorProfileUpdateRequest = { introduction: '<p>Test introduction</p>' };
  const response: MentorshipMentorProfileUpdateResponse = { profile: { aboutMe: '<p>Test introduction</p>', skills: ['Kubernetes'] } };

  let service: MentorProfileSaveService;
  let add: ReturnType<typeof vi.fn>;
  let updateMentorProfile: ReturnType<typeof vi.fn<(body: MentorshipMentorProfileUpdateRequest) => Observable<MentorshipMentorProfileUpdateResponse>>>;

  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  beforeEach(() => {
    add = vi.fn();
    updateMentorProfile = vi.fn(() => of(response));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: { add } },
        { provide: MentorshipMentorService, useValue: { updateMentorProfile } },
      ],
    });

    service = TestBed.inject(MentorProfileSaveService);
  });

  describe('save', () => {
    it('sets saving during the request and clears it on success', () => {
      const pending = new Subject<MentorshipMentorProfileUpdateResponse>();
      updateMentorProfile.mockReturnValueOnce(pending);

      service.save(request).subscribe();
      expect(service.saving()).toBe(true);

      pending.next(response);
      pending.complete();
      expect(service.saving()).toBe(false);
    });

    it('clears saving on error and passes the error on', () => {
      const error = httpError(500);
      updateMentorProfile.mockReturnValueOnce(throwError(() => error));
      let received: unknown;

      service.save(request).subscribe({ error: (err: unknown) => (received = err) });

      expect(received).toBe(error);
      expect(service.saving()).toBe(false);
    });

    it('emits the saved profile and toasts the success only on success', () => {
      let saved: MentorshipMentorProfileUpdateResponse | undefined;
      service.save(request).subscribe((value) => (saved = value));

      expect(updateMentorProfile).toHaveBeenCalledWith(request);
      expect(saved).toEqual(response);
      expect(add).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledWith({ severity: 'success', summary: MENTORSHIP_MENTOR_PROFILE_SAVE_SUCCESS_SUMMARY, life: MENTORSHIP_MENTOR_PROFILE_SAVE_TOAST_LIFE });
    });

    it('does not toast a failure', () => {
      updateMentorProfile.mockReturnValueOnce(throwError(() => httpError(409)));

      service.save(request).subscribe({ error: () => undefined });

      expect(add).not.toHaveBeenCalled();
    });

    it('completes empty and issues no request for a second save while one is in flight', () => {
      const pending = new Subject<MentorshipMentorProfileUpdateResponse>();
      updateMentorProfile.mockReturnValueOnce(pending);
      service.save(request).subscribe();

      let emitted = false;
      let completed = false;
      service.save({ skills: ['Kubernetes'] }).subscribe({ next: () => (emitted = true), complete: () => (completed = true) });

      expect(updateMentorProfile).toHaveBeenCalledTimes(1);
      expect(emitted).toBe(false);
      expect(completed).toBe(true);
      expect(service.saving()).toBe(true);
    });
  });

  describe('errorMessage', () => {
    it('returns the server-authored message for a BFF validation 400', () => {
      const err = httpError(400, { error: 'Add at least one skill.', code: ERROR_CODES.VALIDATION_ERROR });

      expect(service.errorMessage(err)).toBe('Add at least one skill.');
    });

    it('returns the fixed 400 copy for a relayed upstream 400 without a validation code', () => {
      const err = httpError(400, { error: 'update profile failed: 400 Bad Request', code: 'BAD_REQUEST' });

      expect(service.errorMessage(err)).toBe(MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_MESSAGES[400]);
    });

    it.each([404, 409])('returns the fixed copy for a %i', (status) => {
      expect(service.errorMessage(httpError(status, { error: 'composed upstream string' }))).toBe(MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_MESSAGES[status]);
    });

    it('returns the server-authored message for the impersonation 403 and the fallback for a body-less 403', () => {
      const message = 'This action is not available while impersonating a user';

      expect(service.errorMessage(httpError(403, { error: message, code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE }))).toBe(message);
      expect(service.errorMessage(httpError(403))).toBe(MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_FALLBACK);
    });

    it.each([httpError(500, { error: 'Internal server error' }), httpError(0), new Error('boom'), 'boom', null])('returns the fallback for %s', (err) => {
      expect(service.errorMessage(err)).toBe(MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_FALLBACK);
    });
  });
});
