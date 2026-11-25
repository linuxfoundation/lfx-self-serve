// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, inject, signal } from '@angular/core';
import { IDENTITY_PROVIDER_LABELS } from '@lfx-one/shared/constants';
import { RemoveIdentityDialogData } from '@lfx-one/shared/interfaces';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiCheckboxComponent } from '@shared/uikit/checkbox/checkbox.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';

/**
 * Confirms removing an identity on Account & Settings › Identities (#6074): "This is not you?" for an unverified one, and
 * "Remove verified identity", which also asks the user to acknowledge the attribution impact. Closes with `true` to remove it.
 */
@Component({
  selector: 'lfx-account-remove-identity-dialog',
  imports: [UiModalComponent, UiButtonComponent, UiCheckboxComponent],
  templateUrl: './account-remove-identity-dialog.component.html',
})
export class AccountRemoveIdentityDialogComponent {
  protected readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
  protected readonly identity = inject<RemoveIdentityDialogData>(DIALOG_DATA).identity;
  protected readonly providerLabel: string = IDENTITY_PROVIDER_LABELS[this.identity.provider] ?? this.identity.provider;
  protected readonly isVerified = this.identity.state === 'verified';
  protected readonly acknowledged = signal(false);
}
