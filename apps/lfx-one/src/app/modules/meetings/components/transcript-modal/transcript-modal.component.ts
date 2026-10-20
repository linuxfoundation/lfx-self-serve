// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, inject, OnInit, PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { parseTranscriptVtt, TranscriptCue } from '@lfx-one/shared';
import { MeetingService } from '@services/meeting.service';
import { DynamicDialogConfig } from 'primeng/dynamicdialog';
import { catchError, of, take } from 'rxjs';

@Component({
  selector: 'lfx-transcript-modal',
  imports: [],
  templateUrl: './transcript-modal.component.html',
})
export class TranscriptModalComponent implements OnInit {
  // Injected services
  private readonly dialogConfig = inject(DynamicDialogConfig);
  private readonly meetingService = inject(MeetingService);
  private readonly platformId = inject(PLATFORM_ID);

  // Inputs from dialog config (defensively read in case the dialog is opened without data)
  private readonly pastMeetingUid = this.dialogConfig.data?.pastMeetingUid as string | undefined;
  public readonly meetingTitle = (this.dialogConfig.data?.meetingTitle as string | undefined) ?? '';

  // State — the transcript file (WebVTT) is fetched on open and parsed into cues
  public readonly loading: WritableSignal<boolean> = signal(true);
  public readonly cues: WritableSignal<TranscriptCue[]> = signal([]);

  public ngOnInit(): void {
    // The transcript fetch is a browser-only side effect — skip during SSR and
    // when the dialog was opened without a meeting id.
    if (!this.pastMeetingUid || !isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      return;
    }

    this.fetchTranscript(this.pastMeetingUid);
  }

  private fetchTranscript(pastMeetingUid: string): void {
    this.meetingService
      .getPastMeetingTranscriptContent(pastMeetingUid)
      .pipe(
        take(1),
        catchError(() => of({ content: '' }))
      )
      .subscribe((result) => {
        this.cues.set(parseTranscriptVtt(result?.content));
        this.loading.set(false);
      });
  }
}
