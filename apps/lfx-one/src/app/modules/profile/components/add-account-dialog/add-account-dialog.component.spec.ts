// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TransferState } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DEFAULT_RUNTIME_CONFIG, RUNTIME_CONFIG_KEY } from '@app/shared/providers/runtime-config.provider';
import {
  EMAIL_ALREADY_CONNECTED_MESSAGE,
  EMAIL_ALREADY_CONNECTED_SUMMARY,
  EMAIL_ALREADY_LINKED_MESSAGE,
  EMAIL_CODE_NOT_RECEIVED_HINT,
  EMAIL_VERIFICATION_SENT_MESSAGE,
  IDENTITY_PROVIDER_OPTIONS,
} from '@lfx-one/shared/constants';
import { SendEmailVerificationResponse, VerifyAndLinkEmailResponse } from '@lfx-one/shared/interfaces';
import { IntercomService } from '@services/intercom.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddAccountDialogComponent } from './add-account-dialog.component';

/**
 * Guards #4253: an address already connected to the caller's account comes back from the BFF as a
 * success with `status: 'already_connected'`. The dialog says so through the root toast, keeps its
 * shipped close result (callers refresh identities on it), and never shows the conflict/support error.
 *
 * Guards #4328: a proven address that is linked elsewhere shows one neutral explanation and one
 * error-local support sentence — never the server's own support sentence followed by a second one.
 */
