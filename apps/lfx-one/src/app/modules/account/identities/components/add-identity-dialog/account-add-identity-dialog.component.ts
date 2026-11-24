// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { environment } from '@environments/environment';
import { ACCOUNT_IDENTITIES_COPY, ACCOUNT_IDENTITIES_PATH, IDENTITY_PROVIDER_OPTIONS } from '@lfx-one/shared/constants';
import { IdentityProviderOption } from '@lfx-one/shared/interfaces';
import { EmailCodeVerificationService } from '@services/email-code-verification.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { startWith } from 'rxjs';

import { AccountEmailCodeStepComponent } from '../email-code-step/account-email-code-step.component';

/**
 * "Add identity" on Account & Settings › Identities (#6074): pick a provider, then either connect a social account (it leaves for
 * the provider and comes back here) or add an email address and confirm it with a code. Closes with `true` once one is linked.
 */
@Component({
  selector: 'lfx-account-add-identity-dialog',
  imports: [ReactiveFormsModule, UiModalComponent, UiButtonComponent, UiBadgeComponent, UiInputComponent, AccountEmailCodeStepComponent],
  providers: [EmailCodeVerificationService],
  templateUrl: './account-add-identity-dialog.component.html',
})
export class AccountAddIdentityDialogComponent {
  protected readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
  protected readonly verification = inject(EmailCodeVerificationService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly email = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] });

  /** `pick` lists the providers; `email` asks for the address, and shows the code step once a code is sent. */
  protected readonly stage = signal<'pick' | 'email'>('pick');

  protected readonly copy = ACCOUNT_IDENTITIES_COPY;
  // Staging and production keep GitLab as Coming soon while dev validates the linking rollout (#4151).
  protected readonly gitlabLinkingDisabled = environment.production;
  protected readonly providers: IdentityProviderOption[] = IDENTITY_PROVIDER_OPTIONS.filter((provider) => provider.id !== 'lfid').map((provider) =>
    provider.id === 'email' ? { ...provider, description: ACCOUNT_IDENTITIES_COPY.emailProviderDescription } : provider
  );

  protected readonly emailValue: Signal<string> = toSignal(this.email.valueChanges.pipe(startWith(this.email.value)), { initialValue: '' });
  protected readonly emailError: Signal<string> = computed(() => (this.emailValue() && this.email.invalid ? 'Enter a valid email address' : ''));

  protected choose(provider: IdentityProviderOption): void {
    if (provider.id === 'email') {
      this.stage.set('email');
      return;
    }
    // Linking is an OAuth handshake that leaves the page; the server returns here, an allowlisted path.
    if (isPlatformBrowser(this.platformId)) {
      window.location.href = `/api/profile/identities/social/connect?provider=${provider.id}&returnTo=${encodeURIComponent(ACCOUNT_IDENTITIES_PATH)}`;
    }
  }

  protected sendCode(): void {
    if (this.email.invalid) {
      this.email.markAsTouched();
      return;
    }
    this.email.disable({ emitEvent: false });
    this.verification.send(this.email.getRawValue());
  }

  protected resend(): void {
    this.verification.resend(this.email.getRawValue());
  }

  protected verify(): void {
    this.verification.verify(this.email.getRawValue(), () => this.dialogRef.close(true));
  }

  /** From the code step, back to a different address; from the address, back to the providers. */
  protected back(): void {
    if (this.verification.codeSent()) {
      this.verification.reset();
      this.email.enable({ emitEvent: false });
      return;
    }
    this.email.enable({ emitEvent: false });
    this.verification.reset();
    this.stage.set('pick');
  }
}
