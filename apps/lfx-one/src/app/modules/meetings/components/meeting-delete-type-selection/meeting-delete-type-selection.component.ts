// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { SelectComponent } from '@components/select/select.component';
import { MEETING_V2_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { Meeting, MeetingDeleteType, MeetingDeleteTypeResult, MeetingOccurrence, MeetingOccurrenceOption } from '@lfx-one/shared/interfaces';
import { buildMeetingOccurrenceOptions } from '@lfx-one/shared/utils';
import { FeatureFlagService } from '@services/feature-flag.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Asks whether a delete of a recurring meeting cancels one occurrence or removes the series — and, for
 * one occurrence, which.
 * @description Laid out like the edit scope dialog. Opens on cancelling a single occurrence, preselected
 * to the one the organizer clicked from (`data.occurrence`); the picker lists every occurrence that has
 * not ended. All of that is meeting v2 only (`MEETING_V2_ENABLED_FLAG`): flag off keeps the pre-v2 card
 * layout, with nothing preselected and no picker.
 */
@Component({
  selector: 'lfx-meeting-delete-type-selection',
  imports: [NgClass, ReactiveFormsModule, ButtonComponent, RadioButtonComponent, SelectComponent],
  templateUrl: './meeting-delete-type-selection.component.html',
})
export class MeetingDeleteTypeSelectionComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig);

  protected readonly meetingsV2Enabled: Signal<boolean> = inject(FeatureFlagService).getBooleanFlag(MEETING_V2_ENABLED_FLAG, false);

  public readonly meeting: Meeting = this.dialogConfig.data.meeting;
  public readonly occurrence: MeetingOccurrence | null = this.dialogConfig.data.occurrence ?? null;
  public readonly occurrenceOptions: MeetingOccurrenceOption[] = buildMeetingOccurrenceOptions(this.meeting, this.occurrence?.occurrence_id);
  public readonly deleteForm: FormGroup = this.initializeDeleteForm();

  private readonly formValue = toSignal(this.deleteForm.valueChanges, { initialValue: this.deleteForm.getRawValue() });
  protected readonly selectedType: Signal<MeetingDeleteType | null> = computed(() => this.formValue().deleteType);
  protected readonly isOccurrenceType: Signal<boolean> = computed(() => this.selectedType() === 'occurrence');
  protected readonly canContinue: Signal<boolean> = computed(() => {
    const type = this.selectedType();
    // Flag off has no picker: the caller cancels the occurrence it opened the dialog on.
    if (!this.meetingsV2Enabled()) {
      return type !== null;
    }
    return type === 'series' || (type === 'occurrence' && !!this.formValue().occurrenceId);
  });

  /** Pre-v2 card layout: a card click picks the type. */
  public selectType(type: MeetingDeleteType): void {
    this.deleteForm.get('deleteType')?.setValue(type);
  }

  public onCancel(): void {
    this.dialogRef.close();
  }

  public onContinue(): void {
    if (!this.canContinue()) {
      return;
    }

    const { deleteType, occurrenceId } = this.deleteForm.getRawValue();
    const pickedId = this.meetingsV2Enabled() ? occurrenceId : null;
    let result: MeetingDeleteTypeResult = { deleteType: 'series' };
    if (deleteType === 'occurrence') {
      result = pickedId ? { deleteType, occurrenceId: pickedId } : { deleteType };
    }
    this.dialogRef.close(result);
  }

  private initializeDeleteForm(): FormGroup {
    // Only preselect an occurrence the picker actually lists, so the select never shows a value it has no row for.
    const preselected =
      this.occurrenceOptions.find((option) => option.value === this.occurrence?.occurrence_id)?.value ?? this.occurrenceOptions[0]?.value ?? null;
    // No occurrence left to cancel on its own — deleting the series is the only option that can proceed.
    const v2InitialType: MeetingDeleteType = preselected ? 'occurrence' : 'series';
    // Pre-v2 opens with nothing selected, so the organizer has to choose before Continue enables.
    const initialType: MeetingDeleteType | null = this.meetingsV2Enabled() ? v2InitialType : null;

    return new FormGroup({
      deleteType: new FormControl<MeetingDeleteType | null>(initialType),
      occurrenceId: new FormControl<string | null>(preselected),
    });
  }
}
