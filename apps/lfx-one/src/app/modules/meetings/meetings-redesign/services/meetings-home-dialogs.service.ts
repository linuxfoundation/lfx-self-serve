// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { inject, Injectable } from '@angular/core';
import { MeetingHomeRow, MeetingRecordingDialogData, MeetingSummaryDialogData, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { UiModalService } from '@shared/uikit/modal/modal.service';

import { MeetingsHomeRecordingDialogComponent } from '../components/meetings-home-recording-dialog/meetings-home-recording-dialog.component';
import { MeetingsHomeSummaryDialogComponent } from '../components/meetings-home-summary-dialog/meetings-home-summary-dialog.component';

/** Opens the meetings home dialogs for a past meeting's AI summary and recording. */
@Injectable({ providedIn: 'root' })
export class MeetingsHomeDialogsService {
  private readonly modal = inject(UiModalService);

  /** The caller checks the viewer may see the summary; `onChange` gets each saved edit or approval. */
  public openSummary(row: MeetingHomeRow, summary: PastMeetingSummary, onChange?: (summary: PastMeetingSummary) => void): DialogRef<void> {
    return this.modal.open<void, MeetingSummaryDialogData>(MeetingsHomeSummaryDialogComponent, { data: { row, summary, onChange } });
  }

  public openRecording(row: MeetingHomeRow, shareUrl: string): DialogRef<void> {
    return this.modal.open<void, MeetingRecordingDialogData>(MeetingsHomeRecordingDialogComponent, { data: { row, shareUrl } });
  }
}
