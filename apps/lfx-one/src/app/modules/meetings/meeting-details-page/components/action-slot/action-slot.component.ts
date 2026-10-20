// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { environment } from '@environments/environment';
import { DEFAULT_EARLY_JOIN_TIME } from '@lfx-one/shared/constants';
import { ActionSlotKind, MeetingViewerRole } from '@lfx-one/shared/interfaces';
import { buildMeetingOrganizerMailto, formatMeetingMailtoDate, resolveMeetingOrganizer } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { restoreFocusOnDialogClose } from '@shared/utils/restore-dialog-focus.util';
import { DialogService } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

import { AddToCalendarComponent } from '../../../components/add-to-calendar/add-to-calendar.component';
import { PublicRegistrationModalComponent } from '../../../components/public-registration-modal/public-registration-modal.component';
import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingGuestJoinComponent } from '../guest-join/guest-join.component';
import { MeetingJoinActionComponent } from '../join-action/join-action.component';
import { MeetingRsvpCardComponent } from '../rsvp-card/rsvp-card.component';

/**
 * The V2 action slot, under the time banner in the rail card (E2-01, #1775, FR-020).
 * @description It renders exactly one `ActionSlotKind`, the state service's `actionSlot`, and
 * always carries it as `data-kind`. `none` is a decision ("nothing to offer this viewer") and
 * renders an empty slot, never a missing one (SC-004).
 *
 * `join` (FR-027), `register` (E2-02, FR-021), `invitation-required` (E2-03, FR-022),
 * `guest-join` (E2-06, FR-025) and `rsvp` (E2-05, FR-023 / FR-024, its own card) are complete here.
 * `rsvp-unavailable` (FR-026) renders V1's empty rail, as `none` does; only the join hint may follow.
 * `tools` carries one line of copy.
 *
 * Under the slot, an organizer or invitee gets V1's Add to calendar before the join window.
 *
 * Inside the join window the slot is Join only, as in V1 (FR-029, decided 2026-10-06). Before the
 * window, a viewer who will be able to join then is told the early-join rule here, under the slot,
 * rather than in the time banner.
 */
@Component({
  selector: 'lfx-meeting-action-slot',
  imports: [
    AddToCalendarComponent,
    ButtonComponent,
    MeetingGuestJoinComponent,
    MeetingJoinActionComponent,
    MeetingRsvpCardComponent,
    NgTemplateOutlet,
    OpenIntercomDirective,
  ],
  providers: [DialogService],
  templateUrl: './action-slot.component.html',
})
export class MeetingActionSlotComponent {
  protected readonly state = inject(MeetingDetailsStateService);
  private readonly userService = inject(UserService);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The prototype's primary rail button on `lfx-button`, as Join's: a 42px pill on the accent.
   * Arbitrary px values because the app's 14px root would shrink rem-based utilities.
   */
  protected readonly primaryButtonClass =
    '!h-[42px] !w-full !justify-center !gap-[9px] !rounded-full !border-[var(--md-accent)] !bg-[var(--md-accent)] !text-[15px] !font-bold !text-[var(--md-surface-card)] focus-visible:!shadow-[var(--md-shadow-focus)]';

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

  /**
   * `register` for a signed-in outsider (E2-02, FR-021): the shared registration dialog V1 opens, with
   * its validation unchanged. A successful registration moves the slot to the registrant's state at
   * once (`markRegistered`), as V1's optimistic flip does.
   */
  protected register(): void {
    const meeting = this.state.meeting();
    if (!meeting) {
      return;
    }
    // `open` returns null when this dialog is already open (PrimeNG blocks the duplicate), so a quick
    // second click leaves the open dialog alone. Focus goes back to Register on close (#3260).
    const trigger = this.document.activeElement;
    const dialogRef = this.dialogService.open(PublicRegistrationModalComponent, {
      header: 'Register for Meeting',
      width: '500px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { meetingId: meeting.id, meetingTitle: meeting.title, user: this.userService.user() },
    });

    restoreFocusOnDialogClose(dialogRef, trigger);

    // Torn down with the slot, and keyed to this meeting: a registration that completes after the
    // page has moved on to another meeting must not mark that one as invited.
    dialogRef?.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: { registered: boolean } | undefined) => {
      if (result?.registered) {
        this.state.markRegistered(meeting.id);
        // Register is gone from the slot now, so focus has nowhere to return to: hand it to the slot's
        // new first control once it renders, or to the slot itself when the new state has none (e.g.
        // `rsvp-unavailable`, V1's empty rail), so it never falls to <body> (#3260, WCAG 2.4.3). Only on the
        // meeting the registration was for: a late result after the page moved on changes nothing here.
        if (this.state.meeting()?.id === meeting.id) {
          afterNextRender(() => this.focusSlot(), { injector: this.injector });
        }
      }
    });
  }

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

  /** Focuses the slot's first control, or the slot itself (made programmatically focusable) when it has none. */
  private focusSlot(): void {
    const host = this.host.nativeElement;
    const control = host.querySelector<HTMLElement>('button, a[href]');
    if (control) {
      control.focus();
      return;
    }
    host.tabIndex = -1;
    host.focus();
  }
}
