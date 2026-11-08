// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { environment } from '@environments/environment';
import { DEFAULT_EARLY_JOIN_TIME } from '@lfx-one/shared/constants';
import { MeetingHomeRow, MeetingJoinLink } from '@lfx-one/shared/interfaces';
import { formatMeetingDetailsDate, formatMeetingDetailsTime, getMeetingDetailsRecurrence, getMeetingShareUrl } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

import { MeetingsHomeJoinService } from '../../../services/meetings-home-join.service';
import { MeetingsHomeStore } from '../../../services/meetings-home.store';
import { MeetingDateTileComponent } from '../../meeting-date-tile/meeting-date-tile.component';
import { MeetingRsvpControlsComponent } from '../../meeting-rsvp-controls/meeting-rsvp-controls.component';
import { MeetingDetailsContext } from '../meeting-details.context';

/**
 * Schedule card of the meeting details drawer: the shown date, the viewer's RSVP and Join.
 * @description Join opens the meeting's early-join time (default `DEFAULT_EARLY_JOIN_TIME`) before the start and stays open until 40 minutes after the end.
 * RSVP shows before that window only, as on the meeting page.
 */
@Component({
  selector: 'lfx-meeting-details-schedule',
  imports: [MeetingDateTileComponent, MeetingRsvpControlsComponent, UiButtonComponent, UiNoteComponent, UiTooltipDirective],
  templateUrl: './meeting-details-schedule.component.html',
  styleUrl: './meeting-details-schedule.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-[12px]', 'data-testid': 'meeting-details-schedule-section' },
})
export class MeetingDetailsScheduleComponent {
  private readonly userService = inject(UserService);
  private readonly joinService = inject(MeetingsHomeJoinService);
  private readonly store = inject(MeetingsHomeStore);
  protected readonly context = inject(MeetingDetailsContext);

  protected readonly row: Signal<MeetingHomeRow> = this.context.shownRow;
  protected readonly longDate: Signal<string> = computed(() => formatMeetingDetailsDate(this.row().startTime));
  protected readonly time: Signal<string> = computed(() => formatMeetingDetailsTime(this.row().startTime, this.row().durationMinutes));
  protected readonly recurrence: Signal<string | null> = computed(() => getMeetingDetailsRecurrence(this.context.meeting(), this.row().occurrence));
  protected readonly earlyJoinMinutes: Signal<number> = computed(() => this.context.meeting().early_join_time_minutes ?? DEFAULT_EARLY_JOIN_TIME);
  /** Inside the join window, signed in. */
  protected readonly canJoin: Signal<boolean> = computed(
    () => (this.context.state() === 'soon' || this.context.state() === 'live') && this.userService.authenticated()
  );
  /** The shown date with the refreshed meeting, so Join sends the current passcode. */
  private readonly joinRow: Signal<MeetingHomeRow> = computed(() => ({ ...this.row(), meeting: this.context.meeting() }));
  protected readonly joinLink: Signal<MeetingJoinLink> = this.joinService.joinLink(this.joinRow, this.canJoin);
  /** The meeting page, whose join flow takes another email address. */
  protected readonly meetingPageUrl: Signal<string | null> = computed(() => {
    const meeting = this.context.meeting();
    return getMeetingShareUrl(environment.urls.home, meeting.id, meeting.password);
  });
  protected readonly rsvpRow: Signal<MeetingHomeRow> = this.initRsvpRow();

  /**
   * The list's row for the shown date, which carries the viewer's answer and the ones saved since; the drawer's own copy otherwise.
   */
  private initRsvpRow(): Signal<MeetingHomeRow> {
    return computed(() => {
      const shown = this.row();
      return this.store.upcomingRows().find((candidate) => candidate.key === shown.key) ?? shown;
    });
  }
}
