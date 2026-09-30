// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { MENTORSHIP_MENTEE_TASKS_EMPTY_SUBTITLE, MENTORSHIP_MENTEE_TASKS_EMPTY_TITLE, MENTORSHIP_MENTEE_TASKS_LOAD_ERROR } from '@lfx-one/shared/constants';
import { MentorshipMenteeApplicationView } from '@lfx-one/shared/interfaces';
import { buildMentorshipMenteeOverview } from '@lfx-one/shared/utils';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import { MenteeAcceptedTasksComponent } from '../mentee-accepted-tasks/mentee-accepted-tasks.component';
import { MenteeApplicantTasksComponent } from '../mentee-applicant-tasks/mentee-applicant-tasks.component';

/**
 * My Tasks tab. Reads the mentee's applications and renders each accepted or graduated application
 * first (program card, status filter and its non-prerequisite tasks), then each pending application
 * with its prerequisite tasks. With no pending, accepted or graduated application it shows an empty
 * state.
 */
@Component({
  selector: 'lfx-mentorship-mentee-application-tasks',
  imports: [EmptyStateComponent, RouteLoadingComponent, MenteeApplicantTasksComponent, MenteeAcceptedTasksComponent],
  templateUrl: './mentee-application-tasks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeApplicationTasksComponent {
  private readonly menteeService = inject(MentorshipMenteeService);

  protected readonly emptyTitle = MENTORSHIP_MENTEE_TASKS_EMPTY_TITLE;
  protected readonly emptySubtitle = MENTORSHIP_MENTEE_TASKS_EMPTY_SUBTITLE;

  protected readonly hasLoaded = signal(false);
  protected readonly loadError = signal<string | null>(null);

  /** Pending, accepted and graduated applications, already ordered active → graduated → awaiting review → in progress. */
  private readonly cards: Signal<MentorshipMenteeApplicationView[]> = this.initCards();

  protected readonly acceptedApplications = computed(() => this.cards().filter((card) => card.accepted));
  protected readonly pendingApplications = computed(() => this.cards().filter((card) => !card.accepted));

  protected retry(): void {
    this.menteeService.clearMenteeCaches();
  }

  private initCards(): Signal<MentorshipMenteeApplicationView[]> {
    return toSignal(
      toObservable(this.menteeService.menteeApplicationsRevision).pipe(
        tap(() => {
          // The first load and a Retry after an error show the loader. Any other refresh (a saved task
          // status, say) keeps the tree mounted, so the filter chip and scroll position survive.
          if (this.loadError() !== null) {
            this.hasLoaded.set(false);
          }
          this.loadError.set(null);
        }),
        switchMap(() =>
          this.menteeService.getMenteeApplications().pipe(
            map((response) => buildMentorshipMenteeOverview(response.data).cards),
            tap(() => this.hasLoaded.set(true)),
            catchError((error: HttpErrorResponse) => {
              this.hasLoaded.set(true);
              this.loadError.set(serverAuthoredMessage(error, MENTORSHIP_MENTEE_TASKS_LOAD_ERROR));
              return of([] as MentorshipMenteeApplicationView[]);
            })
          )
        )
      ),
      { initialValue: [] as MentorshipMenteeApplicationView[] }
    );
  }
}
