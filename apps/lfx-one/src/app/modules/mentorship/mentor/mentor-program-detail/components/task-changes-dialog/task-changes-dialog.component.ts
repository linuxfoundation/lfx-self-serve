// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  MENTORSHIP_MENTOR_TASK_CHANGES_REASON_HINT,
  MENTORSHIP_MENTOR_TASK_CHANGES_REASON_LABEL,
  MENTORSHIP_MENTOR_TASK_CHANGES_REASON_MAX,
  MENTORSHIP_MENTOR_TASK_CHANGES_REASON_PLACEHOLDER,
  MENTORSHIP_MENTOR_TASK_CHANGES_REASON_REQUIRED,
  MENTORSHIP_MENTOR_TASK_REQUEST_CHANGES_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipTaskChangesDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Request Changes dialog for the mentor Tasks tab. The reason is required: it closes with the trimmed reason, which
 * upstream emails to the mentee, or with `undefined` when dismissed, in which case nothing is sent.
 */
@Component({
  selector: 'lfx-mentorship-task-changes-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, TextareaComponent],
  templateUrl: './task-changes-dialog.component.html',
})
export class TaskChangesDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject<DynamicDialogConfig<MentorshipTaskChangesDialogData>>(DynamicDialogConfig);

  protected readonly data: MentorshipTaskChangesDialogData = this.dialogConfig.data ?? { menteeName: '', taskName: '' };
  protected readonly reasonMax = MENTORSHIP_MENTOR_TASK_CHANGES_REASON_MAX;
  protected readonly reasonLabel = MENTORSHIP_MENTOR_TASK_CHANGES_REASON_LABEL;
  protected readonly reasonPlaceholder = MENTORSHIP_MENTOR_TASK_CHANGES_REASON_PLACEHOLDER;
  protected readonly reasonHint = MENTORSHIP_MENTOR_TASK_CHANGES_REASON_HINT;
  protected readonly reasonRequired = MENTORSHIP_MENTOR_TASK_CHANGES_REASON_REQUIRED;
  protected readonly submitLabel = MENTORSHIP_MENTOR_TASK_REQUEST_CHANGES_LABEL;

  protected readonly form = new FormGroup({
    reason: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(MENTORSHIP_MENTOR_TASK_CHANGES_REASON_MAX)] }),
  });

  /** Set by the first submit, so a blank reason shows its error only once the mentor tries to send it. */
  protected readonly submitted = signal(false);

  private readonly formSnapshot = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected readonly reasonLength = computed(() => String(this.formSnapshot().reason ?? '').length);
  protected readonly reasonBlank = computed(() => String(this.formSnapshot().reason ?? '').trim() === '');
  protected readonly showRequired = computed(() => this.submitted() && this.reasonBlank());

  protected onSubmit(): void {
    this.submitted.set(true);
    const reason = this.form.controls.reason.value.trim();
    if (!reason || this.form.invalid) return;
    this.dialogRef.close(reason);
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }
}
