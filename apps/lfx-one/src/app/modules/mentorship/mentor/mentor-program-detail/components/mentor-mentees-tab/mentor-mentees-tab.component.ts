// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { TableComponent } from '@components/table/table.component';
import {
  MENTORSHIP_ADD_NOTE_LABEL,
  MENTORSHIP_APPLICANT_MINIMIZE_TASKS_LABEL,
  MENTORSHIP_APPLICANT_VIEW_TASKS_LABEL,
  MENTORSHIP_CURRENT_MENTEE_STATUSES,
  MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES,
  MENTORSHIP_MENTEE_STATUS_LABELS,
  MENTORSHIP_MENTOR_CREATE_GROUP_TASK_LABEL,
  MENTORSHIP_MENTOR_MENTEES_HEADING,
  MENTORSHIP_MENTOR_NO_TASKS_ASSIGNED,
  MENTORSHIP_PERSON_PAGE_SIZE,
  MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS,
} from '@lfx-one/shared/constants';
import {
  MentorshipMentorTaskCreateRequest,
  MentorshipNoteRequest,
  MentorshipProgramMentee,
  MentorshipTaskDialogAssignee,
  MentorshipTaskFormValue,
} from '@lfx-one/shared/interfaces';
import {
  mentorshipApplicantHasTasks,
  mentorshipApplicantTaskRows,
  mentorshipMenteeTaskCompletion,
  mentorshipNoteDisplay,
  mentorshipPersonAvatarClass,
  mentorshipPersonInitials,
} from '@lfx-one/shared/utils';
import { take } from 'rxjs';

import { ApplicantTasksPanelComponent } from '../../../../components/applicant-tasks-panel/applicant-tasks-panel.component';
import { PersonCellComponent } from '../../../../components/person-cell/person-cell.component';
import { MentorshipTaskDialogService } from '../../../../services/mentorship-task-dialog.service';

/**
 * Mentor-facing Mentees tab — current mentees (accepted / graduated) with task
 * progress, View Tasks expansion, per-row create, and Create Group Task. Only an
 * accepted mentee can be given a task; the tab hands the dialog's value to the parent,
 * which creates the tasks.
 */
@Component({
  selector: 'lfx-mentorship-mentor-mentees-tab',
  imports: [ApplicantTasksPanelComponent, ButtonComponent, PersonCellComponent, TableComponent],
  templateUrl: './mentor-mentees-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorMenteesTabComponent {
  private readonly taskDialog = inject(MentorshipTaskDialogService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly mentees = input.required<MentorshipProgramMentee[]>();
  public readonly noteRequested = output<MentorshipNoteRequest>();
  public readonly taskCreateRequested = output<MentorshipMentorTaskCreateRequest>();

  protected readonly pageSize = MENTORSHIP_PERSON_PAGE_SIZE;
  protected readonly rowsPerPageOptions = MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS;
  protected readonly heading = MENTORSHIP_MENTOR_MENTEES_HEADING;
  protected readonly createGroupTaskLabel = MENTORSHIP_MENTOR_CREATE_GROUP_TASK_LABEL;
  protected readonly viewTasksLabel = MENTORSHIP_APPLICANT_VIEW_TASKS_LABEL;
  protected readonly minimizeTasksLabel = MENTORSHIP_APPLICANT_MINIMIZE_TASKS_LABEL;

  /**
   * Paginator offset. Tracked so that a shrinking list can send the table back to the
   * first page — PrimeNG keeps its own offset when the value array shrinks underneath it.
   */
  protected readonly first = signal(0);

  /** Mentee ids whose tasks sub-table is expanded. */
  protected readonly expandedTaskMenteeIds = signal<Record<string, boolean>>({});

  protected readonly rows = this.initRows();
  protected readonly assignees = computed(() =>
    this.rows()
      .filter((row) => row.canCreateTask)
      .map((row) => this.toAssignee(row))
  );

  protected onOpenNote(id: string, name: string): void {
    this.noteRequested.emit({ personId: id, personName: name });
  }

  protected onCreateGroupTask(): void {
    this.taskDialog
      .openCreateGroup(this.assignees())
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.requestTaskCreate(value));
  }

  protected onCreateTask(mentee: MentorshipProgramMentee): void {
    this.taskDialog
      .openCreate(this.toAssignee(mentee))
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.requestTaskCreate(value));
  }

  protected toggleTasksExpanded(menteeId: string): void {
    this.expandedTaskMenteeIds.update((current) => ({
      ...current,
      [menteeId]: !current[menteeId],
    }));
  }

  private requestTaskCreate(value: MentorshipTaskFormValue | undefined): void {
    if (!value || value.assignedMenteeIds.length === 0) return;
    this.taskCreateRequested.emit({
      applicationIds: value.assignedMenteeIds,
      name: value.name,
      description: value.description,
      dueDate: value.dueOn,
      requiresFileSubmission: value.requiresFileSubmission,
    });
  }

  private initRows() {
    return computed(() =>
      this.mentees()
        .filter((person) => MENTORSHIP_CURRENT_MENTEE_STATUSES.includes(person.status))
        .map((person) => this.toRow(person))
    );
  }

  private toRow(person: MentorshipProgramMentee) {
    const progress = mentorshipMenteeTaskCompletion(person);
    const progressMeasured = progress.total > 0;
    return {
      ...person,
      initials: mentorshipPersonInitials(person.name),
      avatarStyleClass: mentorshipPersonAvatarClass(person.name),
      statusLabel: MENTORSHIP_MENTEE_STATUS_LABELS[person.status],
      statusBadgeClass: MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES[person.status],
      // Upstream takes a task only on an accepted mentee's application, so a graduated mentee gets none.
      canCreateTask: person.status === 'accepted',
      progressMeasured,
      progressPercent: progress.percent,
      progressLabel: progressMeasured ? `${progress.percent}%` : '—',
      progressAriaLabel: progressMeasured ? `${progress.percent}% of tasks completed` : MENTORSHIP_MENTOR_NO_TASKS_ASSIGNED,
      // No drafts: the page saves a note before it shows, so the row's own note is the saved one.
      ...mentorshipNoteDisplay({}, person, MENTORSHIP_ADD_NOTE_LABEL),
      hasTasks: mentorshipApplicantHasTasks(person),
      taskRows: mentorshipApplicantTaskRows(person.tasks ?? []),
    };
  }

  private toAssignee(person: Pick<MentorshipProgramMentee, 'id' | 'name' | 'email' | 'avatarUrl'>): MentorshipTaskDialogAssignee {
    return { id: person.id, name: person.name, email: person.email, avatarUrl: person.avatarUrl };
  }
}
