// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import {
  EMAIL_ALREADY_CONNECTED_MESSAGE,
  EMAIL_ALREADY_CONNECTED_STATUS,
  EMAIL_ALREADY_CONNECTED_SUMMARY,
  EMAIL_CODE_NOT_RECEIVED_HINT,
  EMAIL_CODE_NOT_RECEIVED_TITLE,
  EMAIL_RESEND_FAILED_MESSAGE,
  EMAIL_RESEND_SUPPORT_MESSAGE,
  EMAIL_RESEND_SUPPORT_THRESHOLD,
  EMAIL_RESEND_SUPPORT_TITLE,
  EMAIL_VERIFICATION_SENT_MESSAGE,
  IDENTITY_PROVIDER_OPTIONS,
} from '@lfx-one/shared/constants';
import { AddAccountDialogData, AddAccountDialogResult, IdentityProvider, IdentityProviderOption } from '@lfx-one/shared/interfaces';
import { isIdentityAlreadyLinkedError } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { useResendCooldown } from '@shared/utils/resend-cooldown';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { InputOtp } from 'primeng/inputotp';

@Component({
  selector: 'lfx-add-account-dialog',
  imports: [ButtonComponent, InputTextComponent, FormsModule, ReactiveFormsModule, InputOtp, OpenIntercomDirective],
  templateUrl: './add-account-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddAccountDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<AddAccountDialogData>);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly userService = inject(UserService);
  // Root instance — the app's <p-toast/> reads it, so a notice survives the dialog closing.
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly existingProviders: IdentityProvider[] = this.config.data?.existingProviders ?? [];
  public readonly providers: IdentityProviderOption[] = IDENTITY_PROVIDER_OPTIONS.filter((provider) => {
    if (provider.id === 'lfid') {
      return false;
    }
    const allowed = this.config.data?.allowedProviders;
    return !allowed || allowed.includes(provider.id);
  });

  public readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  public step = signal<'select' | 'connect'>('select');
  public selectedProvider = signal<IdentityProviderOption | null>(null);
  public isConnecting = signal(false);
  public codeSent = signal(false);
  public verificationCode = signal('');
  public verificationError = signal('');
  // Shows "contact support" for already-linked conflicts — detected via the shared util the
  // backend uses, so it works regardless of which subscribe callback set the error.
  public readonly showSupportLink = computed(() => isIdentityAlreadyLinkedError(this.verificationError()));
  public isVerifying = signal(false);

  private readonly resendCooldownUtil = useResendCooldown(this.destroyRef);
  public readonly resendCooldown = this.resendCooldownUtil.cooldown;
  // Resends sent for the pending address; once it reaches the threshold, Resend gives way to Contact support.
  public resendCount = signal(0);
  public readonly showResendSupport = computed(() => this.resendCount() >= EMAIL_RESEND_SUPPORT_THRESHOLD);
  public readonly codeNotReceivedHint = EMAIL_CODE_NOT_RECEIVED_HINT;
  public readonly codeNotReceivedTitle = EMAIL_CODE_NOT_RECEIVED_TITLE;
  public readonly resendSupportTitle = EMAIL_RESEND_SUPPORT_TITLE;
  public readonly verificationSentMessage = EMAIL_VERIFICATION_SENT_MESSAGE;
  public readonly resendSupportMessage = EMAIL_RESEND_SUPPORT_MESSAGE;

  public onSelectProvider(provider: IdentityProviderOption): void {
    if (provider.id === 'email') {
      this.selectedProvider.set(provider);
      this.step.set('connect');
    } else {
      this.handleSocialConnect(provider);
    }
  }

  public onSendCode(): void {
    if (this.form.controls.email.invalid) {
      this.form.controls.email.markAsTouched();
      return;
    }

    this.isConnecting.set(true);
    this.verificationError.set('');

    const email = this.form.getRawValue().email;

    this.userService.sendEmailVerificationCode(email).subscribe({
      next: (response) => {
        if (response.success) {
          this.codeSent.set(true);
          this.form.controls.email.disable();
          this.resendCount.set(0);
          this.resendCooldownUtil.start();
        } else {
          this.verificationError.set(response.message || response.error || 'Failed to send verification code');
        }
        this.isConnecting.set(false);
      },
      error: (err) => {
        this.verificationError.set(err.error?.message || err.error?.error || 'Failed to send verification code');
        this.isConnecting.set(false);
      },
    });
  }

  public onVerify(): void {
    const code = this.verificationCode();
    if (code.length !== 6) {
      return;
    }

    this.isVerifying.set(true);
    this.verificationError.set('');

    const email = this.form.getRawValue().email;

    this.userService.verifyAndLinkEmail(email, code).subscribe({
      next: (response) => {
        if (response.success) {
          // Already part of this account: nothing new was added, so say so instead of staying silent.
          if (response.status === EMAIL_ALREADY_CONNECTED_STATUS) {
            this.messageService.add({ severity: 'success', summary: EMAIL_ALREADY_CONNECTED_SUMMARY, detail: EMAIL_ALREADY_CONNECTED_MESSAGE });
          }
          const result: AddAccountDialogResult = {
            provider: 'email',
            identifier: email,
          };
          this.ref.close(result);
        } else {
          this.verificationError.set(response.message || response.error || 'Verification failed');
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
    if (this.resendCooldown() > 0 || this.isConnecting() || this.showResendSupport()) {
      return;
    }

    this.verificationCode.set('');
    this.verificationError.set('');
    this.isConnecting.set(true);

    const email = this.form.getRawValue().email;

    this.userService.sendEmailVerificationCode(email).subscribe({
      next: (response) => {
        if (!response.success) {
          this.verificationError.set(EMAIL_RESEND_FAILED_MESSAGE);
        } else {
          this.resendCount.update((count) => count + 1);
        }
        this.isConnecting.set(false);
        this.resendCooldownUtil.start();
      },
      error: () => {
        this.verificationError.set(EMAIL_RESEND_FAILED_MESSAGE);
        this.isConnecting.set(false);
      },
    });
  }

  public onChangeEmail(): void {
    if (this.isConnecting() || this.isVerifying()) {
      return;
    }

    this.codeSent.set(false);
    this.form.controls.email.enable();
    this.form.controls.email.reset();
    this.verificationCode.set('');
    this.verificationError.set('');
    this.resendCount.set(0);
    this.resendCooldownUtil.clear();
  }

  public onCancel(): void {
    this.resendCount.set(0);
    this.resendCooldownUtil.clear();
    this.ref.close(null);
  }

  private handleSocialConnect(provider: IdentityProviderOption): void {
    // Navigate to social connect endpoint which handles the OAuth flow. Linking is an OAuth
    // handshake, so this leaves the page; hand the server the page we're leaving so it returns
    // here rather than to the Identities tab, which is only one of the places this dialog opens
    // from. The path is allowlisted server-side, and only its pathname is kept.
    const returnTo = encodeURIComponent(window.location.pathname);
    window.location.href = `/api/profile/identities/social/connect?provider=${provider.id}&returnTo=${returnTo}`;
  }
}
