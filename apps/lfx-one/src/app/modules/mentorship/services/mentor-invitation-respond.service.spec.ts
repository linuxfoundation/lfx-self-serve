// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_MENTOR_INVITATION_ACCEPT_SUCCESS_SUMMARY,
  MENTORSHIP_MENTOR_INVITATION_DECLINE_CONFIRM_HEADER,
  MENTORSHIP_MENTOR_INVITATION_DECLINE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTOR_INVITATION_STALE_ERROR_MESSAGES,
  MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK,
} from '@lfx-one/shared/constants';
import { MentorshipMentorInviteDecision } from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorInvitationRespondService } from './mentor-invitation-respond.service';

describe('MentorInvitationRespondService', () => {
  const INVITATION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

  let service: MentorInvitationRespondService;
  let confirm: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;
  let respondToMentorInvitation: ReturnType<typeof vi.fn<(id: string, decision: MentorshipMentorInviteDecision) => Observable<void>>>;
  let clearMentorCaches: ReturnType<typeof vi.fn>;

  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  /** Confirms the dialog the last `confirmDecline` raised. */
  const confirmDialog = () => {
    const confirmation = confirm.mock.calls.at(-1)?.[0] as Confirmation;
    confirmation.accept?.();
  };

  beforeEach(() => {
    confirm = vi.fn();
    add = vi.fn();
    respondToMentorInvitation = vi.fn(() => of(undefined));
    clearMentorCaches = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        MentorInvitationRespondService,
        { provide: ConfirmationService, useValue: { confirm } },
        { provide: MessageService, useValue: { add } },
        { provide: MentorshipMentorService, useValue: { respondToMentorInvitation, clearMentorCaches } },
      ],
    });

    service = TestBed.inject(MentorInvitationRespondService);
  });

  it('accepts at once, without a confirmation, and toasts success without clearing the cache itself', () => {
    service.accept(INVITATION_ID);

    expect(confirm).not.toHaveBeenCalled();
    expect(respondToMentorInvitation).toHaveBeenCalledWith(INVITATION_ID, 'accept');
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: MENTORSHIP_MENTOR_INVITATION_ACCEPT_SUCCESS_SUMMARY }));
    // The data service already drops the cache on success.
    expect(clearMentorCaches).not.toHaveBeenCalled();
    expect(service.respondingId()).toBeNull();
  });

  it('asks for confirmation and declines nothing until the mentor confirms', () => {
    service.confirmDecline(INVITATION_ID);

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ header: MENTORSHIP_MENTOR_INVITATION_DECLINE_CONFIRM_HEADER }));
    expect(respondToMentorInvitation).not.toHaveBeenCalled();

    confirmDialog();

    expect(respondToMentorInvitation).toHaveBeenCalledWith(INVITATION_ID, 'decline');
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: MENTORSHIP_MENTOR_INVITATION_DECLINE_SUCCESS_SUMMARY }));
  });

  it('marks the invitation busy while the answer is in flight and ignores another one', () => {
    const pending = new Subject<void>();
    respondToMentorInvitation.mockReturnValueOnce(pending);

    service.accept(INVITATION_ID);
    expect(service.respondingId()).toBe(INVITATION_ID);

    service.accept('another-invitation');
    service.confirmDecline('another-invitation');
    expect(respondToMentorInvitation).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();

    pending.next();
    pending.complete();
    expect(service.respondingId()).toBeNull();
  });

  it.each([404, 409])('shows the stale copy for a %i and re-reads the requests', (status) => {
    respondToMentorInvitation.mockReturnValueOnce(throwError(() => httpError(status, { error: 'upstream text' })));

    service.accept(INVITATION_ID);

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTOR_INVITATION_STALE_ERROR_MESSAGES[status] }));
    expect(clearMentorCaches).toHaveBeenCalledTimes(1);
    expect(service.respondingId()).toBeNull();
  });

  it('shows the server message for the impersonation 403 and keeps the requests', () => {
    const message = 'This action is not available while impersonating a user';
    respondToMentorInvitation.mockReturnValueOnce(throwError(() => httpError(403, { error: message, code: 'IMPERSONATION_READ_ONLY' })));

    service.accept(INVITATION_ID);

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: message }));
    expect(clearMentorCaches).not.toHaveBeenCalled();
  });

  it.each([0, 403, 500, 502])('shows the fallback for a %i and keeps the requests', (status) => {
    respondToMentorInvitation.mockReturnValueOnce(throwError(() => httpError(status)));

    service.confirmDecline(INVITATION_ID);
    confirmDialog();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK }));
    expect(clearMentorCaches).not.toHaveBeenCalled();
  });
});
