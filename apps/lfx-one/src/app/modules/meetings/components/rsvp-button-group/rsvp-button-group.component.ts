// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
  signal,
  viewChildren,
  WritableSignal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RsvpScopeModalComponent } from '@app/modules/meetings/components/rsvp-scope-modal/rsvp-scope-modal.component';
import { CreateMeetingRsvpRequest, Meeting, MeetingRsvp, RsvpResponse, RsvpScope, User } from '@lfx-one/shared';
import {
  formatMeetingOccurrenceLabel,
  isMeetingInviteResponsesEnabled,
  isSameOccurrenceId,
  occurrenceIdToMs,
  occurrenceIdToSeconds,
  resolveRsvpOccurrenceId,
  selectApplicableRsvp,
} from '@lfx-one/shared/utils';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, combineLatest, finalize, map, of, switchMap, take, tap } from 'rxjs';

@Component({
  selector: 'lfx-rsvp-button-group',
  imports: [NgClass],
  providers: [DialogService],
  templateUrl: './rsvp-button-group.component.html',
})
export class RsvpButtonGroupComponent {
  // Injected services
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly userService = inject(UserService);
  private readonly lensService = inject(LensService);
  private readonly destroyRef = inject(DestroyRef);

  // User data
  public user: Signal<User | null> = this.userService.user;
  public authenticated: Signal<boolean> = this.userService.authenticated;

  // Inputs
  public meeting: InputSignal<Meeting> = input.required<Meeting>();
  public showHeader: InputSignal<boolean> = input<boolean>(true);
  public occurrenceId: InputSignal<string | undefined> = input<string | undefined>(undefined);
  public disabled: InputSignal<boolean> = input<boolean>(false);
  public disabledMessage: InputSignal<string> = input<string>('RSVP not available for this meeting');
  /** Suppresses the success toast; pair with `suppressErrorToast` to suppress errors too. */
  public suppressToast: InputSignal<boolean> = input<boolean>(false);
  /** When true, suppresses the default error toast — callers handling errors via the `rsvpFailed` output. */
  public suppressErrorToast: InputSignal<boolean> = input<boolean>(false);
  /** Compact rendering: no surrounding container, buttons match secondary-outlined CTA style with colored icon + label per response. */
  public compact: InputSignal<boolean> = input<boolean>(false);

  // Outputs
  public readonly rsvpChanged: OutputEmitterRef<MeetingRsvp> = output<MeetingRsvp>();
  /** Emits the resolved error message when an RSVP submission fails. Pair with `suppressErrorToast=true` to render a custom error UI. */
  public readonly rsvpFailed: OutputEmitterRef<string> = output<string>();

  // Internal state
  public isLoading: WritableSignal<boolean> = signal(false);
  private readonly confirmedRsvps = signal<MeetingRsvp[]>([]);
  private readonly confirmedContext = signal<string | null>(null);
  private readonly responseButtons = viewChildren<ElementRef<HTMLButtonElement>>('responseButton');

  // Computed values
  public readonly meetingUid: Signal<string> = this.initializeMeetingUid();
  public readonly isRecurring: Signal<boolean> = this.initializeIsRecurring();
  public readonly resolvedOccurrenceId: Signal<string | undefined> = computed(() =>
    resolveRsvpOccurrenceId(this.meeting(), { occurrenceId: this.occurrenceId() })
  );
  public readonly occurrenceLabel: Signal<string | null> = computed(() => this.formatOccurrenceLabel(this.resolvedOccurrenceId()));
  private readonly fetchedRsvp = this.initializeFetchedRsvp();
  private readonly confirmedRsvp: Signal<MeetingRsvp | null> = this.initializeConfirmedRsvp();
  public readonly currentRsvp: Signal<MeetingRsvp | null> = this.initializeCurrentRsvp();
  public readonly selectedResponse: Signal<RsvpResponse | null> = computed(() => this.currentRsvp()?.response_type ?? null);
  public readonly responseLabel: Signal<string | null> = computed(() => {
    const response = this.selectedResponse();
    return response ? this.formatResponse(response) : null;
  });
  public readonly responseSaved: Signal<boolean> = computed(() => !!this.confirmedRsvp() && this.currentRsvp() === this.confirmedRsvp());
  public readonly responseScopeLabel: Signal<string | null> = this.initializeResponseScopeLabel();
  public readonly inviteResponsesEnabled: Signal<boolean> = computed(() => isMeetingInviteResponsesEnabled(this.meeting()));

