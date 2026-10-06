// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { environment } from '@environments/environment';
import { DEFAULT_EARLY_JOIN_TIME } from '@lfx-one/shared/constants';
import { ActionSlotKind, MeetingViewerRole } from '@lfx-one/shared/interfaces';
import { buildMeetingOrganizerMailto, formatMeetingMailtoDate, resolveMeetingOrganizer } from '@lfx-one/shared/utils';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingJoinActionComponent } from '../join-action/join-action.component';

/**
 * The V2 action slot, under the time banner in the rail card (E2-01, #1775, FR-020).
 * @description It renders exactly one `ActionSlotKind`, the state service's `actionSlot`, and
 * always carries it as `data-kind`. `none` is a decision ("nothing to offer this viewer") and
 * renders an empty slot, never a missing one (SC-004).
 *
 * `join` (FR-027) and `invitation-required` (E2-03, FR-022) are complete here. The other kinds carry
 * one line of copy until the issue that owns each one builds its full design, so no viewer meets an
 * empty rail meanwhile: `register` E2-02, `rsvp` E2-04 and E2-05, `guest-join` E2-06,
 * `rsvp-unavailable` N-01, and `tools` E4.
 *
 * Inside the join window the slot is Join only, as in V1 (FR-029, decided 2026-10-06). Before the
 * window, a viewer who will be able to join then is told the early-join rule here, under the slot,
 * rather than in the time banner.
 */
@Component({
  selector: 'lfx-meeting-action-slot',
  imports: [ButtonComponent, MeetingJoinActionComponent, NgTemplateOutlet, OpenIntercomDirective],
  templateUrl: './action-slot.component.html',
})
export class MeetingActionSlotComponent {
  protected readonly state = inject(MeetingDetailsStateService);

  /**
   * The prototype's secondary rail button on `lfx-button`: a 42px outlined pill, full width.
   * Arbitrary px values because the app's 14px root would shrink rem-based utilities.
   */
  protected readonly secondaryButtonClass =
    '!h-[42px] !w-full !justify-center !gap-[8px] !rounded-full !border-[var(--md-border-strong)] !bg-[var(--md-surface-card)] !text-[14px] !font-semibold !text-[var(--md-text-heading)] hover:!bg-[var(--md-surface-hover)] focus-visible:!shadow-[var(--md-shadow-focus)]';

  protected readonly kind: Signal<ActionSlotKind | null> = this.state.actionSlot;
  protected readonly viewerRole: Signal<MeetingViewerRole | null> = this.state.viewerRole;
  /** The prototype's explainer under Join, for a meeting anyone with the link can join. */
  protected readonly openToPublic = computed(() => !!this.state.privacy()?.openToPublic);
  /**
   * The early-join rule (FR-012), shown before the window to a viewer who will be able to join in
   * it. Moved here from the time banner (decided on #3297).
   */
  protected readonly joinHint: Signal<string> = this.initJoinHint();
  /**
   * `invitation-required`'s "Contact the organizer": a pre-filled `mailto:` to the organizer V1's
   * chip names (owner, else creator), with the same subject and body. `null` when there is no
   * usable email, and the slot offers the support chat instead.
   */
  protected readonly organizerMailto: Signal<string | null> = this.initOrganizerMailto();

  private initOrganizerMailto(): Signal<string | null> {
    return computed(() => {
      const meeting = this.state.meeting();
      if (!meeting || this.kind() !== 'invitation-required') {
        return null;
      }
      // The selected occurrence's date, so a series' email names the occurrence the page is about, in
      // the meeting's own timezone so the server render and the browser agree.
      return buildMeetingOrganizerMailto({
        email: resolveMeetingOrganizer(meeting)?.email,
        meetingTitle: meeting.title,
        meetingDate: formatMeetingMailtoDate(this.state.selectedOccurrence()?.start_time ?? meeting.start_time, meeting.timezone),
        detailUrl: `${environment.urls.home}/meetings/${encodeURIComponent(meeting.id)}`,
      });
    });
  }

  private initJoinHint(): Signal<string> {
    return computed(() => {
      const meeting = this.state.meeting();
      if (!meeting || this.state.timeState() !== 'before' || !this.state.joinsInWindow()) {
        return '';
      }
      const minutes = meeting.early_join_time_minutes ?? DEFAULT_EARLY_JOIN_TIME;
      return `You can join up to ${minutes} minutes before the start time.`;
    });
  }
}
