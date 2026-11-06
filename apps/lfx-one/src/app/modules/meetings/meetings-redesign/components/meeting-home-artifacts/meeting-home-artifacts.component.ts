// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MEETINGS_HOME_SUMMARY_ARTIFACT } from '@lfx-one/shared/constants';
import { Meeting, MeetingHomeArtifact, MeetingHomeRow, PastMeeting } from '@lfx-one/shared/interfaces';
import { getPastMeetingSummaryContent, isPastMeetingSummaryAwaitingApproval } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiSplitButtonComponent } from '@shared/uikit/split-button/split-button.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { finalize, Observable, take } from 'rxjs';

import { MeetingsHomeDialogsService } from '../../services/meetings-home-dialogs.service';
import { MeetingsHomeStore } from '../../services/meetings-home.store';

/**
 * Recording and AI Summary buttons of a past meetings home row, each shown only when the past feed has it.
 * @description Recording opens the feed's share link in a new tab, and its split half copies it. AI Summary fetches the
 * summary on click and opens its dialog; an organizer sees "Review summary" until it is approved. Both stay labelled at every width.
 */
@Component({
  selector: 'lfx-meeting-home-artifacts',
  imports: [UiButtonComponent, UiSplitButtonComponent],
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

  protected readonly loadingSummary: WritableSignal<boolean> = signal(false);
  // Comes with the feed so the copy runs within the click; no link (or a failed lookup) hides the button.
  protected readonly recordingUrl: Signal<string | null> = computed(() => {
    const meeting: Partial<PastMeeting> = this.row().meeting;
    return meeting.recording_share_url || null;
  });
  protected readonly hasSummary: Signal<boolean> = computed(() => {
    const meeting: Meeting | PastMeeting = this.row().meeting;
    return 'has_ai_summary' in meeting && meeting.has_ai_summary === true;
  });
  /** The organizer's summary awaits approval: the Last card's copy, else false once the feed's summary was approved this session, else the feed. */
  protected readonly summaryPending: Signal<boolean> = computed(() => {
    const row = this.row();
    const lastSummary = this.store.lastMeeting()?.key === row.key ? this.store.lastMeetingSummary() : null;
    if (lastSummary) return isPastMeetingSummaryAwaitingApproval(lastSummary);
    const meeting: Partial<PastMeeting> = row.meeting;
    if (meeting.ai_summary_uid && this.store.approvedSummaries().get(row.key) === meeting.ai_summary_uid) return false;
    return meeting.ai_summary_awaiting_approval === true;
  });

  protected openRecording(shareUrl: string): void {
    this.dialogs.openRecording(shareUrl);
  }

  protected copyRecordingLink(shareUrl: string): void {
    this.dialogs.copyRecordingLink(shareUrl);
  }

  protected openSummary(): void {
    const row = this.row();
    this.load(this.loadingSummary, this.meetingService.getPastMeetingSummary(row.key), MEETINGS_HOME_SUMMARY_ARTIFACT, (summary) => {
      // The dialog leaves the visibility check to its caller.
      const visible = getPastMeetingSummaryContent(row.meeting, summary) !== null;
      // The Last meeting card shows this summary too when the row is the last meeting.
      if (visible) this.dialogs.openSummary(row, summary, (change) => this.store.applySummaryChange(row.key, change));
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
