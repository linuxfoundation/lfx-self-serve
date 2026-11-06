// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, output, Signal } from '@angular/core';
import { MEETING_ATTENDEE_STATUS_INFO } from '@lfx-one/shared/constants';
import {
  MeetingAttendeeGrid,
  MeetingAttendeeGridOverflow,
  MeetingAttendeeGridPerson,
  MeetingRegistrant,
  PastMeetingParticipant,
  UiButtonSize,
  UiButtonVariant,
} from '@lfx-one/shared/interfaces';
import { buildMeetingAttendeeGrid, getMeetingAttendeeGridOverflow } from '@lfx-one/shared/utils';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

/**
 * A meeting's invitees as avatars with a status dot, ordered by RSVP answer or attendance, capped at two rows.
 * @description The row popup shows the stats line and 9 fixed 28px columns; the drawer card hides the stats and uses 8 fluid columns.
 * With more people than two rows hold, the second row fades and "View all N" emits `viewAll`.
 */
@Component({
  selector: 'lfx-meeting-attendee-grid',
  imports: [UiAvatarComponent, UiButtonComponent, UiTooltipDirective],
  templateUrl: './meeting-attendee-grid.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class MeetingAttendeeGridComponent {
  /** Registrants of an upcoming date, or participants of a past meeting. */
  public readonly people = input.required<readonly (MeetingRegistrant | PastMeetingParticipant)[]>();
  /** Reads attendance instead of RSVP answers. */
  public readonly past = input<boolean, unknown>(false, { transform: booleanAttribute });
  public readonly columns = input<number>(9);
  /** Columns share the width, each avatar up to 28px; otherwise every column is 28px. */
  public readonly fluid = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** The stats line and separator above the grid. */
  public readonly showStats = input<boolean, unknown>(true, { transform: booleanAttribute });
  public readonly showViewAll = input<boolean, unknown>(true, { transform: booleanAttribute });
  public readonly viewAllVariant = input<UiButtonVariant>('secondary');
  public readonly viewAllSize = input<UiButtonSize>('small');

  public readonly viewAll = output<void>();

  protected readonly statusInfo = MEETING_ATTENDEE_STATUS_INFO;
  // A whole count of at least 1, so the CSS grid and the overflow math agree.
  protected readonly columnCount: Signal<number> = computed(() => Math.max(1, Math.floor(this.columns())));
  protected readonly grid: Signal<MeetingAttendeeGrid> = computed(() => buildMeetingAttendeeGrid(this.people(), this.past()));
  protected readonly overflow: Signal<MeetingAttendeeGridOverflow> = computed(() =>
    getMeetingAttendeeGridOverflow(this.grid().people.length, this.columnCount())
  );
  protected readonly visiblePeople: Signal<MeetingAttendeeGridPerson[]> = computed(() => this.grid().people.slice(0, this.overflow().visible));
  protected readonly templateColumns: Signal<string> = computed(() => `repeat(${this.columnCount()}, ${this.fluid() ? 'minmax(0, 1fr)' : '28px'})`);
}
