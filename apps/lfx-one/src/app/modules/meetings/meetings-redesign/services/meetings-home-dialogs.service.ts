// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { inject, Injectable } from '@angular/core';
import {
  MeetingHomeRow,
  MeetingRecordingDialogData,
  MeetingSummaryDialogData,
  MeetingTranscriptDialogData,
  PastMeetingSummary,
} from '@lfx-one/shared/interfaces';
import { UiModalService } from '@shared/uikit/modal/modal.service';

import { MeetingsHomeRecordingDialogComponent } from '../components/meetings-home-recording-dialog/meetings-home-recording-dialog.component';
import { MeetingsHomeSummaryDialogComponent } from '../components/meetings-home-summary-dialog/meetings-home-summary-dialog.component';
import { MeetingsHomeTranscriptDialogComponent } from '../components/meetings-home-transcript-dialog/meetings-home-transcript-dialog.component';

/** Opens the meetings home dialogs for a past meeting's AI summary, transcript and recording. */
@Injectable({ providedIn: 'root' })
export class MeetingsHomeDialogsService {
  private readonly modal = inject(UiModalService);

  /** The caller decides whether the viewer may see the summary; an organizer can edit and approve it, and `onChange` gets each save. */
  public openSummary(row: MeetingHomeRow, summary: PastMeetingSummary, onChange?: (summary: PastMeetingSummary) => void): DialogRef<void> {
    return this.modal.open<void, MeetingSummaryDialogData>(MeetingsHomeSummaryDialogComponent, { data: { row, summary, onChange } });
  }

  public openTranscript(row: MeetingHomeRow): DialogRef<void> {
    return this.modal.open<void, MeetingTranscriptDialogData>(MeetingsHomeTranscriptDialogComponent, { data: { row } });
  }

  public openRecording(row: MeetingHomeRow, shareUrl: string): DialogRef<void> {
    return this.modal.open<void, MeetingRecordingDialogData>(MeetingsHomeRecordingDialogComponent, { data: { row, shareUrl } });
  }
}
