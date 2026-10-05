// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import {
  MENTORSHIP_ACTIVE_APPLICATION_STATUSES,
  MENTORSHIP_ADD_NOTE_LABEL,
  MENTORSHIP_ADMIN_ACCEPT_DIALOG_HEADER,
  MENTORSHIP_ADMIN_APPLICATION_CHANGED_MESSAGE,
  MENTORSHIP_ADMIN_DECISION_DONE_MESSAGES,
  MENTORSHIP_ADMIN_DECISION_FAILED_MESSAGE,
  MENTORSHIP_ADMIN_DECLINE_BY_TERM_CONFIRM_TEMPLATE,
  MENTORSHIP_ADMIN_DECLINE_BY_TERM_DONE_SINGULAR_TEMPLATE,
  MENTORSHIP_ADMIN_DECLINE_BY_TERM_DONE_TEMPLATE,
  MENTORSHIP_ADMIN_DECLINE_BY_TERM_HEADER,
  MENTORSHIP_ADMIN_DECLINE_CONFIRM_MESSAGE,
  MENTORSHIP_ADMIN_GRADUATE_CONFIRM_MESSAGE,
  MENTORSHIP_ADMIN_MENTEES_LOAD_ERROR_MESSAGE,
  MENTORSHIP_ADMIN_MENTEES_PAGE_SIZE,
  MENTORSHIP_ADMIN_MENTEES_SEARCH_DEBOUNCE_MS,
  MENTORSHIP_ADMIN_TASKS_LOAD_ERROR_MESSAGE,
  MENTORSHIP_ADMIN_TERM_CLOSED_ACCEPT_MESSAGE,
  MENTORSHIP_ADMIN_WITHDRAW_CONFIRM_MESSAGE,
  MENTORSHIP_ALL_OPEN_TERMS_OPTION_LABEL,
  MENTORSHIP_ALL_STATUSES_OPTION_LABEL,
  MENTORSHIP_APPLICANT_MINIMIZE_TASKS_LABEL,
  MENTORSHIP_APPLICANT_STATUS_BADGE_CLASSES,
  MENTORSHIP_APPLICANT_STATUS_LABELS,
  MENTORSHIP_APPLICANT_STATUS_NOTE,
  MENTORSHIP_APPLICANT_VIEW_TASKS_LABEL,
  MENTORSHIP_CURRENT_MENTEE_ACTION_ICONS,
  MENTORSHIP_CURRENT_MENTEE_ACTION_LABELS,
  MENTORSHIP_CURRENT_MENTEE_ACTIONS_BY_STATUS,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTEE_STATUS_LABELS,
  MENTORSHIP_MENTEE_STATUSES,
} from '@lfx-one/shared/constants';
import {
  FilterOption,
  MentorshipAdminApplicationStatusUpdate,
  MentorshipAdminTasksState,
  MentorshipAdminTermOption,
  MentorshipCurrentMenteeAction,
  MentorshipAttendanceType,
  MentorshipMenteeStatus,
  MentorshipNoteRequest,
  MentorshipProgramApplicant,
  MentorshipRowAction,
} from '@lfx-one/shared/interfaces';
import {
  buildMentorshipGraduateTaskWarning,
  formatIsoDateLabel,
  mentorshipApplicantDisplayStatus,
  mentorshipApplicantHasTasks,
  mentorshipApplicantTaskRows,
  mentorshipNoteDisplay,
  mentorshipPersonAvatarClass,
  mentorshipPersonInitials,
  mentorshipRowActions,
} from '@lfx-one/shared/utils';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, debounceTime, distinctUntilChanged, map, Observable, of, switchMap, take, tap } from 'rxjs';

import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';
import { MentorshipTaskDialogService } from '../../../../services/mentorship-task-dialog.service';
import { ApplicantTasksPanelComponent } from '../../../../components/applicant-tasks-panel/applicant-tasks-panel.component';
import { AcceptApplicationDialogComponent } from '../accept-application-dialog/accept-application-dialog.component';
import { DeclineByTermDialogComponent } from '../decline-by-term-dialog/decline-by-term-dialog.component';
import { PersonCellComponent } from '../../../../components/person-cell/person-cell.component';
import { RowActionsComponent } from '../../../../components/row-actions/row-actions.component';

