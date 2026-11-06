// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { MeetingDialogOrigin, MeetingHomeRow, MeetingHomeRowProject } from '@lfx-one/shared/interfaces';
import { formatMeetingWhenFull, getMeetingHomeRowProject } from '@lfx-one/shared/utils';

import { MeetingProjectLogoComponent } from '../meeting-project-logo/meeting-project-logo.component';

/**
 * Meeting context under a meetings dialog header: foundation, title and full date line between two full-bleed rules.
 * @description From the details drawer, which already shows the meeting, only a single full-bleed divider remains.
 */
@Component({
  selector: 'lfx-meeting-dialog-context',
  imports: [MeetingProjectLogoComponent],
  templateUrl: './meeting-dialog-context.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // -24px meets the modal's side padding.
  host: { class: 'block -mx-[24px]' },
})
export class MeetingDialogContextComponent {
  public readonly row = input.required<MeetingHomeRow>();
  public readonly origin = input<MeetingDialogOrigin>('page');

  protected readonly project: Signal<MeetingHomeRowProject | null> = computed(() => getMeetingHomeRowProject(this.row().meeting));
  protected readonly when: Signal<string> = computed(() => formatMeetingWhenFull(this.row()));
}
