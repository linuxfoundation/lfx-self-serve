// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ORG_CLA_INVALIDATE_ACKNOWLEDGMENT_COPY } from '@lfx-one/shared/constants';
import type { OrgClaInvalidateAcknowledgmentInput } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';

/**
 * Dialog data passed by the panel opening this modal.
 *
 * `contributor` is the identity the panel already resolved through its fallback chain, so the
 * dialog does not repeat the LF Login → GitHub username → GitLab username → email → DocuSign name
 * decision. `claGroup` is named so the copy can say which agreement is losing coverage.
 */
interface InvalidateDialogData {
  contributor: string;
  claGroup: string;
}

/**
 * Invalidate confirmation for one contributor acknowledgment (#1986).
 *
 * Closes with an `OrgClaInvalidateAcknowledgmentInput` (with trimmed reason/note when either was
 * provided) on accept, or `null` on cancel. The dialog does not call the API itself — the panel
 * owns the request, its in-flight state, and its refetch on success.
 *
 * No typed-to-confirm gate: this is a single-row destructive action against a named contributor,
 * and the modal itself is the consent moment. The destructive control is enabled on mount and
 * requires an explicit click.
 */
@Component({
  selector: 'lfx-org-easycla-invalidate-acknowledgment-dialog',
  imports: [ButtonComponent, InputTextComponent, MessageComponent, ReactiveFormsModule],
  templateUrl: './org-easycla-invalidate-acknowledgment-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaInvalidateAcknowledgmentDialogComponent {
  private readonly dialogConfig = inject<DynamicDialogConfig<InvalidateDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly copy = ORG_CLA_INVALIDATE_ACKNOWLEDGMENT_COPY;
  protected readonly contributor = this.dialogConfig.data?.contributor ?? 'this contributor';
  protected readonly claGroup = this.dialogConfig.data?.claGroup ?? 'this CLA Group';

  protected readonly form = this.formBuilder.group({
    reason: this.formBuilder.control<string>(''),
    note: this.formBuilder.control<string>(''),
  });

  protected get bodyCopy(): string {
    return this.copy.body(this.contributor, this.claGroup);
  }

  protected onConfirm(): void {
    const reason = (this.form.value.reason ?? '').trim();
    const note = (this.form.value.note ?? '').trim();
    const input: OrgClaInvalidateAcknowledgmentInput = {
      ...(reason.length > 0 ? { reason } : {}),
      ...(note.length > 0 ? { note } : {}),
    };
    this.dialogRef.close(input);
  }

  protected onCancel(): void {
    this.dialogRef.close(null);
  }
}
