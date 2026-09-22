// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { MENTORSHIP_MENTEE_TASKS_TAB_PREREQUISITE_LABEL } from '@lfx-one/shared/constants';
import { MentorshipMenteeApplicationView, MentorshipMenteeOverviewApplicant } from '@lfx-one/shared/interfaces';
import { buildMentorshipMenteeApplicationViews, normalizeMentorshipMenteeTaskStatus } from '@lfx-one/shared/utils';
import { MentorshipService } from '@services/mentorship.service';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import { MenteeTaskRowComponent } from '../mentee-task-row/mentee-task-row.component';

/**
 * Applicant phase of the My Application Tasks tab — prerequisite tasks grouped by
 * application card. Mounted by `MenteeApplicationTasksComponent` only while the
 * resolved phase is `applicant`, so it fetches its own overview on init.
 */
@Component({
  selector: 'lfx-mentee-applicant-tasks',
  imports: [NgClass, EmptyStateComponent, RouteLoadingComponent, MenteeTaskRowComponent],
  templateUrl: './mentee-applicant-tasks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeApplicantTasksComponent {
  // ---- 1. DI ----------------------------------------------------------------
  private readonly mentorshipService = inject(MentorshipService);

  // ---- 2. Template constants ------------------------------------------------
  protected readonly prerequisiteLabel = MENTORSHIP_MENTEE_TASKS_TAB_PREREQUISITE_LABEL;

  // ---- 3. Simple writable signals -------------------------------------------
  protected readonly error = signal<string | null>(null);
  /** Reload trigger — bumped by the retry handler to force a re-fetch. */
  private readonly reloadTrigger = signal(0);

  // ---- 4. Complex computed / toSignal signals (via private init functions) --
  private readonly overview = this.initOverview();
  protected readonly loaded = computed(() => this.overview() !== null || this.error() !== null);
  protected readonly applications = computed<MentorshipMenteeApplicationView[] | null>(() => {
    const data = this.overview();
    return data ? buildMentorshipMenteeApplicationViews(data.applications) : null;
  });
  protected readonly applicantForm = this.initApplicantForm();

  // ---- 5. Actions -----------------------------------------------------------

  /** Retry the applicant-phase overview fetch. */
  protected retry(): void {
    this.error.set(null);
    this.reloadTrigger.update((n) => n + 1);
  }

  // ---- 6. Private initializers ----------------------------------------------

  private initOverview(): Signal<MentorshipMenteeOverviewApplicant | null> {
    return toSignal(
      toObservable(this.reloadTrigger).pipe(
        tap(() => this.error.set(null)),
        switchMap(() =>
          this.mentorshipService.getMenteeOverview().pipe(
            map((res): MentorshipMenteeOverviewApplicant | null => (res.phase === 'applicant' ? res : null)),
            catchError((err: unknown) => {
              const msg =
                err instanceof HttpErrorResponse
                  ? serverAuthoredMessage(err, 'Could not load application tasks. Please retry.')
                  : 'Could not load application tasks. Please retry.';
              this.error.set(msg);
              return of(null);
            })
          )
        )
      ),
      { initialValue: null }
    );
  }

  private initApplicantForm(): Signal<FormGroup<Record<string, FormControl<string>>>> {
    return computed(() => {
      const data = this.overview();
      const controls: Record<string, FormControl<string>> = {};
      if (data?.applications) {
        for (const app of data.applications) {
          for (const task of app.tasks ?? []) {
            controls[task.id] = new FormControl(normalizeMentorshipMenteeTaskStatus(task.status), { nonNullable: true });
          }
        }
      }
      return new FormGroup(controls);
    });
  }
}
