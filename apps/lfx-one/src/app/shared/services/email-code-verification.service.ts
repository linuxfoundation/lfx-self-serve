// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import {
  EMAIL_ALREADY_CONNECTED_MESSAGE,
  EMAIL_ALREADY_CONNECTED_STATUS,
  EMAIL_RESEND_FAILED_MESSAGE,
  EMAIL_RESEND_SUPPORT_THRESHOLD,
  EMAIL_VERIFICATION_CODE_LENGTH,
} from '@lfx-one/shared/constants';
import { isIdentityAlreadyLinkedError } from '@lfx-one/shared/utils';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { useResendCooldown } from '@shared/utils/resend-cooldown';

import { UserService } from './user.service';

/**
 * The 6-digit email code round trip of the Account & Settings identity dialogs (#6074): send, resend with a cooldown, verify and
 * link. Provided by each dialog, so its state ends with the dialog.
 */
@Injectable()
export class EmailCodeVerificationService {
  private readonly userService = inject(UserService);
  private readonly toast = inject(UiToastService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly cooldownTimer = useResendCooldown(inject(DestroyRef));

  public readonly codeSent = signal(false);
  public readonly code = signal('');
  public readonly error = signal('');
  public readonly sending = signal(false);
  public readonly verifying = signal(false);
  public readonly resendCount = signal(0);
  public readonly resendCooldown = this.cooldownTimer.cooldown;
  /** True once the code has all its digits. */
  public readonly codeComplete = computed(() => this.code().length === EMAIL_VERIFICATION_CODE_LENGTH);
  /** After a few resends, Resend gives way to Contact support. */
  public readonly showResendSupport = computed(() => this.resendCount() >= EMAIL_RESEND_SUPPORT_THRESHOLD);
  /** The address is verified but belongs to another LFX account, which only support can resolve. */
  public readonly alreadyLinked = computed(() => isIdentityAlreadyLinkedError(this.error()));

  public send(email: string): void {
    this.sending.set(true);
    this.error.set('');
    this.userService.sendEmailVerificationCode(email).subscribe({
      next: (response) => {
        this.sending.set(false);
        if (!response.success) {
          this.error.set(response.message || response.error || 'Failed to send verification code');
          return;
        }
        this.codeSent.set(true);
        this.resendCount.set(0);
        this.cooldownTimer.start();
      },
      error: (err: HttpErrorResponse) => {
        this.sending.set(false);
        this.error.set(err.error?.message || err.error?.error || 'Failed to send verification code');
      },
    });
  }

  public resend(email: string): void {
    if (this.resendCooldown() > 0 || this.sending() || this.showResendSupport()) return;
    this.code.set('');
    this.error.set('');
    this.sending.set(true);
    this.userService.sendEmailVerificationCode(email).subscribe({
      next: (response) => {
        this.sending.set(false);
        if (response.success) this.resendCount.update((count) => count + 1);
        else this.error.set(EMAIL_RESEND_FAILED_MESSAGE);
        this.cooldownTimer.start();
      },
      error: () => {
        this.sending.set(false);
        this.error.set(EMAIL_RESEND_FAILED_MESSAGE);
      },
    });
  }

  /** Verifies the entered code and links the address; `onLinked` runs once it is part of the account. */
  public verify(email: string, onLinked: () => void): void {
    if (!this.codeComplete() || this.verifying()) return;
    this.verifying.set(true);
    this.error.set('');
    this.userService.verifyAndLinkEmail(email, this.code()).subscribe({
      next: (response) => {
        if (!response.success) {
          this.verifying.set(false);
          this.error.set(response.message || response.error || 'Verification failed');
          return;
        }
        // Already part of this account: say so rather than imply something new was linked.
        if (response.status === EMAIL_ALREADY_CONNECTED_STATUS) this.toast.show({ variant: 'success', message: EMAIL_ALREADY_CONNECTED_MESSAGE });
        onLinked();
      },
      error: (err: HttpErrorResponse) => {
        // Flow C: linking needs a management token; the callback replays the verification after authorizing.
        if (err.error?.error === 'management_token_required' && err.error?.authorize_url) {
          if (isPlatformBrowser(this.platformId)) window.location.href = err.error.authorize_url;
          return;
        }
        this.verifying.set(false);
        this.error.set(err.error?.message || err.error?.error || 'Verification failed. Please try again.');
      },
    });
  }

  /** Back to before a code was sent, such as for a different address. */
  public reset(): void {
    this.codeSent.set(false);
    this.code.set('');
    this.error.set('');
    this.resendCount.set(0);
    this.cooldownTimer.clear();
  }
}
