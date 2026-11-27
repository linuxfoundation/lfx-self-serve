// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';
import type { MeetingComposerMode } from '@lfx-one/shared/interfaces';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';

/** Asks before an open composer with unsaved work closes; closes with `true` to discard. */
@Component({
  selector: 'lfx-meeting-composer-discard-dialog',
  imports: [UiModalComponent, UiButtonComponent],
  templateUrl: './meeting-composer-discard-dialog.component.html',
})
export class MeetingComposerDiscardDialogComponent {
  private readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly mode = inject<MeetingComposerMode>(DIALOG_DATA);

  protected readonly heading = this.mode === 'edit' ? 'Discard your changes?' : 'Discard this meeting?';
  protected readonly subtitle = this.mode === 'edit' ? 'Your edits to this meeting won’t be saved.' : 'You’ll lose everything you’ve entered so far.';

  protected keepEditing(): void {
    this.dialogRef.close(false);
  }

  protected discard(): void {
    this.dialogRef.close(true);
  }
}
