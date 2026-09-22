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
  MENTORSHIP_MENTEE_TASK_STATUS_OPTIONS,
  MENTORSHIP_MENTEE_TASKS_TAB_PREREQUISITE_LABEL,
  MENTORSHIP_MENTEE_TASKS_TAB_STATUS_CHANGE_TOAST_SUMMARY,
  MENTORSHIP_MENTEE_TASKS_TAB_UPLOAD_TOAST_SUMMARY,
} from '@lfx-one/shared/constants';
import {
  MentorshipMenteeOverviewApplicant,
  MentorshipMenteeOverviewResponse,
  MentorshipMenteePhase,
  MentorshipMenteeTaskStatus,
  MentorshipMenteeTasksResponse,
} from '@lfx-one/shared/interfaces';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';
import { MentorshipService } from '@services/mentorship.service';
import { SelectComponent } from '@components/select/select.component';
import { catchError, filter, finalize, of, switchMap, tap } from 'rxjs';

/**
 * My Application Tasks / My Tasks tab — renders phase-specific task views:
 *
 * - **applicant** — prerequisite tasks grouped by application card
 * - **accepted** — flat task list with status filter chips
 *
 * ## Phase resolution
 *
 * The shell sets the `phase` hint via `onChildActivate()` when the user reaches
 * this tab from the overview, but that value is only known once the overview
 * *tab* has been visited. A direct visit or refresh on
 * `/mentorship/mentee/tasks` therefore arrives with no usable hint, so this
 * component fetches the mentee overview itself (`overviewData`) and derives the
 * authoritative `resolvedPhase` from the response — the deep-linkable contract
 * documented on the route. The shell hint is only a fast-path fallback while
 * that fetch is in flight.
 *
 * All status changes and file uploads fire Coming Soon toasts; the status
 * dropdown reverts to the task's real status after the toast, since persistence
 * is not wired yet.
 */
@Component({
  selector: 'lfx-mentorship-mentee-application-tasks',
  imports: [EmptyStateComponent, RouteLoadingComponent, NgClass, DatePipe, SelectComponent],
  templateUrl: './mentee-application-tasks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './mentee-application-tasks.component.scss',
})
export class MenteeApplicationTasksComponent {
  // ---- 1. DI ----------------------------------------------------------------
  private readonly mentorshipService = inject(MentorshipService);
  private readonly comingSoonService = inject(MentorshipComingSoonService);

  // ---- 2. Template constants ------------------------------------------------
  protected readonly prerequisiteLabel = MENTORSHIP_MENTEE_TASKS_TAB_PREREQUISITE_LABEL;
  protected readonly appStatusLabels: Record<string, string> = MENTORSHIP_MENTEE_APPLICATION_STATUS_LABELS;
  protected readonly appStatusClasses: Record<string, string> = MENTORSHIP_MENTEE_APPLICATION_STATUS_CLASSES;
  protected readonly taskStatusClasses: Record<string, string> = MENTORSHIP_MENTEE_TASK_STATUS_CLASSES;
  protected readonly taskStatusOptions = MENTORSHIP_MENTEE_TASK_STATUS_OPTIONS;
  protected readonly filterOptions = MENTORSHIP_MENTEE_TASK_FILTER_OPTIONS;

  // ---- 3. Forms (one FormControl per task, keyed by task ID) ----------------
  protected readonly applicantForm = this.initApplicantForm();
  protected readonly acceptedForm = this.initAcceptedForm();

  // ---- 4. Simple writable signals -------------------------------------------
  /** Phase hint from the shell; `resolvedPhase` is the authoritative value. */
  public readonly phase = signal<MentorshipMenteePhase>('applicant');
  protected readonly overviewError = signal<string | null>(null);
  protected readonly acceptedError = signal<string | null>(null);
  protected readonly activeFilter = signal<MentorshipMenteeTaskStatus | null>(null);

  /** Reload trigger — bumped by retry handlers to force re-fetch. */
  private readonly reloadTrigger = signal(0);
  /** True while an accepted-phase retry is in flight — forces the loading spinner. */
  private readonly acceptedRetrying = signal(false);

  // ---- 5. Complex computed / toSignal signals (via private init functions) ---
  private readonly overviewData = this.initOverviewData();
  protected readonly overviewLoaded = computed(() => this.overviewData() !== null || this.overviewError() !== null);

  /** Authoritative phase — from the fetched overview, falling back to the shell hint while loading. */
  protected readonly resolvedPhase = computed<MentorshipMenteePhase>(() => this.overviewData()?.phase ?? this.phase());

  private readonly applicantData = computed<MentorshipMenteeOverviewApplicant | null>(() => {
    const data = this.overviewData();
    return data?.phase === 'applicant' ? data : null;
  });
  protected readonly applicantView = this.initApplicantView();

  private readonly tasksData = this.initTasksData();
  private readonly acceptedTasks = computed(() => this.tasksData()?.data ?? []);
  protected readonly acceptedLoaded = computed(() => !this.acceptedRetrying() && (this.tasksData() !== null || this.acceptedError() !== null));
  protected readonly filteredTaskViews = this.initFilteredTaskViews();
  protected readonly submittedSummary = this.initSubmittedSummary();

  // ---- 6. Actions -----------------------------------------------------------