  public handleRsvpClick(response: RsvpResponse): void {
    if (this.isLoading() || this.disabled() || !this.inviteResponsesEnabled()) {
      return;
    }
    // For recurring meetings, show scope modal
    if (this.isRecurring()) {
      this.showScopeModal(response);
      return;
    }

    // For non-recurring meetings, submit directly with 'all' scope
    this.submitRsvp(response, 'all');
  }

  protected focusSelectedResponse(): void {
    if (this.isLoading() || this.disabled() || !this.inviteResponsesEnabled() || !this.selectedResponse()) {
      return;
    }
    this.responseButtons()
      .find((button) => button.nativeElement.getAttribute('aria-pressed') === 'true')
      ?.nativeElement.focus();
  }

  private showScopeModal(response: RsvpResponse): void {
    // Capture the date the user clicked, so a card/route changing while the dialog is open
    // cannot redirect a single-date response to a different occurrence.
    const meeting = this.meeting();
    const occurrenceId = this.resolvedOccurrenceId();
    const context = this.rsvpContext();
    const dialogRef = this.dialogService.open(RsvpScopeModalComponent, {
      header: 'This date or all dates?',
      width: '500px',
      data: {
        response: this.formatResponse(response),
        occurrenceLabel: this.occurrenceLabel(),
        canSelectOccurrence: !!occurrenceId && !!this.occurrenceLabel(),
      },
    }) as DynamicDialogRef | null;

    dialogRef?.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: { confirmed: boolean; scope?: RsvpScope }) => {
      const currentOccurrenceId = this.resolvedOccurrenceId();
      if (
        result?.confirmed &&
        result.scope &&
        this.rsvpContext() === context &&
        this.meeting().id === meeting.id &&
        (result.scope === 'all' || (!currentOccurrenceId && !occurrenceId) || isSameOccurrenceId(currentOccurrenceId, occurrenceId))
      ) {
        this.submitRsvp(response, result.scope, occurrenceId);
      }
    });
  }

  private submitRsvp(response: RsvpResponse, scope: RsvpScope, occurrenceId = this.resolvedOccurrenceId()): void {
    if (this.isLoading() || this.disabled() || !this.inviteResponsesEnabled()) {
      return;
    }
    const currentUser = this.user();
    const subject = currentUser?.sub || this.userService.viewerUsername() || currentUser?.email || '';
    const meetingUid = this.meetingUid();
    const meeting = this.meeting();
    const context = this.rsvpContext();
    const generation = this.userService.meetingRegistrationGeneration(meeting.id, subject);
    const scopedOccurrenceId = scope === 'all' ? undefined : (occurrenceIdToSeconds(occurrenceId) ?? undefined);
    if (scope !== 'all' && !scopedOccurrenceId) {
      this.reportFailure('This meeting date could not be resolved. Please reload the meeting and try again.');
      return;
    }
    const scopeLabel = this.isRecurring() ? this.formatScope(scope, scopedOccurrenceId) : 'This meeting';
    const successDetail = `${this.meeting().title} — ${scopeLabel}`;
    this.isLoading.set(true);

    const request: CreateMeetingRsvpRequest = {
      response,
      scope,
      email: currentUser?.email,
    };

    if (scopedOccurrenceId) {
      request.occurrence_id = scopedOccurrenceId;
    }

    this.meetingService
      .createMeetingRsvp(meetingUid, request)
      .pipe(
        tap((rsvp: MeetingRsvp) => {
          const acknowledged = {
            ...rsvp,
            occurrence_id: rsvp.occurrence_id || scopedOccurrenceId,
            // Creation time may predate a changed answer; use confirmation time without a modification timestamp.
            updated_at: rsvp.updated_at || rsvp.modified_at || new Date().toISOString(),
          };
          // Use the retained copy so every view orders this answer after the confirmations it follows.
          const savedRsvp = this.userService.recordConfirmedMeetingRsvp(acknowledged, subject, generation) ?? acknowledged;
          if (!this.userService.isMeetingRsvpCurrent(savedRsvp, meeting, subject)) return;
          // The successful POST is authoritative. Never replace it with a stale/null
          // query-service refetch while the new response is still being indexed.
          if (this.confirmedContext() !== context) {
            this.confirmedRsvps.set([]);
          }
          this.confirmedContext.set(context);
          this.confirmedRsvps.update((rsvps) => [...rsvps, savedRsvp]);
          if (!this.suppressToast()) {
            this.messageService.add({
              severity: 'success',
              summary: `Response saved: ${this.formatResponse(savedRsvp.response_type)}`,
              detail: successDetail,
              life: 5000,
            });
          }
          if (this.rsvpContext() === context) this.rsvpChanged.emit(savedRsvp);
          // Defer personal refetches outside Me without keeping a stale replay on return.
          this.userService.refreshUserMeetings(this.lensService.activeLens() === 'me');
        }),
        catchError((error: HttpErrorResponse) => {
          let errorMessage = 'Failed to update RSVP. Please try again.';

          if (error.status === 404) {
            errorMessage = 'Only invited users are allowed to RSVP to this meeting.';
          } else if (error?.error?.error) {
            errorMessage = error.error.error;
          }

          this.reportFailure(errorMessage);
          return of(null);
        }),
        finalize(() => {
          this.isLoading.set(false);
        })
      )
      .subscribe();
  }

  private formatResponse(response: RsvpResponse): string {
    switch (response) {
      case 'accepted':
        return 'Going';
      case 'declined':
        return 'Not going';
      case 'maybe':
        return 'Maybe';
    }
  }

  private initializeMeetingUid(): Signal<string> {
    return computed(() => this.meeting().id);
  }

  private initializeIsRecurring(): Signal<boolean> {
    return computed(() => !!this.meeting().recurrence);
  }

  private initializeResponseScopeLabel(): Signal<string | null> {
    return computed(() => {
      const rsvp = this.currentRsvp();
      if (!rsvp || !this.isRecurring()) {
        return null;
      }
      const compositeOccurrenceId = rsvp.meeting_and_occurrence_id?.split('-').pop();
      return this.formatScope(rsvp.scope, rsvp.occurrence_id || compositeOccurrenceId);
    });
  }

  private initializeFetchedRsvp(): Signal<{ context: string; occurrenceId?: string; rsvp: MeetingRsvp | null } | null> {
    return toSignal(
      combineLatest([
        toObservable(this.meeting),
        toObservable(this.resolvedOccurrenceId),
        toObservable(this.authenticated),
        toObservable(this.disabled),
        toObservable(this.user),
        toObservable(this.userService.viewerUsername),
      ]).pipe(
        switchMap(([meeting, occurrenceId, authenticated, disabled]) => {
          if (disabled || !authenticated || !meeting?.id || !isMeetingInviteResponsesEnabled(meeting)) {
            return of(null);
          }
          const context = this.rsvpContext();
          const allDatesOnly = !!meeting.recurrence && !occurrenceId;
          return this.meetingService.getMeetingRsvpForCurrentUser(meeting.id, occurrenceId, allDatesOnly).pipe(
            catchError(() => of(null)),
            map((rsvp) => ({ context, occurrenceId, rsvp }))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initializeConfirmedRsvp(): Signal<MeetingRsvp | null> {
    return computed(() => {
      if (this.confirmedContext() !== this.rsvpContext()) {
        return null;
      }
      const rsvps = this.confirmedRsvps();
      // Local write order is authoritative even if two responses have the same server timestamp.
      for (let index = rsvps.length - 1; index >= 0; index--) {
        const rsvp = this.applicableRsvp(rsvps[index]);
        if (rsvp) {
          return rsvp;
        }
      }
      return null;
    });
  }

  private initializeCurrentRsvp(): Signal<MeetingRsvp | null> {
    return computed(() => {
      if (!this.authenticated() || this.disabled() || !isMeetingInviteResponsesEnabled(this.meeting())) {
        return null;
      }
      const confirmed = this.confirmedRsvp();
      // Answers retained across card recreation; outside the personal feed nothing else carries them.
      const retained = this.userService
        .confirmedMeetingRsvps(this.meetingUid())
        .map((rsvp) => this.applicableRsvp(rsvp))
        .filter((rsvp): rsvp is MeetingRsvp => !!rsvp);
      const supplied = this.applicableRsvp(this.meeting().my_rsvp);
      const fetched = this.fetchedRsvp();
      const occurrenceId = this.resolvedOccurrenceId();
      const fetchedRsvp =
        fetched?.context === this.rsvpContext() && ((!fetched.occurrenceId && !occurrenceId) || isSameOccurrenceId(fetched.occurrenceId, occurrenceId))
          ? this.applicableRsvp(fetched.rsvp)
          : null;
      const candidates = [confirmed, ...retained, supplied, fetchedRsvp].filter((rsvp): rsvp is MeetingRsvp => !!rsvp);
      return selectApplicableRsvp(this.resolvedOccurrenceId(), candidates);
    });
  }

  private applicableRsvp(rsvp: MeetingRsvp | null | undefined): MeetingRsvp | null {
    if (!rsvp || rsvp.meeting_id !== this.meetingUid() || !this.userService.isMeetingRsvpCurrent(rsvp, this.meeting())) {
      return null;
    }
    // Without a resolved recurring date, only an all-dates response is meaningful.
    if (this.isRecurring() && !this.resolvedOccurrenceId()) {
      return rsvp.scope === 'all' ? rsvp : null;
    }
    return selectApplicableRsvp(this.resolvedOccurrenceId(), [rsvp]);
  }

  private rsvpContext(): string {
    return `${this.meetingUid()}|${this.user()?.sub || this.userService.viewerUsername() || this.user()?.email || ''}`;
  }

  private formatOccurrenceLabel(occurrenceId: string | undefined): string | null {
    const instant = occurrenceIdToMs(occurrenceId);
    if (!occurrenceId || instant === null) {
      return null;
    }
    const meeting = this.meeting();
    const occurrence = meeting.occurrences?.find((item) => isSameOccurrenceId(item.occurrence_id, occurrenceId)) ?? {
      occurrence_id: occurrenceId,
      start_time: new Date(instant).toISOString(),
      duration: meeting.duration,
    };
    return formatMeetingOccurrenceLabel(occurrence, meeting.timezone);
  }

  private formatScope(scope: RsvpScope, occurrenceId?: string): string {
    if (scope === 'all') {
      return 'All dates';
    }
    const date = this.formatOccurrenceLabel(occurrenceId) ?? this.occurrenceLabel();
    if (scope === 'this_and_following') {
      return date ? `${date} and all following dates` : 'This date and all following dates';
    }
    return date ? `${date} only` : 'This date only';
  }

  private reportFailure(errorMessage: string): void {
    this.rsvpFailed.emit(errorMessage);
    if (!this.suppressErrorToast()) {
      this.messageService.add({
        severity: 'error',
        summary: 'RSVP Failed',
        detail: errorMessage,
        life: 5000,
      });
    }
  }
}
