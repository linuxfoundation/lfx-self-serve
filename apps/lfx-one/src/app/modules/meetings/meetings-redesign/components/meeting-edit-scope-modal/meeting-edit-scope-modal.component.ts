// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { MeetingEditScopeDialogData, MeetingOccurrenceOption, RecurringMeetingEditScopeResult } from '@lfx-one/shared/interfaces';
import { buildMeetingOccurrenceOptions, isSameOccurrenceId } from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiRadioGroupComponent } from '@shared/uikit/radio/radio-group.component';
import { UiRadioComponent } from '@shared/uikit/radio/radio.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';

import { MeetingDialogContextComponent } from '../meeting-dialog-context/meeting-dialog-context.component';

/**
 * Asks whether an edit of a recurring meeting applies to one date, and which, or to the whole series; closes with the choice, or nothing on Cancel.
 * @description Opens on the date it was given; the picker lists every date that has not ended, as on the legacy edit scope dialog.
 */
@Component({
  selector: 'lfx-meeting-edit-scope-modal',
  imports: [MeetingDialogContextComponent, UiButtonComponent, UiModalComponent, UiOptionComponent, UiRadioGroupComponent, UiRadioComponent, UiSelectComponent],
  templateUrl: './meeting-edit-scope-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingEditScopeModalComponent {
  private readonly dialogRef = inject<DialogRef<RecurringMeetingEditScopeResult>>(DialogRef);
  private readonly data = inject<MeetingEditScopeDialogData>(DIALOG_DATA);

  protected readonly row = this.data.row;
  protected readonly origin = this.data.origin ?? 'page';
  protected readonly occurrenceOptions: MeetingOccurrenceOption[] = buildMeetingOccurrenceOptions(this.data.meeting, this.data.occurrence.occurrence_id);
  // The options always list the opening date: it is active and passed as the date to keep.
  protected readonly occurrenceId = signal<string | null>(
    this.occurrenceOptions.find((option) => isSameOccurrenceId(option.value, this.data.occurrence.occurrence_id))?.value ?? null
  );
  protected readonly scope = signal<string | null>('occurrence');
  protected readonly canContinue: Signal<boolean> = computed(() => this.scope() === 'series' || !!this.occurrenceId());

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected confirm(): void {
    if (!this.canContinue()) return;
    const occurrenceId = this.occurrenceId();
    this.dialogRef.close(
      this.scope() === 'occurrence' && occurrenceId ? { scope: 'occurrence', proceed: true, occurrenceId } : { scope: 'series', proceed: true }
    );
  }
}