  protected onStatusChange(taskId: string, originalStatus?: MentorshipMenteeTaskStatus): void {
    this.comingSoonService.notify(MENTORSHIP_MENTEE_TASKS_TAB_STATUS_CHANGE_TOAST_SUMMARY);
    // Persistence isn't wired yet — revert the control so the dropdown never
    // displays an unsaved selection that disagrees with the task's real status.
    if (originalStatus === undefined) return;
    const control = this.applicantForm().controls[taskId] ?? this.acceptedForm().controls[taskId];
    control?.setValue(this.normaliseForDropdown(originalStatus), { emitEvent: false });
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

  /** Retry the overview fetch (drives phase resolution for both phases). */
  protected retry(): void {
    this.overviewError.set(null);
    this.reloadTrigger.update((n) => n + 1);
  }

  protected retryAccepted(): void {
    this.acceptedError.set(null);
    this.acceptedRetrying.set(true);
    this.reloadTrigger.update((n) => n + 1);
  }

  // ---- 7. Private initializers ----------------------------------------------

  private initOverviewData(): Signal<MentorshipMenteeOverviewResponse | null> {
    return toSignal(
      toObservable(this.reloadTrigger).pipe(
        tap(() => this.overviewError.set(null)),
        switchMap(() =>
          this.mentorshipService.getMenteeOverview().pipe(
            catchError((err: unknown) => {
              const msg =
                err instanceof HttpErrorResponse
                  ? serverAuthoredMessage(err, 'Could not load application tasks. Please retry.')
                  : 'Could not load application tasks. Please retry.';
              this.overviewError.set(msg);
              return of(null);
            })
          )
        )
      ),
      { initialValue: null }
    );
  }

  private initTasksData(): Signal<MentorshipMenteeTasksResponse | null> {
    // `toObservable` must run in an injection context — capture both streams here
    // (this initializer runs during field construction) rather than inside `switchMap`.
    const reload$ = toObservable(this.reloadTrigger);
    return toSignal(
      toObservable(this.resolvedPhase).pipe(
        filter((p): p is 'accepted' => p === 'accepted'),
        switchMap(() => reload$),
        switchMap(() =>
          this.mentorshipService.getMenteeTasks().pipe(
            catchError((err: unknown) => {
              const msg =
                err instanceof HttpErrorResponse
                  ? serverAuthoredMessage(err, 'Could not load your tasks. Please retry.')
                  : 'Could not load your tasks. Please retry.';
              this.acceptedError.set(msg);
              return of({ data: [], total: 0 } as MentorshipMenteeTasksResponse);
            }),
            finalize(() => this.acceptedRetrying.set(false))
          )
        )
      ),
      { initialValue: null }
    );
  }

  private initApplicantView() {
    return computed(() => {
      const data = this.applicantData();
      if (!data) return null;
      return data.applications.map((app) => ({
        id: app.id,
        programName: app.programName,
        projectName: app.projectName,
        termName: app.term.name,
        statusLabel: this.appStatusLabels[app.status] ?? '',
        statusBadgeClass: this.appStatusClasses[app.status] ?? '',
        submittedCount: this.countSubmitted(app.tasks ?? []),
        totalCount: app.tasks?.length ?? app.prerequisiteTasksTotal,
        tasks: (app.tasks ?? []).map((t) => this.buildTaskView(t.id, t.name, t.description, t.status, t.submitFile, t.fileUrl, t.dueDate, t.submittedOn)),
      }));
    });
  }

  private initFilteredTaskViews() {
    return computed(() => {
      const views = this.acceptedTasks().map((t) => this.buildTaskView(t.id, t.title, t.description, t.status, t.submitFile, t.fileUrl, t.dueDate, t.submittedDate));
      const f = this.activeFilter();
      if (f === null) return views;
      if (f === 'pending') return views.filter((v) => v.status === 'pending' || v.status === 'incomplete');
      if (f === 'submitted') return views.filter((v) => v.status === 'submitted' || v.status === 'complete');
      return views.filter((v) => v.status === f);
    });
  }

  private initSubmittedSummary() {
    return computed(() => {
      const tasks = this.acceptedTasks();
      return `${this.countSubmitted(tasks)} of ${tasks.length} submitted`;
    });
  }

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

  // ---- 8. Private helpers ---------------------------------------------------

  /** Count tasks in a submitted/complete state. */
  private countSubmitted(tasks: readonly { status: MentorshipMenteeTaskStatus }[]): number {
    return tasks.filter((t) => t.status === 'submitted' || t.status === 'complete').length;
  }

  /** Build a display-ready task view so the template reads fields instead of calling logic. */
  private buildTaskView(
    id: string,
    title: string,
    description: string,
    status: MentorshipMenteeTaskStatus,
    submitFile: string | null,
    fileUrl: string | undefined,
    dueDate: string | undefined,
    submittedLabel: string | undefined
  ) {
    const submitted = status === 'submitted' || status === 'complete';
    const hasUploadedFile = (submitFile === 'required' && !!fileUrl) || (!!submitFile && submitFile !== 'required');
    return {
      id,
      title,
      description,
      status,
      submitted,
      inProgress: status === 'in_progress',
      statusClass: this.taskStatusClasses[status] ?? '',
      hasUploadedFile,
      needsUpload: submitFile === 'required' && !fileUrl,
      fileUrl: fileUrl ?? null,
      dueDate: dueDate ?? null,
      submittedLabel: submittedLabel ?? null,
    };
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
