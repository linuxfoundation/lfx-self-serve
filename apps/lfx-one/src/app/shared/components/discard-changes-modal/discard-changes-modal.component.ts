// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';
import { ACCOUNT_DISCARD_CHANGES_MESSAGE, ACCOUNT_DISCARD_CHANGES_TITLE } from '@lfx-one/shared/constants';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';

/** Asks before leaving an Account & Settings page with unsaved changes; closes with `true` to discard them. */
@Component({
  selector: 'lfx-discard-changes-modal',
  imports: [UiModalComponent, UiButtonComponent],
  templateUrl: './discard-changes-modal.component.html',
})
export class DiscardChangesModalComponent {
  protected readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
  protected readonly heading = ACCOUNT_DISCARD_CHANGES_TITLE;
  protected readonly message = ACCOUNT_DISCARD_CHANGES_MESSAGE;
}
