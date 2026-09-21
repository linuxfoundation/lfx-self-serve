// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import {
  MENTORSHIP_MENTEE_APPLICATION_STATUS_CLASSES,
  MENTORSHIP_MENTEE_APPLICATION_STATUS_LABELS,
  MENTORSHIP_MENTEE_TASK_FILTER_OPTIONS,
  MENTORSHIP_MENTEE_TASK_STATUS_CLASSES,
  MENTORSHIP_MENTEE_TASK_STATUS_LABELS,
  MENTORSHIP_MENTEE_TASK_STATUS_OPTIONS,
  MENTORSHIP_MENTEE_TASKS_TAB_PREREQUISITE_LABEL,
  MENTORSHIP_MENTEE_TASKS_TAB_STATUS_CHANGE_TOAST_SUMMARY,
  MENTORSHIP_MENTEE_TASKS_TAB_UPLOAD_TOAST_SUMMARY,
} from '@lfx-one/shared/constants';
import {
  MentorshipMenteeApplication,
  MentorshipMenteeOverviewApplicant,
  MentorshipMenteeOverviewResponse,
  MentorshipMenteePhase,
  MentorshipMenteeTaskStatus,
  MentorshipMenteeTasksResponse,
} from '@lfx-one/shared/interfaces';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';
import { MentorshipService } from '@services/mentorship.service';
import { SelectComponent } from '@components/select/select.component';
import { catchError, filter, map, of, switchMap } from 'rxjs';

/**
 * My Application Tasks / My Tasks tab — renders phase-specific task views:
 *
 * - **applicant** — prerequisite tasks grouped by application card
 * - **accepted** — flat task list with status filter chips
 *
 * The shell sets the `phase` model signal via `onChildActivate()`.
 * All status changes and file uploads fire Coming Soon toasts.
 */
@Component({
  selector: 'lfx-mentorship-mentee-application-tasks',
  imports: [EmptyStateComponent, RouteLoadingComponent, NgClass, DatePipe, SelectComponent],
  templateUrl: './mentee-application-tasks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './mentee-application-tasks.component.scss',
})
export class MenteeApplicationTasksComponent {
  private readonly mentorshipService = inject(MentorshipService);
  private readonly comingSoonService = inject(MentorshipComingSoonService);

  // ---- Phase (writable — set by the shell via onChildActivate) ---------------
  public readonly phase = signal<MentorshipMenteePhase>('applicant');

  /** Reload trigger — bumped by retry handlers to force re-fetch. */
  private readonly reloadTrigger = signal(0);

  // ---- Applicant phase data -------------------------------------------------
  private readonly overviewData = this.initOverviewData();
  protected readonly applicantError = signal<string | null>(null);
  protected readonly applicantData = computed(() => this.overviewData());
  protected readonly applicantLoaded = computed(() => this.phase() !== 'applicant' || this.overviewData() !== null || this.applicantError() !== null);

  // ---- Accepted phase data --------------------------------------------------
  private readonly tasksData = this.initTasksData();
  protected readonly acceptedError = signal<string | null>(null);
  protected readonly acceptedTasks = computed(() => this.tasksData()?.data ?? []);
  protected readonly acceptedLoaded = computed(() => this.phase() !== 'accepted' || this.tasksData() !== null || this.acceptedError() !== null);

  // ---- Accepted filter chips ------------------------------------------------
  protected readonly activeFilter = signal<MentorshipMenteeTaskStatus | null>(null);
  protected readonly filterOptions = MENTORSHIP_MENTEE_TASK_FILTER_OPTIONS;

  protected readonly filteredTasks = computed(() => {
    const tasks = this.acceptedTasks();
    const f = this.activeFilter();
    if (f === null) return tasks;
    if (f === 'pending') return tasks.filter((t) => t.status === 'pending' || t.status === 'incomplete');
    if (f === 'submitted') return tasks.filter((t) => t.status === 'submitted' || t.status === 'complete');
    return tasks.filter((t) => t.status === f);
  });

  /** Summary: `X of Y submitted` */
  protected readonly submittedSummary = computed(() => {
    const tasks = this.acceptedTasks();
    const submitted = tasks.filter((t) => t.status === 'submitted' || t.status === 'complete').length;
    return `${submitted} of ${tasks.length} submitted`;
  });

  // ---- Form groups (one FormControl per task, keyed by task ID) --------------
  protected readonly applicantForm = this.initApplicantForm();
  protected readonly acceptedForm = this.initAcceptedForm();

  // ---- Template constants ---------------------------------------------------
  protected readonly prerequisiteLabel = MENTORSHIP_MENTEE_TASKS_TAB_PREREQUISITE_LABEL;
  protected readonly appStatusLabels: Record<string, string> = MENTORSHIP_MENTEE_APPLICATION_STATUS_LABELS;
  protected readonly appStatusClasses: Record<string, string> = MENTORSHIP_MENTEE_APPLICATION_STATUS_CLASSES;
  protected readonly taskStatusLabels: Record<string, string> = MENTORSHIP_MENTEE_TASK_STATUS_LABELS;
  protected readonly taskStatusClasses: Record<string, string> = MENTORSHIP_MENTEE_TASK_STATUS_CLASSES;
  protected readonly taskStatusOptions = MENTORSHIP_MENTEE_TASK_STATUS_OPTIONS;

