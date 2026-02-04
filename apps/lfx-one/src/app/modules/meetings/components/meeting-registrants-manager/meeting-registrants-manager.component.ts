// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, OnInit, output, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { FeatureToggleComponent } from '@components/feature-toggle/feature-toggle.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { COMMITTEE_LABEL, SHOW_MEETING_ATTENDEES_FEATURE } from '@lfx-one/shared/constants';
import { CommitteeMember, MeetingRegistrant, MeetingRegistrantWithState, RegistrantPendingChanges, RegistrantState } from '@lfx-one/shared/interfaces';
import { generateTempId } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { BehaviorSubject, catchError, finalize, of, take, tap } from 'rxjs';

import { MeetingCommitteeManagerComponent } from '../meeting-committee-manager/meeting-committee-manager.component';
import { RegistrantCardComponent } from '../registrant-card/registrant-card.component';
import { RegistrantFormComponent } from '../registrant-form/registrant-form.component';

@Component({
  selector: 'lfx-meeting-registrants-manager',
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    FeatureToggleComponent,
    InputTextComponent,
    MeetingCommitteeManagerComponent,
    SelectComponent,
    ConfirmDialogModule,
    RegistrantCardComponent,
    RegistrantFormComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './meeting-registrants-manager.component.html',
})
export class MeetingRegistrantsManagerComponent implements OnInit {
  // Injected services
  private readonly meetingService = inject(MeetingService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

  // Input signals
  public meetingUid = input.required<string>();
  public form = input.required<FormGroup>();
  public registrantUpdates = input.required<RegistrantPendingChanges>();
  public refresh = input.required<BehaviorSubject<void>>();

  // Show meeting attendees feature from shared constants
  public readonly showMeetingAttendeesFeature = SHOW_MEETING_ATTENDEES_FEATURE;

  // Output events for two-way binding
  public readonly registrantUpdatesChange = output<RegistrantPendingChanges>();

  // Writable signals for state management
  public registrantsWithState: WritableSignal<MeetingRegistrantWithState[]> = signal([]);
  public loading: WritableSignal<boolean> = signal(true);
  public editingRegistrantId = signal<string | null>(null);
  public searchTerm = signal<string>('');
  public statusFilter = signal<string | null>(null);

  // Simple computed signals
  public readonly visibleRegistrants = computed(() => this.registrantsWithState().filter((r) => r.state !== 'deleted'));
  public readonly registrantCount = computed(() => this.visibleRegistrants().length);
  public readonly hostCount = computed(() => this.visibleRegistrants().filter((r) => r.host).length);
  public readonly memberCount = computed(() => this.visibleRegistrants().filter((r) => r.org_is_member).length);
  public readonly committeeMemberCount = computed(() => this.visibleRegistrants().filter((r) => r.type === 'committee').length);
  public readonly directGuestCount = computed(() => this.visibleRegistrants().filter((r) => r.type === 'direct').length);

  // Complex computed signals (using private initializers)
  public readonly registrants = signal<MeetingRegistrant[]>([]);
  public readonly filteredRegistrants = this.initFilteredRegistrants();

  // Form instances (initialized in constructor)
  public searchForm: FormGroup;
  public addRegistrantForm: FormGroup;

  // Static configuration
  public statusOptions = [
    { label: 'All Guests', value: null },
    { label: 'Hosts Only', value: 'host' },
    { label: COMMITTEE_LABEL.singular + ' Members', value: 'committee' },
    { label: 'Direct Guests Only', value: 'direct' },
  ];

  public constructor() {
    this.searchForm = new FormGroup({
      search: new FormControl(''),
      status: new FormControl(null),
    });

    this.addRegistrantForm = this.meetingService.createRegistrantFormGroup();

    // Subscribe to form changes and update signals
    this.searchForm
      .get('search')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.searchTerm.set(value || '');
      });

