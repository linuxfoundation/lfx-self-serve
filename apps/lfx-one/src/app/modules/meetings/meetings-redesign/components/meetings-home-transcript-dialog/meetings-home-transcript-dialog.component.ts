// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, PLATFORM_ID, signal } from '@angular/core';
import { MeetingTranscriptDialogData, TranscriptCue } from '@lfx-one/shared/interfaces';
import { downloadFromUrl, parseTranscriptVtt } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiSpinnerComponent } from '@shared/uikit/spinner/spinner.component';
import { catchError, of, take } from 'rxjs';

/** Transcript of a past meeting on the meetings home: its WebVTT file fetched on open, shown as cues and downloadable. */
@Component({
  selector: 'lfx-meetings-home-transcript-dialog',
  imports: [UiButtonComponent, UiModalComponent, UiSpinnerComponent],
  templateUrl: './meetings-home-transcript-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingsHomeTranscriptDialogComponent {
  private readonly dialogRef = inject<DialogRef<void>>(DialogRef);
  private readonly data = inject<MeetingTranscriptDialogData>(DIALOG_DATA);
  private readonly meetingService = inject(MeetingService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly title = this.data.row.title;
  protected readonly loading = signal(true);
  protected readonly cues = signal<TranscriptCue[]>([]);
  private content = '';

  public constructor() {
    if (!isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      return;
    }
    this.meetingService
      .getPastMeetingTranscriptContent(this.data.row.key)
      .pipe(
        take(1),
        catchError((error: unknown) => {
          console.error('Failed to load transcript:', error);
          return of({ content: '' });
        })
      )
      .subscribe((result) => {
        this.content = result?.content ?? '';
        this.cues.set(parseTranscriptVtt(this.content));
        this.loading.set(false);
      });
  }

  protected download(): void {
    const url = URL.createObjectURL(new Blob([this.content], { type: 'text/vtt' }));
    downloadFromUrl(url, `${this.title.trim() || 'meeting'} transcript.vtt`);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
