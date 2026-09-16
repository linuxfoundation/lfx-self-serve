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
import { MentorshipNoteRequest, MentorshipProgramMentee, MentorshipTaskDialogAssignee } from '@lfx-one/shared/interfaces';
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
import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';
import { MentorshipTaskDialogService } from '../../../../services/mentorship-task-dialog.service';

/**
 * Mentor-facing Mentees tab — current mentees (accepted / graduated) with task
 * progress, View Tasks expansion, per-row create, and Create Group Task. Writes stub
 * to the coming-soon toast until the mentorship write endpoints land.
 */
@Component({
  selector: 'lfx-mentorship-mentor-mentees-tab',
  imports: [ApplicantTasksPanelComponent, ButtonComponent, PersonCellComponent, TableComponent],
  templateUrl: './mentor-mentees-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorMenteesTabComponent {
  private readonly comingSoon = inject(MentorshipComingSoonService);
  private readonly taskDialog = inject(MentorshipTaskDialogService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly mentees = input.required<MentorshipProgramMentee[]>();
  /** Notes edited this session, keyed by person id; overrides the note a row arrived with. */
  public readonly noteDrafts = input<Record<string, string>>({});
  public readonly noteRequested = output<MentorshipNoteRequest>();

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
  protected readonly assignees = computed(() => this.rows().map((row) => this.toAssignee(row)));

  protected onOpenNote(id: string, name: string): void {
    this.noteRequested.emit({ personId: id, personName: name });
  }

  protected onCreateGroupTask(): void {
    this.taskDialog
      .openCreateGroup(this.assignees())
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        if (!value) return;
        const n = value.assignedMenteeIds.length;
        const noun = n === 1 ? 'mentee' : 'mentees';
        this.comingSoon.notify(`Create group task "${value.name}" for ${n} ${noun}`);
      });
  }

  protected onCreateTask(mentee: MentorshipProgramMentee): void {
    this.taskDialog
      .openCreate(this.toAssignee(mentee))
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        if (!value) return;
        this.comingSoon.notify(`Create task "${value.name}" for ${mentee.name}`);
      });
  }

  protected toggleTasksExpanded(menteeId: string): void {
    this.expandedTaskMenteeIds.update((current) => ({
      ...current,
      [menteeId]: !current[menteeId],
    }));
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
      progressMeasured,
      progressPercent: progress.percent,
      progressLabel: progressMeasured ? `${progress.percent}%` : '—',
      progressAriaLabel: progressMeasured ? `${progress.percent}% of tasks completed` : MENTORSHIP_MENTOR_NO_TASKS_ASSIGNED,
      ...mentorshipNoteDisplay(this.noteDrafts(), person, MENTORSHIP_ADD_NOTE_LABEL),
      hasTasks: mentorshipApplicantHasTasks(person),
      taskRows: mentorshipApplicantTaskRows(person.tasks ?? []),
    };
  }

  private toAssignee(person: Pick<MentorshipProgramMentee, 'id' | 'name' | 'email' | 'avatarUrl'>): MentorshipTaskDialogAssignee {
    return { id: person.id, name: person.name, email: person.email, avatarUrl: person.avatarUrl };
  }
}
