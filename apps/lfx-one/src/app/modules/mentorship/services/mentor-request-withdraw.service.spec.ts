// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK,
  MENTORSHIP_MENTOR_WITHDRAW_CONFIRM_HEADER,
  MENTORSHIP_MENTOR_WITHDRAW_STALE_ERROR_MESSAGES,
  MENTORSHIP_MENTOR_WITHDRAW_SUCCESS_SUMMARY,
} from '@lfx-one/shared/constants';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorRequestWithdrawService } from './mentor-request-withdraw.service';

describe('MentorRequestWithdrawService', () => {
  const REQUEST_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

  let service: MentorRequestWithdrawService;
  let confirm: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;
  let withdrawMentorRequest: ReturnType<typeof vi.fn<(id: string) => Observable<void>>>;
  let clearMentorCaches: ReturnType<typeof vi.fn>;

  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  /** Confirms the dialog the last `confirmWithdraw` raised. */
  const accept = () => {
    const confirmation = confirm.mock.calls.at(-1)?.[0] as Confirmation;
    confirmation.accept?.();
  };

  beforeEach(() => {
    confirm = vi.fn();
    add = vi.fn();
    withdrawMentorRequest = vi.fn(() => of(undefined));
    clearMentorCaches = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        MentorRequestWithdrawService,
        { provide: ConfirmationService, useValue: { confirm } },
        { provide: MessageService, useValue: { add } },
        { provide: MentorshipMentorService, useValue: { withdrawMentorRequest, clearMentorCaches } },
      ],
    });

    service = TestBed.inject(MentorRequestWithdrawService);
  });

  it('asks for confirmation and withdraws nothing until the mentor accepts', () => {
    service.confirmWithdraw(REQUEST_ID);

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ header: MENTORSHIP_MENTOR_WITHDRAW_CONFIRM_HEADER }));
    expect(withdrawMentorRequest).not.toHaveBeenCalled();
  });

  it('withdraws on accept and toasts success without clearing the cache itself', () => {
    service.confirmWithdraw(REQUEST_ID);
    accept();

    expect(withdrawMentorRequest).toHaveBeenCalledWith(REQUEST_ID);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: MENTORSHIP_MENTOR_WITHDRAW_SUCCESS_SUMMARY }));
    // The data service already drops the cache on success.
    expect(clearMentorCaches).not.toHaveBeenCalled();
    expect(service.withdrawingId()).toBeNull();
  });

  it('marks the request busy while the withdraw is in flight and ignores a second one', () => {
    const pending = new Subject<void>();
    withdrawMentorRequest.mockReturnValueOnce(pending);

    service.confirmWithdraw(REQUEST_ID);
    accept();
    expect(service.withdrawingId()).toBe(REQUEST_ID);

    service.confirmWithdraw('another-request');
    expect(confirm).toHaveBeenCalledTimes(1);

    pending.next();
    pending.complete();
    expect(service.withdrawingId()).toBeNull();
  });

  it.each([404, 409])('shows the stale copy for a %i and re-reads the requests', (status) => {
    withdrawMentorRequest.mockReturnValueOnce(throwError(() => httpError(status, { error: 'upstream text' })));

    service.confirmWithdraw(REQUEST_ID);
    accept();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTOR_WITHDRAW_STALE_ERROR_MESSAGES[status] }));
    expect(clearMentorCaches).toHaveBeenCalledTimes(1);
    expect(service.withdrawingId()).toBeNull();
  });

  it('shows the server message for the impersonation 403 and keeps the requests', () => {
    const message = 'This action is not available while impersonating a user';
    withdrawMentorRequest.mockReturnValueOnce(throwError(() => httpError(403, { error: message, code: 'IMPERSONATION_READ_ONLY' })));

    service.confirmWithdraw(REQUEST_ID);
    accept();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: message }));
    expect(clearMentorCaches).not.toHaveBeenCalled();
  });

  it.each([0, 403, 500, 502])('shows the fallback for a %i and keeps the requests', (status) => {
    withdrawMentorRequest.mockReturnValueOnce(throwError(() => httpError(status)));

    service.confirmWithdraw(REQUEST_ID);
    accept();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK }));
    expect(clearMentorCaches).not.toHaveBeenCalled();
  });
});
