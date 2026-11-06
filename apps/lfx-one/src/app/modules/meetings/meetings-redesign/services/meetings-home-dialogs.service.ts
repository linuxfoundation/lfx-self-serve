// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { DialogRef } from '@angular/cdk/dialog';
import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { MeetingHomeRow, MeetingSummaryDialogData, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { isValidUrl } from '@lfx-one/shared/utils';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';

import { MeetingsHomeSummaryDialogComponent } from '../components/meetings-home-summary-dialog/meetings-home-summary-dialog.component';

/** Opens a past meeting's AI summary dialog and its recording on the meetings home, and copies the recording link. */
@Injectable({ providedIn: 'root' })
export class MeetingsHomeDialogsService {
  private readonly modal = inject(UiModalService);
  private readonly clipboard = inject(Clipboard);
  private readonly toast = inject(UiToastService);
  private readonly document = inject(DOCUMENT);

  /** The caller checks the viewer may see the summary; `onChange` gets each saved edit or approval. */
  public openSummary(row: MeetingHomeRow, summary: PastMeetingSummary, onChange?: (summary: PastMeetingSummary) => void): DialogRef<void> {
    return this.modal.open<void, MeetingSummaryDialogData>(MeetingsHomeSummaryDialogComponent, { data: { row, summary, onChange } });
  }

  /** Opens the recording's share link in a new tab. */
  public openRecording(shareUrl: string): void {
    if (isValidUrl(shareUrl)) {
      this.document.defaultView?.open(shareUrl, '_blank', 'noopener,noreferrer');
    } else {
      this.toast.show({ variant: 'error', position: 'bottom-center', message: 'Failed to open recording' });
    }
  }

  /** Call it straight from the click: Safari only allows the copy during the user's gesture. */
  public copyRecordingLink(shareUrl: string): void {
    if (this.clipboard.copy(shareUrl)) {
      this.toast.show({ variant: 'dark', message: 'Recording link copied to clipboard' });
    } else {
      this.toast.show({ variant: 'error', position: 'bottom-center', message: 'Failed to copy recording link' });
    }
  }
}
