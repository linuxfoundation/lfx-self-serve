// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { environment } from '@environments/environment';
import { DEFAULT_EARLY_JOIN_TIME } from '@lfx-one/shared/constants';
import { ActionSlotKind, MeetingRemovalSource, MeetingViewerRole } from '@lfx-one/shared/interfaces';
import { buildMeetingOrganizerMailto, formatMeetingMailtoDate, getMeetingSelfRemovalMessage, resolveMeetingOrganizer } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { extractErrorMessage, isBffValidationError } from '@shared/utils/http-error.utils';
import { restoreFocusOnDialogClose } from '@shared/utils/restore-dialog-focus.util';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService } from 'primeng/dynamicdialog';
import { filter, finalize, take } from 'rxjs';

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
 * `guest-join` (E2-06, FR-025), `rsvp` (E2-05, FR-023 / FR-024, its own card) and `rsvp-unavailable`
 * (N-01, FR-026) are complete here. Only `tools` still carries one line of copy until E4 builds its
 * full design, so no viewer meets an empty rail meanwhile.
 *
 * Under the slot, an organizer or invitee gets V1's Add to calendar and Remove Myself before the join
 * window, and a `?action=leave` link (invite emails, calendar events) asks them to confirm the removal.
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
    ConfirmDialogModule,
    MeetingGuestJoinComponent,
    MeetingJoinActionComponent,
    MeetingRsvpCardComponent,
    NgTemplateOutlet,
    OpenIntercomDirective,
  ],
  // Its own ConfirmationService, as the registrants display has, so its confirmation never shows twice.
  providers: [ConfirmationService, DialogService],
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
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly meetingService = inject(MeetingService);

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

  public constructor() {
    this.initLeaveFromLink();
  }

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
        // `rsvp-unavailable`, plain text), so it never falls to <body> (#3260, WCAG 2.4.3). Only on the
        // meeting the registration was for: a late result after the page moved on changes nothing here.
        if (this.state.meeting()?.id === meeting.id) {
          afterNextRender(() => this.focusSlot(), { injector: this.injector });
        }
      }
    });
  }

  /**
   * V1's `confirmLeaveMeeting`: the same "Remove Yourself" confirmation and copy. Removal runs only
   * from the confirmation, never from a link.
   */
  protected confirmLeave(source: MeetingRemovalSource = 'meeting-join'): void {
    const meeting = this.state.meeting();
    if (!meeting) {
      return;
    }
    const title = this.state.selectedOccurrence()?.title || meeting.title || '';
    this.confirmationService.confirm({
      header: 'Remove Yourself',
      message: getMeetingSelfRemovalMessage(title, { viaCommittee: meeting.invited_via_committee, organizer: meeting.organizer }),
      acceptLabel: 'Remove Me',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => this.leave(meeting.id, source),
    });
  }

  /**
   * V1's `leaveMeeting`: removes the viewer's registrations, then records the outcome on the page
   * (`markLeft`, or `markLeaveIncomplete` when some remain) with V1's toasts. A result for a meeting
   * or account the page has since left changes nothing here.
   */
  private leave(meetingId: string, source: MeetingRemovalSource): void {
    const subject = this.viewerSubject();
    this.state.leaving.set(true);

    this.meetingService
      .removeMyMeetingRegistration(meetingId, source)
      .pipe(
        take(1),
        finalize(() => this.state.leaving.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          this.userService.clearConfirmedMeetingRsvps(meetingId, subject, result);
          if (this.state.meeting()?.id !== meetingId || this.viewerSubject() !== subject) {
            return;
          }
          if (result.remaining_registrant_ids.length > 0) {
            this.state.markLeaveIncomplete(meetingId);
            this.messageService.add({
              severity: 'warn',
              summary: 'Removal incomplete',
              detail: 'Some of your registrations could not be removed. You are still invited to this meeting. Please try again.',
            });
            this.userService.refreshUserMeetings(false);
          } else {
            this.state.markLeft(meetingId);
            this.messageService.add({ severity: 'success', summary: 'Removed', detail: 'You have been removed from this meeting.' });
          }
        },
        error: (error: unknown) => {
          const fallback = 'Unable to remove you from this meeting. Please try again.';
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: isBffValidationError(error) ? extractErrorMessage(error, fallback) : fallback,
          });
        },
      });
  }

  /**
   * V1's `initializeLeaveFromLink`, for a signed-in viewer (V2 renders for no one else): once the
   * linked meeting has loaded, the param is dropped and the viewer asked to confirm, or told they are
   * not registered.
   */
  private initLeaveFromLink(): void {
    toObservable(
      computed(() => this.state.leaveRequested() && this.state.status() === 'ready'),
      { injector: this.injector }
    )
      .pipe(filter(Boolean), take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.state.consumeLeaveRequest();
        if (!this.state.canLeaveMeeting()) {
          this.messageService.add({ severity: 'info', summary: 'Not registered', detail: 'You are not registered for this meeting.' });
          return;
        }
        this.confirmLeave('email-link');
      });
  }

  /** The account a removal is attributed to, as V1 keys it. */
  private viewerSubject(): string {
    return this.userService.user()?.sub || this.userService.viewerUsername() || this.userService.user()?.email || '';
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
