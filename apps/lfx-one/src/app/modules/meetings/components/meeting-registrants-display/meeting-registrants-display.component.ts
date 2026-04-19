// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, InputSignal, output, OutputEmitterRef, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import { Meeting, MeetingRegistrant, PastMeeting, PastMeetingParticipant } from '@lfx-one/shared';
import { markFormControlsAsTouched } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, catchError, debounceTime, filter, finalize, map, of, pairwise, startWith, switchMap, take, tap } from 'rxjs';

import { RegistrantFormComponent } from '../registrant-form/registrant-form.component';

@Component({
  selector: 'lfx-meeting-registrants-display',
  imports: [AvatarComponent, ButtonComponent, TooltipModule, ReactiveFormsModule, RegistrantFormComponent, SelectComponent, NgClass],
  templateUrl: './meeting-registrants-display.component.html',
})
export class MeetingRegistrantsDisplayComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly meeting: InputSignal<Meeting | PastMeeting> = input.required<Meeting | PastMeeting>();
  public readonly pastMeeting: InputSignal<boolean> = input<boolean>(false);
  public readonly visible: InputSignal<boolean> = input<boolean>(false);
  public readonly showAddRegistrant: InputSignal<boolean> = input<boolean>(false);
  public readonly myMeetingRegistrants: InputSignal<boolean> = input<boolean>(false);

  public readonly registrantsCountChange: OutputEmitterRef<number> = output<number>();

  public readonly registrantsLoading: WritableSignal<boolean> = signal(true);
  private readonly refresh$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public readonly registrants: Signal<MeetingRegistrant[]> = this.initRegistrantsList();
  public readonly pastMeetingParticipants: Signal<PastMeetingParticipant[]> = this.initPastMeetingParticipantsList();
  public readonly additionalRegistrantsCount: WritableSignal<number> = signal(0);
  public readonly showAddForm = signal(false);
  public readonly submitting = signal(false);

  // Add registrant form
  public addRegistrantForm: FormGroup;

  // Search and filter controls
  public readonly searchControl: FormControl<string> = new FormControl<string>('', { nonNullable: true });
  public readonly rsvpFilterControl: FormControl<string> = new FormControl<string>('all', { nonNullable: true });
  public readonly groupFilterControl: FormControl<string> = new FormControl<string>('all', { nonNullable: true });
  public readonly filterForm: FormGroup = new FormGroup({
    rsvpFilter: this.rsvpFilterControl,
    groupFilter: this.groupFilterControl,
  });

  // Filter options
  public readonly rsvpFilterOptions = [
    { label: 'All RSVPs', value: 'all' },
    { label: 'Accepted', value: 'yes' },
    { label: 'Declined', value: 'no' },
    { label: 'Pending', value: 'pending' },
  ];

  // Group (Committee) filter options computed from meeting committees
  public readonly groupFilterOptions = this.initGroupFilterOptions();

  // Check if meeting has committees
  public readonly hasCommittees = this.initHasCommittees();

  // Search query signal from form control
  public readonly searchQuery: Signal<string> = toSignal(this.searchControl.valueChanges.pipe(startWith(''), debounceTime(300)), { initialValue: '' });

  // Filter signals from form controls
  public readonly rsvpFilter: Signal<string> = toSignal(this.rsvpFilterControl.valueChanges.pipe(startWith('all')), { initialValue: 'all' });
  public readonly groupFilter: Signal<string> = toSignal(this.groupFilterControl.valueChanges.pipe(startWith('all')), { initialValue: 'all' });

  // Filtered registrants based on search and filters
  public readonly filteredRegistrants = this.initFilteredRegistrants();

  // Filtered past meeting participants based on search
  public readonly filteredPastParticipants = this.initFilteredPastParticipants();

  public constructor() {
    this.addRegistrantForm = this.meetingService.createRegistrantFormGroup(false);

    effect(() => {
      if (this.visible()) {
        this.registrantsLoading.set(true);
        this.refresh$.next(true);
      }
    });

    // Reset inline add form when drawer closes (open → closed transition)
    toObservable(this.visible)
      .pipe(
        pairwise(),
        filter(([prev, curr]) => prev && !curr),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.showAddForm.set(false);
        this.addRegistrantForm.reset();
      });
  }

  // === Public Methods ===
  public refresh(): void {
    this.refresh$.next(true);
  }

  public toggleAddForm(): void {
    const isShowing = this.showAddForm();
    this.showAddForm.set(!isShowing);
    if (isShowing) {
      this.addRegistrantForm.reset();
    }
  }

  public onAddRegistrant(): void {
    if (this.submitting()) return;

    if (this.addRegistrantForm.valid) {
      this.submitting.set(true);
      const formValue = this.addRegistrantForm.value;
      const createData = this.meetingService.stripMetadata(this.meeting().id, formValue);

      this.meetingService
        .addMeetingRegistrants(this.meeting().id, [createData])
        .pipe(take(1))
        .subscribe({
          next: (response) => {
            this.submitting.set(false);
            if (response.summary.successful > 0) {
              this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Guest added successfully' });
              // Immediately increment the count for UI feedback (query service indexing is async)
              this.additionalRegistrantsCount.update((c) => c + response.summary.successful);
              this.registrantsCountChange.emit(this.additionalRegistrantsCount());
              this.refresh$.next(true);
              this.addRegistrantForm.reset();
            } else {
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: response.failures[0]?.error?.message || 'Failed to add guest',
              });
            }
          },
          error: () => {
            this.submitting.set(false);
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to add guest. Please try again.' });
          },
        });
    } else {
      markFormControlsAsTouched(this.addRegistrantForm);
    }
  }

  public onUserSelectedFromSearch(): void {
    this.onAddRegistrant();
  }

  private initRegistrantsList(): Signal<MeetingRegistrant[]> {
    return toSignal(
      toObservable(this.myMeetingRegistrants).pipe(
        takeUntilDestroyed(),
        switchMap((useMyEndpoint) =>
          this.refresh$.pipe(
            filter((refresh) => refresh && !this.pastMeeting()),
            switchMap(() => {
              this.registrantsLoading.set(true);
              // Use access-controlled endpoint for meeting join page, regular endpoint for organizer views
              const registrantsObservable = useMyEndpoint
                ? this.meetingService.getMyMeetingRegistrants(this.meeting().id, true)
                : this.meetingService.getMeetingRegistrants(this.meeting().id, true);

              return registrantsObservable.pipe(
                catchError(() => of([])),
                map((registrants) => registrants.sort((a, b) => a.first_name?.localeCompare(b.first_name ?? '') ?? 0) as MeetingRegistrant[]),
                tap((registrants) => {
                  const baseCount = (this.meeting().individual_registrants_count || 0) + (this.meeting().committee_members_count || 0);
                  const fetchedAdditional = Math.max(0, (registrants?.length || 0) - baseCount);
                  // Never decrease below the current optimistic count (async indexing may lag)
                  const additionalCount = Math.max(fetchedAdditional, this.additionalRegistrantsCount());
                  this.additionalRegistrantsCount.set(additionalCount);
                  this.registrantsCountChange.emit(additionalCount);
                }),
                finalize(() => this.registrantsLoading.set(false))
              );
            })
          )
        )
      ),
      { initialValue: [] }
    );
  }

  private initPastMeetingParticipantsList(): Signal<PastMeetingParticipant[]> {
    return toSignal(
      this.refresh$.pipe(
        takeUntilDestroyed(),
        filter((refresh) => refresh && this.pastMeeting()),
        switchMap(() => {
          this.registrantsLoading.set(true);
          return this.meetingService
            .getPastMeetingParticipants(this.meeting().id)
            .pipe(catchError(() => of([])))
            .pipe(
              map((participants) => participants.sort((a, b) => a.first_name?.localeCompare(b.first_name ?? '') ?? 0) as PastMeetingParticipant[]),
              finalize(() => this.registrantsLoading.set(false))
            );
        })
      ),
      { initialValue: [] }
    );
  }

  private initGroupFilterOptions() {
    return computed(() => {
      const meeting = this.meeting();
      const committees = (meeting as Meeting).committees || [];

      const options = [{ label: 'All Groups', value: 'all' }];

      committees.forEach((committee) => {
        if (committee.name) {
          options.push({ label: committee.name, value: committee.uid });
        }
      });

      return options;
    });
  }

  private initHasCommittees() {
    return computed(() => {
      const meeting = this.meeting();
      return ((meeting as Meeting).committees?.length || 0) > 0;
    });
  }

  private initFilteredRegistrants() {
    return computed(() => {
      const registrants = this.registrants();
      const query = this.searchQuery().toLowerCase().trim();
      const rsvp = this.rsvpFilter();
      const group = this.groupFilter();

      return registrants.filter((registrant) => {
        // Search filter
        const matchesSearch =
          !query ||
          registrant.first_name?.toLowerCase().includes(query) ||
          registrant.last_name?.toLowerCase().includes(query) ||
          registrant.email?.toLowerCase().includes(query) ||
          registrant.org_name?.toLowerCase().includes(query);

        // RSVP filter (must match display logic in template)
        let matchesRsvp = true;
        if (rsvp !== 'all') {
          if (rsvp === 'yes') {
            // Accepted: rsvp.response_type === 'accepted' OR invite_accepted === true
            matchesRsvp = registrant.rsvp?.response_type === 'accepted' || registrant.invite_accepted === true;
          } else if (rsvp === 'no') {
            // Declined: rsvp.response_type === 'declined' OR invite_accepted === false
            matchesRsvp = registrant.rsvp?.response_type === 'declined' || registrant.invite_accepted === false;
          } else if (rsvp === 'pending') {
            // Pending: NOT accepted AND NOT declined (includes maybe and no response)
            const isAccepted = registrant.rsvp?.response_type === 'accepted' || registrant.invite_accepted === true;
            const isDeclined = registrant.rsvp?.response_type === 'declined' || registrant.invite_accepted === false;
            matchesRsvp = !isAccepted && !isDeclined;
          }
        }

        // Group (Committee) filter
        const matchesGroup = group === 'all' || registrant.committee_uid === group;

        return matchesSearch && matchesRsvp && matchesGroup;
      });
    });
  }

  private initFilteredPastParticipants() {
    return computed(() => {
      const participants = this.pastMeetingParticipants();
      const query = this.searchQuery().toLowerCase().trim();

      if (!query) {
        return participants;
      }

      return participants.filter(
        (participant) =>
          participant.first_name?.toLowerCase().includes(query) ||
          participant.last_name?.toLowerCase().includes(query) ||
          participant.email?.toLowerCase().includes(query)
      );
    });
  }
}
