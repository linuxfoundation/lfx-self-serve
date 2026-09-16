// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { SelectComponent } from '@components/select/select.component';
import {
  MENTORSHIP_APPLICANT_TASK_STATUS_LABELS,
  MENTORSHIP_APPLICANT_TASK_STATUS_OPTIONS,
  MENTORSHIP_APPLICANT_TASKS_HIDE_PREREQUISITE_LABEL,
  MENTORSHIP_TASK_EDIT_ACTION_ICON,
  MENTORSHIP_TASK_EDIT_ACTION_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipApplicantTaskRow, MentorshipApplicantTaskStatus } from '@lfx-one/shared/interfaces';
import { filterMentorshipApplicantTasks } from '@lfx-one/shared/utils';
import { startWith, take } from 'rxjs';

import { MentorshipComingSoonService } from '../../services/mentorship-coming-soon.service';
import { MentorshipTaskDialogService } from '../../services/mentorship-task-dialog.service';

type TaskStatusForm = FormGroup<{ status: FormControl<MentorshipApplicantTaskStatus> }>;

/**
 * Expanded tasks sub-table for an Applicants or Current Mentees row.
 * Every write (status change, edit, view, download) stubs to the coming-soon
 * toast until the mentorship write endpoints land. UI edits do not mutate the
 * mock lists.
 */
@Component({
  selector: 'lfx-mentorship-applicant-tasks-panel',
  imports: [ReactiveFormsModule, ButtonComponent, CheckboxComponent, SelectComponent],
  templateUrl: './applicant-tasks-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicantTasksPanelComponent {
  private readonly comingSoon = inject(MentorshipComingSoonService);
  private readonly taskDialog = inject(MentorshipTaskDialogService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly applicantId = input.required<string>();
  public readonly applicantName = input.required<string>();
  public readonly tasks = input.required<MentorshipApplicantTaskRow[]>();

  protected readonly filterForm = new FormGroup({
    hidePrerequisite: new FormControl(true, { nonNullable: true }),
  });

  protected readonly hidePrerequisiteLabel = MENTORSHIP_APPLICANT_TASKS_HIDE_PREREQUISITE_LABEL;
  protected readonly editActionLabel = MENTORSHIP_TASK_EDIT_ACTION_LABEL;
  protected readonly editActionIcon = MENTORSHIP_TASK_EDIT_ACTION_ICON;
  protected readonly statusOptions = MENTORSHIP_APPLICANT_TASK_STATUS_OPTIONS;

  /** Lazily-created FormGroup per task row, keyed by task id. */
  private readonly statusFormCache = new Map<string, TaskStatusForm>();

  private readonly hidePrerequisite = toSignal(
    this.filterForm.controls.hidePrerequisite.valueChanges.pipe(startWith(this.filterForm.controls.hidePrerequisite.value)),
    { initialValue: this.filterForm.controls.hidePrerequisite.value }
  );

  private readonly visibleTasks = computed(() => filterMentorshipApplicantTasks(this.tasks(), this.hidePrerequisite()));

  protected readonly visibleTaskRows = this.initVisibleTaskRows();

  protected readonly panelTitle = computed(() => `Tasks Assigned to ${this.applicantName()}`);

  protected onViewTask(task: MentorshipApplicantTaskRow): void {
    this.comingSoon.notify(`View ${task.name} for ${this.applicantName()}`);
  }

  protected onDownloadTask(task: MentorshipApplicantTaskRow): void {
    this.comingSoon.notify(`Download ${task.name} for ${this.applicantName()}`);
  }

  /**
   * Opens the shared task-form dialog in edit mode. Persistence stubs to the
   * coming-soon toast; the mock task list is left unchanged.
   */
  protected onEditTask(task: MentorshipApplicantTaskRow): void {
    this.taskDialog
      .openEdit(task)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        if (!value) return;
        this.comingSoon.notify(`Update ${value.name} for ${this.applicantName()}`);
      });
  }

  /** Toast only — mock data is not updated. */
  protected onStatusChange(task: MentorshipApplicantTaskRow, event: { value: MentorshipApplicantTaskStatus }): void {
    this.comingSoon.notify(`Status of ${task.name} for ${this.applicantName()} → ${MENTORSHIP_APPLICANT_TASK_STATUS_LABELS[event.value]}`);
  }

  private initVisibleTaskRows() {
    return computed(() =>
      this.visibleTasks().map((task) => ({
        ...task,
        statusForm: this.statusFormFor(task.id, task.status),
      }))
    );
  }

  private statusFormFor(taskId: string, status: MentorshipApplicantTaskStatus): TaskStatusForm {
    let form = this.statusFormCache.get(taskId);
    if (!form) {
      form = new FormGroup({ status: new FormControl(status, { nonNullable: true }) });
      this.statusFormCache.set(taskId, form);
    }
    return form;
  }
}
