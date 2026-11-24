// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { MeetingDeleteDialogData, MeetingDeleteTypeResult, MeetingOccurrenceOption } from '@lfx-one/shared/interfaces';
import { buildMeetingOccurrenceOptions, isSameOccurrenceId } from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiRadioGroupComponent } from '@shared/uikit/radio/radio-group.component';
import { UiRadioComponent } from '@shared/uikit/radio/radio.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';

import { MeetingDialogContextComponent } from '../meeting-dialog-context/meeting-dialog-context.component';

/**
 * Asks whether a delete of a recurring meeting cancels one date, and which, or deletes the series; closes with the choice, or nothing on Cancel.
 * @description Opens on the date it was given, as the legacy delete type dialog does; with no date left, only the series can go.
 */
@Component({
  selector: 'lfx-meeting-delete-scope-modal',
  imports: [
    MeetingDialogContextComponent,
    UiButtonComponent,
    UiModalComponent,
    UiNoteComponent,
    UiOptionComponent,
    UiRadioGroupComponent,
    UiRadioComponent,
    UiSelectComponent,
  ],
  templateUrl: './meeting-delete-scope-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingDeleteScopeModalComponent {
  private readonly dialogRef = inject<DialogRef<MeetingDeleteTypeResult>>(DialogRef);
  private readonly data = inject<MeetingDeleteDialogData>(DIALOG_DATA);

  protected readonly row = this.data.row;
  protected readonly origin = this.data.origin ?? 'page';
  protected readonly occurrenceOptions: MeetingOccurrenceOption[] = buildMeetingOccurrenceOptions(this.row.meeting, this.data.occurrence?.occurrence_id);
  protected readonly occurrenceId = signal<string | null>(
    this.occurrenceOptions.find((option) => isSameOccurrenceId(option.value, this.data.occurrence?.occurrence_id))?.value ?? null
  );
  protected readonly scope = signal<string | null>(this.occurrenceId() ? 'occurrence' : this.initialScopeWithoutDate());
  protected readonly canContinue: Signal<boolean> = computed(() => this.scope() === 'series' || !!this.occurrenceId());

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected confirm(): void {
    if (!this.canContinue()) return;
    const occurrenceId = this.occurrenceId();
    this.dialogRef.close(this.scope() === 'occurrence' && occurrenceId ? { deleteType: 'occurrence', occurrenceId } : { deleteType: 'series' });
  }

  /** With no date of its own the organizer must choose, so no other date is cancelled by default; with none left, only the series can go. */
  private initialScopeWithoutDate(): string | null {
    return this.occurrenceOptions.length ? null : 'series';
  }
}
