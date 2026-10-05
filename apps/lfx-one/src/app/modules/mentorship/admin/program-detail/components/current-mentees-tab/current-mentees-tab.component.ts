// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
  MENTORSHIP_ADMIN_MENTEES_LOAD_ERROR_MESSAGE,
  MENTORSHIP_ADMIN_MENTEES_PAGE_SIZE,
  MENTORSHIP_ADMIN_MENTEES_SEARCH_DEBOUNCE_MS,
  MENTORSHIP_ADMIN_TASKS_LOAD_ERROR_MESSAGE,
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
  MENTORSHIP_MENTEE_STATUS_LABELS,
  MENTORSHIP_MENTEE_STATUSES,
} from '@lfx-one/shared/constants';
import {
  FilterOption,
  MentorshipAdminTasksState,
  MentorshipAdminTermOption,
  MentorshipCurrentMenteeAction,
  MentorshipMenteeStatus,
  MentorshipNoteRequest,
  MentorshipProgramApplicant,
  MentorshipRowAction,
} from '@lfx-one/shared/interfaces';
import {
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
import { TooltipModule } from 'primeng/tooltip';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap, take, tap } from 'rxjs';

import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';
import { MentorshipTaskDialogService } from '../../../../services/mentorship-task-dialog.service';
import { ApplicantTasksPanelComponent } from '../../../../components/applicant-tasks-panel/applicant-tasks-panel.component';
import { PersonCellComponent } from '../../../../components/person-cell/person-cell.component';
import { RowActionsComponent } from '../../../../components/row-actions/row-actions.component';

/**
 * Current Mentees tab — the program's applications in an open term, whatever their status, one server page at a
 * time. Search, status and term filters go upstream, and any change of them, or a page change, reads that page
 * again. View Tasks reads an application's tasks on the first click only; the result stays cached until the table
 * next reloads, so collapsing and expanding a row makes no request. Row actions depend on the status; every one
 * stubs to coming soon until the write endpoints land, as do Decline by Term and the status export, except
 * Create task, which opens the task form first. The reviewer note is the one action that takes effect; the
 * parent owns its state, so it outlives a tab switch.
 */
@Component({
  selector: 'lfx-mentorship-current-mentees-tab',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ApplicantTasksPanelComponent,
    ButtonComponent,
    InputTextComponent,
    PersonCellComponent,
    RowActionsComponent,
    SelectComponent,
    TableComponent,
    TooltipModule,
  ],
  templateUrl: './current-mentees-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CurrentMenteesTabComponent {
  private readonly mentorshipAdminService = inject(MentorshipAdminService);
  private readonly comingSoon = inject(MentorshipComingSoonService);
  private readonly taskDialog = inject(MentorshipTaskDialogService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly programId = input.required<string>();
  /** The program's terms; only the open ones feed the term filter. */
  public readonly terms = input<MentorshipAdminTermOption[]>([]);
  /** Notes edited this session, keyed by person id; overrides the note a row arrived with. */
  public readonly noteDrafts = input<Record<string, string>>({});
  public readonly noteRequested = output<MentorshipNoteRequest>();

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

  protected onRowAction(mentee: MentorshipProgramApplicant, action: MentorshipRowAction): void {
    // The menu hands back a plain string; `satisfies` ties the key to the action union, so renaming it fails here.
    if (action.value === ('create-task' satisfies MentorshipCurrentMenteeAction)) {
      this.onCreateTask(mentee);
      return;
    }
    this.comingSoon.notify(`${action.label} ${mentee.name}`);
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
    this.setTasksState(applicationId, { status: 'loading', tasks: [] });
    this.mentorshipAdminService
      .getApplicationTasks(applicationId)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tasks) => this.setTasksIfCurrent(applicationId, { status: 'loaded', tasks }),
        error: () => this.setTasksIfCurrent(applicationId, { status: 'failed', tasks: [] }),
      });
  }

  /** A table reload clears the cache; an answer for a row that is no longer cached belongs to the old page, so it is dropped. */
  private setTasksIfCurrent(applicationId: string, state: MentorshipAdminTasksState): void {
    if (!this.tasksByApplication().has(applicationId)) return;
    this.setTasksState(applicationId, state);
  }

  private setTasksState(applicationId: string, state: MentorshipAdminTasksState): void {
    this.tasksByApplication.update((current) => new Map(current).set(applicationId, state));
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
