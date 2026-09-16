// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  MENTORSHIP_APPLICANT_TASK_STATUS_OPTIONS,
  MENTORSHIP_TASK_ASSIGN_CLEAR_LABEL,
  MENTORSHIP_TASK_ASSIGN_SELECT_ALL_LABEL,
  MENTORSHIP_TASK_ASSIGN_TO_LABEL,
  MENTORSHIP_TASK_CANCEL_LABEL,
  MENTORSHIP_TASK_CREATE_SUBMIT_LABEL,
  MENTORSHIP_TASK_DESCRIPTION_LABEL,
  MENTORSHIP_TASK_DESCRIPTION_MAX,
  MENTORSHIP_TASK_DESCRIPTION_PLACEHOLDER,
  MENTORSHIP_TASK_DUE_DATE_LABEL,
  MENTORSHIP_TASK_DUE_DATE_PLACEHOLDER,
  MENTORSHIP_TASK_EDIT_SUBMIT_LABEL,
  MENTORSHIP_TASK_NAME_LABEL,
  MENTORSHIP_TASK_NAME_MAX,
  MENTORSHIP_TASK_NAME_PLACEHOLDER,
  MENTORSHIP_TASK_REQUIRES_FILE_LABEL,
  MENTORSHIP_TASK_STATUS_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipApplicantTaskStatus, MentorshipTaskFormDialogData, MentorshipTaskFormValue } from '@lfx-one/shared/interfaces';
