// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { TableComponent } from '@components/table/table.component';
import {
  MENTORSHIP_MENTEE_APPLICANT_BANNER_BODY,
  MENTORSHIP_MENTEE_APPLICANT_BANNER_LIMIT_SUFFIX,
  MENTORSHIP_MENTEE_APPLICANT_BANNER_TITLE_SUFFIX_PLURAL,
  MENTORSHIP_MENTEE_APPLICANT_BANNER_TITLE_SUFFIX_SINGULAR,
  MENTORSHIP_MENTEE_APPLICATION_LIMIT,
  MENTORSHIP_MENTEE_EMPTY_SUBTITLE,
  MENTORSHIP_MENTEE_EMPTY_TITLE,
  MENTORSHIP_MENTEE_FIND_PROGRAM_LABEL,
  MENTORSHIP_MENTEE_FIND_PROGRAM_URL,
  MENTORSHIP_MENTEE_OVERVIEW_LOAD_ERROR,
  MENTORSHIP_MENTEE_PAST_APPLICATIONS_TITLE,
  MENTORSHIP_MENTEE_TASKS_URL,
  MENTORSHIP_MENTEE_VIEW_TASKS_LABEL,
  MENTORSHIP_MENTEE_WITHDRAW_LABEL,
  MENTORSHIP_MENTEE_WITHDRAW_TOAST_SUMMARY,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeOverview } from '@lfx-one/shared/interfaces';
import { buildMentorshipMenteeOverview } from '@lfx-one/shared/utils';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { catchError, map, of, switchMap, tap } from 'rxjs';

/**
 * Overview child of the mentee shell. With no applications it shows the empty state and a
 * link to browse programs; otherwise a banner counting the pending applications, one card
 * per pending, accepted or graduated application, and a Past Applications table for the rest.
 */
@Component({
  selector: 'lfx-mentorship-mentee-overview',
  imports: [AvatarComponent, EmptyStateComponent, RouteLoadingComponent, NgClass, TableComponent, DatePipe],
  templateUrl: './mentee-overview.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeOverviewComponent {
  private readonly menteeService = inject(MentorshipMenteeService);
  private readonly comingSoonService = inject(MentorshipComingSoonService);
  private readonly router = inject(Router);

  protected readonly emptyTitle = MENTORSHIP_MENTEE_EMPTY_TITLE;
  protected readonly emptySubtitle = MENTORSHIP_MENTEE_EMPTY_SUBTITLE;
  protected readonly findProgramLabel = MENTORSHIP_MENTEE_FIND_PROGRAM_LABEL;
  protected readonly findProgramUrl = MENTORSHIP_MENTEE_FIND_PROGRAM_URL;
  protected readonly viewTasksLabel = MENTORSHIP_MENTEE_VIEW_TASKS_LABEL;
  protected readonly withdrawLabel = MENTORSHIP_MENTEE_WITHDRAW_LABEL;
  protected readonly pastApplicationsTitle = MENTORSHIP_MENTEE_PAST_APPLICATIONS_TITLE;

  protected readonly hasLoaded = signal(false);
  protected readonly loadError = signal<string | null>(null);

  protected readonly overview: Signal<MentorshipMenteeOverview | null> = this.initOverview();

  protected readonly pendingCount = computed(() => this.overview()?.pendingCount ?? 0);

  /** "N application(s) under review" — switches between singular and plural. */
  protected readonly bannerTitleSuffix = computed(() =>
    this.pendingCount() === 1 ? MENTORSHIP_MENTEE_APPLICANT_BANNER_TITLE_SUFFIX_SINGULAR : MENTORSHIP_MENTEE_APPLICANT_BANNER_TITLE_SUFFIX_PLURAL
  );

  /** Appends the application-limit sentence once the mentee holds the maximum number of pending applications. */
  protected readonly bannerBody = computed(() =>
    this.pendingCount() >= MENTORSHIP_MENTEE_APPLICATION_LIMIT
      ? MENTORSHIP_MENTEE_APPLICANT_BANNER_BODY + MENTORSHIP_MENTEE_APPLICANT_BANNER_LIMIT_SUFFIX
      : MENTORSHIP_MENTEE_APPLICANT_BANNER_BODY
  );

  protected onViewTasks(): void {
    void this.router.navigate([MENTORSHIP_MENTEE_TASKS_URL]);
  }

  protected onWithdraw(): void {
    this.comingSoonService.notify(MENTORSHIP_MENTEE_WITHDRAW_TOAST_SUMMARY);
  }

  protected retry(): void {
    this.menteeService.clearMenteeCaches();
  }

  private initOverview(): Signal<MentorshipMenteeOverview | null> {
    return toSignal(
      toObservable(this.menteeService.menteeApplicationsRevision).pipe(
        tap(() => {
          this.hasLoaded.set(false);
          this.loadError.set(null);
        }),
        switchMap(() =>
          this.menteeService.getMenteeApplications().pipe(
            map((response) => buildMentorshipMenteeOverview(response.data)),
            tap(() => this.hasLoaded.set(true)),
            catchError((error: HttpErrorResponse) => {
              this.hasLoaded.set(true);
              this.loadError.set(serverAuthoredMessage(error, MENTORSHIP_MENTEE_OVERVIEW_LOAD_ERROR));
              return of(null);
            })
          )
        )
      ),
      { initialValue: null }
    );
  }
}
