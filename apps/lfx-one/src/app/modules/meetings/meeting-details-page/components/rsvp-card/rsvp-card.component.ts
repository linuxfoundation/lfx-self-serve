// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CreateMeetingRsvpRequest, MeetingRsvp, RsvpResponse, RsvpScope } from '@lfx-one/shared/interfaces';
import { resolveRsvpOccurrenceId } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { finalize } from 'rxjs';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The V2 RSVP card, the `rsvp` kind of the action slot (E2-05, #2881, FR-023 / FR-024).
 * @description The prototype's "Will you attend?" card: Yes, I'll attend / Maybe / Can't attend.
 * Once answered it shows the answer, with Change to answer again. On a series it asks which
 * occurrences the answer covers (all / this occurrence only / this and following) before saving;
 * a single meeting saves `all` silently. RSVP is a three-value enum; "pending" is the absence of
 * one.
 *
 * It saves as V1's `lfx-rsvp-button-group` does (same request, `occurrence_id` for `single` and
 * `this_and_following`, same toasts and 404 copy) and hands the saved RSVP to the state service
 * (`setMyRsvp`), so the pill and the card show it at once, ahead of the indexer.
 *
 * The scope question is a step inside the card, not V1's dialog: that dialog is shared with V1 and
 * the meeting cards (and carries V1's testids), and a V2 dialog would render outside the page's
 * scoped design tokens, appended to `<body>`.
 */
@Component({
  selector: 'lfx-meeting-rsvp-card',
  templateUrl: './rsvp-card.component.html',
})
export class MeetingRsvpCardComponent {
  protected readonly state = inject(MeetingDetailsStateService);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  /** The three answers, in the prototype's order, with its words and colours (V2 tokens). */
  protected readonly options: { response: RsvpResponse; label: string; icon: string; tone: string }[] = [
    { response: 'accepted', label: "Yes, I'll attend", icon: 'fa-solid fa-check', tone: 'var(--md-status-good)' },
    { response: 'maybe', label: 'Maybe', icon: 'fa-solid fa-question', tone: 'var(--md-status-warn)' },
    { response: 'declined', label: "Can't attend", icon: 'fa-solid fa-xmark', tone: 'var(--md-status-live)' },
  ];
  /** V1's scope options and words. */
  protected readonly scopes: { scope: RsvpScope; label: string }[] = [
    { scope: 'all', label: 'All occurrences' },
    { scope: 'single', label: 'This occurrence only' },
    { scope: 'this_and_following', label: 'This and following occurrences' },
  ];
  /** The prototype's confirmation per answer: words, glyph and tokens. */
  protected readonly confirmations: Record<RsvpResponse, { label: string; icon: string; classes: string }> = {
    accepted: { label: "You're going", icon: 'fa-solid fa-check', classes: 'bg-[var(--md-status-good-bg)] text-[var(--md-status-good)]' },
    maybe: { label: 'You replied maybe', icon: 'fa-solid fa-question', classes: 'bg-[var(--md-status-warn-bg)] text-[var(--md-status-warn)]' },
    declined: { label: "You can't attend", icon: 'fa-solid fa-xmark', classes: 'bg-[var(--md-surface-hover)] text-[var(--md-text-muted)]' },
  };

  /** True while the viewer is changing an existing answer (Change). */
  protected readonly changing = signal(false);
  /** The answer chosen on a series, waiting for its scope. */
  protected readonly pendingResponse = signal<RsvpResponse | null>(null);
  protected readonly selectedScope = signal<RsvpScope>('all');
  protected readonly saving = signal<RsvpResponse | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly myRsvp: Signal<RsvpResponse | null | undefined> = this.state.myRsvp;
  protected readonly myRsvpAttr: Signal<string | null> = this.state.myRsvpAttr;
  /** Answered, and not changing it: the confirmation shows instead of the buttons. */
  protected readonly confirmed = computed(() => !!this.myRsvp() && !this.changing() && !this.pendingResponse());
  protected readonly recurring = computed(() => !!this.state.meeting()?.recurrence);

  protected choose(response: RsvpResponse): void {
    if (this.saving()) {
      return;
    }
    this.error.set(null);
    // FR-024: a series asks for a scope first; a single meeting saves `all` silently.
    if (this.recurring()) {
      this.selectedScope.set('all');
      this.pendingResponse.set(response);
      return;
    }
    this.save(response, 'all');
  }

  protected confirmScope(): void {
    const response = this.pendingResponse();
    if (response) {
      this.save(response, this.selectedScope());
    }
  }

  protected cancelScope(): void {
    this.pendingResponse.set(null);
  }

  protected change(): void {
    this.error.set(null);
    this.changing.set(true);
  }

  private save(response: RsvpResponse, scope: RsvpScope): void {
    const meeting = this.state.meeting();
    if (!meeting) {
      return;
    }
    // The occurrence the page shows, resolved as the state service resolves it for the fetch, so the
    // saved answer lands on the same key.
    const occurrenceId = resolveRsvpOccurrenceId(meeting, { occurrence: this.state.selectedOccurrence() });
    const request: CreateMeetingRsvpRequest = { response, scope, email: this.userService.user()?.email };
    if ((scope === 'single' || scope === 'this_and_following') && occurrenceId) {
      request.occurrence_id = occurrenceId;
    }

    this.saving.set(response);
    this.meetingService
      .createMeetingRsvp(meeting.id, request)
      .pipe(
        finalize(() => this.saving.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (rsvp: MeetingRsvp) => {
          this.state.setMyRsvp(meeting.id, occurrenceId, rsvp);
          this.pendingResponse.set(null);
          this.changing.set(false);
          this.messageService.add({
            severity: 'success',
            summary: 'RSVP Updated',
            detail: `You have responded "${this.responseWord(response)}" for this meeting.`,
            life: 3000,
          });
        },
        error: (error: HttpErrorResponse) => {
          const message = this.errorMessage(error);
          this.error.set(message);
          this.messageService.add({ severity: 'error', summary: 'RSVP Failed', detail: message, life: 5000 });
        },
      });
  }

  /** V1's words for the answer in the toast. */
  private responseWord(response: RsvpResponse): string {
    switch (response) {
      case 'accepted':
        return 'Yes';
      case 'declined':
        return 'No';
      default:
        return 'Maybe';
    }
  }

  /** V1's error copy: the 404 is a viewer who is not on the invite list. */
  private errorMessage(error: HttpErrorResponse): string {
    if (error.status === 404) {
      return 'Only invited users are allowed to RSVP to this meeting.';
    }
    return error?.error?.error || 'Failed to update RSVP. Please try again.';
  }
}
