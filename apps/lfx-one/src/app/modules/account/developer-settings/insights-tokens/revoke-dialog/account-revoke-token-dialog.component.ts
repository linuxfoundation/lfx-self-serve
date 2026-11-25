// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';
import { ACCOUNT_DEVELOPER_SETTINGS_COPY } from '@lfx-one/shared/constants';
import { AccountRevokeInsightsTokenDialogData } from '@lfx-one/shared/interfaces';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';

/** "Revoke token?" on Account & Settings › Developer settings (#6081). Closes with `true` to revoke the token. */
@Component({
  selector: 'lfx-account-revoke-token-dialog',
  imports: [UiModalComponent, UiButtonComponent],
  templateUrl: './account-revoke-token-dialog.component.html',
})
export class AccountRevokeTokenDialogComponent {
  protected readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
  protected readonly name = inject<AccountRevokeInsightsTokenDialogData>(DIALOG_DATA).name;
  protected readonly copy = ACCOUNT_DEVELOPER_SETTINGS_COPY;
}
