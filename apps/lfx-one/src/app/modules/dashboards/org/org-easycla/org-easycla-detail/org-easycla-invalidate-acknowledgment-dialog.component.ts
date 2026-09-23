// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import {
  ORG_CLA_INVALIDATE_DIALOG_COPY,
  ORG_CLA_INVALIDATION_NOTE_MAX_LENGTH,
  ORG_CLA_INVALIDATION_REASON_LABELS,
  ORG_CLA_INVALIDATION_REASONS,
} from '@lfx-one/shared/constants';
import type { OrgClaInvalidateAcknowledgmentDialogData, OrgClaInvalidateAcknowledgmentRequest, OrgClaInvalidationReason } from '@lfx-one/shared/interfaces';
import { codePointLength } from '@lfx-one/shared/utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';

/**
 * The cap is the producer's, counted on the note that will actually be sent.
 *
 * `onConfirm` and the BFF both trim before measuring, so a trailing newline must not disable
 * Confirm for a note that is within the cap once that whitespace is gone. The error key matches
 * `maxCodePointsValidator` so the template has one shape to read.
 */
function trimmedNoteLength(control: AbstractControl): ValidationErrors | null {
  if (typeof control.value !== 'string') return null;
  const actualLength = codePointLength(control.value.trim());
  if (actualLength <= ORG_CLA_INVALIDATION_NOTE_MAX_LENGTH) return null;
  return { maxCodePoints: { requiredLength: ORG_CLA_INVALIDATION_NOTE_MAX_LENGTH, actualLength } };
}

/**
 * Confirmation for invalidating one contributor acknowledgment (#1986, #2807).
 *
 * Closes with an `OrgClaInvalidateAcknowledgmentRequest` on confirm and `null` on cancel or
 * dismiss. It does not call the API itself — the panel owns the request, the in-flight state, and
 * the refetch — so a dismissed dialog cannot leave a write half-done.
 *
 * A reason is required before Confirm enables. The producer accepts an empty body, but a CLA
 * manager's own record of why coverage was revoked is the point of the field: the alternative is
 * an audit trail that says a contributor lost coverage and nothing about why.
 *
 * No typed-to-confirm gate. This is a single-row action against a named contributor and the modal
 * is itself the consent moment; the destructive control needs one explicit click.
 */
@Component({
  selector: 'lfx-org-easycla-invalidate-acknowledgment-dialog',
  imports: [ButtonComponent, MessageComponent, ReactiveFormsModule, SelectComponent, TextareaComponent],
  templateUrl: './org-easycla-invalidate-acknowledgment-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaInvalidateAcknowledgmentDialogComponent {
  protected readonly copy = ORG_CLA_INVALIDATE_DIALOG_COPY;

  /** Picker options in the contract's tuple order, which is the order the CLA manager reads. */
  protected readonly reasonOptions = ORG_CLA_INVALIDATION_REASONS.map((reason) => ({
    label: ORG_CLA_INVALIDATION_REASON_LABELS[reason],
    value: reason,
  }));

  public readonly form = new FormGroup({
    reason: new FormControl<OrgClaInvalidationReason | null>(null, { validators: [Validators.required] }),
    // Code points, not Validators.maxLength, and on the trimmed note. The producer's maxLength
    // counts runes, and a native maxlength would stop a non-BMP note at half of that cap.
    note: new FormControl<string>('', { nonNullable: true, validators: [trimmedNoteLength] }),
  });

  private readonly dialogConfig = inject<DynamicDialogConfig<OrgClaInvalidateAcknowledgmentDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  protected readonly contributor = this.dialogConfig.data?.contributor?.trim() || 'this contributor';

  // `statusChanges` alone never emits for the initial invalid state, so the current status is
  // seeded as the initial value — without it Confirm would render enabled until the first edit.
  private readonly status = toSignal(this.form.statusChanges, { initialValue: this.form.status });
  protected readonly canConfirm = computed(() => this.status() === 'VALID');
  // The form starts invalid because the reason is empty, and it stays invalid when a too-long note
  // is typed before a reason is chosen. `statusChanges` does not emit when the status string does
  // not change, so the message has to follow the note's own value.
  private readonly noteValue = toSignal(this.form.controls.note.valueChanges, { initialValue: this.form.controls.note.value });
  protected readonly noteTooLong = computed(() => {
    this.noteValue();
    return this.form.controls.note.hasError('maxCodePoints');
  });

  protected onConfirm(): void {
    if (this.form.invalid) return;

    const reason = this.form.controls.reason.value;
    const note = this.form.controls.note.value.trim();
    const request: OrgClaInvalidateAcknowledgmentRequest = {
      ...(reason ? { reason } : {}),
      ...(note.length > 0 ? { note } : {}),
    };
    this.dialogRef.close(request);
  }

  protected onCancel(): void {
    this.dialogRef.close(null);
  }
}
