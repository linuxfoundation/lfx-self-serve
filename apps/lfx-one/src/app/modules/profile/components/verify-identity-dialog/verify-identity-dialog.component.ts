// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { IDENTITY_PROVIDER_LABELS } from '@lfx-one/shared/constants';
import { ConnectedIdentityFull, VerifyIdentityDialogData } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { InputOtp } from 'primeng/inputotp';

@Component({
  selector: 'lfx-verify-identity-dialog',
  imports: [ButtonComponent, FormsModule, InputOtp],
  templateUrl: './verify-identity-dialog.component.html',
  styles: [
    `
      ::ng-deep .p-inputotp .p-inputtext {
        height: 4rem;
        font-size: 1.25rem;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
        text-align: center;
      }
    `,
  ],
})
export class VerifyIdentityDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<VerifyIdentityDialogData>);
  private readonly userService = inject(UserService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly identity: ConnectedIdentityFull = this.config.data.identity;
  public readonly providerLabel: string = IDENTITY_PROVIDER_LABELS[this.identity.provider] ?? this.identity.provider;
  public readonly isEmailProvider = computed(() => this.identity.provider === 'email');

  public codeSent = signal(false);
  public verificationCode = signal('');
  public verificationError = signal('');
  public isSendingCode = signal(false);
  public isVerifying = signal(false);
  public resendCooldown = signal(0);

  private cooldownInterval: ReturnType<typeof setInterval> | null = null;

  public onSendCode(): void {
    this.isSendingCode.set(true);
    this.verificationError.set('');

    this.userService.sendEmailVerificationCode(this.identity.identifier).subscribe({
      next: (response) => {
        if (response.success) {
          this.codeSent.set(true);
          this.startResendCooldown();
        } else {
          this.verificationError.set(response.error || response.message || 'Failed to send verification code');
        }
        this.isSendingCode.set(false);
      },
      error: (err) => {
        this.verificationError.set(err.error?.message || err.error?.error || 'Failed to send verification code');
        this.isSendingCode.set(false);
      },
    });
  }

  public onVerifyOtp(): void {
    const code = this.verificationCode();
    if (code.length !== 6) {
      return;
    }

    this.isVerifying.set(true);
    this.verificationError.set('');

    this.userService.verifyAndLinkEmail(this.identity.identifier, code).subscribe({
      next: (response) => {
        if (response.success) {
          this.ref.close(true);
        } else {
          this.verificationError.set(response.error || response.message || 'Verification failed');
          this.isVerifying.set(false);
        }
      },
      error: (err) => {
        if (err.error?.error === 'management_token_required' && err.error?.authorize_url) {
          window.location.href = err.error.authorize_url;
          return;
        }
        this.verificationError.set(err.error?.message || err.error?.error || 'Verification failed. Please try again.');
        this.isVerifying.set(false);
      },
    });
  }

  public onResendCode(): void {
    if (this.resendCooldown() > 0) {
      return;
    }

    this.verificationCode.set('');
    this.verificationError.set('');
    this.isSendingCode.set(true);

    this.userService.sendEmailVerificationCode(this.identity.identifier).subscribe({
      next: (response) => {
        if (!response.success) {
          this.verificationError.set(response.error || response.message || 'Failed to resend code');
        }
        this.isSendingCode.set(false);
        this.startResendCooldown();
      },
      error: (err) => {
        this.verificationError.set(err.error?.message || err.error?.error || 'Failed to resend code');
        this.isSendingCode.set(false);
      },
    });
  }

  public onConfirm(): void {
    // Navigate to social connect endpoint which handles the OAuth flow
    window.location.href = `/api/profile/identities/social/connect?provider=${this.identity.provider}`;
  }

  public onCancel(): void {
    this.clearCooldown();
    this.ref.close(null);
  }

  private startResendCooldown(): void {
    this.clearCooldown();
    this.resendCooldown.set(60);

    this.cooldownInterval = setInterval(() => {
      const current = this.resendCooldown();
      if (current <= 1) {
        this.resendCooldown.set(0);
        this.clearCooldown();
      } else {
        this.resendCooldown.set(current - 1);
      }
    }, 1000);

    this.destroyRef.onDestroy(() => this.clearCooldown());
  }

  private clearCooldown(): void {
    if (this.cooldownInterval) {
      clearInterval(this.cooldownInterval);
      this.cooldownInterval = null;
    }
  }
}
