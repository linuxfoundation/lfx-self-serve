// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable, signal } from '@angular/core';
import { MeetingRegistrant } from '@lfx-one/shared/interfaces';
import { MeetingOwnInviteResendService } from '@services/meeting-own-invite-resend.service';
import { MeetingService } from '@services/meeting.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { take } from 'rxjs';

/**
 * "Resend invite" flows shared by every surface that offers one.
 * @description Organizers resend to a guest from any surface that lists meeting registrants
 * (`confirmAndResend`); each surface owns its own `ConfirmationService` (bound to its `p-confirmDialog`),
 * so the host passes it in. Upstream enforces the organizer relation; hosts gate the button on the
 * meeting's `organizer` flag. Registrants resend to themselves from a meeting card or the join page
 * (`resendOwn`): the server resolves which registrant that is, and upstream verifies it is theirs.
 * In-flight tracking and success/error toasts live here so the surfaces stay consistent. The own-resend logic lives
 * in {@link MeetingOwnInviteResendService}, which surfaces without PrimeNG or with their own feedback use directly.
 */
@Injectable({ providedIn: 'root' })
export class MeetingInviteResendService {
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly ownResend = inject(MeetingOwnInviteResendService);

  private readonly resendingUids = signal<ReadonlySet<string>>(new Set());

  /** Whether the registrant is persisted upstream; pending and optimistic rows have no invite to resend. */
  public canResend(registrant: Pick<MeetingRegistrant, 'uid'>): boolean {
    return !!registrant.uid && !registrant.uid.startsWith('optimistic-');
  }

  /** Whether a resend is in flight for the registrant; reads a signal, so templates stay reactive. */
  public isResending(uid: string | undefined): boolean {
    return !!uid && this.resendingUids().has(uid);
  }

  /** Whether the signed-in user's own resend is in flight for the meeting; reads a signal, so templates stay reactive. */
  public isResendingOwn(meetingUid: string | undefined): boolean {
    return this.ownResend.isResendingOwn(meetingUid);
  }

  /**
   * Resends the meeting invitation to the signed-in user's own registration, for the occurrence being viewed when the
   * surface has one (registrations can be scoped to a single occurrence). No confirmation: it only emails the
   * caller, and a second click while one is in flight is ignored. Toasts the result.
   */
  public resendOwn(meetingUid: string, occurrenceId?: string | null): void {
    this.ownResend.resendOwn$(meetingUid, occurrenceId).subscribe({
      next: () =>
        this.messageService.add({
          severity: 'success',
          summary: 'Invitation Sent',
          detail: 'We sent the meeting invitation to your email.',
        }),
      error: (error: unknown) =>
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: this.ownResend.describeOwnResendFailure(error),
        }),
    });
  }

  public confirmAndResend(confirmationService: ConfirmationService, meetingUid: string, registrant: MeetingRegistrant): void {
    if (!this.canResend(registrant) || this.isResending(registrant.uid)) {
      return;
    }

    const label = [registrant.first_name, registrant.last_name].filter(Boolean).join(' ') || registrant.email || 'this guest';
    confirmationService.confirm({
      header: 'Resend invitation',
      message: `Resend the meeting invitation to ${label}?`,
      // PrimeNG sizes the confirm icon at 2rem (font-size, width and height), which dwarfs this short prompt; scale it down for this dialog only.
      icon: 'fa-light fa-paper-plane !text-xl !w-auto !h-auto',
      acceptLabel: 'Resend',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.resend(meetingUid, registrant, label),
    });
  }

  private resend(meetingUid: string, registrant: MeetingRegistrant, label: string): void {
    const uid = registrant.uid;
    this.setResending(uid, true);

    this.meetingService
      .resendMeetingInvitation(meetingUid, uid)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.setResending(uid, false);
          this.messageService.add({ severity: 'success', summary: 'Success', detail: `Invitation resent to ${registrant.email || label}` });
        },
        error: (error: { error?: { error?: unknown } }) => {
          this.setResending(uid, false);
          // The BFF error envelope is `{ error: string, code }`, so the reason sits at `error.error.error`.
          const reason = error?.error?.error;
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: typeof reason === 'string' && reason.trim() ? reason : 'Failed to resend invitation. Please try again.',
          });
        },
      });
  }

  private setResending(uid: string, resending: boolean): void {
    this.resendingUids.update((current) => {
      const next = new Set(current);
      if (resending) {
        next.add(uid);
      } else {
        next.delete(uid);
      }
      return next;
    });
  }
}
