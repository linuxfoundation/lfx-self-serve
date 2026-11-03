// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MEETING_HOME_RECORDING_ARTIFACT, MEETING_HOME_SUMMARY_ARTIFACT } from '@lfx-one/shared/constants';
import { Meeting, MeetingHomeArtifact, MeetingHomeRow, PastMeeting, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { getLargestSessionShareUrl, getPastMeetingSummaryContent } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { finalize, Observable, take } from 'rxjs';

import { MeetingsHomeDialogsService } from '../../services/meetings-home-dialogs.service';
import { MeetingsHomeStore } from '../../services/meetings-home.store';

/**
 * Recording and AI Summary buttons of a past meetings home row, each shown only when the past feed flags it.
 * @description Fetches the recording or summary on click and opens its meetings home dialog. In a centre column of
 * 900px or less they collapse to icon-only buttons with tooltips.
 */
@Component({
  selector: 'lfx-meeting-home-artifacts',
  imports: [UiButtonComponent],
  templateUrl: './meeting-home-artifacts.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class MeetingHomeArtifactsComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly dialogs = inject(MeetingsHomeDialogsService);
  private readonly toast = inject(UiToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(MeetingsHomeStore);

  public readonly row = input.required<MeetingHomeRow>();

  protected readonly loadingRecording: WritableSignal<boolean> = signal(false);
  protected readonly loadingSummary: WritableSignal<boolean> = signal(false);
  // Undefined (the lookup failed) hides the button like false.
  protected readonly hasRecording: Signal<boolean> = computed(() => {
    const meeting: Meeting | PastMeeting = this.row().meeting;
    return 'has_recording' in meeting && meeting.has_recording === true;
  });
  protected readonly hasSummary: Signal<boolean> = computed(() => {
    const meeting: Meeting | PastMeeting = this.row().meeting;
    return 'has_ai_summary' in meeting && meeting.has_ai_summary === true;
  });

  protected openRecording(): void {
    const row = this.row();
    this.load(this.loadingRecording, this.meetingService.getPastMeetingRecording(row.key), MEETING_HOME_RECORDING_ARTIFACT, (recording) => {
      const shareUrl = getLargestSessionShareUrl(recording);
      if (shareUrl) this.dialogs.openRecording(row, shareUrl);
      return !!shareUrl;
    });
  }

  protected openSummary(): void {
    const row = this.row();
    this.load(this.loadingSummary, this.meetingService.getPastMeetingSummary(row.key), MEETING_HOME_SUMMARY_ARTIFACT, (summary) => {
      // The dialog leaves the visibility check to its caller.
      const visible = getPastMeetingSummaryContent(row.meeting, summary) !== null;
      // The Last meeting card shows this summary too when the row is the last meeting.
      const onChange = row.key === this.store.lastMeeting()?.key ? (change: PastMeetingSummary) => this.store.setLastMeetingSummary(change) : undefined;
      if (visible) this.dialogs.openSummary(row, summary, onChange);
      return visible;
    });
  }

  /** Runs one artifact request; `open` returns false when the artifact turns out to be missing. */
  private load<T>(loading: WritableSignal<boolean>, request$: Observable<T>, artifact: MeetingHomeArtifact, open: (value: T) => boolean): void {
    if (loading()) return;
    loading.set(true);
    request$
      .pipe(
        take(1),
        finalize(() => loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (value) => {
          if (!open(value)) this.showUnavailable(artifact, false);
        },
        error: (error: unknown) => {
          // A 404 just means the meeting has no such artifact.
          const missing = error instanceof HttpErrorResponse && error.status === 404;
          if (!missing) console.error(`Failed to load a past meeting ${artifact.noun}:`, error);
          this.showUnavailable(artifact, !missing);
        },
      });
  }

  /** Only a failed request is worth retrying; a missing or not-yet-visible artifact is not. */
  private showUnavailable(artifact: MeetingHomeArtifact, retryable: boolean): void {
    this.toast.show({
      variant: 'error',
      position: 'bottom-center',
      message: `${artifact.title} unavailable`,
      description: retryable ? `We couldn't load this ${artifact.noun}. Please try again.` : `This ${artifact.noun} isn't available yet.`,
    });
  }
}
