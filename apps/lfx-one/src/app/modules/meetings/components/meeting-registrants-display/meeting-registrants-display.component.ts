// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, InputSignal, output, OutputEmitterRef, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { BadgeComponent } from '@components/badge/badge.component';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import {
  CommitteeMember,
  EnrichedPastMeetingParticipant,
  Meeting,
  MeetingHostCandidate,
  MeetingRegistrant,
  PastMeeting,
  PastMeetingParticipant,
  PastParticipantAttendanceFilter,
  PastParticipantInvitationFilter,
} from '@lfx-one/shared/interfaces';
import {
  compareMeetingPeopleByHostThenName,
  filterPastMeetingParticipants,
  getPastMeetingResourceId,
  markFormControlsAsTouched,
  resolveMeetingBaseCount,
} from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, catchError, combineLatest, debounceTime, filter, finalize, map, of, pairwise, startWith, switchMap, take, tap } from 'rxjs';

import { RegistrantFormComponent } from '../registrant-form/registrant-form.component';

@Component({
  selector: 'lfx-meeting-registrants-display',
  imports: [AvatarComponent, BadgeComponent, ButtonComponent, TooltipModule, ReactiveFormsModule, RegistrantFormComponent, SelectComponent, NgTemplateOutlet],
  templateUrl: './meeting-registrants-display.component.html',
})
export class MeetingRegistrantsDisplayComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly committeeService = inject(CommitteeService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly meeting: InputSignal<Meeting | PastMeeting> = input.required<Meeting | PastMeeting>();
  public readonly pastMeeting: InputSignal<boolean> = input<boolean>(false);
  public readonly visible: InputSignal<boolean> = input<boolean>(false);
  public readonly showAddRegistrant: InputSignal<boolean> = input<boolean>(false);
  public readonly myMeetingRegistrants: InputSignal<boolean> = input<boolean>(false);
  public readonly initialRegistrants: InputSignal<MeetingRegistrant[] | null> = input<MeetingRegistrant[] | null>(null);
  public readonly initialRegistrantsLoading: InputSignal<boolean> = input<boolean>(false);

  public readonly registrantsCountChange: OutputEmitterRef<number> = output<number>();
  public readonly refreshRequested: OutputEmitterRef<number> = output<number>();
  public readonly totalCountChange: OutputEmitterRef<number> = output<number>();
  // Emits the host-flagged people (the organizer set) whenever the list resolves, so a parent
  // can feed the same set to the shared "Organized by" chip — keeping chip and modal in agreement.
  public readonly resolvedHostsChange: OutputEmitterRef<MeetingHostCandidate[]> = output<MeetingHostCandidate[]>();

  private readonly internalLoading: WritableSignal<boolean> = signal(true);
  private readonly refresh$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  private readonly optimisticRegistrants: WritableSignal<MeetingRegistrant[]> = signal<MeetingRegistrant[]>([]);
  private readonly externallyManaged: Signal<boolean> = computed(() => this.initialRegistrants() !== null);
  private readonly internalRegistrants: Signal<MeetingRegistrant[]> = this.initRegistrantsList();
  public readonly pastMeetingParticipants: Signal<EnrichedPastMeetingParticipant[]> = this.initPastMeetingParticipantsList();
  public readonly registrants: Signal<MeetingRegistrant[]> = this.initRegistrants();
  public readonly registrantsLoading: Signal<boolean> = computed(() => {
    if (this.externallyManaged() && !this.pastMeeting()) {
      return this.initialRegistrantsLoading();
    }
    return this.internalLoading();
  });
  public readonly additionalRegistrantsCount: WritableSignal<number> = signal(0);
  public readonly showAddForm = signal(false);
  public readonly submitting = signal(false);

  // Add registrant form
  public addRegistrantForm: FormGroup;

  // Search and filter controls
  public readonly searchControl: FormControl<string> = new FormControl<string>('', { nonNullable: true });
  public readonly rsvpFilterControl: FormControl<string> = new FormControl<string>('all', { nonNullable: true });
  public readonly groupFilterControl: FormControl<string> = new FormControl<string>('all', { nonNullable: true });
  // Past-meeting-only controls — past participants carry attendance/invitation, not RSVP responses.
  public readonly attendanceFilterControl: FormControl<PastParticipantAttendanceFilter> = new FormControl<PastParticipantAttendanceFilter>('all', {
    nonNullable: true,
  });
  public readonly invitationFilterControl: FormControl<PastParticipantInvitationFilter> = new FormControl<PastParticipantInvitationFilter>('all', {
    nonNullable: true,
  });
  public readonly filterForm: FormGroup = new FormGroup({
    rsvpFilter: this.rsvpFilterControl,
    groupFilter: this.groupFilterControl,
    attendanceFilter: this.attendanceFilterControl,
    invitationFilter: this.invitationFilterControl,
  });

  // Filter options
  public readonly rsvpFilterOptions = [
    { label: 'All RSVPs', value: 'all' },
    { label: 'Accepted', value: 'yes' },
    { label: 'Declined', value: 'no' },
    { label: 'Pending', value: 'pending' },
  ];

  // Past-meeting attendance / invitation options (mirror the past-meeting-details filters)
  public readonly attendanceFilterOptions = [
    { label: 'All Attendees', value: 'all' },
    { label: 'Attended', value: 'attended' },
    { label: 'Did Not Attend', value: 'absent' },
  ];
  public readonly invitationFilterOptions = [
    { label: 'All Invites', value: 'all' },
    { label: 'Invited', value: 'invited' },
    { label: 'Not Invited', value: 'uninvited' },
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
  public readonly attendanceFilter: Signal<PastParticipantAttendanceFilter> = toSignal(
    this.attendanceFilterControl.valueChanges.pipe(startWith('all' as const)),
    {
      initialValue: 'all',
    }
  );
  public readonly invitationFilter: Signal<PastParticipantInvitationFilter> = toSignal(
    this.invitationFilterControl.valueChanges.pipe(startWith('all' as const)),
    {
      initialValue: 'all',
    }
  );

  // Filtered registrants based on search and filters
  public readonly filteredRegistrants = this.initFilteredRegistrants();

  // Committee (board) and direct registrant sections for the two-section layout
  public readonly committeeFilteredRegistrants = computed(() => this.filteredRegistrants().filter((r) => r.type === 'committee'));
  public readonly directFilteredRegistrants = computed(() => this.filteredRegistrants().filter((r) => r.type !== 'committee'));

  // Filtered past meeting participants based on search
  public readonly filteredPastParticipants = this.initFilteredPastParticipants();

  // Host-flagged people (the organizer set) derived from whichever list is active.
  private readonly resolvedHosts: Signal<MeetingHostCandidate[]> = computed(() =>
    (this.pastMeeting() ? this.pastMeetingParticipants() : this.registrants()).filter((person) => person.host)
  );

  public constructor() {
    this.addRegistrantForm = this.meetingService.createRegistrantFormGroup(false);

    // Surface the host-flagged people to the parent so the "Organized by" chip and this modal
    // resolve organizers from the same source.
    toObservable(this.resolvedHosts)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((hosts) => this.resolvedHostsChange.emit(hosts));

    effect(() => {
      if (!this.visible()) return;
      // Past-meeting participants always self-fetch.
      if (this.pastMeeting()) {
        this.internalLoading.set(true);
        this.refresh$.next(true);
        return;
      }
      // Externally-managed: parent owns the registrants list, no internal fetch needed.
      if (this.externallyManaged()) return;
      this.internalLoading.set(true);
      this.refresh$.next(true);
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
        this.optimisticRegistrants.set([]);
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
              if (this.externallyManaged()) {
                // Parent owns the data — request a refetch and let it bump its own optimistic count.
                this.refreshRequested.emit(response.summary.successful);
              } else {
                // Self-managed mode: optimistically add to the displayed list immediately
                // (query-service indexing is async; the refetch may not include them yet).
                const optimistic: MeetingRegistrant = {
                  uid: `optimistic-${crypto.randomUUID()}`,
                  meeting_id: this.meeting().id,
                  email: formValue.email ?? '',
                  first_name: formValue.first_name ?? '',
                  last_name: formValue.last_name ?? '',
                  host: formValue.host ?? false,
                  job_title: formValue.job_title || null,
                  org_name: formValue.org_name || null,
                  linkedin_profile: formValue.linkedin_profile || null,
                  occurrence_id: null,
                  org_is_member: false,
                  org_is_project_member: false,
                  avatar_url: null,
                  username: null,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  type: 'direct',
                  invite_accepted: null,
                  attended: null,
                };
                const meeting = this.meeting();
                const baseCount = resolveMeetingBaseCount(meeting) ?? this.internalRegistrants().length;
                const nextAdditionalCount = this.additionalRegistrantsCount() + response.summary.successful;
                this.optimisticRegistrants.update((list) => [...list, optimistic]);
                this.additionalRegistrantsCount.set(nextAdditionalCount);
                this.registrantsCountChange.emit(nextAdditionalCount);
                this.totalCountChange.emit(baseCount + nextAdditionalCount);
                this.refresh$.next(true);
              }
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
            // Skip when externally-managed (parent supplies the list) or when the meeting is past
            // (handled by initPastMeetingParticipantsList).
            filter((refresh) => refresh && !this.pastMeeting() && !this.externallyManaged()),
            switchMap(() => {
              this.internalLoading.set(true);
              // Use access-controlled endpoint for meeting join page, regular endpoint for organizer views
              const registrantsObservable = useMyEndpoint
                ? this.meetingService.getMyMeetingRegistrants(this.meeting().id, true)
                : this.meetingService.getMeetingRegistrants(this.meeting().id, true);

              return registrantsObservable.pipe(
                catchError(() => of([])),
                map((registrants) => registrants.sort((a, b) => compareMeetingPeopleByHostThenName(a, b)) as MeetingRegistrant[]),
                tap((registrants) => {
                  const meeting = this.meeting();
                  const resolvedBaseCount = resolveMeetingBaseCount(meeting);
                  const hasBackendBaseCount = resolvedBaseCount !== undefined;
                  const baseCount = hasBackendBaseCount ? resolvedBaseCount : (registrants?.length ?? 0);
                  const fetchedAdditional = Math.max(0, (registrants?.length ?? 0) - baseCount);
                  const additionalCount = hasBackendBaseCount ? Math.max(fetchedAdditional, this.additionalRegistrantsCount()) : fetchedAdditional;
                  this.additionalRegistrantsCount.set(additionalCount);
                  this.registrantsCountChange.emit(additionalCount);
                  this.totalCountChange.emit(baseCount + additionalCount);
                }),
                finalize(() => this.internalLoading.set(false))
              );
            })
          )
        )
      ),
      { initialValue: [] }
    );
  }

  private initPastMeetingParticipantsList(): Signal<EnrichedPastMeetingParticipant[]> {
    return toSignal(
      this.refresh$.pipe(
        takeUntilDestroyed(),
        filter((refresh) => refresh && this.pastMeeting()),
        switchMap(() => {
          this.internalLoading.set(true);
          const meeting = this.meeting();
          // Past participants carry no committee association — enrich them by joining the
          // meeting's committee members on email so the group filter has something to match.
          const committeeUids = ((meeting as Meeting).committees || []).map((committee) => committee.uid).filter(Boolean);
          const committeeMembers$ = committeeUids.length
            ? combineLatest(
                committeeUids.map((uid) => this.committeeService.getCommitteeMembers(uid).pipe(catchError(() => of([] as CommitteeMember[]))))
              ).pipe(map((memberLists) => memberLists.flat()))
            : of([] as CommitteeMember[]);

          return combineLatest([
            // Use the canonical occurrence resource id — project/foundation past cards can carry a
            // distinct meeting.id, which would otherwise fail-soft to [] (empty organizer set).
            this.meetingService.getPastMeetingParticipants(getPastMeetingResourceId(meeting)).pipe(catchError(() => of([] as PastMeetingParticipant[]))),
            committeeMembers$,
          ]).pipe(
            map(([participants, committeeMembers]) => {
              // A participant can sit on multiple committees, so group all member records by
              // email rather than keeping a single last-wins entry. committeeMembers is already
              // ordered by the meeting's committee order, so the first record is the primary one.
              const membersByEmail = new Map<string, CommitteeMember[]>();
              for (const member of committeeMembers) {
                const key = member.email?.trim().toLowerCase();
                if (!key) continue;
                const existing = membersByEmail.get(key);
                if (existing) {
                  existing.push(member);
                } else {
                  membersByEmail.set(key, [member]);
                }
              }
              return participants
                .map((participant) => {
                  const members = membersByEmail.get(participant.email?.trim().toLowerCase()) ?? [];
                  const primary = members[0];
                  const enriched: EnrichedPastMeetingParticipant = {
                    ...participant,
                    committee_uids: members.map((member) => member.committee_uid).filter(Boolean),
                    committee_name: primary?.committee_name ?? null,
                    committee_role: primary?.role?.name ?? null,
                    committee_voting_status: primary?.voting?.status ?? null,
                    committee_category: primary?.committee_category ?? null,
                  };
                  return enriched;
                })
                .sort((a, b) => compareMeetingPeopleByHostThenName(a, b));
            }),
            finalize(() => this.internalLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initRegistrants(): Signal<MeetingRegistrant[]> {
    return computed(() => {
      let list: MeetingRegistrant[];
      if (this.externallyManaged()) {
        const seed = this.initialRegistrants() ?? [];
        list = [...seed].sort((a, b) => compareMeetingPeopleByHostThenName(a, b)) as MeetingRegistrant[];
      } else {
        list = this.internalRegistrants();
      }
      const fetchedEmails = new Set(list.map((r) => r.email?.trim().toLowerCase()));
      const pending = this.optimisticRegistrants().filter((r) => !fetchedEmails.has(r.email?.trim().toLowerCase()));
      return pending.length ? ([...pending, ...list].sort((a, b) => compareMeetingPeopleByHostThenName(a, b)) as MeetingRegistrant[]) : list;
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
    return computed(() =>
      filterPastMeetingParticipants(this.pastMeetingParticipants(), {
        search: this.searchQuery(),
        attendance: this.attendanceFilter(),
        invitation: this.invitationFilter(),
        group: this.groupFilter(),
      })
    );
  }
}