describe('AddAccountDialogComponent — email verification outcome (#4253, #4328)', () => {
  const email = 'owned@example.test';
  const conflictCopy = 'This email is already linked to an LFX account. If you believe this is an error, contact support.';
  let fixture: ComponentFixture<AddAccountDialogComponent>;

  function setup(
    verify: () => Observable<VerifyAndLinkEmailResponse>,
    send: () => Observable<SendEmailVerificationResponse> = () => of<SendEmailVerificationResponse>({ success: true })
  ) {
    const close = vi.fn();
    const add = vi.fn();
    const openMessenger = vi.fn();
    const userServiceMock = {
      sendEmailVerificationCode: vi.fn(send),
      verifyAndLinkEmail: vi.fn(verify),
    };

    TestBed.configureTestingModule({
      imports: [AddAccountDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { existingProviders: [] } } },
        { provide: UserService, useValue: userServiceMock },
        { provide: MessageService, useValue: { add } },
        { provide: IntercomService, useValue: { openMessenger } },
      ],
    });

    fixture = TestBed.createComponent(AddAccountDialogComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    // Walk the real email path up to the OTP step.
    component.onSelectProvider(IDENTITY_PROVIDER_OPTIONS.find((provider) => provider.id === 'email')!);
    component.form.controls.email.setValue(email);
    component.onSendCode();
    component.verificationCode.set('123456');
    fixture.detectChanges();

    return { component, close, add, openMessenger, userServiceMock, root: fixture.nativeElement as HTMLElement };
  }

  const normalizedText = (element: Element | null): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const otpError = (root: HTMLElement): Element | null => root.querySelector('[data-testid="add-account-otp-error"]');

  // Failure delivery differs by subscribe callback; both must render through the same branch.
  const deliveries = [
    {
      via: 'an HTTP error',
      respond: (message: string) => () => throwError(() => new HttpErrorResponse({ status: 409, error: { success: false, message } })),
    },
    {
      via: 'an unsuccessful response',
      respond: (message: string) => () => of<VerifyAndLinkEmailResponse>({ success: false, message }),
    },
  ];

  const conflictMessages = [
    { label: 'the shared already-linked message', message: EMAIL_ALREADY_LINKED_MESSAGE },
    { label: 'a bare marker with no punctuation', message: 'email already linked' },
    { label: 'a case-varied marker', message: 'Email ALREADY LINKED' },
    { label: 'the identity-link marker', message: 'The provided identity token belongs to an existing LFID account and cannot be linked' },
  ];

  const unrelatedMessages = [
    { label: 'a punctuated message', message: 'Verification failed. Please try again or request a new code.' },
    { label: 'an unpunctuated message', message: 'Invalid verification code' },
  ];

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('confirms an already-connected email through the root toast and keeps the existing close result', () => {
    const { component, close, add, userServiceMock, root } = setup(() =>
      of<VerifyAndLinkEmailResponse>({ success: true, status: 'already_connected', message: EMAIL_ALREADY_CONNECTED_MESSAGE })
    );
    expect(root.querySelector('[data-testid="add-account-otp"]')).not.toBeNull();

    component.onVerify();
    fixture.detectChanges();

    expect(userServiceMock.verifyAndLinkEmail).toHaveBeenCalledExactlyOnceWith(email, '123456');
    expect(add).toHaveBeenCalledExactlyOnceWith({ severity: 'success', summary: EMAIL_ALREADY_CONNECTED_SUMMARY, detail: EMAIL_ALREADY_CONNECTED_MESSAGE });
    expect(close).toHaveBeenCalledExactlyOnceWith({ provider: 'email', identifier: email });
    expect(component.showSupportLink()).toBe(false);
    expect(root.querySelector('[data-testid="add-account-otp-error"]')).toBeNull();
  });

  it('closes a newly linked email with the same result and no extra notice', () => {
    const { component, close, add } = setup(() =>
      of<VerifyAndLinkEmailResponse>({ success: true, message: 'Email identity verified and linked successfully' })
    );

    component.onVerify();

    expect(add).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledExactlyOnceWith({ provider: 'email', identifier: email });
  });

  it('shows the neutral linked-account conflict with one support sentence and stays open', async () => {
    const { component, close, add, root } = setup(() =>
      throwError(() => new HttpErrorResponse({ status: 409, error: { success: false, error: 'email already linked', message: EMAIL_ALREADY_LINKED_MESSAGE } }))
    );

    component.onVerify();
    await fixture.whenStable();

    const error = otpError(root);
    const text = normalizedText(error);
    expect(text).toBe(conflictCopy);
    expect(text.match(/contact support/gi)).toHaveLength(1);
    expect(text).not.toContain('..');
    const supportButtons = error?.querySelectorAll('[lfxOpenIntercom]') ?? [];
    expect(supportButtons).toHaveLength(1);
    expect(supportButtons[0]?.tagName).toBe('BUTTON');
    expect(supportButtons[0]?.getAttribute('type')).toBe('button');
    // Presentation only: the signal keeps the server's message as received.
    expect(component.verificationError()).toBe(EMAIL_ALREADY_LINKED_MESSAGE);
    expect(close).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(component.isVerifying()).toBe(false);
  });

  describe.each(deliveries)('when the conflict arrives as $via', ({ respond }) => {
    it.each(conflictMessages)('renders the approved copy for $label', async ({ message }) => {
      const { component, close, add, root } = setup(respond(message));

      component.onVerify();
      await fixture.whenStable();

      const error = otpError(root);
      expect(normalizedText(error)).toBe(conflictCopy);
      expect(error?.querySelectorAll('[lfxOpenIntercom]')).toHaveLength(1);
      expect(component.verificationError()).toBe(message);
      expect(close).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
      expect(component.isVerifying()).toBe(false);
    });
  });

  describe.each(deliveries)('when an unrelated error arrives as $via', ({ respond }) => {
    it.each(unrelatedMessages)('renders $label verbatim without a support action', async ({ message }) => {
      const { component, close, root } = setup(respond(message));

      component.onVerify();
      await fixture.whenStable();

      const error = otpError(root);
      expect(normalizedText(error)).toBe(message);
      expect(error?.querySelector('[lfxOpenIntercom]')).toBeNull();
      expect(close).not.toHaveBeenCalled();
      expect(component.isVerifying()).toBe(false);
    });
  });

  it('hides the error paragraph while there is no error and keeps the code hint and its support action', async () => {
    const { root } = setup(() => of<VerifyAndLinkEmailResponse>({ success: true }));
    await fixture.whenStable();

    expect(otpError(root)).toBeNull();
    expect(root.querySelector('[data-testid="add-account-send-error"]')).toBeNull();
    expect(root.querySelector('[data-testid="add-account-otp-hint"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="add-account-otp-support-button"]')).not.toBeNull();
  });

  it('keeps the code hint alongside the conflict error', async () => {
    const { component, root } = setup(deliveries[0].respond(EMAIL_ALREADY_LINKED_MESSAGE));

    component.onVerify();
    await fixture.whenStable();

    expect(otpError(root)).not.toBeNull();
    expect(root.querySelector('[data-testid="add-account-otp-hint"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="add-account-otp-support-button"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="add-account-send-error"]')).toBeNull();
  });

  it('leaves a pre-code send error verbatim, outside the OTP error paragraph', async () => {
    const { root } = setup(
      () => of<VerifyAndLinkEmailResponse>({ success: true }),
      () => throwError(() => new HttpErrorResponse({ status: 409, error: { success: false, message: EMAIL_ALREADY_LINKED_MESSAGE } }))
    );
    await fixture.whenStable();

    const sendError = root.querySelector('[data-testid="add-account-send-error"]');
    expect(normalizedText(sendError)).toBe(EMAIL_ALREADY_LINKED_MESSAGE);
    expect(sendError?.querySelector('[lfxOpenIntercom]')).toBeNull();
    expect(otpError(root)).toBeNull();
  });

  it('opens the support messenger from the error-local support button', async () => {
    const { component, close, add, openMessenger, root } = setup(deliveries[0].respond(EMAIL_ALREADY_LINKED_MESSAGE));
    TestBed.inject(TransferState).set(RUNTIME_CONFIG_KEY, { ...DEFAULT_RUNTIME_CONFIG, intercomAppId: 'test-app-id' });

    component.onVerify();
    await fixture.whenStable();
    (otpError(root)?.querySelector('[lfxOpenIntercom]') as HTMLButtonElement | null)?.click();

    expect(openMessenger).toHaveBeenCalledExactlyOnceWith('test-app-id', expect.any(Function));
    expect(add).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('shows a wrong or expired code as a retryable error without the support link', () => {
    const { component, close, root } = setup(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { success: false, error: 'verification_failed', message: 'Verification failed. Please try again or request a new code.' },
          })
      )
    );

    component.onVerify();
    fixture.detectChanges();

    const error = root.querySelector('[data-testid="add-account-otp-error"]');
    expect(error?.textContent).toContain('Verification failed. Please try again or request a new code.');
    expect(error?.querySelector('[lfxOpenIntercom]')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(component.isVerifying()).toBe(false);
  });

  it('hands off to profile authorization without consuming the step or showing an error', () => {
    // jsdom does not implement cross-document navigation; silence its "not implemented" report.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { component, close, add, root } = setup(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 403,
            error: { success: false, error: 'management_token_required', authorize_url: '/api/profile/auth/start?returnTo=%2Fprofile%2Femails' },
          })
      )
    );

    component.onVerify();
    fixture.detectChanges();

    expect(component.verificationError()).toBe('');
    expect(root.querySelector('[data-testid="add-account-otp-error"]')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  describe('resend escalation', () => {
    const resendButton = (root: HTMLElement): Element | null => root.querySelector('[data-testid="add-account-resend"]');
    const supportAction = (root: HTMLElement): Element | null => root.querySelector('[data-testid="add-account-resend-support"]');

    afterEach(() => {
      vi.useRealTimers();
    });

    it('replaces Resend with Contact support after the first successful resend', () => {
      vi.useFakeTimers();
      const { component, root } = setup(() => of<VerifyAndLinkEmailResponse>({ success: true }));
      expect(component.showResendSupport()).toBe(false);
      expect(resendButton(root)).not.toBeNull();
      expect(supportAction(root)).toBeNull();

      vi.advanceTimersByTime(60_000);
      component.onResendCode();
      fixture.detectChanges();

      expect(component.resendCount()).toBe(1);
      expect(component.showResendSupport()).toBe(true);
      expect(resendButton(root)).toBeNull();
      expect(normalizedText(supportAction(root))).toBe('Contact support');
      expect(supportAction(root)?.hasAttribute('lfxOpenIntercom')).toBe(true);
    });

    it('blocks overlapping resends and further requests after escalation', () => {
      vi.useFakeTimers();
      const { component, root, userServiceMock } = setup(() => of<VerifyAndLinkEmailResponse>({ success: true }));
      const response$ = new Subject<SendEmailVerificationResponse>();
      userServiceMock.sendEmailVerificationCode.mockReturnValue(response$);

      vi.advanceTimersByTime(60_000);
      fixture.detectChanges();
      const button = resendButton(root) as HTMLButtonElement;
      expect(button.disabled).toBe(false);

      button.click();
      component.onResendCode(); // A second event before change detection must also be ignored.
      fixture.detectChanges();
      expect(button.disabled).toBe(true);
      button.click();
      expect(userServiceMock.sendEmailVerificationCode).toHaveBeenCalledTimes(2);
      expect(component.resendCount()).toBe(0);

      response$.next({ success: true });
      response$.complete();
      fixture.detectChanges();

      expect(component.isConnecting()).toBe(false);
      expect(component.resendCount()).toBe(1);
      expect(resendButton(root)).toBeNull();
      expect(supportAction(root)).not.toBeNull();

      vi.advanceTimersByTime(60_000);
      component.onResendCode();
      expect(userServiceMock.sendEmailVerificationCode).toHaveBeenCalledTimes(2);
    });

    it.each([false, true])('allows retry after a pending resend fails (HTTP error: %s)', (httpError) => {
      vi.useFakeTimers();
      const { component, root, userServiceMock } = setup(() => of<VerifyAndLinkEmailResponse>({ success: true }));
      const response$ = new Subject<SendEmailVerificationResponse>();
      userServiceMock.sendEmailVerificationCode.mockReturnValue(response$);

      vi.advanceTimersByTime(60_000);
      fixture.detectChanges();
      (resendButton(root) as HTMLButtonElement).click();
      fixture.detectChanges();
      expect((resendButton(root) as HTMLButtonElement).disabled).toBe(true);

      if (httpError) {
        response$.error(new HttpErrorResponse({ status: 500, error: { message: 'Failed to resend code' } }));
      } else {
        response$.next({ success: false, message: 'Failed to resend code' });
        response$.complete();
      }

      expect(component.isConnecting()).toBe(false);
      expect(component.resendCount()).toBe(0);
      vi.advanceTimersByTime(60_000);
      fixture.detectChanges();
      expect((resendButton(root) as HTMLButtonElement).disabled).toBe(false);
      expect(supportAction(root)).toBeNull();

      userServiceMock.sendEmailVerificationCode.mockReturnValue(of<SendEmailVerificationResponse>({ success: true }));
      (resendButton(root) as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(userServiceMock.sendEmailVerificationCode).toHaveBeenCalledTimes(3);
      expect(component.resendCount()).toBe(1);
      expect(supportAction(root)).not.toBeNull();
    });

    it('does not count a failed resend toward the threshold', () => {
      vi.useFakeTimers();
      const { component, userServiceMock } = setup(() => of<VerifyAndLinkEmailResponse>({ success: true }));
      userServiceMock.sendEmailVerificationCode.mockReturnValue(of<SendEmailVerificationResponse>({ success: false, message: 'nope' }));

      vi.advanceTimersByTime(60_000);
      component.onResendCode();

      expect(component.resendCount()).toBe(0);
    });

    it('resets the count on cancel', () => {
      vi.useFakeTimers();
      const { component } = setup(() => of<VerifyAndLinkEmailResponse>({ success: true }));
      vi.advanceTimersByTime(60_000);
      component.onResendCode();
      expect(component.resendCount()).toBe(1);

      component.onCancel();

      expect(component.resendCount()).toBe(0);
    });

    it('words the complete email step conditionally before and after a generic successful send', () => {
      const response$ = new Subject<SendEmailVerificationResponse>();
      const { component, root } = setup(
        () => of<VerifyAndLinkEmailResponse>({ success: true }),
        () => response$
      );

      expect(component.codeSent()).toBe(false);
      expect(normalizedText(root)).toContain("Enter your email address. If it can be added to your account, we'll send you a verification code.");
      expect(normalizedText(root)).toContain('Codes are sent only to addresses that can be added to your account.');
      expect(normalizedText(root)).not.toContain("You'll receive a verification code");

      response$.next({ success: true, message: EMAIL_VERIFICATION_SENT_MESSAGE });
      response$.complete();
      fixture.detectChanges();

      expect(component.codeSent()).toBe(true);
      expect(root.querySelector('[data-testid="add-account-otp"]')).not.toBeNull();
      expect(normalizedText(root)).toContain("Enter your email address. If it can be added to your account, we'll send you a verification code.");
      expect(normalizedText(root)).not.toContain("Enter your email address and we'll send you a verification code.");
      const hint = normalizedText(root.querySelector('[data-testid="add-account-otp-hint"]'));
      expect(hint).toContain(EMAIL_CODE_NOT_RECEIVED_HINT);
      expect(hint).not.toContain('already linked');
    });
  });
});
