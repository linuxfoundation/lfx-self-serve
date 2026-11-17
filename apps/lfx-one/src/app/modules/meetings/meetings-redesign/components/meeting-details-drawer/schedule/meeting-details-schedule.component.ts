// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
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
import { UiDrawerContext } from '@shared/uikit/drawer/drawer.context';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { filter, take } from 'rxjs';

import { MeetingsHomeJoinService } from '../../../services/meetings-home-join.service';
import { MeetingDateTileComponent } from '../../meeting-date-tile/meeting-date-tile.component';
import { MeetingRsvpControlsComponent } from '../../meeting-rsvp-controls/meeting-rsvp-controls.component';
import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsSource } from '../meeting-details.source';
import { MeetingDetailsRegisterModalComponent } from '../register/meeting-details-register-modal.component';
import { MeetingDetailsGuestJoinComponent } from './guest-join/meeting-details-guest-join.component';

/**
 * Top of the meeting details drawer's card: the shown date, the viewer's RSVP, Join and Register.
 * @description Join opens the meeting's early-join time (default `DEFAULT_EARLY_JOIN_TIME`) before the start and stays open until 40 minutes after the end.
 * RSVP and Register show before that window only, as on the meeting page. A page whose join window was open when it
 * loaded opens Zoom once by itself, as the legacy meeting page does. A signed-out visitor gets Sign In and the guest form,
 * which a page also offers in place to a signed-in viewer whose email is not registered.
 */
@Component({
  selector: 'lfx-meeting-details-schedule',
  imports: [
    MeetingDateTileComponent,
    MeetingDetailsGuestJoinComponent,
    MeetingRsvpControlsComponent,
    NgTemplateOutlet,
    UiButtonComponent,
    UiNoteComponent,
    UiTooltipDirective,
  ],
  templateUrl: './meeting-details-schedule.component.html',
  styleUrl: './meeting-details-schedule.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-[16px]', 'data-testid': 'meeting-details-schedule-section' },
})
export class MeetingDetailsScheduleComponent {
  private readonly userService = inject(UserService);
  private readonly joinService = inject(MeetingsHomeJoinService);
  private readonly source = inject(MeetingDetailsSource);
  private readonly modal = inject(UiModalService);
  private readonly toast = inject(UiToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly drawer = inject(UiDrawerContext, { optional: true });
  protected readonly context = inject(MeetingDetailsContext);

  /** Registrant id of a registration made here, until the list shows it. */
  private readonly registrantId = signal<string | null>(null);
  /** The guest form a signed-in viewer opened with "Click here". */
  protected readonly guestFormOpen = signal(false);

  protected readonly row: Signal<MeetingHomeRow> = this.context.shownRow;
  protected readonly longDate: Signal<string> = computed(() => formatMeetingDetailsDate(this.row().startTime));
  protected readonly time: Signal<string> = computed(() => formatMeetingDetailsTime(this.row().startTime, this.row().durationMinutes));
  protected readonly recurrence: Signal<string | null> = computed(() => getMeetingDetailsRecurrence(this.context.meeting(), this.row().occurrence));
  protected readonly earlyJoinMinutes: Signal<number> = computed(() => this.context.meeting().early_join_time_minutes ?? DEFAULT_EARLY_JOIN_TIME);
  /** Inside the join window, signed in. */
  protected readonly canJoin: Signal<boolean> = computed(() => (this.context.state() === 'soon' || this.context.state() === 'live') && this.context.signedIn());
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
  /** A page joins with another email in place, where the drawer links to the meeting page. */
  protected readonly guestJoinInPlace = !!this.source.guestJoinInPlace && !this.drawer;
  /** The real viewer's name, never an impersonated user's (MD-091). */
  protected readonly viewerName: Signal<string> = computed(() => this.userService.meetingJoinIdentity()?.name ?? '');

  public constructor() {
    this.openJoinOnLoad();
  }

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
      const row = this.source.upcomingRows().find((candidate) => candidate.key === shown.key) ?? shown;
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

  /** Opens the join link once it loads, when the host allows it for this load; a blocked popup leaves Join to the viewer. */
  private openJoinOnLoad(): void {
    if (!this.source.claimJoinOnLoad || !isPlatformBrowser(inject(PLATFORM_ID))) return;
    toObservable(this.joinLink)
      .pipe(
        // The claim holds nothing back until the page allows it, so a link that loads first is not the only try.
        filter((link) => !!link.url && this.canJoin() && !!this.source.claimJoinOnLoad?.()),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((link) => {
        // With noopener a successful open may still return null, so only a closed window counts as blocked.
        const opened = window.open(link.url ?? '', '_blank', 'noopener,noreferrer');
        if (opened?.closed) {
          this.toast.show({
            variant: 'warning',
            position: 'bottom-center',
            message: 'Popup Blocked',
            description: 'Your browser blocked the meeting window. Please click the "Join Meeting" button to open it manually.',
            duration: 5000,
          });
          return;
        }
        this.toast.show({
          variant: 'success',
          message: 'Meeting Opened',
          description: "The meeting has been opened in a new tab. If you don't see it, check if popups are blocked.",
          duration: 3000,
        });
      });
  }
}
