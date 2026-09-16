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

/**
 * Expanded tasks sub-table for an Applicants or Current Mentees row.
 * Submission view/download stub to the shared coming-soon toast until the
 * mentorship write endpoints land. Task status is editable by admins and mentors
 * via the per-row dropdown; changes are held in a session-only `statusDrafts`
 * signal (mirroring the parent's note-drafts pattern) and forwarded to the
 * coming-soon toast until the mentorship-service update-status endpoint exists.
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

  /** Lazily-created FormGroup per task row, keyed by task id. The lfx-select wrapper
   *  requires `[form]` + `control`, so each row gets its own group with a `status` control. */
  private readonly statusFormCache = new Map<string, FormGroup>();

  private readonly hidePrerequisite = toSignal(
    this.filterForm.controls.hidePrerequisite.valueChanges.pipe(startWith(this.filterForm.controls.hidePrerequisite.value)),
    { initialValue: this.filterForm.controls.hidePrerequisite.value }
  );

  protected readonly visibleTasks = computed(() => filterMentorshipApplicantTasks(this.tasks(), this.hidePrerequisite()));

  protected readonly panelTitle = computed(() => `Tasks Assigned to ${this.applicantName()}`);

  protected onViewTask(task: MentorshipApplicantTaskRow): void {
    this.comingSoon.notify(`View ${task.name} for ${this.applicantName()}`);
  }

  protected onDownloadTask(task: MentorshipApplicantTaskRow): void {
    this.comingSoon.notify(`Download ${task.name} for ${this.applicantName()}`);
  }

  /**
   * Opens the shared task-form dialog in edit mode. Rendered only for non-prerequisite
   * rows in the template; the persistence side stubs to the coming-soon toast until
   * the mentorship-service update-task endpoint lands.
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

  /**
   * Records a status change in the session-only `statusDrafts` signal and fires
   * a coming-soon toast until the mentorship-service update-status endpoint lands.
   */
  protected onStatusChange(taskId: string, taskName: string, event: { value: MentorshipApplicantTaskStatus }): void {
    this.comingSoon.notify(`Status of ${taskName} for ${this.applicantName()} → ${MENTORSHIP_APPLICANT_TASK_STATUS_LABELS[event.value]}`);
  }

  /** Returns a cached FormGroup for the given task's status dropdown. */
  protected getStatusForm(taskId: string, initialStatus: MentorshipApplicantTaskStatus): FormGroup {
    let form = this.statusFormCache.get(taskId);
    if (!form) {
      form = new FormGroup({ status: new FormControl(initialStatus, { nonNullable: true }) });
      this.statusFormCache.set(taskId, form);
    }
    return form;
  }
}
