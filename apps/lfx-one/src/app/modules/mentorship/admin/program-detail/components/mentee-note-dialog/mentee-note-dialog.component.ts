// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MENTORSHIP_MENTEE_NOTE_MAX, MENTORSHIP_MENTEE_NOTE_PLACEHOLDER, MENTORSHIP_MENTEE_NOTE_VISIBILITY } from '@lfx-one/shared/constants';
import { MentorshipNoteDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Reviewer-note dialog for a program-detail person row — both the Current Mentees and
 * Applicants tabs open it. Closes with the trimmed note so the caller can store it: an
 * empty string clears the note, `undefined` (dismissed) leaves it untouched.
 */
@Component({
  selector: 'lfx-mentorship-mentee-note-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, TextareaComponent],
  templateUrl: './mentee-note-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeNoteDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject<DynamicDialogConfig<MentorshipNoteDialogData>>(DynamicDialogConfig);

  protected readonly data: MentorshipNoteDialogData = this.dialogConfig.data ?? { personName: '', note: '' };
  protected readonly noteMax = MENTORSHIP_MENTEE_NOTE_MAX;
  protected readonly notePlaceholder = MENTORSHIP_MENTEE_NOTE_PLACEHOLDER;
  protected readonly noteVisibility = MENTORSHIP_MENTEE_NOTE_VISIBILITY;

  protected readonly form = new FormGroup({
    note: new FormControl(this.data.note, { nonNullable: true, validators: [Validators.maxLength(MENTORSHIP_MENTEE_NOTE_MAX)] }),
  });

  private readonly formSnapshot = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected readonly noteLength = computed(() => String(this.formSnapshot().note ?? '').length);

  protected onSave(): void {
    if (this.form.invalid) return;
    this.dialogRef.close(this.form.controls.note.value.trim());
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }
}
