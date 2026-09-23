// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ORG_CLA_INVALIDATE_DIALOG_COPY } from '@lfx-one/shared/constants';
import type { OrgClaInvalidateAcknowledgmentDialogData, OrgClaInvalidateAcknowledgmentDialogResult } from '@lfx-one/shared/interfaces';
import { orgClaApprovalCriteriaLabel } from '@lfx-one/shared/utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';

/**
 * Confirmation for invalidating one contributor acknowledgment (#1986, #2807).
 *
 * Closes with an `OrgClaInvalidateAcknowledgmentDialogResult` on confirm and `null` on cancel or
 * dismiss. It does not call the API itself — the panel owns the requests, the in-flight state,
 * and the refetch — so a dismissed dialog cannot leave a write half-done.
 *
 * No typed-to-confirm gate. This is a single-row action against a named contributor and the modal
 * is itself the consent moment; the destructive control needs one explicit click.
 */
@Component({
  selector: 'lfx-org-easycla-invalidate-acknowledgment-dialog',
  imports: [ButtonComponent],
  templateUrl: './org-easycla-invalidate-acknowledgment-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaInvalidateAcknowledgmentDialogComponent {
  protected readonly copy = ORG_CLA_INVALIDATE_DIALOG_COPY;

  private readonly dialogConfig = inject<DynamicDialogConfig<OrgClaInvalidateAcknowledgmentDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly data = this.dialogConfig.data;

  protected readonly contributor = this.data?.contributor?.trim() || 'this contributor';

  protected readonly matchingEntries = computed(() => (this.data?.matchingEntries ? this.data.matchingEntries() : null));
  protected readonly canRemoveEntries = computed(() => this.data?.canRemoveEntries?.() ?? false);
  protected readonly matchRows = computed(() =>
    (this.matchingEntries() ?? []).map((entry) => ({ ...entry, criteriaLabel: orgClaApprovalCriteriaLabel(entry.kind) }))
  );
  protected readonly checking = computed(() => this.matchingEntries() === undefined);
  protected readonly alsoRemove = signal(true);

  protected onAlsoRemoveChange(event: Event): void {
    this.alsoRemove.set((event.target as HTMLInputElement).checked);
  }

  protected onConfirm(): void {
    const entries = this.canRemoveEntries() && this.alsoRemove() ? (this.matchingEntries() ?? []) : [];
    const result: OrgClaInvalidateAcknowledgmentDialogResult =
      entries.length > 0 ? { removeApprovalEntries: entries.map(({ kind, value }) => ({ kind, value })) } : {};
    this.dialogRef.close(result);
  }

  protected onCancel(): void {
    this.dialogRef.close(null);
  }
}
