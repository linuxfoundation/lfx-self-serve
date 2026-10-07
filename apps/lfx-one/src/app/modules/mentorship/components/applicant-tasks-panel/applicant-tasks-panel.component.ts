// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
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
import { MentorshipAdminTaskUpdate, MentorshipApplicantTask, MentorshipApplicantTaskRow, MentorshipApplicantTaskStatus } from '@lfx-one/shared/interfaces';
import { buildMentorshipAdminTaskUpdate, filterMentorshipApplicantTasks } from '@lfx-one/shared/utils';
import { startWith, take } from 'rxjs';

import { AdminTaskUpdateService } from '../../services/admin-task-update.service';
import { MentorshipComingSoonService } from '../../services/mentorship-coming-soon.service';
import { MentorshipTaskDialogService } from '../../services/mentorship-task-dialog.service';

type TaskStatusForm = FormGroup<{ status: FormControl<MentorshipApplicantTaskStatus> }>;

/**
 * Expanded tasks sub-table for admin Current Mentees and the mentor program-detail Applicants and Mentees rows.
 * With `editable` set (admin Current Mentees) the Edit dialog and the status select save through the BFF: the saved
 * task goes to `taskSaved`, which patches the caller's list, and a failed save puts the select back and toasts why.
 * The caller is a callback rather than an output because collapsing the row destroys this panel while a save is still
 * in flight, and Angular drops an output emitted after destroy. Without `editable` (the mentor tabs, which have no
 * write route yet) every write stubs to the coming-soon toast and the list is left as it was. View and download always
 * stub to the toast, as file transfer is not wired.
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
  private readonly taskUpdate = inject(AdminTaskUpdateService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly applicantId = input.required<string>();
  public readonly applicantName = input.required<string>();
  public readonly tasks = input.required<MentorshipApplicantTaskRow[]>();
  /** Saves edits and status changes through the BFF instead of the coming-soon toast. */
  public readonly editable = input(false);
  /** Called with the applicant's id and the task as saved, so the owner of the list can patch it in place. */
  public readonly taskSaved = input<(applicantId: string, task: MentorshipApplicantTask) => void>(() => undefined);

  protected readonly filterForm = new FormGroup({
    hidePrerequisite: new FormControl(false, { nonNullable: true }),
  });

  protected readonly hidePrerequisiteLabel = MENTORSHIP_APPLICANT_TASKS_HIDE_PREREQUISITE_LABEL;
  protected readonly editActionLabel = MENTORSHIP_TASK_EDIT_ACTION_LABEL;
  protected readonly editActionIcon = MENTORSHIP_TASK_EDIT_ACTION_ICON;
  protected readonly statusOptions = MENTORSHIP_APPLICANT_TASK_STATUS_OPTIONS;

  /** Ids of the tasks with a save in flight; their select and Edit are disabled until it settles. */
  protected readonly savingTaskIds = signal<ReadonlySet<string>>(new Set());

  /** Lazily-created FormGroup per task row, keyed by task id. */
  private readonly statusFormCache = new Map<string, TaskStatusForm>();

  private readonly hidePrerequisite = toSignal(
    this.filterForm.controls.hidePrerequisite.valueChanges.pipe(startWith(this.filterForm.controls.hidePrerequisite.value)),
    { initialValue: this.filterForm.controls.hidePrerequisite.value }
  );

  private readonly visibleTasks = computed(() => filterMentorshipApplicantTasks(this.tasks(), this.hidePrerequisite()));

  protected readonly visibleTaskRows = this.initVisibleTaskRows();

  /** Per visible task, whether a change to it is being saved, here or by a panel collapsed mid-save; Edit and the select are disabled meanwhile. */
  protected readonly busyTaskIds = this.initBusyTaskIds();

  protected readonly panelTitle = computed(() => `Tasks Assigned to ${this.applicantName()}`);

  public constructor() {
    this.initStatusSelectLock();
  }

  protected onViewTask(task: MentorshipApplicantTaskRow): void {
    this.comingSoon.notify(`View ${task.name} for ${this.applicantName()}`);
  }

  protected onDownloadTask(task: MentorshipApplicantTaskRow): void {
    this.comingSoon.notify(`Download ${task.name} for ${this.applicantName()}`);
  }

  /** Opens the shared task-form dialog in edit mode and saves what it changed. */
  protected onEditTask(task: MentorshipApplicantTaskRow): void {
    if (this.editable() && this.isBusy(task.id)) return;
    this.taskDialog
      .openEdit(task)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        if (!value) return;
        if (!this.editable()) {
          this.comingSoon.notify(`Update ${value.name} for ${this.applicantName()}`);
          return;
        }
        const update = buildMentorshipAdminTaskUpdate(task, value);
        if (Object.keys(update).length === 0) return;
        this.saveTask(task, update, true);
      });
  }

  protected onStatusChange(task: MentorshipApplicantTaskRow, event: { value: MentorshipApplicantTaskStatus }): void {
    if (!this.editable()) {
      this.comingSoon.notify(`Status of ${task.name} for ${this.applicantName()} → ${MENTORSHIP_APPLICANT_TASK_STATUS_LABELS[event.value]}`);
      return;
    }
    if (event.value === task.status) return;
    this.saveTask(task, { status: event.value }, false);
  }

  /** Whether a change to the task is being saved, here or by a panel that was collapsed mid-save. */
  private isBusy(taskId: string): boolean {
    return this.savingTaskIds().has(taskId) || this.taskUpdate.isUpdating(taskId);
  }

  /**
   * Sends one change. The save is never cancelled by the panel going away (no `takeUntilDestroyed`), so a collapse
   * mid-save still lands in the caller's list; only the select and the saving flag, which are local, are touched
   * meanwhile. A failure puts the select back on the task's status.
   */
  private saveTask(task: MentorshipApplicantTaskRow, update: MentorshipAdminTaskUpdate, toastOnSuccess: boolean): void {
    if (this.isBusy(task.id)) {
      this.resetStatus(task);
      return;
    }
    const applicantId = this.applicantId();
    this.setSaving(task.id, true);
    this.taskUpdate
      .update(task.id, update, toastOnSuccess)
      .pipe(take(1))
      .subscribe((saved) => {
        this.setSaving(task.id, false);
        if (saved) {
          this.taskSaved()(applicantId, saved);
          return;
        }
        this.resetStatus(task);
      });
  }

  private setSaving(taskId: string, saving: boolean): void {
    this.savingTaskIds.update((current) => {
      const next = new Set(current);
      if (saving) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }

  private resetStatus(task: MentorshipApplicantTaskRow): void {
    this.statusFormCache.get(task.id)?.controls.status.setValue(task.status, { emitEvent: false });
  }

  private initVisibleTaskRows() {
    return computed(() =>
      this.visibleTasks().map((task) => ({
        ...task,
        statusForm: this.statusFormFor(task.id, task.status),
      }))
    );
  }

  /** Kept apart from the rows: a save settling must not rebuild them, since that can move a select's value mid-computed. */
  private initBusyTaskIds() {
    return computed<Readonly<Record<string, boolean>>>(() => Object.fromEntries(this.visibleTasks().map((task) => [task.id, this.isBusy(task.id)])));
  }

  /**
   * Disables each visible select while its task is saving, here or by a panel collapsed mid-save, so a rebuilt panel
   * offers no pick that `saveTask` would only drop. An effect rather than the rows computed, since disabling writes the
   * select's state.
   */
  private initStatusSelectLock(): void {
    effect(() => {
      const busy = this.busyTaskIds();
      const rows = this.visibleTaskRows();
      untracked(() => {
        for (const row of rows) {
          if (busy[row.id]) row.statusForm.disable({ emitEvent: false });
          else row.statusForm.enable({ emitEvent: false });
        }
      });
    });
  }

  private statusFormFor(taskId: string, status: MentorshipApplicantTaskStatus): TaskStatusForm {
    let form = this.statusFormCache.get(taskId);
    if (!form) {
      form = new FormGroup({ status: new FormControl(status, { nonNullable: true }) });
      this.statusFormCache.set(taskId, form);
    } else if (!untracked(() => this.savingTaskIds().has(taskId)) && form.controls.status.value !== status) {
      // The list moved on (a save landed after this panel was rebuilt, or the row was patched), so the select follows it.
      form.controls.status.setValue(status, { emitEvent: false });
    }
    return form;
  }
}
