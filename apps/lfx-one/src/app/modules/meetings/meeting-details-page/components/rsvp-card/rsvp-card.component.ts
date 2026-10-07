// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, linkedSignal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
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
 * Once answered it shows the answer, with Change to answer again (and Keep my answer to back out).
 * On a series it asks which occurrences the answer covers (all / this occurrence only / this and
 * following) before saving; a single meeting saves `all` silently. RSVP is a three-value enum;
 * "pending" is the absence of one.
 *
 * It saves as V1's `lfx-rsvp-button-group` does (same request, `occurrence_id` for `single` and
 * `this_and_following`, same toasts and 404 copy) and hands the saved RSVP to the state service
 * (`setMyRsvp`), so the pill and the card show it at once, ahead of the indexer. The card also keeps
 * the answer it saved: the state service only loads an invitee's own answer, and an organizer gets
 * this card too, invited or not.
 *
 * Each step swaps what is on screen, so focus moves to the step's control, and a save is announced
 * through one live region that stays mounted. The step state resets when the page moves to another
 * meeting or occurrence.
 *
 * The scope question is a step inside the card, not V1's dialog: that dialog is shared with V1 and
 * the meeting cards (and carries V1's testids), and a V2 dialog would render outside the page's
 * scoped design tokens, appended to `<body>`.
 */
@Component({
  selector: 'lfx-meeting-rsvp-card',
  imports: [ReactiveFormsModule, RadioButtonComponent],
  templateUrl: './rsvp-card.component.html',
})
export class MeetingRsvpCardComponent {
  protected readonly state = inject(MeetingDetailsStateService);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly elementRef: ElementRef<HTMLElement> = inject(ElementRef);

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

  protected readonly scopeForm = new FormGroup({ scope: new FormControl<RsvpScope>('all', { nonNullable: true }) });

  /** The meeting and occurrence the card answers for; the step state below resets when it changes. */
  private readonly rsvpKey: Signal<string> = this.initRsvpKey();
  /** True while the viewer is changing an existing answer (Change). */
  protected readonly changing = linkedSignal({ source: this.rsvpKey, computation: () => false });
  /** The answer chosen on a series, waiting for its scope. */
  protected readonly pendingResponse = linkedSignal<string, RsvpResponse | null>({ source: this.rsvpKey, computation: () => null });
  /** The answer this card last saved, for a viewer whose own answer the state service does not load. */
  private readonly savedResponse = linkedSignal<string, RsvpResponse | null>({ source: this.rsvpKey, computation: () => null });
  protected readonly saving = linkedSignal<string, RsvpResponse | null>({ source: this.rsvpKey, computation: () => null });
  protected readonly error = linkedSignal<string, string | null>({ source: this.rsvpKey, computation: () => null });
  /** The live region's text: set after a save, so the result is announced once. */
  protected readonly announcement = linkedSignal({ source: this.rsvpKey, computation: () => '' });

  /** The answer to show: the page's own once loaded, else what this card saved. */
  protected readonly answer: Signal<RsvpResponse | null> = computed(() => this.state.myRsvp() ?? this.savedResponse());
  protected readonly myRsvpAttr: Signal<string | null> = this.state.myRsvpAttr;
  /** Answered, and not changing it: the confirmation shows instead of the buttons. */
  protected readonly confirmed = computed(() => !!this.answer() && !this.changing() && !this.pendingResponse());
  protected readonly recurring = computed(() => !!this.state.meeting()?.recurrence);

  protected choose(response: RsvpResponse): void {
    if (this.saving()) {
      return;
    }
    this.error.set(null);
    // FR-024: a series asks for a scope first; a single meeting saves `all` silently.
    if (this.recurring()) {
      this.scopeForm.reset({ scope: 'all' });
      this.pendingResponse.set(response);
      this.focusAfterRender('#meeting-rsvp-card-scope-all');
      return;
    }
    this.save(response, 'all');
  }

  protected confirmScope(): void {
    const response = this.pendingResponse();
    if (response) {
      this.save(response, this.scopeForm.controls.scope.value);
    }
  }

  protected cancelScope(): void {
    const response = this.pendingResponse();
    this.pendingResponse.set(null);
    this.focusAfterRender(`[data-testid="meeting-rsvp-card-${response}"]`);
  }

  protected change(): void {
    this.error.set(null);
    this.changing.set(true);
    this.focusAfterRender('[data-testid^="meeting-rsvp-card-"][aria-pressed="true"]');
  }

  protected keepAnswer(): void {
    this.changing.set(false);
    this.focusAfterRender('[data-testid="meeting-rsvp-card-change"]');
  }

  private initRsvpKey(): Signal<string> {
    return computed(() => {
      const meeting = this.state.meeting();
      return meeting ? `${meeting.id}|${resolveRsvpOccurrenceId(meeting, { occurrence: this.state.selectedOccurrence() }) ?? ''}` : '';
    });
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
    this.scopeForm.disable();
    this.meetingService
      .createMeetingRsvp(meeting.id, request)
      .pipe(
        finalize(() => {
          this.saving.set(null);
          this.scopeForm.enable();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (rsvp: MeetingRsvp) => {
          this.state.setMyRsvp(meeting.id, occurrenceId, rsvp);
          this.savedResponse.set(rsvp.response_type);
          this.pendingResponse.set(null);
          this.changing.set(false);
          this.announcement.set(`RSVP saved. ${this.confirmations[rsvp.response_type].label}.`);
          this.focusAfterRender('[data-testid="meeting-rsvp-card-change"]');
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

  /** Moves focus into the step just rendered, so keyboard and screen-reader users keep their place. */
  private focusAfterRender(selector: string): void {
    afterNextRender(() => this.elementRef.nativeElement.querySelector<HTMLElement>(selector)?.focus(), { injector: this.injector });
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
