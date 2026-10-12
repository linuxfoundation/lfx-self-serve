// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { MeetingArtifactState, MeetingRecordingSectionState } from '@lfx-one/shared/interfaces';
import {
  formatRecordingDuration,
  formatRecordingDurationSpoken,
  getLargestSessionShareUrl,
  getPastMeetingResourceId,
  getPastMeetingTranscriptUrl,
  toSafeExternalHref,
} from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, map, Observable, of, startWith, switchMap } from 'rxjs';

import { TranscriptModalComponent } from '../../../components/transcript-modal/transcript-modal.component';
import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The V2 Recording & Transcript section, at the top of the content column of an ended meeting
 * (E4-01, #3255, FR-040).
 * @description The page renders it where `visibleSections().tools` allows (artifact access). Watch
 * recording opens the largest session's share URL (`getLargestSessionShareUrl`, as V1 does); Transcript
 * opens V1's transcript modal, unchanged. Each keeps V1's three states apart: available, none (the
 * meeting has no such artifact) and no access (the viewer may not open it), plus a read error.
 *
 * The artifact routes need a session and an occurrence record, so an anonymous viewer is asked to
 * sign in (until the public artifact routes, E4-04), and an ended meeting opened by its series id,
 * which has no occurrence record yet, says its recording appears once it is ready. The recording's
 * length (E4-02) shows on the still when the BFF could measure it. The AI summary (E4-03) joins
 * this section later.
 */
@Component({
  selector: 'lfx-meeting-recording',
  imports: [ButtonComponent, SkeletonModule],
  templateUrl: './recording.component.html',
})
export class MeetingRecordingComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly dialogService = inject(DialogService);

  /** `lfx-button` as the prototype's 38px pills (Watch recording filled, Transcript outlined). */
  protected readonly primaryButtonClass =
    '!h-[38px] !gap-[8px] !rounded-full !border-[var(--md-accent)] !bg-[var(--md-accent)] !px-[18px] !py-0 !text-[13.5px] !font-semibold !text-[var(--md-surface-card)] focus-visible:!shadow-[var(--md-shadow-focus)]';
  protected readonly secondaryButtonClass =
    '!h-[38px] !gap-[8px] !rounded-full !border-[var(--md-border-strong)] !bg-[var(--md-surface-card)] !px-[16px] !py-0 !text-[13.5px] !font-semibold !text-[var(--md-text-heading)] hover:!bg-[var(--md-surface-hover)] focus-visible:!shadow-[var(--md-shadow-focus)]';

  protected readonly signInHref = this.state.signInHref;
  /** Bumped to read the artifacts again after a read error. */
  private readonly refreshCount = signal(0);
  protected readonly section: Signal<MeetingRecordingSectionState> = this.initSection();
  /** What failed to load, for the error line: the recording, the transcript, or both. */
  protected readonly failedArtifacts = computed(() => {
    const { recording, transcript } = this.section();
    const failed = [recording.status === 'error' && 'recording', transcript.status === 'error' && 'transcript'].filter(Boolean);
    return failed.join(' and ');
  });

  public retry(): void {
    this.refreshCount.update((count) => count + 1);
  }

  public openTranscript(): void {
    const meeting = this.state.meeting();
    if (!meeting) {
      return;
    }
    this.dialogService.open(TranscriptModalComponent, {
      header: 'Transcript',
      width: '700px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { pastMeetingUid: getPastMeetingResourceId(meeting), meetingTitle: meeting.title },
    });
  }

  private initSection(): Signal<MeetingRecordingSectionState> {
    const request = computed(
      () => {
        const meeting = this.state.meeting();
        if (!meeting || !this.state.matchesRoute()) {
          return null;
        }
        if (!this.userService.authenticated()) {
          return { kind: 'sign-in' as const };
        }
        if (!this.state.loadedViaPastMeetingId()) {
          return { kind: 'pending' as const };
        }
        return { kind: 'fetch' as const, id: getPastMeetingResourceId(meeting), refresh: this.refreshCount() };
      },
      { equal: (a, b) => a?.kind === b?.kind && (a?.kind !== 'fetch' || (b?.kind === 'fetch' && a.id === b.id && a.refresh === b.refresh)) }
    );
    const loading: MeetingRecordingSectionState = { status: 'loading', recording: { status: 'none' }, transcript: { status: 'none' } };

    return toSignal(
      toObservable(request).pipe(
        switchMap((req): Observable<MeetingRecordingSectionState> => {
          if (!req) {
            return of(loading);
          }
          if (req.kind !== 'fetch') {
            return of({ status: req.kind, recording: { status: 'none' }, transcript: { status: 'none' } });
          }
          const recording$ = this.meetingService.getPastMeetingRecording(req.id).pipe(
            map((recording): MeetingArtifactState => {
              const url = toSafeExternalHref(getLargestSessionShareUrl(recording));
              // The BFF measures the linked session (E4-02); no length is shown rather than a guess.
              const duration = formatRecordingDuration(recording.duration_seconds) ?? undefined;
              const durationLabel = formatRecordingDurationSpoken(recording.duration_seconds) ?? undefined;
              return url ? { status: 'available', url, duration, durationLabel } : { status: 'none' };
            }),
            catchError((error: unknown) => of(this.artifactFailure(error, 'recording')))
          );
          const transcript$ = this.meetingService.getPastMeetingTranscript(req.id).pipe(
            map((transcript): MeetingArtifactState => (getPastMeetingTranscriptUrl(transcript) ? { status: 'available' } : { status: 'none' })),
            catchError((error: unknown) => of(this.artifactFailure(error, 'transcript')))
          );
          return combineLatest([recording$, transcript$]).pipe(
            map(
              ([recording, transcript]): MeetingRecordingSectionState =>
                // A 401 is an expired session (the routes sit behind the auth middleware), not a refusal:
                // the way forward is to sign in again, as the materials section does for its past route.
                recording.status === 'session-expired' || transcript.status === 'session-expired'
                  ? { status: 'sign-in', recording: { status: 'none' }, transcript: { status: 'none' } }
                  : { status: 'ready', recording, transcript }
            ),
            startWith(loading)
          );
        })
      ),
      { initialValue: loading }
    );
  }

  /**
   * 404: the meeting has no such artifact (the BFF answers 404 only for an empty result). 401: the
   * session expired. 403: the viewer may not open it. Anything else, an upstream failure included:
   * an error, with Try again.
   */
  private artifactFailure(error: unknown, artifact: string): MeetingArtifactState {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    if (status === 404) {
      return { status: 'none' };
    }
    if (status === 401) {
      return { status: 'session-expired' };
    }
    if (status === 403) {
      return { status: 'no-access' };
    }
    console.error(`Failed to load the meeting ${artifact}`, error);
    return { status: 'error' };
  }
}
