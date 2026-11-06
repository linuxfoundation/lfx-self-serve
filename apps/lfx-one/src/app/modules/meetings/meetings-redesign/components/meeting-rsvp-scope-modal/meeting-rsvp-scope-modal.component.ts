// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MEETINGS_HOME_RSVP_CHOICES } from '@lfx-one/shared/constants';
import { MeetingRsvpScopeDialogData, MeetingRsvpScopeOption, RsvpScope } from '@lfx-one/shared/interfaces';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiRadioGroupComponent } from '@shared/uikit/radio/radio-group.component';
import { UiRadioComponent } from '@shared/uikit/radio/radio.component';

import { MeetingDialogContextComponent } from '../meeting-dialog-context/meeting-dialog-context.component';

/**
 * Asks which dates of a recurring meeting an RSVP applies to; closes with the chosen scope, or nothing on Cancel.
 * @description Without a resolved date only "All occurrences" is offered, as on the legacy meeting card.
 */
@Component({
  selector: 'lfx-meeting-rsvp-scope-modal',
  imports: [MeetingDialogContextComponent, UiButtonComponent, UiModalComponent, UiRadioGroupComponent, UiRadioComponent],
  templateUrl: './meeting-rsvp-scope-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingRsvpScopeModalComponent {
  private readonly dialogRef = inject<DialogRef<RsvpScope>>(DialogRef);
  private readonly data = inject<MeetingRsvpScopeDialogData>(DIALOG_DATA);

  protected readonly row = this.data.row;
  protected readonly origin = this.data.origin ?? 'page';
  protected readonly responseLabel = MEETINGS_HOME_RSVP_CHOICES.find((choice) => choice.response === this.data.response)?.label ?? '';
  protected readonly canSelectOccurrence = !!this.row.occurrenceId;
  protected readonly options: MeetingRsvpScopeOption[] = this.initOptions();
  protected readonly scope = signal<string | null>(this.canSelectOccurrence ? 'single' : 'all');

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected confirm(): void {
    const scope = this.options.find((option) => option.value === this.scope())?.value;
    if (scope) this.dialogRef.close(scope);
  }

  private initOptions(): MeetingRsvpScopeOption[] {
    const all: MeetingRsvpScopeOption = { value: 'all', label: 'All occurrences' };
    if (!this.canSelectOccurrence) return [all];
    return [{ value: 'single', label: 'This occurrence' }, { value: 'this_and_following', label: 'This and following occurrences' }, all];
  }
}
