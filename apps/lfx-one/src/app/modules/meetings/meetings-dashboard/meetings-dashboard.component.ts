// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MeetingCardComponent } from '@app/modules/meetings/components/meeting-card/meeting-card.component';
import { ButtonComponent } from '@components/button/button.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { MEETING_TYPE_CONFIGS } from '@lfx-one/shared/constants';
import { Meeting, PastMeeting, ProjectContext } from '@lfx-one/shared/interfaces';
import { getCurrentOrNextOccurrence, hasMeetingEnded } from '@lfx-one/shared/utils';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { BehaviorSubject, catchError, combineLatest, finalize, map, of, switchMap } from 'rxjs';

import { MeetingsTopBarComponent } from './components/meetings-top-bar/meetings-top-bar.component';

@Component({
  selector: 'lfx-meetings-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MeetingCardComponent, MeetingsTopBarComponent, ButtonComponent, SelectButtonComponent],
  templateUrl: './meetings-dashboard.component.html',
  styleUrl: './meetings-dashboard.component.scss',
})
export class MeetingsDashboardComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);
  private readonly featureFlagService = inject(FeatureFlagService);

  public meetingsLoading: WritableSignal<boolean>;
  public pastMeetingsLoading: WritableSignal<boolean>;
  public upcomingMeetings: Signal<Meeting[]>;
  public pastMeetings: Signal<PastMeeting[]>;
  public filteredMeetings: Signal<(Meeting | PastMeeting)[]>;
  public refresh$: BehaviorSubject<void>;
  public searchQuery: WritableSignal<string>;
  public timeFilter: WritableSignal<'upcoming' | 'past'>;
  public topBarVisibilityFilter: WritableSignal<'mine' | 'public'>;
  public meetingTypeFilter: WritableSignal<string | null>;
  public meetingTypeOptions: Signal<{ label: string; value: string | null }[]>;
  public readonly timeFilterOptions = [
    { label: 'Upcoming', value: 'upcoming' },
    { label: 'Past', value: 'past' },
  ];
  public filterForm: FormGroup;
  public project: Signal<ProjectContext | null>;
  public isMaintainer: Signal<boolean>;
  public isFoundationContext: Signal<boolean>;
  public foundationCreateMeetingFlag: Signal<boolean>;
  public canCreateMeeting: Signal<boolean>;

  public constructor() {
    // Initialize project context first (needed for reactive data loading)
    this.project = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());

    // Initialize permission checks
    this.isMaintainer = computed(() => this.personaService.currentPersona() === 'maintainer');
    this.isFoundationContext = computed(() => !this.projectContextService.selectedProject() && !!this.projectContextService.selectedFoundation());
    this.foundationCreateMeetingFlag = this.featureFlagService.getBooleanFlag('foundation-create-meeting', false);
    this.canCreateMeeting = computed(() => {
      const isMaintainerAndNotFoundation = this.isMaintainer() && !this.isFoundationContext();
      const hasFeatureFlag = this.foundationCreateMeetingFlag();
      return isMaintainerAndNotFoundation || hasFeatureFlag;
    });

    // Initialize state
    this.meetingsLoading = signal<boolean>(true);
    this.pastMeetingsLoading = signal<boolean>(true);
    this.refresh$ = new BehaviorSubject<void>(undefined);
    this.searchQuery = signal<string>('');
    this.timeFilter = signal<'upcoming' | 'past'>('upcoming');
    this.topBarVisibilityFilter = signal<'mine' | 'public'>('mine');
    this.meetingTypeFilter = signal<string | null>(null);

    // Initialize filter form
    this.filterForm = new FormGroup({
      timeFilter: new FormControl<'upcoming' | 'past'>('upcoming'),
    });

    // Subscribe to time filter changes
    this.filterForm
      .get('timeFilter')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        if (value) {
          this.timeFilter.set(value);
        }
      });

    // Initialize meeting type options
    this.meetingTypeOptions = this.initializeMeetingTypeOptions();

    // Initialize data with reactive pattern
    this.upcomingMeetings = this.initializeUpcomingMeetings();
    this.pastMeetings = this.initializePastMeetings();
    this.filteredMeetings = this.initializeFilteredMeetings();
  }

  public refreshMeetings(): void {
    this.meetingsLoading.set(true);
    this.pastMeetingsLoading.set(true);
    this.refresh$.next();
  }

  public onMeetingTypeChange(value: string | null): void {
    this.meetingTypeFilter.set(value);
  }

  private initializeUpcomingMeetings(): Signal<Meeting[]> {
    // Convert project signal to observable to react to project changes
    const project$ = toObservable(this.project);
    const timeFilter$ = toObservable(this.timeFilter);

    return toSignal(
      combineLatest([project$, timeFilter$, this.refresh$]).pipe(
        switchMap(([project, timeFilter]) => {
          // Only load upcoming meetings when upcoming filter is selected
          if (!project?.uid || timeFilter !== 'upcoming') {
            this.meetingsLoading.set(false);
            return of([]);
          }

          this.meetingsLoading.set(true);
          return this.meetingService.getMeetingsByProject(project.uid, 100).pipe(
            map((meetings) => {
              // TODO: Remove client-side filtering once API supports filtering by end time + 40-minute buffer
              // This logic should be moved to the query service for better performance
              // Filter out meetings that have ended (including 40-minute buffer)
              const activeMeetings = meetings.filter((meeting) => {
                // For recurring meetings, check if there's at least one occurrence that hasn't ended
                if (meeting.occurrences && meeting.occurrences.length > 0) {
                  return meeting.occurrences.some((occurrence) => !occurrence.is_cancelled && !hasMeetingEnded(meeting, occurrence));
                }

                // For one-time meetings, check if the meeting itself hasn't ended
                return !hasMeetingEnded(meeting);
              });

              // Sort meetings by current or next occurrence start time (earliest first)
              // Falls back to meeting.start_time when occurrences are not available
              return activeMeetings.sort((a, b) => {
                const occurrenceA = getCurrentOrNextOccurrence(a);
                const occurrenceB = getCurrentOrNextOccurrence(b);

                // Get the effective start time for each meeting
                const timeA = occurrenceA ? new Date(occurrenceA.start_time).getTime() : new Date(a.start_time).getTime();
                const timeB = occurrenceB ? new Date(occurrenceB.start_time).getTime() : new Date(b.start_time).getTime();

                return timeA - timeB;
              });
            }),
            catchError((error) => {
              console.error('Failed to load upcoming meetings:', error);
              return of([]);
            }),
            finalize(() => this.meetingsLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initializePastMeetings(): Signal<PastMeeting[]> {
    // Convert signals to observables to react to changes
    const project$ = toObservable(this.project);
    const timeFilter$ = toObservable(this.timeFilter);

    return toSignal(
      combineLatest([project$, timeFilter$, this.refresh$]).pipe(
        switchMap(([project, timeFilter]) => {
          // Only load past meetings when past filter is selected
          if (!project?.uid || timeFilter !== 'past') {
            this.pastMeetingsLoading.set(false);
            return of([]);
          }

          this.pastMeetingsLoading.set(true);
          return this.meetingService.getPastMeetingsByProject(project.uid, 100).pipe(
            // TODO: Remove client-side sorting once API supports sorting by scheduled_start_time
            // When backend sorting is implemented, this map() operator can be removed as the
            // API will return meetings already sorted in the correct order
            map((meetings) => {
              // Sort past meetings by scheduled start time (most recent first)
              return meetings.sort((a, b) => {
                const timeA = new Date(a.scheduled_start_time).getTime();
                const timeB = new Date(b.scheduled_start_time).getTime();
                return timeB - timeA; // Descending order (most recent first)
              });
            }),
            catchError((error) => {
              console.error('Failed to load past meetings:', error);
              return of([]);
            }),
            finalize(() => this.pastMeetingsLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initializeMeetingTypeOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const types = Object.entries(MEETING_TYPE_CONFIGS).map(([value, config]) => ({
        label: config.label,
        value: value,
      }));

      return [{ label: 'All Types', value: null }, ...types];
    });
  }

  private initializeFilteredMeetings(): Signal<(Meeting | PastMeeting)[]> {
    return computed(() => {
      // Get appropriate meetings based on time filter
      const timeFilter = this.timeFilter();
      let filtered: (Meeting | PastMeeting)[] = timeFilter === 'past' ? this.pastMeetings() : this.upcomingMeetings();

      // Apply meeting type filter
      const typeFilter = this.meetingTypeFilter();
      if (typeFilter) {
        filtered = filtered.filter((meeting) => meeting.meeting_type?.toLowerCase() === typeFilter.toLowerCase());
      }

      // Apply search filter
      const search = this.searchQuery()?.toLowerCase() || '';
      if (search) {
        filtered = filtered.filter(
          (meeting) =>
            meeting.title?.toLowerCase().includes(search) ||
            meeting.description?.toLowerCase().includes(search) ||
            meeting.meeting_type?.toLowerCase().includes(search) ||
            meeting.committees?.some((committee) => committee.name?.toLowerCase().includes(search))
        );
      }

      return filtered;
    });
  }
}
