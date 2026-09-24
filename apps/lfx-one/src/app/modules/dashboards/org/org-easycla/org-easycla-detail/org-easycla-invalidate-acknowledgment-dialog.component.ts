// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { ORG_CLA_INVALIDATE_DIALOG_COPY } from '@lfx-one/shared/constants';
import type { OrgClaInvalidateAcknowledgmentDialogData, OrgClaInvalidateAcknowledgmentDialogResult } from '@lfx-one/shared/interfaces';
import { orgClaApprovalCriteriaLabel } from '@lfx-one/shared/utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';

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
  imports: [ButtonComponent, CheckboxComponent],
  templateUrl: './org-easycla-invalidate-acknowledgment-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaInvalidateAcknowledgmentDialogComponent {
  public static readonly headingId = 'org-easycla-invalidate-dialog-heading';

  protected readonly copy = ORG_CLA_INVALIDATE_DIALOG_COPY;

  private readonly dialogConfig = inject<DynamicDialogConfig<OrgClaInvalidateAcknowledgmentDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly data = this.dialogConfig.data;

  protected readonly headingId = OrgEasyclaInvalidateAcknowledgmentDialogComponent.headingId;
  protected readonly contributor = this.data?.contributor?.trim() || 'this contributor';
  protected readonly title = this.copy.title(this.contributor);
  protected readonly reacknowledge = this.copy.reacknowledge(this.contributor);

  protected readonly removalForm = new FormGroup({
    alsoRemove: new FormControl<boolean>(true, { nonNullable: true }),
  });

  protected readonly matchingEntries = computed(() => (this.data?.matchingEntries ? this.data.matchingEntries() : null));
  protected readonly canRemoveEntries = computed(() => this.data?.canRemoveEntries?.() ?? false);
  protected readonly matchRows = computed(() =>
    (this.matchingEntries() ?? []).map((entry) => ({ ...entry, criteriaLabel: orgClaApprovalCriteriaLabel(entry.kind) }))
  );
  protected readonly matchedBy = computed(() => this.copy.matchedBy(this.matchRows().length));
  protected readonly alsoRemoveLabel = computed(() => this.copy.alsoRemove(this.contributor, this.matchRows().length));
  protected readonly checking = computed(() => this.matchingEntries() === undefined);
  // The "remove the matching criteria below" clause points at the removal control, which only
  // renders when there are individual matches and the reader may edit the list. Otherwise the
  // sentence just ends, so the confirmation never promises a step that isn't there.
  protected readonly reacknowledgeSuffix = computed(() => (this.matchRows().length > 0 && this.canRemoveEntries() ? this.copy.removeCriteria : '.'));

  protected onConfirm(): void {
    if (this.checking()) return;
    const entries = this.canRemoveEntries() && this.removalForm.controls.alsoRemove.value ? (this.matchingEntries() ?? []) : [];
    // Deduplicate exact kind+value pairs before sending. An approval list can hold duplicate rows,
    // but the producer collapses duplicates on removal — one value is enough — and the BFF caps a
    // single write at ORG_CLA_APPROVAL_UPDATE_MAX_ENTRIES, so forwarding duplicates only risks
    // tripping that cap after the invalidate has already succeeded. Case variants are distinct
    // values and are kept; the displayed match list is untouched.
    const seen = new Set<string>();
    const removeApprovalEntries = entries
      .map(({ kind, value }) => ({ kind, value }))
      .filter((entry) => {
        const key = `${entry.kind}:${entry.value}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const result: OrgClaInvalidateAcknowledgmentDialogResult = removeApprovalEntries.length > 0 ? { removeApprovalEntries } : {};
    this.dialogRef.close(result);
  }

  protected onCancel(): void {
    this.dialogRef.close(null);
  }
}