  /** Safe lookup — returns empty string for unknown status values to avoid template crashes. */
  protected statusClass(status: string): string {
    return this.taskStatusClasses[status] ?? '';
  }

  /** Safe lookup — returns the raw status for unknown values. */
  protected statusLabel(status: string): string {
    return this.taskStatusLabels[status] ?? status;
  }

  // ---- Applicant helpers ----------------------------------------------------

  protected applicationSubmittedCount(app: MentorshipMenteeApplication): number {
    return app.tasks?.filter((t) => t.status === 'submitted' || t.status === 'complete').length ?? 0;
  }

  protected isTaskSubmitted(status: MentorshipMenteeTaskStatus): boolean {
    return status === 'submitted' || status === 'complete';
  }

  protected hasUploadedFile(task: { submitFile: string | null; fileUrl?: string }): boolean {
    return (task.submitFile === 'required' && !!task.fileUrl) || (!!task.submitFile && task.submitFile !== 'required');
  }

  protected needsUpload(task: { submitFile: string | null; fileUrl?: string }): boolean {
    return task.submitFile === 'required' && !task.fileUrl;
  }

  // ---- Actions (Coming Soon) ------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected onStatusChange(_taskId: string): void {
    this.comingSoonService.notify(MENTORSHIP_MENTEE_TASKS_TAB_STATUS_CHANGE_TOAST_SUMMARY);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected onUpload(_taskId: string): void {
    this.comingSoonService.notify(MENTORSHIP_MENTEE_TASKS_TAB_UPLOAD_TOAST_SUMMARY);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected onViewFile(_fileUrl: string): void {
    this.comingSoonService.notify(MENTORSHIP_MENTEE_TASKS_TAB_UPLOAD_TOAST_SUMMARY);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected onDownloadFile(_fileUrl: string): void {
    this.comingSoonService.notify(MENTORSHIP_MENTEE_TASKS_TAB_UPLOAD_TOAST_SUMMARY);
  }

  protected onFilterChange(filterValue: MentorshipMenteeTaskStatus | null): void {
    this.activeFilter.set(filterValue);
  }

  protected retryApplicant(): void {
    this.applicantError.set(null);
    this.reloadTrigger.update((n) => n + 1);
  }

  protected retryAccepted(): void {
    this.acceptedError.set(null);
    this.reloadTrigger.update((n) => n + 1);
  }

  // ---- Private initializers -------------------------------------------------

  private initOverviewData(): Signal<MentorshipMenteeOverviewApplicant | null> {
    return toSignal(
      toObservable(this.phase).pipe(
        filter((p): p is 'applicant' => p === 'applicant'),
        switchMap(() => toObservable(this.reloadTrigger)),
        switchMap(() =>
          this.mentorshipService.getMenteeOverview('applicant').pipe(
            map((res: MentorshipMenteeOverviewResponse) => {
              if (res.phase === 'applicant') return res as MentorshipMenteeOverviewApplicant;
              return null;
            }),
            catchError((err: unknown) => {
              const msg =
                err instanceof HttpErrorResponse
                  ? serverAuthoredMessage(err, 'Could not load application tasks. Please retry.')
                  : 'Could not load application tasks. Please retry.';
              this.applicantError.set(msg);
              return of(null);
            })
          )
        )
      ),
      { initialValue: null }
    );
  }

  private initTasksData(): Signal<MentorshipMenteeTasksResponse | null> {
    return toSignal(
      toObservable(this.phase).pipe(
        filter((p): p is 'accepted' => p === 'accepted'),
        switchMap(() => toObservable(this.reloadTrigger)),
        switchMap(() =>
          this.mentorshipService.getMenteeTasks().pipe(
            catchError((err: unknown) => {
              const msg =
                err instanceof HttpErrorResponse
                  ? serverAuthoredMessage(err, 'Could not load your tasks. Please retry.')
                  : 'Could not load your tasks. Please retry.';
              this.acceptedError.set(msg);
              return of({ data: [], total: 0 } as MentorshipMenteeTasksResponse);
            })
          )
        )
      ),
      { initialValue: null }
    );
  }

  /** FormGroup for applicant-phase tasks — rebuilt when data changes. */
  private initApplicantForm(): Signal<FormGroup<Record<string, FormControl<string>>>> {
    return computed(() => {
      const data = this.applicantData();
      const controls: Record<string, FormControl<string>> = {};
      if (data?.applications) {
        for (const app of data.applications) {
          for (const task of app.tasks ?? []) {
            controls[task.id] = new FormControl(this.normaliseForDropdown(task.status), { nonNullable: true });
          }
        }
      }
      return new FormGroup(controls);
    });
  }

  /** FormGroup for accepted-phase tasks — rebuilt when data changes. */
  private initAcceptedForm(): Signal<FormGroup<Record<string, FormControl<string>>>> {
    return computed(() => {
      const tasks = this.acceptedTasks();
      const controls: Record<string, FormControl<string>> = {};
      for (const task of tasks) {
        controls[task.id] = new FormControl(this.normaliseForDropdown(task.status), { nonNullable: true });
      }
      return new FormGroup(controls);
    });
  }

  /**
   * Normalise a task status to a dropdown-compatible value.
   * `incomplete` → `pending` (both mean "To Do"), `complete` → `submitted` (both mean "Submitted").
   */
  private normaliseForDropdown(status: string): string {
    if (status === 'incomplete') return 'pending';
    if (status === 'complete') return 'submitted';
    return status;
  }
}
