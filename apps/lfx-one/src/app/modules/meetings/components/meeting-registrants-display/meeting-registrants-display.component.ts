// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, effect, inject, input, InputSignal, output, OutputEmitterRef, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { SelectComponent } from '@components/select/select.component';
import { Meeting, MeetingRegistrant, PastMeeting, PastMeetingParticipant } from '@lfx-one/shared';
import { RegistrantModalComponent } from '@modules/meetings/components/registrant-modal/registrant-modal.component';
import { MeetingService } from '@services/meeting.service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, catchError, debounceTime, filter, finalize, map, of, startWith, switchMap, take, tap } from 'rxjs';

@Component({
  selector: 'lfx-meeting-registrants-display',
  imports: [AvatarComponent, TooltipModule, ReactiveFormsModule, SelectComponent, NgClass],
  templateUrl: './meeting-registrants-display.component.html',
})
export class MeetingRegistrantsDisplayComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly dialogService = inject(DialogService);

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

  // Search and filter controls
  public readonly searchControl: FormControl<string> = new FormControl<string>('', { nonNullable: true });
  public readonly rsvpFilterControl: FormControl<string> = new FormControl<string>('all', { nonNullable: true });
  public readonly roleFilterControl: FormControl<string> = new FormControl<string>('all', { nonNullable: true });
  public readonly groupFilterControl: FormControl<string> = new FormControl<string>('all', { nonNullable: true });
  public readonly filterForm: FormGroup = new FormGroup({
    rsvpFilter: this.rsvpFilterControl,
    roleFilter: this.roleFilterControl,
    groupFilter: this.groupFilterControl,
  });

  // Filter options
  public readonly rsvpFilterOptions = [
    { label: 'All RSVPs', value: 'all' },
    { label: 'Accepted', value: 'yes' },
    { label: 'Declined', value: 'no' },
    { label: 'Pending', value: 'pending' },
  ];

  // Role filter options computed from registrants
  public readonly roleFilterOptions = this.initRoleFilterOptions();

  // Group (Committee) filter options computed from meeting committees
  public readonly groupFilterOptions = this.initGroupFilterOptions();

  // Check if meeting has committees
  public readonly hasCommittees = this.initHasCommittees();

  // Search query signal from form control
  public readonly searchQuery: Signal<string> = toSignal(this.searchControl.valueChanges.pipe(startWith(''), debounceTime(300)), { initialValue: '' });

  // Filter signals from form controls
  public readonly rsvpFilter: Signal<string> = toSignal(this.rsvpFilterControl.valueChanges.pipe(startWith('all')), { initialValue: 'all' });
  public readonly roleFilter: Signal<string> = toSignal(this.roleFilterControl.valueChanges.pipe(startWith('all')), { initialValue: 'all' });
  public readonly groupFilter: Signal<string> = toSignal(this.groupFilterControl.valueChanges.pipe(startWith('all')), { initialValue: 'all' });

  // Filtered registrants based on search and filters
  public readonly filteredRegistrants = this.initFilteredRegistrants();

  // Filtered past meeting participants based on search
  public readonly filteredPastParticipants = this.initFilteredPastParticipants();

  public constructor() {
    effect(() => {
      if (this.visible()) {
        this.registrantsLoading.set(true);
        this.refresh$.next(true);
      }
    });
  }

  public onAddRegistrantClick(): void {
    const dialogRef = this.dialogService.open(RegistrantModalComponent, {
      header: 'Add Guests',
      width: '650px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: {
        meetingId: this.meeting().uid,
        registrant: null,
      },
    }) as DynamicDialogRef;

    dialogRef.onChildComponentLoaded.pipe(take(1)).subscribe((component) => {
      component.registrantSaved.subscribe(() => {
        this.refresh();
      });
    });
  }

  public refresh(): void {
    this.refresh$.next(true);
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
                ? this.meetingService.getMyMeetingRegistrants(this.meeting().uid, true)
                : this.meetingService.getMeetingRegistrants(this.meeting().uid, true);

              return registrantsObservable.pipe(
                catchError(() => of([])),
                map((registrants) => registrants.sort((a, b) => a.first_name?.localeCompare(b.first_name ?? '') ?? 0) as MeetingRegistrant[]),
                tap((registrants) => {
                  const baseCount = (this.meeting().individual_registrants_count || 0) + (this.meeting().committee_members_count || 0);
                  const additionalCount = Math.max(0, (registrants?.length || 0) - baseCount);
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
            .getPastMeetingParticipants(this.meeting().uid)
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

  private initRoleFilterOptions() {
    return computed(() => {
      const registrants = this.registrants();
      const roles = new Set<string>();

      registrants.forEach((registrant) => {
        if (registrant.committee_role) {
          roles.add(registrant.committee_role);
        }
      });

      const options = [{ label: 'All Roles', value: 'all' }];
      Array.from(roles)
        .sort()
        .forEach((role) => {
          options.push({ label: role, value: role });
        });

      return options;
    });
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
      const role = this.roleFilter();
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
            // Accepted: rsvp.response === 'accepted' OR invite_accepted === true
            matchesRsvp = registrant.rsvp?.response === 'accepted' || registrant.invite_accepted === true;
          } else if (rsvp === 'no') {
            // Declined: rsvp.response === 'declined' OR invite_accepted === false
            matchesRsvp = registrant.rsvp?.response === 'declined' || registrant.invite_accepted === false;
          } else if (rsvp === 'pending') {
            // Pending: NOT accepted AND NOT declined (includes maybe and no response)
            const isAccepted = registrant.rsvp?.response === 'accepted' || registrant.invite_accepted === true;
            const isDeclined = registrant.rsvp?.response === 'declined' || registrant.invite_accepted === false;
            matchesRsvp = !isAccepted && !isDeclined;
          }
        }

        // Role filter
        const matchesRole = role === 'all' || registrant.committee_role === role;

        // Group (Committee) filter
        const matchesGroup = group === 'all' || registrant.committee_uid === group;

        return matchesSearch && matchesRsvp && matchesRole && matchesGroup;
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
