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
import { MENTORSHIP_MENTEE_TASK_FILTER_OPTIONS } from '@lfx-one/shared/constants';
import { MentorshipMenteeTaskStatus, MentorshipMenteeTasksResponse, MentorshipMenteeTaskView } from '@lfx-one/shared/interfaces';
import { buildMentorshipMenteeTaskViews, countSubmittedMentorshipMenteeTasks, normalizeMentorshipMenteeTaskStatus } from '@lfx-one/shared/utils';
import { MentorshipService } from '@services/mentorship.service';
import { catchError, finalize, of, switchMap } from 'rxjs';

import { MenteeTaskRowComponent } from '../mentee-task-row/mentee-task-row.component';

/**
 * Accepted phase of the tasks tab — a flat task list with status filter chips.
 * Mounted by `MenteeApplicationTasksComponent` only while the resolved phase is
 * `accepted`, so it fetches its own tasks on init.
 */
@Component({
  selector: 'lfx-mentee-accepted-tasks',
  imports: [NgClass, EmptyStateComponent, RouteLoadingComponent, MenteeTaskRowComponent],
  templateUrl: './mentee-accepted-tasks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeAcceptedTasksComponent {
  // ---- 1. DI ----------------------------------------------------------------
  private readonly mentorshipService = inject(MentorshipService);

  // ---- 2. Template constants ------------------------------------------------
  protected readonly filterOptions = MENTORSHIP_MENTEE_TASK_FILTER_OPTIONS;

  // ---- 3. Simple writable signals -------------------------------------------
  protected readonly error = signal<string | null>(null);
  protected readonly activeFilter = signal<MentorshipMenteeTaskStatus | null>(null);
  /** Reload trigger — bumped by the retry handler to force a re-fetch. */
  private readonly reloadTrigger = signal(0);
  /** True while a retry is in flight — forces the loading spinner. */
  private readonly retrying = signal(false);

  // ---- 4. Complex computed / toSignal signals (via private init functions) --
  private readonly tasksData = this.initTasksData();
  private readonly tasks = computed(() => this.tasksData()?.data ?? []);
  protected readonly loaded = computed(() => !this.retrying() && (this.tasksData() !== null || this.error() !== null));
  protected readonly filteredTaskViews = this.initFilteredTaskViews();
  protected readonly submittedSummary = this.initSubmittedSummary();
  protected readonly acceptedForm = this.initAcceptedForm();

  // ---- 5. Actions -----------------------------------------------------------

  protected onFilterChange(filterValue: MentorshipMenteeTaskStatus | null): void {
    this.activeFilter.set(filterValue);
  }

  /** Retry the accepted-phase tasks fetch. */
  protected retry(): void {
    this.error.set(null);
    this.retrying.set(true);
    this.reloadTrigger.update((n) => n + 1);
  }

  // ---- 6. Private initializers ----------------------------------------------

  private initTasksData(): Signal<MentorshipMenteeTasksResponse | null> {
    return toSignal(
      toObservable(this.reloadTrigger).pipe(
        switchMap(() =>
          this.mentorshipService.getMenteeTasks().pipe(
            catchError((err: unknown) => {
              const msg =
                err instanceof HttpErrorResponse
                  ? serverAuthoredMessage(err, 'Could not load your tasks. Please retry.')
                  : 'Could not load your tasks. Please retry.';
              this.error.set(msg);
              return of({ data: [], total: 0 } as MentorshipMenteeTasksResponse);
            }),
            finalize(() => this.retrying.set(false))
          )
        )
      ),
      { initialValue: null }
    );
  }

  private initFilteredTaskViews(): Signal<MentorshipMenteeTaskView[]> {
    return computed(() => {
      const views = buildMentorshipMenteeTaskViews(this.tasks());
      const active = this.activeFilter();
      if (active === null) return views;
      if (active === 'pending') return views.filter((v) => v.status === 'pending' || v.status === 'incomplete');
      if (active === 'submitted') return views.filter((v) => v.status === 'submitted' || v.status === 'complete');
      return views.filter((v) => v.status === active);
    });
  }

  private initSubmittedSummary(): Signal<string> {
    return computed(() => {
      const tasks = this.tasks();
      return `${countSubmittedMentorshipMenteeTasks(tasks)} of ${tasks.length} submitted`;
    });
  }

  private initAcceptedForm(): Signal<FormGroup<Record<string, FormControl<string>>>> {
    return computed(() => {
      const tasks = this.tasks();
      const controls: Record<string, FormControl<string>> = {};
      for (const task of tasks) {
        controls[task.id] = new FormControl(normalizeMentorshipMenteeTaskStatus(task.status), { nonNullable: true });
      }
      return new FormGroup(controls);
    });
  }
}
