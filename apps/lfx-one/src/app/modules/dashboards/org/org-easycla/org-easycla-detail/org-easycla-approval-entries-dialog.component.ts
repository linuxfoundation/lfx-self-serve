// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ORG_CLA_APPROVAL_CRITERIA, ORG_CLA_APPROVAL_UPDATE_MAX_ENTRIES } from '@lfx-one/shared/constants';
import type { OrgClaApprovalCriteriaKind, OrgClaApprovalEntriesDialogData, OrgClaApprovalListUpdate } from '@lfx-one/shared/interfaces';
import { orgClaApprovalCriteriaLabel, orgClaApprovalCriteriaOption, validateOrgClaApprovalValue } from '@lfx-one/shared/utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import { SelectComponent } from '@components/select/select.component';

/**
 * Add or edit approval-list entries (#1985).
 *
 * Closes with an `OrgClaApprovalListUpdate` — the delta to send — or `undefined` on cancel. The
 * dialog does not call the API itself: the tab owns the request, its in-flight state and its
 * error handling, so a failed write leaves one component to recover rather than two.
 *
 * Editing produces a `remove` of the old entry alongside the `add` of the new one, because that
 * is the only write the producer offers. The removal half invalidates every acknowledgement that
 * matched the old value, which is why edit carries the same warning delete does — and why the
 * design's own copy for this dialog ("existing contributors keep their coverage") is not used.
 */
@Component({
  selector: 'lfx-org-easycla-approval-entries-dialog',
  imports: [ButtonComponent, InputTextComponent, MessageComponent, SelectComponent],
  templateUrl: './org-easycla-approval-entries-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaApprovalEntriesDialogComponent {
  private readonly dialogConfig = inject<DynamicDialogConfig<OrgClaApprovalEntriesDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly criteriaOptions = ORG_CLA_APPROVAL_CRITERIA.map((option) => ({ label: option.label, value: option.kind }));
  protected readonly maxEntries = ORG_CLA_APPROVAL_UPDATE_MAX_ENTRIES;

  protected readonly isEdit = this.dialogConfig.data?.mode === 'edit';

  private readonly editing = this.dialogConfig.data?.entry;
  private readonly existing = this.dialogConfig.data?.existing ?? [];

  protected readonly form: FormGroup = this.formBuilder.group({
    rows: this.formBuilder.array([this.buildRow(this.editing?.kind, this.editing?.value)]),
  });

  /**
   * Re-read on every submit rather than tracked reactively.
   *
   * The row controls are a `FormArray` whose values change on keystroke, and the messages below
   * are validation output — showing them while someone is still typing the first character of an
   * address reports an error against text they have not finished writing. So they appear on
   * submit and clear on the next one.
   */
  protected readonly errors = signal<Record<number, string>>({});

  protected readonly hint = computed(() =>
    this.isEdit
      ? 'Update this entry. Contributors matching the previous value lose coverage under this CLA, and any acknowledgements they hold for it are invalidated.'
      : 'Add one or more entries. A contributor matching any entry can be covered by this CLA.'
  );

  protected get rows(): FormArray {
    return this.form.get('rows') as FormArray;
  }

  protected rowGroup(index: number): FormGroup {
    return this.rows.at(index) as FormGroup;
  }

  /** Placeholder follows the row's own criteria type, so the expected shape is visible up front. */
  protected placeholderFor(index: number): string {
    const kind = this.rowGroup(index).get('kind')?.value as OrgClaApprovalCriteriaKind | null;
    return kind ? orgClaApprovalCriteriaOption(kind).placeholder : '';
  }

  protected addRow(): void {
    if (this.rows.length >= this.maxEntries) return;
    // Seeded from the row above, because someone adding several entries is usually adding several
    // of the same kind — re-picking "GitHub username" five times is friction with no purpose.
    const previous = this.rowGroup(this.rows.length - 1).get('kind')?.value as OrgClaApprovalCriteriaKind | undefined;
    this.rows.push(this.buildRow(previous));
  }

  protected removeRow(index: number): void {
    // Never below one row: an empty dialog offers nothing to submit and no way back to a row.
    if (this.rows.length <= 1) return;
    this.rows.removeAt(index);
    this.errors.set({});
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected submit(): void {
    const problems: Record<number, string> = {};
    const add: { kind: OrgClaApprovalCriteriaKind; value: string }[] = [];
    const seen = new Set<string>();

    this.rows.controls.forEach((control, index) => {
      const kind = control.get('kind')?.value as OrgClaApprovalCriteriaKind | null;
      const value = String(control.get('value')?.value ?? '').trim();

      if (!kind) {
        problems[index] = 'Choose a criteria type.';
        return;
      }

      const problem = validateOrgClaApprovalValue(kind, value);
      if (problem) {
        problems[index] = problem;
        return;
      }

      // Within the dialog first, so two identical rows are named rather than silently collapsed
      // into one by the server's own de-duplication.
      const key = `${kind}:${value.toLowerCase()}`;
      if (seen.has(key)) {
        problems[index] = 'This entry is already in this list of changes.';
        return;
      }

      // Then against the list as it stands. The producer answers 200 for a rule it already holds,
      // so without this the dialog would close on a receipt for a change that did not happen.
      // Skipped when the value is unchanged in edit mode: reworking only an entry's criteria type
      // is a legitimate change, and the entry being edited is by definition already on the list.
      const unchangedInEdit = this.isEdit && this.editing?.kind === kind && this.editing?.value === value;
      if (!unchangedInEdit && this.existing.some((entry) => entry.kind === kind && entry.value.toLowerCase() === value.toLowerCase())) {
        problems[index] = `${orgClaApprovalCriteriaLabel(kind)} "${value}" is already on the approval list.`;
        return;
      }

      seen.add(key);
      add.push({ kind, value });
    });

    this.errors.set(problems);
    if (Object.keys(problems).length > 0) return;

    if (this.isEdit && this.editing) {
      const next = add[0];
      // An edit that changed nothing is not sent. The producer would take the removal and the
      // addition of the same value and process the invalidation half regardless — revoking
      // acknowledgements to arrive back where it started.
      if (next.kind === this.editing.kind && next.value === this.editing.value) {
        this.dialogRef.close();
        return;
      }

      this.dialogRef.close({ add, remove: [{ kind: this.editing.kind, value: this.editing.value }] } satisfies OrgClaApprovalListUpdate);
      return;
    }

    this.dialogRef.close({ add, remove: [] } satisfies OrgClaApprovalListUpdate);
  }

  private buildRow(kind?: OrgClaApprovalCriteriaKind, value?: string): FormGroup {
    return this.formBuilder.group({
      // Defaults to the design's own first option, email domain — the entry that covers a whole
      // workforce with one rule, and so the one a CLA manager reaches for first.
      kind: [kind ?? ORG_CLA_APPROVAL_CRITERIA[0].kind, Validators.required],
      value: [value ?? ''],
    });
  }
}
