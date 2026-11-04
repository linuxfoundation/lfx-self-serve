// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MeetingRecordingDialogData } from '@lfx-one/shared/interfaces';
import { isValidUrl } from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';

/** Recording share link of a past meeting on the meetings home, to copy or open in a new tab, as in the legacy recording dialog. */
@Component({
  selector: 'lfx-meetings-home-recording-dialog',
  imports: [UiButtonComponent, UiModalComponent],
  templateUrl: './meetings-home-recording-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingsHomeRecordingDialogComponent {
  private readonly dialogRef = inject<DialogRef<void>>(DialogRef);
  private readonly data = inject<MeetingRecordingDialogData>(DIALOG_DATA);
  private readonly clipboard = inject(Clipboard);
  private readonly toast = inject(UiToastService);
  private readonly document = inject(DOCUMENT);

  protected readonly title = this.data.row.title;
  protected readonly shareUrl = this.data.shareUrl;
  protected readonly canView = isValidUrl(this.shareUrl);

  protected copy(): void {
    if (this.clipboard.copy(this.shareUrl)) {
      this.toast.show({ variant: 'dark', message: 'Recording URL copied to clipboard' });
    } else {
      this.toast.show({ variant: 'error', position: 'bottom-center', message: 'Failed to copy recording URL' });
    }
  }

  protected view(): void {
    if (!this.canView) return;
    this.document.defaultView?.open(this.shareUrl, '_blank', 'noopener,noreferrer');
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
