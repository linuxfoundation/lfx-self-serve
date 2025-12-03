// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, InputSignal, output, OutputEmitterRef, Signal, signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RsvpScopeModalComponent } from '@app/modules/meetings/components/rsvp-scope-modal/rsvp-scope-modal.component';
import { CreateMeetingRsvpRequest, Meeting, MeetingRsvp, RsvpResponse, RsvpScope, User } from '@lfx-one/shared';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { catchError, combineLatest, finalize, of, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-rsvp-button-group',
  standalone: true,
  imports: [CommonModule],
  providers: [DialogService],
  templateUrl: './rsvp-button-group.component.html',
})
export class RsvpButtonGroupComponent {
  // Injected services
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly userService = inject(UserService);

  // User data
  public user: Signal<User | null> = this.userService.user;
  public authenticated: Signal<boolean> = this.userService.authenticated;

  // Inputs
  public meeting: InputSignal<Meeting> = input.required<Meeting>();
  public showHeader: InputSignal<boolean> = input<boolean>(true);
  public occurrenceId: InputSignal<string | undefined> = input<string | undefined>(undefined);
  public disabled: InputSignal<boolean> = input<boolean>(false);
  public disabledMessage: InputSignal<string> = input<string>('RSVP not available for this meeting');

  // Outputs
  public readonly rsvpChanged: OutputEmitterRef<MeetingRsvp> = output<MeetingRsvp>();

  // Internal state
  public isLoading: WritableSignal<boolean> = signal(false);
  private refreshTrigger: WritableSignal<number> = signal(0);

  // Computed values
  public readonly meetingUid: Signal<string> = this.initializeMeetingUid();
  public readonly isRecurring: Signal<boolean> = this.initializeIsRecurring();
  public readonly currentRsvp: Signal<MeetingRsvp | null> = this.initializeCurrentRsvp();
  public readonly selectedResponse: Signal<RsvpResponse | null> = this.initializeSelectedResponse();

  public handleRsvpClick(response: RsvpResponse): void {
    // For recurring meetings, show scope modal
    if (this.isRecurring()) {
      this.showScopeModal(response);
      return;
    }

    // For non-recurring meetings, submit directly with 'all' scope
    this.submitRsvp(response, 'all');
  }

  private showScopeModal(response: RsvpResponse): void {
    const ref = this.dialogService.open(RsvpScopeModalComponent, {
      header: 'RSVP Scope',
      width: '500px',
      data: {
        response: this.formatResponse(response),
      },
    });

    ref.onClose.subscribe((result: { confirmed: boolean; scope?: RsvpScope }) => {
      if (result?.confirmed && result.scope) {
        this.submitRsvp(response, result.scope);
      }
    });
  }

  private submitRsvp(response: RsvpResponse, scope: RsvpScope): void {
    const currentUser = this.user();

    this.isLoading.set(true);

    const request: CreateMeetingRsvpRequest = {
      response,
      scope,
      email: currentUser?.email,
    };

    // Add occurrence_id if scope is 'single'
    if ((scope === 'single' && this.occurrenceId()) || (scope === 'this_and_following' && this.occurrenceId())) {
      request.occurrence_id = this.occurrenceId();
    }

    this.meetingService
      .createMeetingRsvp(this.meetingUid(), request)
      .pipe(
        tap((rsvp: MeetingRsvp) => {
          // Success - emit the updated RSVP
          this.rsvpChanged.emit(rsvp);
          this.messageService.add({
            severity: 'success',
            summary: 'RSVP Updated',
            detail: `You have responded "${this.formatResponse(response)}" for this meeting.`,
            life: 3000,
          });
          // Trigger refresh to fetch updated RSVP
          this.refreshTrigger.set(this.refreshTrigger() + 1);
        }),
        catchError((error: HttpErrorResponse) => {
          let errorMessage = 'Failed to update RSVP. Please try again.';

          if (error.status === 404) {
            errorMessage = 'Only invited users are allowed to RSVP to this meeting.';
          } else if (error?.error?.error) {
            errorMessage = error.error.error;
          }

          this.messageService.add({
            severity: 'error',
            summary: 'RSVP Failed',
            detail: errorMessage,
            life: 5000,
          });
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
        return 'Yes';
      case 'declined':
        return 'No';
      case 'maybe':
        return 'Maybe';
      default:
        return response;
    }
  }

  private initializeMeetingUid(): Signal<string> {
    return computed(() => this.meeting().uid);
  }

  private initializeIsRecurring(): Signal<boolean> {
    return computed(() => !!this.meeting().recurrence);
  }

  private initializeCurrentRsvp(): Signal<MeetingRsvp | null> {
    return toSignal(
      combineLatest([toObservable(this.meeting), toObservable(this.authenticated), toObservable(this.refreshTrigger)]).pipe(
        switchMap(([meeting, authenticated]) => {
          const occurrenceId = this.meeting().recurrence ? this.occurrenceId() : undefined;
          if (authenticated && meeting?.uid) {
            return this.meetingService.getMeetingRsvpByUsername(meeting.uid, occurrenceId).pipe(catchError(() => of(null)));
          }
          return of(null);
        })
      ),
      { initialValue: null }
    );
  }

  private initializeSelectedResponse(): Signal<RsvpResponse | null> {
    return computed(() => this.currentRsvp()?.response ?? null);
  }
}
