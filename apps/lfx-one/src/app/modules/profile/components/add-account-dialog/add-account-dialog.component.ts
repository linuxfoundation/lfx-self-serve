// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { IDENTITY_PROVIDER_OPTIONS } from '@lfx-one/shared/constants';
import { AddAccountDialogData, AddAccountDialogResult, IdentityProvider, IdentityProviderOption } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { useResendCooldown } from '@shared/utils/resend-cooldown';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { InputOtp } from 'primeng/inputotp';

@Component({
  selector: 'lfx-add-account-dialog',
  imports: [ButtonComponent, InputTextComponent, FormsModule, ReactiveFormsModule, InputOtp],
  templateUrl: './add-account-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddAccountDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<AddAccountDialogData>);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly userService = inject(UserService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly existingProviders: IdentityProvider[] = this.config.data?.existingProviders ?? [];
  public readonly providers: IdentityProviderOption[] = IDENTITY_PROVIDER_OPTIONS.filter((p) => p.id !== 'lfid');

  public readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  public step = signal<'select' | 'connect'>('select');
  public selectedProvider = signal<IdentityProviderOption | null>(null);
  public isConnecting = signal(false);
  public codeSent = signal(false);
  public verificationCode = signal('');
  public verificationError = signal('');
  public isVerifying = signal(false);

  private readonly resendCooldownUtil = useResendCooldown(this.destroyRef);
  public readonly resendCooldown = this.resendCooldownUtil.cooldown;

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
          this.resendCooldownUtil.start();
        } else {
          this.verificationError.set(response.error || response.message || 'Failed to send verification code');
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
          const result: AddAccountDialogResult = {
            provider: 'email',
            identifier: email,
          };
          this.ref.close(result);
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
    this.isConnecting.set(true);

    const email = this.form.getRawValue().email;

    this.userService.sendEmailVerificationCode(email).subscribe({
      next: (response) => {
        if (!response.success) {
          this.verificationError.set(response.error || response.message || 'Failed to resend code');
        }
        this.isConnecting.set(false);
        this.resendCooldownUtil.start();
      },
      error: (err) => {
        this.verificationError.set(err.error?.message || err.error?.error || 'Failed to resend code');
        this.isConnecting.set(false);
      },
    });
  }

  public onCancel(): void {
    this.resendCooldownUtil.clear();
    this.ref.close(null);
  }

  private handleSocialConnect(provider: IdentityProviderOption): void {
    // Navigate to social connect endpoint which handles the OAuth flow
    window.location.href = `/api/profile/identities/social/connect?provider=${provider.id}`;
  }
}
