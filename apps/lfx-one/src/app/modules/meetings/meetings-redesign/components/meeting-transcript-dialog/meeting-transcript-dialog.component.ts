// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MeetingTranscriptDialogData, TranscriptCue } from '@lfx-one/shared/interfaces';
import { parseTranscriptVtt } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiSpinnerComponent } from '@shared/uikit/spinner/spinner.component';
import { catchError, map, of } from 'rxjs';

import { MeetingDialogContextComponent } from '../meeting-dialog-context/meeting-dialog-context.component';

/**
 * Transcript of a past meeting on the meetings home: one message per cue with the speaker, its start time and the text.
 * @description Loads and parses the transcript file like the legacy transcript modal; a failed load reads as no content.
 */
@Component({
  selector: 'lfx-meeting-transcript-dialog',
  imports: [MeetingDialogContextComponent, UiAvatarComponent, UiModalComponent, UiSpinnerComponent],
  templateUrl: './meeting-transcript-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingTranscriptDialogComponent {
  private readonly data = inject<MeetingTranscriptDialogData>(DIALOG_DATA);
  private readonly meetingService = inject(MeetingService);

  protected readonly row = this.data.row;
  protected readonly origin = this.data.origin ?? 'page';
  /** Undefined while loading. */
  protected readonly cues: Signal<TranscriptCue[] | undefined> = this.initCues();

  private initCues(): Signal<TranscriptCue[] | undefined> {
    const cues$ = this.meetingService.getPastMeetingTranscriptContent(this.data.pastMeetingId).pipe(
      map((result) => parseTranscriptVtt(result?.content)),
      // As in the legacy modal, a failed load shows the empty line.
      catchError((error: unknown) => {
        console.error('Failed to load the meeting transcript:', error);
        return of([]);
      })
    );
    return toSignal(cues$, { initialValue: undefined });
  }
}
