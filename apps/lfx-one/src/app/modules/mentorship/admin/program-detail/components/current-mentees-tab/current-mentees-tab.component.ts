// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import {
  MENTORSHIP_ACTIVE_APPLICATION_STATUSES,
  MENTORSHIP_ADD_NOTE_LABEL,
  MENTORSHIP_ALL_OPEN_TERMS_OPTION_LABEL,
  MENTORSHIP_ALL_STATUSES_OPTION_LABEL,
  MENTORSHIP_APPLICANT_DISPLAY_STATUSES,
  MENTORSHIP_APPLICANT_MINIMIZE_TASKS_LABEL,
  MENTORSHIP_APPLICANT_STATUS_BADGE_CLASSES,
  MENTORSHIP_APPLICANT_STATUS_LABELS,
  MENTORSHIP_APPLICANT_STATUS_NOTE,
  MENTORSHIP_APPLICANT_VIEW_TASKS_LABEL,
  MENTORSHIP_CURRENT_MENTEE_ACTION_ICONS,
  MENTORSHIP_CURRENT_MENTEE_ACTION_LABELS,
  MENTORSHIP_CURRENT_MENTEE_ACTIONS_BY_STATUS,
  MENTORSHIP_PERSON_PAGE_SIZE,
  MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS,
} from '@lfx-one/shared/constants';
import {
  FilterOption,
  MentorshipApplicantDisplayStatus,
  MentorshipNoteRequest,
  MentorshipProgramApplicant,
  MentorshipProgramTermRow,
  MentorshipRowAction,
} from '@lfx-one/shared/interfaces';
import {
  formatIsoDateLabel,
  matchesMentorshipPersonSearch,
  mentorshipApplicantDisplayStatus,
  mentorshipApplicantHasTasks,
  mentorshipApplicantTaskRows,
  mentorshipNoteDisplay,
  mentorshipPersonAvatarClass,
  mentorshipPersonInitials,
  mentorshipRowActions,
  mentorshipTermFilterOptions,
} from '@lfx-one/shared/utils';
import { startWith, take, tap } from 'rxjs';

import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';
import { MentorshipTaskDialogService } from '../../../../services/mentorship-task-dialog.service';
import { ApplicantTasksPanelComponent } from '../../../../components/applicant-tasks-panel/applicant-tasks-panel.component';
import { PersonCellComponent } from '../../../../components/person-cell/person-cell.component';
import { RowActionsComponent } from '../../../../components/row-actions/row-actions.component';

/**
 * Current Mentees tab — every application in one of the program's open terms, whatever
 * its status, filtered by search, status, and open term. View Tasks expands an inline
 * sub-table of assigned tasks. Row actions depend on the status: an application under
 * review can be accepted, declined, or withdrawn; an accepted mentee can also be given a
 * task or graduated. Create task opens the task form; it and every other action stub to
 * coming soon until the write endpoints land, as do Decline by Term and the status export.
 * The reviewer note is the one action that takes effect; the parent owns its state, so it
 * outlives a tab switch.
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
  ],
  templateUrl: './current-mentees-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CurrentMenteesTabComponent {
  private readonly comingSoon = inject(MentorshipComingSoonService);
  private readonly taskDialog = inject(MentorshipTaskDialogService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly mentees = input.required<MentorshipProgramApplicant[]>();
  /** The program's terms; only the open ones feed the term filter. */
  public readonly terms = input<MentorshipProgramTermRow[]>([]);
  /** Notes edited this session, keyed by person id; overrides the note a row arrived with. */
  public readonly noteDrafts = input<Record<string, string>>({});
  public readonly noteRequested = output<MentorshipNoteRequest>();

  protected readonly pageSize = MENTORSHIP_PERSON_PAGE_SIZE;
  protected readonly rowsPerPageOptions = MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS;
  protected readonly statusNote = MENTORSHIP_APPLICANT_STATUS_NOTE;
  protected readonly viewTasksLabel = MENTORSHIP_APPLICANT_VIEW_TASKS_LABEL;
  protected readonly minimizeTasksLabel = MENTORSHIP_APPLICANT_MINIMIZE_TASKS_LABEL;

  /**
   * Fixed rather than derived from the rows: every status the table can badge. Filters on
   * the displayed status, so Applied and Tasks Completed each pick out their own pending rows.
   */
  protected readonly statusOptions: FilterOption<MentorshipApplicantDisplayStatus | null>[] = [
    { label: MENTORSHIP_ALL_STATUSES_OPTION_LABEL, value: null },
    ...MENTORSHIP_APPLICANT_DISPLAY_STATUSES.map((status) => ({ label: MENTORSHIP_APPLICANT_STATUS_LABELS[status], value: status })),
  ];

  protected readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    status: new FormControl<MentorshipApplicantDisplayStatus | null>(null),
    term: new FormControl<string | null>(null),
  });

  /**
   * Paginator offset. Tracked so that narrowing the list can send the table back to the
   * first page — PrimeNG keeps its own offset when the value array shrinks underneath it,
   * which would otherwise leave the admin on a page that no longer exists.
   */
  protected readonly first = signal(0);

  /** Mentee ids whose tasks sub-table is expanded. */
  protected readonly expandedTaskMenteeIds = signal<Record<string, boolean>>({});

  private readonly filters = toSignal(
    this.form.valueChanges.pipe(
      tap(() => this.first.set(0)),
      startWith(this.form.getRawValue())
    ),
    { initialValue: this.form.getRawValue() }
  );

  protected readonly termOptions = this.initTermOptions();

  protected readonly rows = this.initRows();

  protected onOpenNote(id: string, name: string): void {
    this.noteRequested.emit({ personId: id, personName: name });
  }

  protected onAction(summary: string): void {
    this.comingSoon.notify(summary);
  }

  protected onRowAction(mentee: MentorshipProgramApplicant, action: MentorshipRowAction): void {
    if (action.value === 'create-task') {
      this.onCreateTask(mentee);
      return;
    }
    this.comingSoon.notify(`${action.label} ${mentee.name}`);
  }

  protected toggleTasksExpanded(menteeId: string): void {
    this.expandedTaskMenteeIds.update((current) => ({
      ...current,
      [menteeId]: !current[menteeId],
    }));
  }

  private initTermOptions() {
    return computed(() => mentorshipTermFilterOptions(this.terms(), 'open', MENTORSHIP_ALL_OPEN_TERMS_OPTION_LABEL));
  }

  private initRows() {
    return computed(() => {
      const { search, status, term } = this.filters();
      return this.mentees()
        .filter((person) => matchesMentorshipPersonSearch(person, search ?? ''))
        .filter((person) => !status || mentorshipApplicantDisplayStatus(person) === status)
        .filter((person) => !term || person.termName === term)
        .map((person) => this.toRow(person));
    });
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

  private toRow(person: MentorshipProgramApplicant) {
    const displayStatus = mentorshipApplicantDisplayStatus(person);
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
      taskRows: mentorshipApplicantTaskRows(person.tasks ?? []),
    };
  }
}
