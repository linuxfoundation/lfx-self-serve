// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  ERROR_CODES,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_FALLBACK,
  MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_MESSAGES,
  MENTORSHIP_MENTEE_PROFILE_SAVE_TOAST_LIFE,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeProfileUpdateRequest, MentorshipMenteeProfileUpdateResponse } from '@lfx-one/shared/interfaces';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeProfileSaveService } from './mentee-profile-save.service';

describe('MenteeProfileSaveService', () => {
  const request: MentorshipMenteeProfileUpdateRequest = { introduction: 'Test introduction' };
  const response: MentorshipMenteeProfileUpdateResponse = { profile: { aboutMe: '<p>Test introduction</p>', skillsHave: ['Go'], skillsWant: ['Rust'] } };

  let service: MenteeProfileSaveService;
  let add: ReturnType<typeof vi.fn>;
  let updateMenteeProfile: ReturnType<typeof vi.fn<(body: MentorshipMenteeProfileUpdateRequest) => Observable<MentorshipMenteeProfileUpdateResponse>>>;

  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  beforeEach(() => {
    add = vi.fn();
    updateMenteeProfile = vi.fn(() => of(response));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: { add } },
        { provide: MentorshipMenteeService, useValue: { updateMenteeProfile } },
      ],
    });

    service = TestBed.inject(MenteeProfileSaveService);
  });

  describe('save', () => {
    it('sets saving during the request and clears it on success', () => {
      const pending = new Subject<MentorshipMenteeProfileUpdateResponse>();
      updateMenteeProfile.mockReturnValueOnce(pending);

      service.save(request, 'Profile updated').subscribe();
      expect(service.saving()).toBe(true);

      pending.next(response);
      pending.complete();
      expect(service.saving()).toBe(false);
    });

    it('clears saving on error and passes the error on', () => {
      const error = httpError(500);
      updateMenteeProfile.mockReturnValueOnce(throwError(() => error));
      let received: unknown;

      service.save(request, 'Profile updated').subscribe({ error: (err: unknown) => (received = err) });

      expect(received).toBe(error);
      expect(service.saving()).toBe(false);
    });

    it('emits the saved profile and toasts the success summary only on success', () => {
      let saved: MentorshipMenteeProfileUpdateResponse | undefined;
      service.save(request, 'Profile updated').subscribe((value) => (saved = value));

      expect(updateMenteeProfile).toHaveBeenCalledWith(request);
      expect(saved).toEqual(response);
      expect(add).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledWith({ severity: 'success', summary: 'Profile updated', life: MENTORSHIP_MENTEE_PROFILE_SAVE_TOAST_LIFE });
    });

    it('does not toast a failure', () => {
      updateMenteeProfile.mockReturnValueOnce(throwError(() => httpError(409)));

      service.save(request, 'Profile updated').subscribe({ error: () => undefined });

      expect(add).not.toHaveBeenCalled();
    });

    it('completes empty and issues no request for a second save while one is in flight', () => {
      const pending = new Subject<MentorshipMenteeProfileUpdateResponse>();
      updateMenteeProfile.mockReturnValueOnce(pending);
      service.save(request, 'Profile updated').subscribe();

      let emitted = false;
      let completed = false;
      service.save(request, 'Demographics updated').subscribe({ next: () => (emitted = true), complete: () => (completed = true) });

      expect(updateMenteeProfile).toHaveBeenCalledTimes(1);
      expect(emitted).toBe(false);
      expect(completed).toBe(true);
      expect(service.saving()).toBe(true);
    });
  });

  describe('errorMessage', () => {
    it('returns the server-authored message for a BFF validation 400', () => {
      const err = httpError(400, { error: 'introduction must be a string', code: ERROR_CODES.VALIDATION_ERROR });

      expect(service.errorMessage(err)).toBe('introduction must be a string');
    });

    it('returns the fixed 400 copy for a relayed upstream 400 without a validation code', () => {
      const err = httpError(400, { error: 'update profile failed: 400 Bad Request', code: 'BAD_REQUEST' });

      expect(service.errorMessage(err)).toBe(MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_MESSAGES[400]);
    });

    it.each([404, 409])('returns the fixed copy for a %i', (status) => {
      expect(service.errorMessage(httpError(status, { error: 'composed upstream string' }))).toBe(MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_MESSAGES[status]);
    });

    it('returns the server-authored message for the impersonation 403 and the fallback for a body-less 403', () => {
      const message = 'This action is not available while impersonating a user';

      expect(service.errorMessage(httpError(403, { error: message, code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE }))).toBe(message);
      expect(service.errorMessage(httpError(403))).toBe(MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_FALLBACK);
    });

    it.each([httpError(500, { error: 'Internal server error' }), httpError(0), new Error('boom'), 'boom', null])('returns the fallback for %s', (err) => {
      expect(service.errorMessage(err)).toBe(MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_FALLBACK);
    });
  });
});
