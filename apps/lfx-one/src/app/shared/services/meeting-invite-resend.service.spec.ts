// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MeetingRegistrant } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingInviteResendService } from './meeting-invite-resend.service';

describe('MeetingInviteResendService', () => {
  const MEETING_UID = 'meeting-1';
  const registrant = { uid: 'reg-1', email: 'jane@guest.example', first_name: 'Jane', last_name: 'Doe' } as MeetingRegistrant;

  let service: MeetingInviteResendService;
  let resendMeetingInvitation: ReturnType<typeof vi.fn>;
  let resendMyMeetingInvitation: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;
  let confirm: ReturnType<typeof vi.fn>;
  let confirmationService: ConfirmationService;

  /** Runs the dialog's accept callback, as a click on the confirm button would. */
  const acceptConfirmation = (): void => confirm.mock.calls[confirm.mock.calls.length - 1][0].accept();

  beforeEach(() => {
    resendMeetingInvitation = vi.fn().mockReturnValue(of({ message: 'ok' }));
    resendMyMeetingInvitation = vi.fn().mockReturnValue(of({ message: 'ok' }));
    messageAdd = vi.fn();
    confirm = vi.fn();
    confirmationService = { confirm } as unknown as ConfirmationService;

    TestBed.configureTestingModule({
      providers: [
        { provide: MeetingService, useValue: { resendMeetingInvitation, resendMyMeetingInvitation } },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    });
    service = TestBed.inject(MeetingInviteResendService);
  });

  describe('canResend', () => {
    it('allows a saved registrant', () => {
      expect(service.canResend({ uid: 'reg-1' })).toBe(true);
    });

    it.each([
      ['an empty uid', ''],
      ['a missing uid', undefined],
      ['an optimistic uid', 'optimistic-123'],
    ])('rejects %s', (_label, uid) => {
      expect(service.canResend({ uid } as Pick<MeetingRegistrant, 'uid'>)).toBe(false);
    });
  });

  describe('confirmAndResend', () => {
    it('does not open the dialog for a registrant that is not saved', () => {
      service.confirmAndResend(confirmationService, MEETING_UID, { ...registrant, uid: 'optimistic-1' });

      expect(confirm).not.toHaveBeenCalled();
    });

    it('does not send until the organizer accepts', () => {
      service.confirmAndResend(confirmationService, MEETING_UID, registrant);

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(resendMeetingInvitation).not.toHaveBeenCalled();
    });

    it('resends to the registrant and shows a success toast once accepted', () => {
      service.confirmAndResend(confirmationService, MEETING_UID, registrant);
      acceptConfirmation();

      expect(resendMeetingInvitation).toHaveBeenCalledWith(MEETING_UID, 'reg-1');
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: 'Invitation resent to jane@guest.example' }));
      expect(service.isResending('reg-1')).toBe(false);
    });

    it('tracks the in-flight send and ignores a second request until it settles', () => {
      const inFlight = new Subject<{ message: string }>();
      resendMeetingInvitation.mockReturnValue(inFlight);

      service.confirmAndResend(confirmationService, MEETING_UID, registrant);
      acceptConfirmation();
      expect(service.isResending('reg-1')).toBe(true);

      service.confirmAndResend(confirmationService, MEETING_UID, registrant);
      expect(confirm).toHaveBeenCalledTimes(1);

      inFlight.next({ message: 'ok' });
      inFlight.complete();
      expect(service.isResending('reg-1')).toBe(false);
    });

    it('shows the BFF error reason when the resend fails', () => {
      resendMeetingInvitation.mockReturnValue(throwError(() => ({ error: { error: 'Insufficient permissions', code: 'AUTHORIZATION_ERROR' } })));

      service.confirmAndResend(confirmationService, MEETING_UID, registrant);
      acceptConfirmation();

      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Insufficient permissions' }));
      expect(service.isResending('reg-1')).toBe(false);
    });

    it('falls back to a generic message when the error carries no reason', () => {
      resendMeetingInvitation.mockReturnValue(throwError(() => new Error('network down')));

      service.confirmAndResend(confirmationService, MEETING_UID, registrant);
      acceptConfirmation();

      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Failed to resend invitation. Please try again.' }));
    });
  });

  describe('resendOwn', () => {
    it("resends to the viewer's own registration, keyed by meeting only, and shows a success toast", () => {
      service.resendOwn(MEETING_UID);

      expect(resendMyMeetingInvitation).toHaveBeenCalledWith(MEETING_UID, undefined);
      expect(resendMeetingInvitation).not.toHaveBeenCalled();
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Invitation Sent' }));
      expect(service.isResendingOwn(MEETING_UID)).toBe(false);
    });

    it('passes the occurrence being viewed through to the request', () => {
      service.resendOwn(MEETING_UID, '1700000000');

      expect(resendMyMeetingInvitation).toHaveBeenCalledWith(MEETING_UID, '1700000000');
    });

    it('does not ask for confirmation', () => {
      service.resendOwn(MEETING_UID);

      expect(confirm).not.toHaveBeenCalled();
    });

    it('ignores an empty meeting id', () => {
      service.resendOwn('');

      expect(resendMyMeetingInvitation).not.toHaveBeenCalled();
      expect(service.isResendingOwn('')).toBe(false);
      expect(service.isResendingOwn(undefined)).toBe(false);
    });

    it('tracks the in-flight send per meeting and ignores a second request for it until it settles', () => {
      const inFlight = new Subject<{ message: string }>();
      resendMyMeetingInvitation.mockReturnValueOnce(inFlight);

      service.resendOwn(MEETING_UID);
      expect(service.isResendingOwn(MEETING_UID)).toBe(true);
      expect(service.isResendingOwn('meeting-2')).toBe(false);

      service.resendOwn(MEETING_UID);
      expect(resendMyMeetingInvitation).toHaveBeenCalledTimes(1);

      service.resendOwn('meeting-2');
      expect(resendMyMeetingInvitation).toHaveBeenCalledTimes(2);

      inFlight.next({ message: 'ok' });
      inFlight.complete();
      expect(service.isResendingOwn(MEETING_UID)).toBe(false);
    });

    it('does not share in-flight state with the organizer flow, which is keyed by registrant', () => {
      const inFlight = new Subject<{ message: string }>();
      resendMyMeetingInvitation.mockReturnValueOnce(inFlight);

      service.resendOwn('reg-1');

      expect(service.isResending('reg-1')).toBe(false);
    });

    it('shows the BFF message for a validation failure', () => {
      resendMyMeetingInvitation.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'VALIDATION_ERROR', error: 'Unable to determine your identity' } }))
      );

      service.resendOwn(MEETING_UID);

      expect(messageAdd).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', detail: expect.stringContaining('Unable to determine your identity') })
      );
      expect(service.isResendingOwn(MEETING_UID)).toBe(false);
    });

    it.each([403, 404, 500])('shows generic copy for a %s rather than the upstream detail, and lets the viewer retry', (status) => {
      resendMyMeetingInvitation.mockReturnValue(throwError(() => new HttpErrorResponse({ status, error: { code: 'ERROR', error: 'upstream detail' } })));

      service.resendOwn(MEETING_UID);

      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Unable to resend the invitation. Please try again.' }));
      expect(service.isResendingOwn(MEETING_UID)).toBe(false);
    });
  });
});
