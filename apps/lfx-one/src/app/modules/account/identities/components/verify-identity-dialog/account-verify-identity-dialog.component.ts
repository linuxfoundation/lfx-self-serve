// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { isPlatformBrowser } from '@angular/common';
import { Component, inject, PLATFORM_ID } from '@angular/core';
import { ACCOUNT_IDENTITIES_PATH, IDENTITY_PROVIDER_LABELS } from '@lfx-one/shared/constants';
import { VerifyIdentityDialogData } from '@lfx-one/shared/interfaces';
import { EmailCodeVerificationService } from '@services/email-code-verification.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';

import { AccountEmailCodeStepComponent } from '../email-code-step/account-email-code-step.component';

/**
 * "Verify identity" on Account & Settings › Identities (#6074). An email is confirmed with a code; a social account by signing in to
 * it, which leaves for the provider and comes back here. Closes with `true` once an email is verified.
 */
@Component({
  selector: 'lfx-account-verify-identity-dialog',
  imports: [UiModalComponent, UiButtonComponent, AccountEmailCodeStepComponent],
  providers: [EmailCodeVerificationService],
  templateUrl: './account-verify-identity-dialog.component.html',
})
export class AccountVerifyIdentityDialogComponent {
  protected readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
  protected readonly verification = inject(EmailCodeVerificationService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly identity = inject<VerifyIdentityDialogData>(DIALOG_DATA).identity;
  protected readonly providerLabel: string = IDENTITY_PROVIDER_LABELS[this.identity.provider] ?? this.identity.provider;
  protected readonly isEmail = this.identity.provider === 'email';

  protected sendCode(): void {
    this.verification.send(this.identity.identifier);
  }

  protected verify(): void {
    this.verification.verify(this.identity.identifier, () => this.dialogRef.close(true));
  }

  protected continueWithProvider(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.location.href = `/api/profile/identities/social/connect?provider=${encodeURIComponent(this.identity.provider)}&returnTo=${encodeURIComponent(ACCOUNT_IDENTITIES_PATH)}`;
    }
  }
}