import { mentorshipPersonAvatarClass, mentorshipPersonInitials, parseMentorshipDateOnly, toMentorshipDateOnly } from '@lfx-one/shared/utils';
import { trimmedRequired } from '@lfx-one/shared/validators';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Create/edit dialog for a mentee task — opened from admin's Create Task button on the
 * Current Mentees tab and from the Edit action on the applicant tasks panel. See
 * `MentorshipTaskDialogService.openCreate` / `openEdit` for the two entry points.
 *
 * Assignee section:
 *   - Hidden in `edit` mode (a task's assignee is not editable here).
 *   - Hidden in `create` mode when only one mentee is passed (single-mentee flow used
 *     by the per-row Create Task button); `assignedMenteeIds` is pre-seeded with that
 *     mentee's id from `preselectedMenteeIds`.
 *   - Shown in `create` mode when multiple mentees are passed (future Mentees-tab
 *     multi-select flow), with `Select all` / `Clear` shortcuts and a live count.
 */
@Component({
  selector: 'lfx-mentorship-task-form-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, CalendarComponent, CheckboxComponent, InputTextComponent, SelectComponent, TextareaComponent],
  templateUrl: './task-form-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskFormDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject<DynamicDialogConfig<MentorshipTaskFormDialogData>>(DynamicDialogConfig);

  protected readonly data: MentorshipTaskFormDialogData = this.dialogConfig.data ?? {
    mode: 'create',
    mentees: [],
    preselectedMenteeIds: [],
  };

  protected readonly taskNameLabel = MENTORSHIP_TASK_NAME_LABEL;
  protected readonly taskNamePlaceholder = MENTORSHIP_TASK_NAME_PLACEHOLDER;
  protected readonly taskNameMax = MENTORSHIP_TASK_NAME_MAX;
  protected readonly dueDateLabel = MENTORSHIP_TASK_DUE_DATE_LABEL;
  protected readonly dueDatePlaceholder = MENTORSHIP_TASK_DUE_DATE_PLACEHOLDER;
  protected readonly descriptionLabel = MENTORSHIP_TASK_DESCRIPTION_LABEL;
  protected readonly descriptionPlaceholder = MENTORSHIP_TASK_DESCRIPTION_PLACEHOLDER;
  protected readonly descriptionMax = MENTORSHIP_TASK_DESCRIPTION_MAX;
  protected readonly requiresFileLabel = MENTORSHIP_TASK_REQUIRES_FILE_LABEL;
  protected readonly statusLabel = MENTORSHIP_TASK_STATUS_LABEL;
  protected readonly statusOptions = MENTORSHIP_APPLICANT_TASK_STATUS_OPTIONS;
  protected readonly assignToLabel = MENTORSHIP_TASK_ASSIGN_TO_LABEL;
  protected readonly selectAllLabel = MENTORSHIP_TASK_ASSIGN_SELECT_ALL_LABEL;
  protected readonly clearLabel = MENTORSHIP_TASK_ASSIGN_CLEAR_LABEL;
  protected readonly cancelLabel = MENTORSHIP_TASK_CANCEL_LABEL;

  protected readonly isEdit = computed(() => this.data.mode === 'edit');
  protected readonly submitLabel = computed(() => (this.isEdit() ? MENTORSHIP_TASK_EDIT_SUBMIT_LABEL : MENTORSHIP_TASK_CREATE_SUBMIT_LABEL));

  /** Multi-select assignee list only renders in `create` mode when more than one mentee was passed. */
  protected readonly showAssigneeList = computed(() => !this.isEdit() && this.data.mentees.length > 1);

  protected readonly assignees = computed(() =>
    this.data.mentees.map((mentee) => ({
      ...mentee,
      initials: mentorshipPersonInitials(mentee.name),
      avatarStyleClass: mentorshipPersonAvatarClass(mentee.name),
    }))
  );

  /**
   * Nested FormGroup keyed by mentee id — one `FormControl<boolean>` per mentee so
   * each row can bind `<lfx-checkbox [form]="assigneesForm" [control]="mentee.id">`
   * without a raw `<input type="checkbox">` (frontend checklist §14.1). Reduced to an
   * id list on submit; ignored in edit mode.
   */
  protected readonly assigneesForm = this.initAssigneesForm();

  protected readonly form = new FormGroup({
    name: new FormControl(this.data.task?.name ?? '', {
      nonNullable: true,
      validators: [trimmedRequired(), Validators.maxLength(MENTORSHIP_TASK_NAME_MAX)],
    }),
    description: new FormControl(this.data.task?.description ?? '', {
      nonNullable: true,
      validators: [trimmedRequired(), Validators.maxLength(MENTORSHIP_TASK_DESCRIPTION_MAX)],
    }),
    // The calendar produces a `Date` object; converted back to ISO YYYY-MM-DD on submit.
    dueDate: new FormControl<Date | null>(this.initialDueDate(), { nonNullable: false }),
    requiresFileSubmission: new FormControl(!!this.data.task?.requiresFileSubmission, { nonNullable: true }),
    /**
     * Status only surfaces in edit mode. Create is seeded as `pending` and the field
     * is omitted from the submitted value until the write endpoint exists.
     */
    status: new FormControl<MentorshipApplicantTaskStatus>(this.data.task?.status ?? 'pending', { nonNullable: true }),
    assignees: this.assigneesForm,
  });

  private readonly assigneesSnapshot = toSignal(this.assigneesForm.valueChanges, { initialValue: this.assigneesForm.getRawValue() });
  private readonly formStatus = toSignal(this.form.statusChanges, { initialValue: this.form.status });

  protected readonly selectedMenteeCount = computed(() => Object.values(this.assigneesSnapshot() ?? {}).filter(Boolean).length);
  protected readonly menteeCount = computed(() => this.assignees().length);
  protected readonly assigneeCountLabel = computed(() => `${this.selectedMenteeCount()} of ${this.menteeCount()} mentees selected`);

  /**
   * Disable the primary button when the form is invalid, and — in create mode with the
   * multi-mentee list visible — when no assignee is checked. Edit mode never checks
   * assignees (the assignee list is hidden and immutable).
   */
  protected readonly canSubmit = computed(() => {
    if (this.formStatus() !== 'VALID') return false;
    if (!this.isEdit() && this.showAssigneeList() && this.selectedMenteeCount() === 0) return false;
    return true;
  });

  protected onSelectAll(): void {
    this.setAllAssignees(true);
  }

  protected onClear(): void {
    this.setAllAssignees(false);
  }

  protected onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const assignedMenteeIds = this.isEdit()
      ? []
      : Object.entries(raw.assignees ?? {})
          .filter(([, checked]) => checked)
          .map(([id]) => id);
    if (!this.isEdit() && assignedMenteeIds.length === 0) return;

    const value: MentorshipTaskFormValue = {
      taskId: this.data.task?.id,
      name: raw.name.trim(),
      description: raw.description.trim(),
      dueOn: raw.dueDate ? toMentorshipDateOnly(raw.dueDate) : undefined,
      requiresFileSubmission: raw.requiresFileSubmission,
      assignedMenteeIds,
      ...(this.isEdit() ? { status: raw.status } : {}),
    };
    this.dialogRef.close(value);
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }

  /**
   * Parse an ISO date-only string as a local calendar day so the picker matches
   * `lfx-calendar`. Invalid or non-calendar values (including `2026-02-31`) drop
   * back to `null` rather than silently coercing to today.
   */
  private initialDueDate(): Date | null {
    return this.data.task?.dueOn ? parseMentorshipDateOnly(this.data.task.dueOn) : null;
  }

  /**
   * Build a FormGroup with one `FormControl<boolean>` per mentee; the preselected set
   * (single-mentee create flow) starts checked.
   */
  private initAssigneesForm(): FormGroup<Record<string, FormControl<boolean>>> {
    const preselected = new Set(this.data.preselectedMenteeIds);
    const controls: Record<string, FormControl<boolean>> = {};
    for (const mentee of this.data.mentees) {
      controls[mentee.id] = new FormControl<boolean>(preselected.has(mentee.id), { nonNullable: true });
    }
    return new FormGroup(controls);
  }

  /**
   * Select-all / clear helper. Uses `patchValue` (not `setValue`) so we don't have to
   * enumerate every control name — the FormGroup's controls define the key set, and
   * `patchValue` ignores unknown keys and accepts partial input.
   */
  private setAllAssignees(checked: boolean): void {
    const next: Record<string, boolean> = {};
    for (const id of Object.keys(this.assigneesForm.controls)) {
      next[id] = checked;
    }
    this.assigneesForm.patchValue(next);
  }
}
