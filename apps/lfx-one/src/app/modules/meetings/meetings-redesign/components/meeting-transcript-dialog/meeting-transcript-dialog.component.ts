// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MeetingTranscriptDialogData, TranscriptCue } from '@lfx-one/shared/interfaces';
import { parseTranscriptVtt } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiSpinnerComponent } from '@shared/uikit/spinner/spinner.component';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { MeetingDialogContextComponent } from '../meeting-dialog-context/meeting-dialog-context.component';

/**
 * Transcript of a past meeting on the meetings home: one message per cue with the speaker, its start time and the text.
 * @description Loads and parses the transcript file like the legacy transcript modal; a failed load shows an error with Retry.
 */
@Component({
  selector: 'lfx-meeting-transcript-dialog',
  imports: [MeetingDialogContextComponent, UiAvatarComponent, UiButtonComponent, UiEmptyStateComponent, UiModalComponent, UiSpinnerComponent],
  templateUrl: './meeting-transcript-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingTranscriptDialogComponent {
  private readonly data = inject<MeetingTranscriptDialogData>(DIALOG_DATA);
  private readonly meetingService = inject(MeetingService);

  protected readonly row = this.data.row;
  protected readonly origin = this.data.origin ?? 'page';
  private readonly reload = signal(0);
  /** Undefined while loading, `'error'` after a failed load. */
  protected readonly cues: Signal<TranscriptCue[] | 'error' | undefined> = this.initCues();

  protected retry(): void {
    this.reload.update((count) => count + 1);
  }

  private initCues(): Signal<TranscriptCue[] | 'error' | undefined> {
    const cues$ = toObservable(this.reload).pipe(
      switchMap(() =>
        this.meetingService.getPastMeetingTranscriptContent(this.data.pastMeetingId).pipe(
          map((result): TranscriptCue[] | 'error' => parseTranscriptVtt(result?.content)),
          catchError((error: unknown) => {
            console.error('Failed to load the meeting transcript:', error);
            return of('error' as const);
          }),
          startWith(undefined)
        )
      )
    );
    return toSignal(cues$, { initialValue: undefined });
  }
}
