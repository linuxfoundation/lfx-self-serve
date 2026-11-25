// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';
import { ACCOUNT_EMAIL_SETTINGS_COPY } from '@lfx-one/shared/constants';
import { AccountDeleteEmailDialogData } from '@lfx-one/shared/interfaces';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';

/** Confirms deleting an email address on Account & Settings › Email settings (#6079). Closes with `true` to delete it. */
@Component({
  selector: 'lfx-account-delete-email-dialog',
  imports: [UiModalComponent, UiButtonComponent],
  templateUrl: './account-delete-email-dialog.component.html',
})
export class AccountDeleteEmailDialogComponent {
  protected readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
  protected readonly email = inject<AccountDeleteEmailDialogData>(DIALOG_DATA).email;
  protected readonly copy = ACCOUNT_EMAIL_SETTINGS_COPY;
}
