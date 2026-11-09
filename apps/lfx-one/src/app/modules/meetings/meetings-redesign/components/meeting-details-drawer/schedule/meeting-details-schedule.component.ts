// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { environment } from '@environments/environment';
import { DEFAULT_EARLY_JOIN_TIME } from '@lfx-one/shared/constants';
import { MeetingVisibility } from '@lfx-one/shared/enums';
import { MeetingHomeRow, MeetingJoinLink, MeetingRegisterDialogData, PublicMeetingRegistrationResponse } from '@lfx-one/shared/interfaces';
import {
  formatMeetingDetailsDate,
  formatMeetingDetailsTime,
  getMeetingDetailsRecurrence,
  getMeetingSeriesUid,
  getMeetingShareUrl,
} from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { take } from 'rxjs';

import { MeetingsHomeJoinService } from '../../../services/meetings-home-join.service';
import { MeetingsHomeStore } from '../../../services/meetings-home.store';
import { MeetingDateTileComponent } from '../../meeting-date-tile/meeting-date-tile.component';
import { MeetingRsvpControlsComponent } from '../../meeting-rsvp-controls/meeting-rsvp-controls.component';
import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsOccurrenceNavComponent } from '../occurrence-nav/meeting-details-occurrence-nav.component';
import { MeetingDetailsRegisterModalComponent } from '../register/meeting-details-register-modal.component';

/**
 * Schedule card of the meeting details drawer: the occurrence navigator, the shown date, the viewer's RSVP, Join and Register.
 * @description Join opens the meeting's early-join time (default `DEFAULT_EARLY_JOIN_TIME`) before the start and stays open until 40 minutes after the end.
 * RSVP and Register show before that window only, as on the meeting page.
 */
@Component({
  selector: 'lfx-meeting-details-schedule',
  imports: [
    MeetingDateTileComponent,
    MeetingDetailsOccurrenceNavComponent,
    MeetingRsvpControlsComponent,
    UiButtonComponent,
    UiNoteComponent,
    UiTooltipDirective,
  ],
  templateUrl: './meeting-details-schedule.component.html',
  styleUrl: './meeting-details-schedule.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-[12px]', 'data-testid': 'meeting-details-schedule-section' },
})
export class MeetingDetailsScheduleComponent {
  private readonly userService = inject(UserService);
  private readonly joinService = inject(MeetingsHomeJoinService);
  private readonly store = inject(MeetingsHomeStore);
  private readonly modal = inject(UiModalService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly context = inject(MeetingDetailsContext);

  /** Registrant id of a registration made here, until the list shows it. */
  private readonly registrantId = signal<string | null>(null);

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
  protected readonly canRegister: Signal<boolean> = this.initCanRegister();

  protected register(): void {
    const meeting = this.context.meeting();
    const data: MeetingRegisterDialogData = { meetingId: getMeetingSeriesUid(meeting), meetingTitle: this.row().title, user: this.userService.user() };
    // Not dismissible mid-request, so a registration that succeeds always reaches the drawer.
    const ref = this.modal.open<PublicMeetingRegistrationResponse, MeetingRegisterDialogData, MeetingDetailsRegisterModalComponent>(
      MeetingDetailsRegisterModalComponent,
      { data },
      { closePredicate: (_result, _config, dialog) => !(dialog instanceof MeetingDetailsRegisterModalComponent && dialog.submitting()) }
    );
    const stopClosingOnDestroy = this.destroyRef.onDestroy(() => ref.close());
    ref.closed.pipe(take(1)).subscribe((registrant) => {
      stopClosingOnDestroy();
      if (!registrant) return;
      this.registrantId.set(registrant.uid ?? '');
      this.context.markRegistered();
    });
  }

  /**
   * The list's row for the shown date, which carries the viewer's answer and the ones saved since; the drawer's own copy otherwise.
   * @description A registration made here counts as an invitation with no answer yet, so the RSVP buttons show at once.
   */
  private initRsvpRow(): Signal<MeetingHomeRow> {
    return computed(() => {
      const shown = this.row();
      const row = this.store.upcomingRows().find((candidate) => candidate.key === shown.key) ?? shown;
      const registrantId = this.registrantId();
      if (registrantId === null || row.meeting.invited) return row;
      const meeting = { ...row.meeting, invited: true, my_registrant_ids: registrantId ? [registrantId] : undefined };
      return { ...row, meeting, myRsvp: row.myRsvp ?? null };
    });
  }

  /** A public, unrestricted meeting the viewer neither organizes nor is invited to, before its join window. */
  private initCanRegister(): Signal<boolean> {
    return computed(() => {
      const meeting = this.context.meeting();
      return (
        this.userService.authenticated() &&
        this.context.state() === 'far' &&
        !this.context.organizer() &&
        !this.context.invited() &&
        !meeting.restricted &&
        meeting.visibility === MeetingVisibility.PUBLIC
      );
    });
  }
}
