// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_MENTEE_WITHDRAW_CONFIRM_HEADER,
  MENTORSHIP_MENTEE_WITHDRAW_ERROR_FALLBACK,
  MENTORSHIP_MENTEE_WITHDRAW_STALE_ERROR_MESSAGES,
  MENTORSHIP_MENTEE_WITHDRAW_SUCCESS_SUMMARY,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeApplicationWithdrawService } from './mentee-application-withdraw.service';

describe('MenteeApplicationWithdrawService', () => {
  const APPLICATION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

  let service: MenteeApplicationWithdrawService;
  let confirm: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;
  let withdrawMenteeApplication: ReturnType<typeof vi.fn<(id: string) => Observable<void>>>;
  let clearMenteeCaches: ReturnType<typeof vi.fn>;

  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  /** Confirms the dialog the last `confirmWithdraw` raised. */
  const accept = () => {
    const confirmation = confirm.mock.calls.at(-1)?.[0] as Confirmation;
    confirmation.accept?.();
  };

  beforeEach(() => {
    confirm = vi.fn();
    add = vi.fn();
    withdrawMenteeApplication = vi.fn(() => of(undefined));
    clearMenteeCaches = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        MenteeApplicationWithdrawService,
        { provide: ConfirmationService, useValue: { confirm } },
        { provide: MessageService, useValue: { add } },
        { provide: MentorshipMenteeService, useValue: { withdrawMenteeApplication, clearMenteeCaches } },
      ],
    });

    service = TestBed.inject(MenteeApplicationWithdrawService);
  });

  it('asks for confirmation and withdraws nothing until the mentee accepts', () => {
    service.confirmWithdraw(APPLICATION_ID);

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ header: MENTORSHIP_MENTEE_WITHDRAW_CONFIRM_HEADER }));
    expect(withdrawMenteeApplication).not.toHaveBeenCalled();
  });

  it('withdraws on accept and toasts success without clearing the cache itself', () => {
    service.confirmWithdraw(APPLICATION_ID);
    accept();

    expect(withdrawMenteeApplication).toHaveBeenCalledWith(APPLICATION_ID);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: MENTORSHIP_MENTEE_WITHDRAW_SUCCESS_SUMMARY }));
    // The data service already drops the cache on success.
    expect(clearMenteeCaches).not.toHaveBeenCalled();
    expect(service.withdrawingId()).toBeNull();
  });

  it('marks the application busy while the withdraw is in flight and ignores a second request', () => {
    const pending = new Subject<void>();
    withdrawMenteeApplication.mockReturnValueOnce(pending);

    service.confirmWithdraw(APPLICATION_ID);
    accept();
    expect(service.withdrawingId()).toBe(APPLICATION_ID);

    service.confirmWithdraw('another-application');
    expect(confirm).toHaveBeenCalledTimes(1);

    pending.next();
    pending.complete();
    expect(service.withdrawingId()).toBeNull();
  });

  it.each([403, 404, 409])('shows the stale copy for a %i and re-reads the applications', (status) => {
    withdrawMenteeApplication.mockReturnValueOnce(throwError(() => httpError(status, { error: 'upstream text' })));

    service.confirmWithdraw(APPLICATION_ID);
    accept();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTEE_WITHDRAW_STALE_ERROR_MESSAGES[status] }));
    expect(clearMenteeCaches).toHaveBeenCalledTimes(1);
    expect(service.withdrawingId()).toBeNull();
  });

  it('shows the server message for the impersonation 403 and keeps the applications', () => {
    const message = 'This action is not available while impersonating a user';
    withdrawMenteeApplication.mockReturnValueOnce(throwError(() => httpError(403, { error: message, code: 'IMPERSONATION_READ_ONLY' })));

    service.confirmWithdraw(APPLICATION_ID);
    accept();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: message }));
    expect(clearMenteeCaches).not.toHaveBeenCalled();
  });

  it.each([0, 500, 502])('shows the fallback for a %i and keeps the applications', (status) => {
    withdrawMenteeApplication.mockReturnValueOnce(throwError(() => httpError(status)));

    service.confirmWithdraw(APPLICATION_ID);
    accept();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: MENTORSHIP_MENTEE_WITHDRAW_ERROR_FALLBACK }));
    expect(clearMenteeCaches).not.toHaveBeenCalled();
  });
});
