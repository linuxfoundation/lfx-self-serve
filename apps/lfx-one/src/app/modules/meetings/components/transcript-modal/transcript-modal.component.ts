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
  // Set only by the V2 page for a viewer with no session (#3528): read the text through the public
  // route, keyed by the past meeting's own uid. V1 never passes it.
  private readonly publicPastMeetingId = this.dialogConfig.data?.publicPastMeetingId as string | undefined;
  public readonly meetingTitle = (this.dialogConfig.data?.meetingTitle as string | undefined) ?? '';

  // State — the transcript file (WebVTT) is fetched on open and parsed into cues
  public readonly loading: WritableSignal<boolean> = signal(true);
  public readonly cues: WritableSignal<TranscriptCue[]> = signal([]);

  public ngOnInit(): void {
    // The transcript fetch is a browser-only side effect — skip during SSR and
    // when the dialog was opened without a meeting id.
    if ((!this.pastMeetingUid && !this.publicPastMeetingId) || !isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      return;
    }

    this.fetchTranscript();
  }

  private fetchTranscript(): void {
    const content$ = this.publicPastMeetingId
      ? this.meetingService.getPublicPastMeetingTranscriptContent(this.publicPastMeetingId)
      : this.meetingService.getPastMeetingTranscriptContent(this.pastMeetingUid as string);
    content$
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
