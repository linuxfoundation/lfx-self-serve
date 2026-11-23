// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { SelectComponent } from '@components/select/select.component';
import { Meeting, MeetingOccurrence, MeetingOccurrenceOption, RecurringMeetingEditScope, RecurringMeetingEditScopeResult } from '@lfx-one/shared/interfaces';
import { buildMeetingOccurrenceOptions, isSameOccurrenceId } from '@lfx-one/shared/utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Asks whether an edit of a recurring meeting applies to the whole series or to one occurrence — and,
 * for one occurrence, which.
 * @description Opens preselected on the occurrence the organizer clicked from (`data.occurrence`); the
 * picker lists every occurrence that has not ended, so another one can be chosen without leaving the dialog.
 */
@Component({
  selector: 'lfx-recurring-meeting-edit-options',
  imports: [ReactiveFormsModule, ButtonComponent, RadioButtonComponent, SelectComponent],
  templateUrl: './recurring-meeting-edit-options.component.html',
})
export class RecurringMeetingEditOptionsComponent {
  private readonly dialogConfig = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  public readonly meeting: Meeting = this.dialogConfig.data?.meeting;
  public readonly occurrence: MeetingOccurrence | null = this.dialogConfig.data?.occurrence ?? null;
  public readonly occurrenceOptions: MeetingOccurrenceOption[] = buildMeetingOccurrenceOptions(this.meeting, this.occurrence?.occurrence_id);
  public readonly editForm: FormGroup = this.initializeEditForm();

  private readonly formValue = toSignal(this.editForm.valueChanges, { initialValue: this.editForm.getRawValue() });
  protected readonly isOccurrenceScope: Signal<boolean> = computed(() => this.formValue().scope === 'occurrence');
  protected readonly canContinue: Signal<boolean> = computed(() => !this.isOccurrenceScope() || !!this.formValue().occurrenceId);

  public onConfirm(): void {
    if (!this.canContinue()) {
      return;
    }

    const { scope, occurrenceId } = this.editForm.getRawValue();
    const result: RecurringMeetingEditScopeResult = scope === 'occurrence' ? { scope, proceed: true, occurrenceId } : { scope: 'series', proceed: true };
    this.dialogRef.close(result);
  }

  public onCancel(): void {
    const result: RecurringMeetingEditScopeResult = {
      scope: 'occurrence',
      proceed: false,
    };
    this.dialogRef.close(result);
  }

  private initializeEditForm(): FormGroup {
    // Only preselect an occurrence the picker actually lists, so the select never shows a value it has no row for.
    const preselected =
      this.occurrenceOptions.find((option) => isSameOccurrenceId(option.value, this.occurrence?.occurrence_id))?.value ??
      this.occurrenceOptions[0]?.value ??
      null;
    // No occurrence left to edit on its own — the series is the only scope that can proceed.
    const initialScope: RecurringMeetingEditScope = preselected ? 'occurrence' : 'series';

    return new FormGroup({
      scope: new FormControl<RecurringMeetingEditScope>(initialScope, { nonNullable: true }),
      occurrenceId: new FormControl<string | null>(preselected),
    });
  }
}