/**
 * Current Mentees tab — the program's applications in an open term, whatever their status, one server page at a
 * time. Search, status and term filters go upstream, and any change of them, or a page change, reads that page
 * again. View Tasks reads an application's tasks on the first click only; the result stays cached until the table
 * next reloads, so collapsing and expanding a row makes no request. Row actions depend on the status. Accept
 * (with an attendance type), Decline, Withdraw, Graduate and Decline by Term write through the BFF; each
 * reloads the page and tells the parent to refresh the tab counts, and a 409 or 422 answers with its own
 * message. Graduate always confirms, warning from the row's task counts without reading any task. Create task
 * opens the task form first and the status export still stubs to coming soon. The reviewer note is the one
 * other action that takes effect; the parent owns its state, so it outlives a tab switch.
 */
@Component({
  selector: 'lfx-mentorship-current-mentees-tab',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ApplicantTasksPanelComponent,
    ButtonComponent,
    ConfirmDialogModule,
    InputTextComponent,
    PersonCellComponent,
    RowActionsComponent,
    SelectComponent,
    TableComponent,
    TooltipModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './current-mentees-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CurrentMenteesTabComponent {
  private readonly mentorshipAdminService = inject(MentorshipAdminService);
  private readonly comingSoon = inject(MentorshipComingSoonService);
  private readonly taskDialog = inject(MentorshipTaskDialogService);
  private readonly dialogService = inject(DialogService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly programId = input.required<string>();
  /** The program's terms; only the open ones feed the term filter. */
  public readonly terms = input<MentorshipAdminTermOption[]>([]);
  /** Notes edited this session, keyed by person id; overrides the note a row arrived with. */
  public readonly noteDrafts = input<Record<string, string>>({});
  public readonly noteRequested = output<MentorshipNoteRequest>();
  /** A decision changed the program's application counts, so the parent should read the tab counts again. */
  public readonly countsChanged = output<void>();

  protected readonly pageSize = MENTORSHIP_ADMIN_MENTEES_PAGE_SIZE;
  protected readonly statusNote = MENTORSHIP_APPLICANT_STATUS_NOTE;
  protected readonly viewTasksLabel = MENTORSHIP_APPLICANT_VIEW_TASKS_LABEL;
  protected readonly minimizeTasksLabel = MENTORSHIP_APPLICANT_MINIMIZE_TASKS_LABEL;
  protected readonly menteesLoadErrorMessage = MENTORSHIP_ADMIN_MENTEES_LOAD_ERROR_MESSAGE;
  protected readonly tasksLoadErrorMessage = MENTORSHIP_ADMIN_TASKS_LOAD_ERROR_MESSAGE;

  /** Every status an application can hold, sent as the wire `status`. */
  protected readonly statusOptions: FilterOption<MentorshipMenteeStatus | null>[] = [
    { label: MENTORSHIP_ALL_STATUSES_OPTION_LABEL, value: null },
    ...MENTORSHIP_MENTEE_STATUSES.map((status) => ({ label: MENTORSHIP_MENTEE_STATUS_LABELS[status], value: status })),
  ];

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    status: new FormControl<MentorshipMenteeStatus | null>(null),
    term: new FormControl<string | null>(null),
  });

  /** Offset of the page shown; the table's paginator reads it and a page change writes it. */
  protected readonly offset = signal(0);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  private readonly applications = signal<MentorshipProgramApplicant[]>([]);

  /** Mentee ids whose tasks sub-table is expanded. */
  protected readonly expandedTaskMenteeIds = signal<Record<string, boolean>>({});
  /** Tasks read so far, keyed by application id. Cleared whenever the table reloads. */
  protected readonly tasksByApplication = signal<ReadonlyMap<string, MentorshipAdminTasksState>>(new Map());

  private readonly search = signal('');
  private readonly status = signal<MentorshipMenteeStatus | null>(null);
  private readonly termId = signal<string | null>(null);
  private readonly reloadCount = signal(0);
  /** True while a decision write is in flight, so a second click cannot send it twice. */
  private decisionInFlight = false;

  protected readonly termOptions = this.initTermOptions();
  protected readonly rows = this.initRows();

  public constructor() {
    this.initFilters();
    this.initPageReads();
  }

  protected onLazyLoad(event: { first?: number | null }): void {
    this.offset.set(event.first ?? 0);
  }

  protected onRetry(): void {
    this.reloadCount.update((count) => count + 1);
  }

  protected onOpenNote(id: string, name: string, note?: string): void {
    this.noteRequested.emit({ personId: id, personName: name, note });
  }

  protected onAction(summary: string): void {
    this.comingSoon.notify(summary);
  }

  protected onDeclineByTerm(): void {
    const openTerms = this.terms().filter((term) => term.status === 'open');
    const dialogRef: DynamicDialogRef | null = this.dialogService.open(DeclineByTermDialogComponent, {
      header: MENTORSHIP_ADMIN_DECLINE_BY_TERM_HEADER,
      width: '30rem',
      style: { maxWidth: '90vw' },
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { terms: openTerms },
    });
    if (!dialogRef) return;

    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((term: MentorshipAdminTermOption | undefined) => {
      if (!term) return;
      this.confirmDecision({
        header: MENTORSHIP_ADMIN_DECLINE_BY_TERM_HEADER,
        message: MENTORSHIP_ADMIN_DECLINE_BY_TERM_CONFIRM_TEMPLATE.replace('{term}', term.name),
        acceptLabel: 'Decline all pending',
        danger: true,
        accept: () => this.declinePendingForTerm(term.id),
      });
    });
  }

  protected onRowAction(mentee: MentorshipProgramApplicant, action: MentorshipRowAction): void {
    // The menu hands back a plain string; `satisfies` ties the key to the action union, so renaming it fails here.
    if (action.value === ('create-task' satisfies MentorshipCurrentMenteeAction)) {
      this.onCreateTask(mentee);
      return;
    }

    switch (action.value as MentorshipCurrentMenteeAction) {
      case 'accept':
        this.onAccept(mentee);
        return;
      case 'decline':
        this.confirmDecision({
          header: action.label,
          message: MENTORSHIP_ADMIN_DECLINE_CONFIRM_MESSAGE,
          acceptLabel: action.label,
          danger: true,
          accept: () => this.decide(this.mentorshipAdminService.updateApplicationStatus(mentee.id, { status: 'declined' }), 'declined'),
        });
        return;
      case 'withdraw':
        this.confirmDecision({
          header: action.label,
          message: MENTORSHIP_ADMIN_WITHDRAW_CONFIRM_MESSAGE,
          acceptLabel: action.label,
          danger: true,
          accept: () => this.decide(this.mentorshipAdminService.withdrawApplication(mentee.id), 'withdrawn'),
        });
        return;
      case 'graduate':
        this.onGraduate(mentee, action.label);
        return;
      default:
        this.comingSoon.notify(`${action.label} ${mentee.name}`);
    }
  }

  /** Expands or collapses a row. Only an expand with nothing cached, or a failed read, reads the tasks. */
  protected toggleTasksExpanded(menteeId: string): void {
    const expanding = !this.expandedTaskMenteeIds()[menteeId];
    this.expandedTaskMenteeIds.update((current) => ({ ...current, [menteeId]: expanding }));
    if (expanding && !this.tasksByApplication().has(menteeId)) {
      this.loadTasks(menteeId);
    }
  }

  protected onRetryTasks(menteeId: string): void {
    this.loadTasks(menteeId);
  }

  private loadTasks(applicationId: string): void {
    const loading: MentorshipAdminTasksState = { status: 'loading', tasks: [] };
    this.setTasksState(applicationId, loading);
    this.mentorshipAdminService
      .getApplicationTasks(applicationId)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tasks) => this.setTasksIfCurrent(applicationId, loading, { status: 'loaded', tasks }),
        error: () => this.setTasksIfCurrent(applicationId, loading, { status: 'failed', tasks: [] }),
      });
  }

  /**
   * Applies an answer only while the row still holds the loading state its read set. A table reload clears the cache,
   * and a later read (after a reload or a Retry) sets its own loading state, so an older answer arriving late is dropped.
   */
  private setTasksIfCurrent(applicationId: string, loading: MentorshipAdminTasksState, state: MentorshipAdminTasksState): void {
    if (this.tasksByApplication().get(applicationId) !== loading) return;
    this.setTasksState(applicationId, state);
  }

  private setTasksState(applicationId: string, state: MentorshipAdminTasksState): void {
    this.tasksByApplication.update((current) => new Map(current).set(applicationId, state));
  }

  private onAccept(mentee: MentorshipProgramApplicant): void {
    const dialogRef: DynamicDialogRef | null = this.dialogService.open(AcceptApplicationDialogComponent, {
      header: MENTORSHIP_ADMIN_ACCEPT_DIALOG_HEADER,
      width: '28rem',
      style: { maxWidth: '90vw' },
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { personName: mentee.name },
    });
    if (!dialogRef) return;

    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((attendanceType: MentorshipAttendanceType | undefined) => {
      if (!attendanceType) return;
      const body: MentorshipAdminApplicationStatusUpdate = { status: 'accepted', attendanceType };
      this.decide(this.mentorshipAdminService.updateApplicationStatus(mentee.id, body), 'accepted');
    });
  }

  /** Always confirms. The task warning comes from the row's counts; no task is read, so the cache plays no part. */
  private onGraduate(mentee: MentorshipProgramApplicant, label: string): void {
    const warning = buildMentorshipGraduateTaskWarning(mentee.tasksTotal ?? 0, mentee.tasksSubmitted ?? 0);
    this.confirmDecision({
      header: label,
      message: warning ? `${MENTORSHIP_ADMIN_GRADUATE_CONFIRM_MESSAGE} ${warning}` : MENTORSHIP_ADMIN_GRADUATE_CONFIRM_MESSAGE,
      acceptLabel: label,
      danger: false,
      accept: () => this.decide(this.mentorshipAdminService.updateApplicationStatus(mentee.id, { status: 'graduated' }), 'graduated'),
    });
  }

  private confirmDecision(options: { header: string; message: string; acceptLabel: string; danger: boolean; accept: () => void }): void {
    this.confirmationService.confirm({
      header: options.header,
      message: options.message,
      icon: 'fa-light fa-triangle-exclamation',
      acceptLabel: options.acceptLabel,
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: options.danger ? 'p-button-sm p-button-danger' : 'p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: options.accept,
    });
  }

  /** Runs one decision write; on success reloads the page and has the parent refresh the counts. */
  private decide(write: Observable<void>, outcome: keyof typeof MENTORSHIP_ADMIN_DECISION_DONE_MESSAGES): void {
    this.runWrite(write, () => this.showSuccess(MENTORSHIP_ADMIN_DECISION_DONE_MESSAGES[outcome]));
  }

  private declinePendingForTerm(termId: string): void {
    this.runWrite(this.mentorshipAdminService.declinePendingForTerm(this.programId(), termId), ({ declinedCount }) =>
      this.showSuccess(
        declinedCount === 1
          ? MENTORSHIP_ADMIN_DECLINE_BY_TERM_DONE_SINGULAR_TEMPLATE
          : MENTORSHIP_ADMIN_DECLINE_BY_TERM_DONE_TEMPLATE.replace('{count}', String(declinedCount))
      )
    );
  }

  private runWrite<T>(write: Observable<T>, onDone: (result: T) => void): void {
    if (this.decisionInFlight) return;
    this.decisionInFlight = true;
    write.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.decisionInFlight = false;
        onDone(result);
        this.reloadCount.update((count) => count + 1);
        this.countsChanged.emit();
      },
      error: (err: unknown) => {
        this.decisionInFlight = false;
        this.onDecisionError(err);
      },
    });
  }

  /** 409 means the application moved on, so the page reloads; 422 means the term closed; an impersonation 403 shows the server's text. */
  private onDecisionError(err: unknown): void {
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    if (status === 409) {
      this.reloadCount.update((count) => count + 1);
      this.showFailure(MENTORSHIP_ADMIN_APPLICATION_CHANGED_MESSAGE);
      return;
    }
    if (status === 422) {
      this.showFailure(MENTORSHIP_ADMIN_TERM_CLOSED_ACCEPT_MESSAGE);
      return;
    }
    if (status === 403 && (err as HttpErrorResponse).error?.code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE) {
      this.showFailure(serverAuthoredMessage(err, MENTORSHIP_ADMIN_DECISION_FAILED_MESSAGE));
      return;
    }
    this.showFailure(MENTORSHIP_ADMIN_DECISION_FAILED_MESSAGE);
  }

  private showSuccess(detail: string): void {
    this.messageService.add({ severity: 'success', summary: 'Success', detail, life: 3000 });
  }

  private showFailure(detail: string): void {
    this.messageService.add({ severity: 'error', summary: 'Error', detail, life: 5000 });
  }

  private onCreateTask(mentee: MentorshipProgramApplicant): void {
    this.taskDialog
      .openCreate({ id: mentee.id, name: mentee.name, email: mentee.email, avatarUrl: mentee.avatarUrl })
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        if (!value) return;
        this.comingSoon.notify(`Create task "${value.name}" for ${mentee.name}`);
      });
  }

  private initTermOptions() {
    return computed((): FilterOption<string | null>[] => [
      { label: MENTORSHIP_ALL_OPEN_TERMS_OPTION_LABEL, value: null },
      ...this.terms()
        .filter((term) => term.status === 'open')
        .map((term) => ({ label: term.name, value: term.id })),
    ]);
  }

  private initRows() {
    return computed(() => this.applications().map((person) => this.toRow(person)));
  }

  /** Search waits for typing to pause; the selects apply at once. Every change goes back to the first page. */
  private initFilters(): void {
    this.form.controls.search.valueChanges
      .pipe(debounceTime(MENTORSHIP_ADMIN_MENTEES_SEARCH_DEBOUNCE_MS), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.search.set(search.trim());
        this.offset.set(0);
      });
    this.form.controls.status.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((status) => {
      this.status.set(status);
      this.offset.set(0);
    });
    this.form.controls.term.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((termId) => {
      this.termId.set(termId);
      this.offset.set(0);
    });
  }

  /**
   * Reads the page whenever the program, a filter, the offset or the retry count changes; a read still in flight
   * is dropped. Each read clears the tasks cache and collapses every row. A failed read keeps nothing on screen
   * but the error, so Retry reads the same page again.
   */
  private initPageReads(): void {
    const query = computed(() => ({
      programId: this.programId(),
      search: this.search(),
      status: this.status(),
      termId: this.termId(),
      offset: this.offset(),
      reload: this.reloadCount(),
    }));

    toObservable(query)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.loadFailed.set(false);
          this.tasksByApplication.set(new Map());
          this.expandedTaskMenteeIds.set({});
        }),
        switchMap(({ programId, search, status, termId, offset }) =>
          this.mentorshipAdminService
            .getProgramMentees(programId, {
              type: 'current',
              search: search || undefined,
              status: status ?? undefined,
              termId: termId ?? undefined,
              offset,
              limit: MENTORSHIP_ADMIN_MENTEES_PAGE_SIZE,
            })
            .pipe(
              map((page) => ({ page })),
              catchError(() => of({ page: null }))
            )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ page }) => {
        this.loading.set(false);
        if (!page) {
          this.applications.set([]);
          this.total.set(0);
          this.loadFailed.set(true);
          return;
        }
        this.applications.set(page.data);
        this.total.set(page.total);
      });
  }

  private toRow(person: MentorshipProgramApplicant) {
    const displayStatus = mentorshipApplicantDisplayStatus(person);
    const tasksState = this.tasksByApplication().get(person.id);
    return {
      ...person,
      initials: mentorshipPersonInitials(person.name),
      avatarStyleClass: mentorshipPersonAvatarClass(person.name),
      statusLabel: MENTORSHIP_APPLICANT_STATUS_LABELS[displayStatus],
      statusBadgeClass: MENTORSHIP_APPLICANT_STATUS_BADGE_CLASSES[displayStatus],
      createdLabel: formatIsoDateLabel(person.createdOn),
      updatedLabel: formatIsoDateLabel(person.updatedOn),
      // The column is headed "Other Active Applications", so declined and withdrawn ones drop out.
      otherApplications: (person.otherApplications ?? [])
        .filter((application) => MENTORSHIP_ACTIVE_APPLICATION_STATUSES.includes(application.status))
        .map((application) => ({
          ...application,
          statusLabel: MENTORSHIP_APPLICANT_STATUS_LABELS[mentorshipApplicantDisplayStatus(application)],
        })),
      ...mentorshipNoteDisplay(this.noteDrafts(), person, MENTORSHIP_ADD_NOTE_LABEL),
      actions: mentorshipRowActions(
        MENTORSHIP_CURRENT_MENTEE_ACTIONS_BY_STATUS[person.status],
        MENTORSHIP_CURRENT_MENTEE_ACTION_LABELS,
        MENTORSHIP_CURRENT_MENTEE_ACTION_ICONS
      ),
      hasTasks: mentorshipApplicantHasTasks(person),
      tasksStatus: tasksState?.status ?? null,
      taskRows: mentorshipApplicantTaskRows(tasksState?.tasks ?? []),
    };
  }
}
