// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { EMAIL_ALREADY_CONNECTED_STATUS, EMAIL_RESEND_FAILED_MESSAGE, EMAIL_RESEND_SUPPORT_THRESHOLD } from '@lfx-one/shared/constants';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailCodeVerificationService } from './email-code-verification.service';
import { UserService } from './user.service';

describe('EmailCodeVerificationService', () => {
  let send: ReturnType<typeof vi.fn>;
  let verify: ReturnType<typeof vi.fn>;
  let show: ReturnType<typeof vi.fn>;
  let service: EmailCodeVerificationService;

  beforeEach(() => {
    vi.useFakeTimers();
    send = vi.fn(() => of({ success: true }));
    verify = vi.fn(() => of({ success: true }));
    show = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        EmailCodeVerificationService,
        { provide: UserService, useValue: { sendEmailVerificationCode: send, verifyAndLinkEmail: verify } },
        { provide: UiToastService, useValue: { show } },
      ],
    });
    service = TestBed.inject(EmailCodeVerificationService);
  });

  afterEach(() => vi.useRealTimers());

  it('sends a code and starts the resend cooldown', () => {
    service.send('ada@example.com');

    expect(send).toHaveBeenCalledWith('ada@example.com');
    expect(service.codeSent()).toBe(true);
    expect(service.resendCooldown()).toBe(60);
  });

  it('keeps the server reason when a code cannot be sent', () => {
    send.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 429, error: { message: 'Too many requests' } })));
    service.send('ada@example.com');

    expect(service.codeSent()).toBe(false);
    expect(service.error()).toBe('Too many requests');
  });

  it('resends only after the cooldown, and offers support after the last resend', () => {
    service.send('ada@example.com');
    service.resend('ada@example.com');
    expect(send).toHaveBeenCalledTimes(1);

    for (let count = 0; count < EMAIL_RESEND_SUPPORT_THRESHOLD; count++) {
      vi.advanceTimersByTime(60_000);
      service.resend('ada@example.com');
    }
    expect(service.showResendSupport()).toBe(true);
    vi.advanceTimersByTime(60_000);
    service.resend('ada@example.com');
    expect(send).toHaveBeenCalledTimes(EMAIL_RESEND_SUPPORT_THRESHOLD + 1);
  });

  it('says so when a resend fails', () => {
    service.send('ada@example.com');
    vi.advanceTimersByTime(60_000);
    send.mockReturnValueOnce(of({ success: false }));
    service.resend('ada@example.com');

    expect(service.error()).toBe(EMAIL_RESEND_FAILED_MESSAGE);
  });

  it('links the address once the six-digit code checks out, telling the user when it already was', () => {
    const linked = vi.fn();
    service.code.set('123456');
    verify.mockReturnValueOnce(of({ success: true, status: EMAIL_ALREADY_CONNECTED_STATUS }));
    service.verify('ada@example.com', linked);

    expect(verify).toHaveBeenCalledWith('ada@example.com', '123456');
    expect(linked).toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }));
  });

  it('does not verify a short code, and keeps a rejected one on the page', () => {
    const linked = vi.fn();
    service.code.set('123');
    service.verify('ada@example.com', linked);
    expect(verify).not.toHaveBeenCalled();

    service.code.set('123456');
    verify.mockReturnValueOnce(of({ success: false, message: 'Invalid code' }));
    service.verify('ada@example.com', linked);
    expect(linked).not.toHaveBeenCalled();
    expect(service.error()).toBe('Invalid code');
    expect(service.verifying()).toBe(false);
  });

  it('goes back to before a code was sent', () => {
    service.send('ada@example.com');
    service.code.set('123456');
    service.reset();

    expect(service.codeSent()).toBe(false);
    expect(service.code()).toBe('');
    expect(service.resendCount()).toBe(0);
  });
});
