// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
  let messageAdd: ReturnType<typeof vi.fn>;
  let confirm: ReturnType<typeof vi.fn>;
  let confirmationService: ConfirmationService;

  /** Runs the dialog's accept callback, as a click on the confirm button would. */
  const acceptConfirmation = (): void => confirm.mock.calls[confirm.mock.calls.length - 1][0].accept();

  beforeEach(() => {
    resendMeetingInvitation = vi.fn().mockReturnValue(of({ message: 'ok' }));
    messageAdd = vi.fn();
    confirm = vi.fn();
    confirmationService = { confirm } as unknown as ConfirmationService;

    TestBed.configureTestingModule({
      providers: [
        { provide: MeetingService, useValue: { resendMeetingInvitation } },
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
});
