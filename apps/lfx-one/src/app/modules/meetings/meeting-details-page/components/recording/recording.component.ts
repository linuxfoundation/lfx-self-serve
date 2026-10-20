// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MEETING_AGENDA_COLLAPSED_HEIGHT_PX, PAST_MEETING_SUMMARY_APPROVAL_LABELS } from '@lfx-one/shared/constants';
import { MeetingArtifactState, MeetingRecordingSectionState, MeetingSummaryArtifactState } from '@lfx-one/shared/interfaces';
import {
  getLargestSessionShareUrl,
  getPastMeetingResourceId,
  getPastMeetingSummaryApprovalState,
  getPastMeetingSummaryContent,
  getPastMeetingTranscriptUrl,
  toSafeExternalHref,
} from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { restoreFocusOnDialogClose } from '@shared/utils/restore-dialog-focus.util';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, map, Observable, of, startWith, switchMap } from 'rxjs';

import { MeetingSummaryModalComponent } from '../../../components/meeting-summary-modal/meeting-summary-modal.component';
import { TranscriptModalComponent } from '../../../components/transcript-modal/transcript-modal.component';
import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The V2 Recording & Transcript section, at the top of the content column of an ended meeting
 * (E4-01, #3255, FR-040).
 * @description The page renders it where `visibleSections().tools` allows (artifact access). Watch
 * recording opens the largest session's share URL (`getLargestSessionShareUrl`, as V1 does); Transcript
 * opens V1's transcript modal, unchanged. Each keeps V1's states apart: available, none (the meeting
 * has no such artifact) and no access (the viewer may not open it).
 *
 * As V1, the artifacts are read on `/api/past-meetings/:id/*`, which need a session and an occurrence
 * record: an anonymous viewer is asked to sign in, and an ended meeting opened by its series id, which
 * has no occurrence record yet, says its recording appears once it is ready. As V1, a failed read
 * counts as no such artifact (the BFF answers 404 for a failed lookup too).
 *
 * The AI summary (E4-03) sits under the actions, rendered from its markdown (no new parser) and
 * collapsed past the agenda's height, with Read full summary opening V1's summary modal. As V1, an
 * unapproved summary is shown to everyone who can read the summary, marked Pending. A summary record
 * with no content surfaces no affordance: it reads as no summary.
 */
@Component({
  selector: 'lfx-meeting-recording',
  imports: [ButtonComponent, ExpandableTextComponent, MarkdownRendererComponent, SkeletonModule],
  templateUrl: './recording.component.html',
})
export class MeetingRecordingComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly dialogService = inject(DialogService);
  private readonly document = inject(DOCUMENT);

  /** `lfx-button` as the prototype's 38px pills (Watch recording filled, Transcript outlined). */
  protected readonly primaryButtonClass =
    '!h-[38px] !gap-[8px] !rounded-full !border-[var(--md-accent)] !bg-[var(--md-accent)] !px-[18px] !py-0 !text-[13.5px] !font-semibold !text-[var(--md-surface-card)] focus-visible:!shadow-[var(--md-shadow-focus)]';
  protected readonly secondaryButtonClass =
    '!h-[38px] !gap-[8px] !rounded-full !border-[var(--md-border-strong)] !bg-[var(--md-surface-card)] !px-[16px] !py-0 !text-[13.5px] !font-semibold !text-[var(--md-text-heading)] hover:!bg-[var(--md-surface-hover)] focus-visible:!shadow-[var(--md-shadow-focus)]';

  protected readonly signInHref = this.state.signInHref;
  protected readonly summaryCollapsedHeight = MEETING_AGENDA_COLLAPSED_HEIGHT_PX;
  protected readonly approvalLabels = PAST_MEETING_SUMMARY_APPROVAL_LABELS;
  protected readonly section: Signal<MeetingRecordingSectionState> = this.initSection();

  public openSummary(): void {
    const summary = this.section().summary.record;
    if (!summary) {
      return;
    }
    // Focus goes back to Read full summary on close (#3260).
    const trigger = this.document.activeElement;
    const ref = this.dialogService.open(MeetingSummaryModalComponent, {
      header: summary.summary_data?.title || 'AI Summary',
      width: '700px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { summary },
    });
    restoreFocusOnDialogClose(ref, trigger);
  }

  public openTranscript(): void {
    const meeting = this.state.meeting();
    if (!meeting) {
      return;
    }
    const trigger = this.document.activeElement;
    const ref = this.dialogService.open(TranscriptModalComponent, {
      header: 'Transcript',
      width: '700px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { pastMeetingUid: getPastMeetingResourceId(meeting), meetingTitle: meeting.title },
    });
    restoreFocusOnDialogClose(ref, trigger);
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
        return { kind: 'fetch' as const, id: getPastMeetingResourceId(meeting) };
      },
      { equal: (a, b) => a?.kind === b?.kind && (a?.kind !== 'fetch' || (b?.kind === 'fetch' && a.id === b.id)) }
    );
    const loading: MeetingRecordingSectionState = {
      status: 'loading',
      recording: { status: 'none' },
      transcript: { status: 'none' },
      summary: { status: 'none' },
    };

    return toSignal(
      toObservable(request).pipe(
        switchMap((req): Observable<MeetingRecordingSectionState> => {
          if (!req) {
            return of(loading);
          }
          if (req.kind !== 'fetch') {
            return of({ status: req.kind, recording: { status: 'none' }, transcript: { status: 'none' }, summary: { status: 'none' } });
          }
          const recording$ = this.meetingService.getPastMeetingRecording(req.id).pipe(
            map((recording): MeetingArtifactState => {
              const url = toSafeExternalHref(getLargestSessionShareUrl(recording));
              return url ? { status: 'available', url } : { status: 'none' };
            }),
            catchError((error: unknown) => of(this.artifactFailure(error)))
          );
          const transcript$ = this.meetingService.getPastMeetingTranscript(req.id).pipe(
            map((transcript): MeetingArtifactState => (getPastMeetingTranscriptUrl(transcript) ? { status: 'available' } : { status: 'none' })),
            catchError((error: unknown) => of(this.artifactFailure(error)))
          );
          const summary$ = this.meetingService.getPastMeetingSummary(req.id).pipe(
            map((summary): MeetingSummaryArtifactState => {
              const content = getPastMeetingSummaryContent(summary);
              if (!content) {
                return { status: 'none' };
              }
              // As V1: a summary awaiting approval is shown to every viewer who can read it, marked Pending.
              return { status: 'available', content, approval: getPastMeetingSummaryApprovalState(summary), record: summary };
            }),
            catchError((error: unknown) => of(this.artifactFailure(error)))
          );
          return combineLatest([recording$, transcript$, summary$]).pipe(
            map(
              ([recording, transcript, summary]): MeetingRecordingSectionState =>
                // A 401 is an expired session (the routes sit behind the auth middleware), not a refusal:
                // the way forward is to sign in again, as the materials section does for its past route.
                [recording, transcript, summary].some((artifact) => artifact.status === 'session-expired')
                  ? { status: 'sign-in', recording: { status: 'none' }, transcript: { status: 'none' }, summary: { status: 'none' } }
                  : { status: 'ready', recording, transcript, summary }
            ),
            startWith(loading)
          );
        })
      ),
      { initialValue: loading }
    );
  }

  /**
   * 401: the session expired. 403: the viewer may not open it. Anything else, a 404 or a failure, reads
   * as no such artifact, as V1 reads every failed artifact read (the BFF answers 404 for a failed
   * lookup as for none).
   */
  private artifactFailure(error: unknown): MeetingArtifactState {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    if (status === 401) {
      return { status: 'session-expired' };
    }
    if (status === 403) {
      return { status: 'no-access' };
    }
    return { status: 'none' };
  }
}
