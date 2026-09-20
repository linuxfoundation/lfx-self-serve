// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, EventEmitter, inject, Output, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import {
  EMPTY_MENTORSHIP_MENTEE_OVERVIEW_RESPONSE,
  MENTORSHIP_MENTEE_ACTIVE_BADGE_LABEL,
  MENTORSHIP_MENTEE_ALL_TASKS_LABEL,
  MENTORSHIP_MENTEE_APPLICANT_BANNER_BODY,
  MENTORSHIP_MENTEE_APPLICANT_BANNER_TITLE_SUFFIX,
  MENTORSHIP_MENTEE_APPLICATION_STATUS_CLASSES,
  MENTORSHIP_MENTEE_APPLICATION_STATUS_LABELS,
  MENTORSHIP_MENTEE_DEV_VIEW_ACCEPTED_LABEL,
  MENTORSHIP_MENTEE_DEV_VIEW_APPLICANT_LABEL,
  MENTORSHIP_MENTEE_DEV_VIEW_EMPTY_LABEL,
  MENTORSHIP_MENTEE_EMPTY_SUBTITLE,
  MENTORSHIP_MENTEE_EMPTY_TITLE,
  MENTORSHIP_MENTEE_FIND_PROGRAM_LABEL,
  MENTORSHIP_MENTEE_FIND_PROGRAM_URL,
  MENTORSHIP_MENTEE_PAST_APPLICATIONS_TITLE,
  MENTORSHIP_MENTEE_PAST_OUTCOME_CLASSES,
  MENTORSHIP_MENTEE_PAST_OUTCOME_LABELS,
  MENTORSHIP_MENTEE_UP_NEXT_STATUS_CLASSES,
  MENTORSHIP_MENTEE_UP_NEXT_STATUS_LABELS,
  MENTORSHIP_MENTEE_UP_NEXT_TITLE,
  MENTORSHIP_MENTEE_VIEW_TASKS_LABEL,
  MENTORSHIP_MENTEE_WITHDRAW_LABEL,
  MENTORSHIP_MENTEE_WITHDRAW_TOAST_SUMMARY,
  MENTORSHIP_MENTEE_YOUR_MENTOR_LABEL,
} from '@lfx-one/shared/constants';
import {
  MentorshipMenteeApplication,
  MentorshipMenteeApplicationStatus,
  MentorshipMenteeOverviewAccepted,
  MentorshipMenteeOverviewApplicant,
  MentorshipMenteeOverviewResponse,
  MentorshipMenteePastOutcome,
  MentorshipMenteePhase,
  MentorshipMenteeUpNextTaskStatus,
} from '@lfx-one/shared/interfaces';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';
import { MentorshipService } from '@services/mentorship.service';
import { catchError, map, of, switchMap, tap } from 'rxjs';

/**
 * Overview child of the mentee shell — displays one of three phases:
 *
 * 1. **Empty** — no applications; CTA to browse programs
 * 2. **Applicant** — active application cards + past applications table
 * 3. **Accepted** — active program card with mentor + "Up Next" tasks
 *
 * Emits `phaseChange` and `openTaskCountChange` so the parent shell can
 * update its tab bar.
 */
