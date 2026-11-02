// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { formatDate } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DEFAULT_MEETING_TYPE_CONFIG, MEETING_TYPE_CONFIGS, MEETINGS_HOME_RSVP_CHOICES } from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import { MeetingHomeRowType, MeetingRsvpScopeDialogData, MeetingRsvpScopeOption, RsvpScope } from '@lfx-one/shared/interfaces';
import { formatMeetingTimeRange } from '@lfx-one/shared/utils';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiRadioGroupComponent } from '@shared/uikit/radio/radio-group.component';
import { UiRadioComponent } from '@shared/uikit/radio/radio.component';

/**
 * Asks which dates of a recurring meeting an RSVP applies to; closes with the chosen scope, or nothing on Cancel.
 * @description Without a resolved date only "All occurrences" is offered, as on the legacy meeting card.
 */
@Component({
  selector: 'lfx-meeting-rsvp-scope-modal',
  imports: [UiAvatarComponent, UiButtonComponent, UiModalComponent, UiRadioGroupComponent, UiRadioComponent],
  templateUrl: './meeting-rsvp-scope-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingRsvpScopeModalComponent {
  private readonly dialogRef = inject<DialogRef<RsvpScope>>(DialogRef);
  private readonly data = inject<MeetingRsvpScopeDialogData>(DIALOG_DATA);

  protected readonly row = this.data.row;
  protected readonly projectName = this.row.meeting.project_name?.trim() ?? '';
  protected readonly when = `${formatDate(this.row.startTime, 'EEE, MMM d', 'en-US')} · ${formatMeetingTimeRange(this.row.startTime, this.row.durationMinutes)}`;
  protected readonly meetingType: MeetingHomeRowType | null = this.initMeetingType();
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

  private initMeetingType(): MeetingHomeRowType | null {
    const type = this.row.meeting.meeting_type?.trim();
    if (!type || type === MeetingType.NONE) return null;
    const config = MEETING_TYPE_CONFIGS[type.toLowerCase()];
    return { label: config?.label ?? type, icon: (config ?? DEFAULT_MEETING_TYPE_CONFIG).icon };
  }

  private initOptions(): MeetingRsvpScopeOption[] {
    const all: MeetingRsvpScopeOption = { value: 'all', label: 'All occurrences', description: 'Every upcoming occurrence in this series.' };
    if (!this.canSelectOccurrence) return [all];
    const date = formatDate(this.row.startTime, 'MMM d', 'en-US');
    return [
      { value: 'single', label: 'This occurrence', description: this.when },
      { value: 'this_and_following', label: 'This and following occurrences', description: `${date} and every occurrence after it.` },
      all,
    ];
  }
}
