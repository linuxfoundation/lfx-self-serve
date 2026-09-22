// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ORG_CLA_INVALIDATE_DIALOG_COPY,
  ORG_CLA_INVALIDATION_NOTE_MAX_LENGTH,
  ORG_CLA_INVALIDATION_REASON_LABELS,
  ORG_CLA_INVALIDATION_REASONS,
} from '@lfx-one/shared/constants';
import type { OrgClaInvalidateAcknowledgmentDialogData, OrgClaInvalidateAcknowledgmentRequest, OrgClaInvalidationReason } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';

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
  protected readonly noteMaxLength = ORG_CLA_INVALIDATION_NOTE_MAX_LENGTH;

  /** Picker options in the contract's tuple order, which is the order the CLA manager reads. */
  protected readonly reasonOptions = ORG_CLA_INVALIDATION_REASONS.map((reason) => ({
    label: ORG_CLA_INVALIDATION_REASON_LABELS[reason],
    value: reason,
  }));

  protected readonly form = new FormGroup({
    reason: new FormControl<OrgClaInvalidationReason | null>(null, { validators: [Validators.required] }),
    note: new FormControl<string>('', { nonNullable: true, validators: [Validators.maxLength(ORG_CLA_INVALIDATION_NOTE_MAX_LENGTH)] }),
  });

  private readonly dialogConfig = inject<DynamicDialogConfig<OrgClaInvalidateAcknowledgmentDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  protected readonly contributor = this.dialogConfig.data?.contributor?.trim() || 'this contributor';

  // `statusChanges` alone never emits for the initial invalid state, so the current status is
  // seeded as the initial value — without it Confirm would render enabled until the first edit.
  private readonly status = toSignal(this.form.statusChanges, { initialValue: this.form.status });
  protected readonly canConfirm = computed(() => this.status() === 'VALID');

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
