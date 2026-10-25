// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EMAIL_ALREADY_CONNECTED_MESSAGE, EMAIL_ALREADY_LINKED_MESSAGE, IDENTITY_PROVIDER_OPTIONS } from '@lfx-one/shared/constants';
import { SendEmailVerificationResponse, VerifyAndLinkEmailResponse } from '@lfx-one/shared/interfaces';
import { IntercomService } from '@services/intercom.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddAccountDialogComponent } from './add-account-dialog.component';

/**
 * Guards #4253: an address already connected to the caller's account comes back from the BFF as a
 * success with `status: 'already_connected'`. The dialog says so through the root toast, keeps its
 * shipped close result (callers refresh identities on it), and never shows the conflict/support error.
 */
describe('AddAccountDialogComponent — email verification outcome (#4253)', () => {
  const email = 'owned@example.test';
  let fixture: ComponentFixture<AddAccountDialogComponent>;

  function setup(verify: () => Observable<VerifyAndLinkEmailResponse>) {
    const close = vi.fn();
    const add = vi.fn();
    const userServiceMock = {
      sendEmailVerificationCode: vi.fn(() => of<SendEmailVerificationResponse>({ success: true })),
      verifyAndLinkEmail: vi.fn(verify),
    };

    TestBed.configureTestingModule({
      imports: [AddAccountDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { existingProviders: [] } } },
        { provide: UserService, useValue: userServiceMock },
        { provide: MessageService, useValue: { add } },
        { provide: IntercomService, useValue: { openMessenger: vi.fn() } },
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

    return { component, close, add, userServiceMock, root: fixture.nativeElement as HTMLElement };
  }

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
    expect(add).toHaveBeenCalledExactlyOnceWith({ severity: 'success', summary: 'Already connected', detail: EMAIL_ALREADY_CONNECTED_MESSAGE });
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

  it('shows the neutral linked-account conflict with the support link and stays open', () => {
    const { component, close, add, root } = setup(() =>
      throwError(() => new HttpErrorResponse({ status: 409, error: { success: false, error: 'email already linked', message: EMAIL_ALREADY_LINKED_MESSAGE } }))
    );

    component.onVerify();
    fixture.detectChanges();

    const error = root.querySelector('[data-testid="add-account-otp-error"]');
    expect(error?.textContent).toContain(EMAIL_ALREADY_LINKED_MESSAGE);
    expect(error?.querySelector('[lfxOpenIntercom]')).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(component.isVerifying()).toBe(false);
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
});
