// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EMAIL_ALREADY_CONNECTED_MESSAGE, EMAIL_ALREADY_CONNECTED_SUMMARY } from '@lfx-one/shared/constants';
import { ConnectedIdentityFull, SendEmailVerificationResponse, VerifyAndLinkEmailResponse } from '@lfx-one/shared/interfaces';
import { IntercomService } from '@services/intercom.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VerifyIdentityDialogComponent } from './verify-identity-dialog.component';

/**
 * Guards #4253: verifying an email identity that is already connected to the caller's account
 * succeeds with `status: 'already_connected'`. The dialog confirms it through the root toast and
 * still closes with `true`, so the Identities tab refreshes as before.
 */
describe('VerifyIdentityDialogComponent — email verification outcome (#4253)', () => {
  const identity = {
    id: 'identity-1',
    provider: 'email',
    identifier: 'owned@example.test',
    icon: 'fa-light fa-envelope',
    state: 'unverified',
  } as unknown as ConnectedIdentityFull;
  let fixture: ComponentFixture<VerifyIdentityDialogComponent>;

  function setup(verify: () => Observable<VerifyAndLinkEmailResponse>) {
    const close = vi.fn();
    const add = vi.fn();
    const userServiceMock = {
      sendEmailVerificationCode: vi.fn(() => of<SendEmailVerificationResponse>({ success: true })),
      verifyAndLinkEmail: vi.fn(verify),
    };

    TestBed.configureTestingModule({
      imports: [VerifyIdentityDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { identity } } },
        { provide: UserService, useValue: userServiceMock },
        { provide: MessageService, useValue: { add } },
        { provide: IntercomService, useValue: { openMessenger: vi.fn() } },
      ],
    });

    fixture = TestBed.createComponent(VerifyIdentityDialogComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

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

  it('confirms an already-connected email through the root toast and closes with true', () => {
    const { component, close, add, userServiceMock, root } = setup(() =>
      of<VerifyAndLinkEmailResponse>({ success: true, status: 'already_connected', message: EMAIL_ALREADY_CONNECTED_MESSAGE })
    );
    expect(root.querySelector('[data-testid="verify-otp"]')).not.toBeNull();

    component.onVerifyOtp();
    fixture.detectChanges();

    expect(userServiceMock.verifyAndLinkEmail).toHaveBeenCalledExactlyOnceWith('owned@example.test', '123456');
    expect(add).toHaveBeenCalledExactlyOnceWith({ severity: 'success', summary: EMAIL_ALREADY_CONNECTED_SUMMARY, detail: EMAIL_ALREADY_CONNECTED_MESSAGE });
    expect(close).toHaveBeenCalledExactlyOnceWith(true);
    expect(root.querySelector('[data-testid="verify-email-error"]')).toBeNull();
  });

  it('closes an ordinary verification with true and no extra notice', () => {
    const { component, close, add } = setup(() =>
      of<VerifyAndLinkEmailResponse>({ success: true, message: 'Email identity verified and linked successfully' })
    );

    component.onVerifyOtp();

    expect(add).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('keeps the dialog open with a retryable error for a wrong or expired code', () => {
    const { component, close, add, root } = setup(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { success: false, error: 'verification_failed', message: 'Verification failed. Please try again or request a new code.' },
          })
      )
    );

    component.onVerifyOtp();
    fixture.detectChanges();

    const error = root.querySelector('[data-testid="verify-email-error"]');
    expect(error?.textContent).toContain('Verification failed. Please try again or request a new code.');
    expect(error?.querySelector('[lfxOpenIntercom]')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(component.isVerifying()).toBe(false);
  });

  it('hands off to profile authorization without closing or showing an error', () => {
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

    component.onVerifyOtp();
    fixture.detectChanges();

    expect(component.verificationError()).toBe('');
    expect(root.querySelector('[data-testid="verify-email-error"]')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
});