@Component({
  selector: 'lfx-mentorship-mentee-overview',
  imports: [EmptyStateComponent, RouteLoadingComponent, NgClass],
  templateUrl: './mentee-overview.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeOverviewComponent {
  private readonly mentorshipService = inject(MentorshipService);
  private readonly comingSoonService = inject(MentorshipComingSoonService);

  /** Emitted when the API response phase is known. */
  @Output() readonly phaseChange = new EventEmitter<MentorshipMenteePhase>();
  /** Emitted when the open task count is known. */
  @Output() readonly openTaskCountChange = new EventEmitter<number>();

  protected readonly hasLoaded = signal(false);
  protected readonly loadError = signal<string | null>(null);

  /** Dev shortcut: override the phase requested from the BFF. */
  private readonly overridePhase = signal<MentorshipMenteePhase | null>(null);
  private readonly reloadTrigger = signal(0);

  private readonly overviewState: Signal<MentorshipMenteeOverviewResponse> = this.initOverview();

  protected readonly phase = computed<MentorshipMenteePhase>(() => this.overviewState().phase);

  /** Cast helpers for template type narrowing. */
  protected readonly applicantData = computed(() => (this.phase() === 'applicant' ? (this.overviewState() as MentorshipMenteeOverviewApplicant) : null));
  protected readonly acceptedData = computed(() => (this.phase() === 'accepted' ? (this.overviewState() as MentorshipMenteeOverviewAccepted) : null));

  // -- Label constants exposed to template ------------------------------------

  protected readonly emptyTitle = MENTORSHIP_MENTEE_EMPTY_TITLE;
  protected readonly emptySubtitle = MENTORSHIP_MENTEE_EMPTY_SUBTITLE;
  protected readonly findProgramLabel = MENTORSHIP_MENTEE_FIND_PROGRAM_LABEL;
  protected readonly findProgramUrl = MENTORSHIP_MENTEE_FIND_PROGRAM_URL;
  protected readonly bannerTitleSuffix = MENTORSHIP_MENTEE_APPLICANT_BANNER_TITLE_SUFFIX;
  protected readonly bannerBody = MENTORSHIP_MENTEE_APPLICANT_BANNER_BODY;
  protected readonly viewTasksLabel = MENTORSHIP_MENTEE_VIEW_TASKS_LABEL;
  protected readonly withdrawLabel = MENTORSHIP_MENTEE_WITHDRAW_LABEL;
  protected readonly pastApplicationsTitle = MENTORSHIP_MENTEE_PAST_APPLICATIONS_TITLE;
  protected readonly activeBadgeLabel = MENTORSHIP_MENTEE_ACTIVE_BADGE_LABEL;
  protected readonly yourMentorLabel = MENTORSHIP_MENTEE_YOUR_MENTOR_LABEL;
  protected readonly upNextTitle = MENTORSHIP_MENTEE_UP_NEXT_TITLE;
  protected readonly allTasksLabel = MENTORSHIP_MENTEE_ALL_TASKS_LABEL;

  // -- Dev shortcuts ----------------------------------------------------------

  protected readonly devViewEmptyLabel = MENTORSHIP_MENTEE_DEV_VIEW_EMPTY_LABEL;
  protected readonly devViewApplicantLabel = MENTORSHIP_MENTEE_DEV_VIEW_APPLICANT_LABEL;
  protected readonly devViewAcceptedLabel = MENTORSHIP_MENTEE_DEV_VIEW_ACCEPTED_LABEL;

  // -- Status helpers ---------------------------------------------------------

  protected applicationStatusLabel(status: MentorshipMenteeApplicationStatus): string {
    return MENTORSHIP_MENTEE_APPLICATION_STATUS_LABELS[status];
  }

  protected applicationStatusClass(status: MentorshipMenteeApplicationStatus): string {
    return MENTORSHIP_MENTEE_APPLICATION_STATUS_CLASSES[status];
  }

  protected pastOutcomeLabel(outcome: MentorshipMenteePastOutcome): string {
    return MENTORSHIP_MENTEE_PAST_OUTCOME_LABELS[outcome];
  }

  protected pastOutcomeClass(outcome: MentorshipMenteePastOutcome): string {
    return MENTORSHIP_MENTEE_PAST_OUTCOME_CLASSES[outcome];
  }

  protected upNextStatusLabel(status: MentorshipMenteeUpNextTaskStatus): string {
    return MENTORSHIP_MENTEE_UP_NEXT_STATUS_LABELS[status];
  }

  protected upNextStatusClass(status: MentorshipMenteeUpNextTaskStatus): string {
    return MENTORSHIP_MENTEE_UP_NEXT_STATUS_CLASSES[status];
  }

  protected taskProgress(completed: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((completed / total) * 100);
  }

  /** The banner shows "N applications under review". */
  protected applicationCount(): number {
    return this.applicantData()?.applications?.length ?? 0;
  }

  // -- Actions ----------------------------------------------------------------

  protected onWithdraw(_app: MentorshipMenteeApplication): void {
    this.comingSoonService.notify(MENTORSHIP_MENTEE_WITHDRAW_TOAST_SUMMARY);
  }

  /** Dev shortcut: switch to a different phase. */
  protected switchPhase(phase: MentorshipMenteePhase): void {
    this.overridePhase.set(phase);
    this.reloadTrigger.update((v) => v + 1);
  }

  protected retry(): void {
    this.reloadTrigger.update((v) => v + 1);
  }

  // -- Data loading -----------------------------------------------------------

  private initOverview(): Signal<MentorshipMenteeOverviewResponse> {
    return toSignal(
      toObservable(this.reloadTrigger).pipe(
        tap(() => {
          this.hasLoaded.set(false);
          this.loadError.set(null);
        }),
        switchMap(() =>
          this.mentorshipService.getMenteeOverview(this.overridePhase() ?? undefined).pipe(
            map((response) => {
              this.hasLoaded.set(true);
              this.phaseChange.emit(response.phase);
              if ('openTaskCount' in response) {
                this.openTaskCountChange.emit(response.openTaskCount);
              } else {
                this.openTaskCountChange.emit(0);
              }
              return response;
            }),
            catchError((error: HttpErrorResponse) => {
              this.hasLoaded.set(true);
              this.loadError.set(serverAuthoredMessage(error, 'We could not load your mentee overview. Please retry.'));
              return of(EMPTY_MENTORSHIP_MENTEE_OVERVIEW_RESPONSE);
            })
          )
        )
      ),
      { initialValue: EMPTY_MENTORSHIP_MENTEE_OVERVIEW_RESPONSE }
    );
  }
}
