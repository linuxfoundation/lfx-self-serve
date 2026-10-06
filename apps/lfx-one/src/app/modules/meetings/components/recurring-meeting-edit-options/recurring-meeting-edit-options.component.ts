// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { SelectComponent } from '@components/select/select.component';
import { MEETING_V2_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { Meeting, MeetingOccurrence, MeetingOccurrenceOption, RecurringMeetingEditScope, RecurringMeetingEditScopeResult } from '@lfx-one/shared/interfaces';
import { buildMeetingOccurrenceOptions, isSameOccurrenceId } from '@lfx-one/shared/utils';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { FeatureFlagService } from '@services/feature-flag.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Asks whether an edit of a recurring meeting applies to the whole series or to one occurrence — and,
 * for one occurrence, which.
 * @description Opens preselected on the occurrence the organizer clicked from (`data.occurrence`); the
 * picker lists every occurrence that has not ended, so another one can be chosen without leaving the dialog.
 * The picker is meeting v2 only (`MEETING_V2_ENABLED_FLAG`); flag off keeps the pre-v2 dialog, which edits
 * the occurrence it was opened on.
 */
@Component({
  selector: 'lfx-recurring-meeting-edit-options',
  imports: [ReactiveFormsModule, ButtonComponent, RadioButtonComponent, SelectComponent, MeetingTimePipe],
  templateUrl: './recurring-meeting-edit-options.component.html',
})
export class RecurringMeetingEditOptionsComponent {
  private readonly dialogConfig = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  protected readonly meetingsV2Enabled: Signal<boolean> = inject(FeatureFlagService).getBooleanFlag(MEETING_V2_ENABLED_FLAG, false);

  public readonly meeting: Meeting = this.dialogConfig.data?.meeting;
  public readonly occurrence: MeetingOccurrence | null = this.dialogConfig.data?.occurrence ?? null;
  public readonly occurrenceOptions: MeetingOccurrenceOption[] = buildMeetingOccurrenceOptions(this.meeting, this.occurrence?.occurrence_id);
  public readonly editForm: FormGroup = this.initializeEditForm();

  private readonly formValue = toSignal(this.editForm.valueChanges, { initialValue: this.editForm.getRawValue() });
  protected readonly isOccurrenceScope: Signal<boolean> = computed(() => this.formValue().scope === 'occurrence');
  // Flag off has no picker, so nothing there can leave the occurrence unpicked — the caller edits the one it passed in.
  protected readonly canContinue: Signal<boolean> = computed(() => !this.meetingsV2Enabled() || !this.isOccurrenceScope() || !!this.formValue().occurrenceId);

  public onConfirm(): void {
    if (!this.canContinue()) {
      return;
    }

    const { scope } = this.editForm.getRawValue();
    // Flag off has no picker: always the occurrence the dialog was opened on, never a picker fallback.
    const occurrenceId = this.meetingsV2Enabled() ? this.editForm.getRawValue().occurrenceId : this.occurrence?.occurrence_id;
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
    // Pre-v2 always opens on the occurrence it was given, exactly as before the picker existed.
    if (!this.meetingsV2Enabled()) {
      return new FormGroup({
        scope: new FormControl<RecurringMeetingEditScope>('occurrence', { nonNullable: true }),
        occurrenceId: new FormControl<string | null>(this.occurrence?.occurrence_id ?? null),
      });
    }

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