    this.searchForm
      .get('status')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.statusFilter.set(value);
      });
  }

  public ngOnInit(): void {
    this.initializeRegistrants();

    this.refresh()
      ?.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.initializeRegistrants();
      });
  }

  public onCancelEdit(): void {
    this.editingRegistrantId.set(null);
  }

  // Action handlers
  public onAddRegistrant(): void {
    if (this.addRegistrantForm.valid) {
      this.addRegistrantFromForm();
    }
  }

  /**
   * Handle user selection from search - add user directly to guest list
   */
  public onUserSelectedFromSearch(): void {
    if (this.addRegistrantForm.valid) {
      this.addRegistrantFromForm();
    }
  }

  // Simplified registrant event handlers (only receive validated data)
  public handleRegistrantUpdate(updateData: { id: string; data: MeetingRegistrant }): void {
    this.registrantsWithState.update((registrants) =>
      registrants.map((r) => {
        if (r.uid === updateData.id || r.tempId === updateData.id) {
          return {
            ...updateData.data,
            state: r.state === 'existing' ? ('modified' as RegistrantState) : r.state,
            originalData: r.originalData,
            tempId: r.tempId,
          } as MeetingRegistrantWithState;
        }
        return r;
      })
    );

    // Emit updated registrant updates using the conversion logic
    this.emitRegistrantUpdates();
  }

  public handleRegistrantDelete(id: string): void {
    this.confirmationService.confirm({
      message: 'Are you sure you want to remove this guest from the meeting?',
      header: 'Remove Guest',
      icon: 'fa-light fa-triangle-exclamation',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm',
      accept: () => {
        this.registrantsWithState.update(
          (registrants) =>
            registrants
              .map((r) => {
                if (r.uid === id || r.tempId === id) {
                  if (r.state === 'new') {
                    // For new registrants, remove completely
                    return null;
                  }
                  // For existing registrants, mark as deleted
                  return { ...r, state: 'deleted' as RegistrantState };
                }
                return r;
              })
              .filter(Boolean) as MeetingRegistrantWithState[]
        );

        // Emit updated registrant updates using the conversion logic
        this.emitRegistrantUpdates();
      },
    });
  }

  /**
   * Handle committee members change - sync committee members with registrants list
   */
  public onCommitteeMembersChange(members: CommitteeMember[]): void {
    this.registrantsWithState.update((registrants) => {
      // Remove all existing committee members (they'll be replaced with the new list)
      const nonCommitteeRegistrants = registrants.filter((r) => r.type !== 'committee');

      // Convert committee members to MeetingRegistrantWithState
      const committeeRegistrants: MeetingRegistrantWithState[] = members.map((member) => ({
        uid: '', // Will be assigned by API when meeting is saved
        meeting_uid: this.meetingUid(),
        occurrence_id: null,
        email: member.email,
        first_name: member.first_name,
        last_name: member.last_name,
        job_title: member.job_title || null,
        org_name: member.organization?.name || null,
        host: false,
        org_is_member: false,
        org_is_project_member: false,
        avatar_url: null,
        username: member.username || null,
        linkedin_profile: member.linkedin_profile || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        type: 'committee' as const,
        committee_uid: member.committee_uid,
        committee_name: member.committee_name,
        committee_role: member.role?.name || null,
        committee_voting_status: member.voting?.status || null,
        invite_accepted: null,
        attended: null,
        state: 'new' as RegistrantState,
        tempId: generateTempId(),
        originalData: undefined,
      }));

      // Return non-committee registrants first, then committee members
      return [...nonCommitteeRegistrants, ...committeeRegistrants];
    });
  }

  /**
   * Common method to add a registrant from the form values
   */
  private addRegistrantFromForm(): void {
    const formValue = this.addRegistrantForm.value;

    // Build complete MeetingRegistrant object
    const registrantData: MeetingRegistrant = {
      uid: '', // Will be assigned by API
      meeting_uid: this.meetingUid(),
      occurrence_id: null,
      email: formValue.email,
      first_name: formValue.first_name,
      last_name: formValue.last_name,
      job_title: formValue.job_title || null,
      org_name: formValue.org_name || null,
      host: formValue.host || false,
      org_is_member: false,
      org_is_project_member: false,
      avatar_url: null,
      username: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      type: 'direct',
      invite_accepted: null,
      attended: null,
      linkedin_profile: formValue.linkedin_profile || null,
    };

    // Create new registrant with temporary ID for immediate UI updates
    const newRegistrant: MeetingRegistrantWithState = {
      ...registrantData,
      meeting_uid: this.meetingUid(),
      uid: '', // Will be assigned by API
      state: 'new' as RegistrantState,
      tempId: generateTempId(),
      originalData: undefined,
    };

    // Add to local state at the top for immediate UI feedback
    this.registrantsWithState.update((registrants) => [newRegistrant, ...registrants]);

    // Emit updated registrant updates using the conversion logic
    this.emitRegistrantUpdates();

    // Reset form
    this.addRegistrantForm.reset();
  }

  private initFilteredRegistrants() {
    return computed(() => {
      let filtered = this.visibleRegistrants();
      const search = this.searchTerm().toLowerCase();
      const status = this.statusFilter();

      // Apply search filter
      if (search) {
        filtered = filtered.filter(
          (registrant) =>
            registrant.first_name?.toLowerCase().includes(search) ||
            registrant.last_name?.toLowerCase().includes(search) ||
            registrant.email?.toLowerCase().includes(search) ||
            registrant.org_name?.toLowerCase().includes(search) ||
            registrant.committee_name?.toLowerCase().includes(search)
        );
      }

      // Apply status filter
      if (status) {
        switch (status) {
          case 'host':
            filtered = filtered.filter((r) => r.host);
            break;
          case 'committee':
            filtered = filtered.filter((r) => r.type === 'committee');
            break;
          case 'direct':
            filtered = filtered.filter((r) => r.type === 'direct');
            break;
        }
      }

      return filtered;
    });
  }

  private createRegistrantWithState(registrant: MeetingRegistrant, state: RegistrantState = 'existing'): MeetingRegistrantWithState {
    return {
      ...registrant,
      state: state,
      originalData: state === 'existing' ? { ...registrant } : undefined,
      tempId: state === 'new' ? generateTempId() : undefined,
    };
  }

  private initializeRegistrants(): void {
    const uid = this.meetingUid();
    if (!uid) return;

    this.meetingService
      .getMeetingRegistrants(uid, false)
      .pipe(
        take(1),
        catchError((error) => {
          console.error('Error', error);
          return of([]);
        }),
        finalize(() => {
          this.loading.set(false);
        }),
        tap((registrants) => {
          if (!registrants || registrants.length === 0) {
            this.registrantsWithState.set([]);
            return;
          }

          this.registrantsWithState.set(registrants.map((r) => this.createRegistrantWithState(r, 'existing')));
        })
      )
      .subscribe();
  }

  // Reuse the conversion logic from onRegistrantsUpdate
  private emitRegistrantUpdates(): void {
    const registrants = this.registrantsWithState();
    this.registrantUpdatesChange.emit({
      toAdd: registrants.filter((r) => r.state === 'new').map((r) => this.meetingService.stripMetadata(this.meetingUid(), r)),
      toUpdate: registrants
        .filter((r) => r.state === 'modified')
        .map((r) => ({
          uid: r.uid,
          changes: this.meetingService.getChangedFields(r),
        })),
      toDelete: registrants.filter((r) => r.state === 'deleted').map((r) => r.uid),
    });
  }
}
