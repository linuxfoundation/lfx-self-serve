// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MeetingService } from '@services/meeting.service';
import { firstValueFrom, of, Subject, throwError, toArray } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingOwnInviteResendService } from './meeting-own-invite-resend.service';

describe('MeetingOwnInviteResendService', () => {
  const MEETING_UID = 'meeting-1';

  let service: MeetingOwnInviteResendService;
  let resendMyMeetingInvitation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resendMyMeetingInvitation = vi.fn().mockReturnValue(of({ message: 'ok' }));

    // No MessageService provided: the service must not need PrimeNG.
    TestBed.configureTestingModule({
      providers: [{ provide: MeetingService, useValue: { resendMyMeetingInvitation } }],
    });
    service = TestBed.inject(MeetingOwnInviteResendService);
  });

  describe('resendOwn$', () => {
    it('resends for the occurrence and clears the in-flight state once it settles', async () => {
      const result = await firstValueFrom(service.resendOwn$(MEETING_UID, '1700000000'));

      expect(result).toEqual({ message: 'ok' });
      expect(resendMyMeetingInvitation).toHaveBeenCalledWith(MEETING_UID, '1700000000');
      expect(service.isResendingOwn(MEETING_UID)).toBe(false);
    });

    it('sends nothing until subscribed', () => {
      service.resendOwn$(MEETING_UID);

      expect(resendMyMeetingInvitation).not.toHaveBeenCalled();
      expect(service.isResendingOwn(MEETING_UID)).toBe(false);
    });

    it('tracks the in-flight send per meeting', () => {
      const inFlight = new Subject<{ message: string }>();
      resendMyMeetingInvitation.mockReturnValueOnce(inFlight);

      service.resendOwn$(MEETING_UID).subscribe();
      expect(service.isResendingOwn(MEETING_UID)).toBe(true);
      expect(service.isResendingOwn('meeting-2')).toBe(false);

      inFlight.next({ message: 'ok' });
      inFlight.complete();
      expect(service.isResendingOwn(MEETING_UID)).toBe(false);
    });

    it('completes without a request for an empty id or while a send for the meeting is in flight', async () => {
      resendMyMeetingInvitation.mockReturnValueOnce(new Subject<{ message: string }>());
      service.resendOwn$(MEETING_UID).subscribe();

      expect(await firstValueFrom(service.resendOwn$(MEETING_UID).pipe(toArray()))).toEqual([]);
      expect(await firstValueFrom(service.resendOwn$('').pipe(toArray()))).toEqual([]);
      expect(resendMyMeetingInvitation).toHaveBeenCalledTimes(1);
      expect(service.isResendingOwn('')).toBe(false);
      expect(service.isResendingOwn(undefined)).toBe(false);
    });

    it('errors with the HTTP error and clears the in-flight state', async () => {
      const failure = new HttpErrorResponse({ status: 500 });
      resendMyMeetingInvitation.mockReturnValue(throwError(() => failure));

      const error = await firstValueFrom(service.resendOwn$(MEETING_UID)).catch((caught: unknown) => caught);

      expect(error).toBe(failure);
      expect(service.isResendingOwn(MEETING_UID)).toBe(false);
    });
  });

  describe('describeOwnResendFailure', () => {
    it('tells the viewer to wait on a 429, in fixed words rather than the server detail', () => {
      const error = new HttpErrorResponse({ status: 429, error: { code: 'RATE_LIMITED', error: 'limiter detail that should not be shown' } });

      expect(service.describeOwnResendFailure(error)).toBe('You have resent your invitation too many times. Please try again later.');
    });

    it('shows the BFF message for a validation failure', () => {
      const error = new HttpErrorResponse({ status: 400, error: { code: 'VALIDATION_ERROR', error: 'Unable to determine your identity' } });

      expect(service.describeOwnResendFailure(error)).toContain('Unable to determine your identity');
    });

    it.each([403, 404, 500])('shows generic copy for a %s rather than the upstream detail', (status) => {
      const error = new HttpErrorResponse({ status, error: { code: 'ERROR', error: 'upstream detail' } });

      expect(service.describeOwnResendFailure(error)).toBe('Unable to resend the invitation. Please try again.');
    });
  });
});
