// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, linkedSignal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MeetingDetailsArtifactData, MeetingDetailsArtifacts, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { getLargestSessionShareUrl, getPastMeetingSummaryContent, getPastMeetingTranscriptUrl, isPastMeetingCalendarRow } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { catchError, distinctUntilChanged, forkJoin, map, Observable, of, OperatorFunction, startWith, switchMap } from 'rxjs';

import { MeetingDetailsContext } from '../meeting-details.context';

/**
 * Recording, transcript and AI summary of the date the meeting details drawer shows, once it has ended.
 * @description Provided by the drawer, so the feature badges and the tools card read the same lookups.
 */
@Injectable()
export class MeetingDetailsArtifactsService {
  private readonly context = inject(MeetingDetailsContext);
  private readonly meetingService = inject(MeetingService);

  /** Undefined while loading, null before the date ends or without access. */
  public readonly artifacts: Signal<MeetingDetailsArtifactData | null | undefined> = this.initArtifacts();
  /** The summary, replaced by the organizer's edits and approval in the summary dialog. */
  public readonly summary: WritableSignal<PastMeetingSummary | null> = linkedSignal(() => this.artifacts()?.summary ?? null);
  /** Edited text, else generated, pending included as on the meeting page; blank counts as none. */
  public readonly summaryContent: Signal<string | null> = computed(() => getPastMeetingSummaryContent({ organizer: true }, this.summary()));
  /** What the feature badges show; null while the date has not ended. */
  public readonly flags: Signal<MeetingDetailsArtifacts | null> = computed(() => {
    if (this.context.state() !== 'ended') return null;
    const artifacts = this.artifacts();
    if (!artifacts) {
      // Loading or no access: the past feed's flags stand in.
      const meeting = this.context.meeting();
      const past = isPastMeetingCalendarRow(meeting) ? meeting : null;
      return { recording: past?.has_recording === true, transcript: false, summary: past?.has_ai_summary === true };
    }
    return { recording: !!artifacts.recordingUrl, transcript: !!artifacts.transcriptUrl, summary: !!this.summaryContent() };
  });

  private initArtifacts(): Signal<MeetingDetailsArtifactData | null | undefined> {
    const id = computed(() => (this.context.signedInAccess() ? this.context.pastMeetingId() : null));
    const artifacts$ = toObservable(id).pipe(
      distinctUntilChanged(),
      switchMap((pastMeetingId) => {
        if (!pastMeetingId) return of(null);
        return forkJoin({
          recordingUrl: this.meetingService.getPastMeetingRecording(pastMeetingId).pipe(
            map((recording) => getLargestSessionShareUrl(recording)),
            this.orNull('recording')
          ),
          transcriptUrl: this.meetingService.getPastMeetingTranscript(pastMeetingId).pipe(
            map((transcript) => getPastMeetingTranscriptUrl(transcript)),
            this.orNull('transcript')
          ),
          summary: this.meetingService.getPastMeetingSummary(pastMeetingId).pipe(this.orNull('summary')),
        }).pipe(startWith(undefined));
      })
    );
    return toSignal(artifacts$, { initialValue: undefined });
  }

  /** Shows a missing or failed artifact as unavailable, as the meeting page does; only a failure other than 404 is logged. */
  private orNull<T>(artifact: string): OperatorFunction<T, T | null> {
    return catchError((error: unknown): Observable<null> => {
      if (!(error instanceof HttpErrorResponse && error.status === 404)) console.error(`Failed to load the past meeting ${artifact}:`, error);
      return of(null);
    });
  }
}
