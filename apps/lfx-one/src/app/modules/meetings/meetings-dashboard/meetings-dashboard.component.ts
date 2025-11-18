// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MeetingCardComponent } from '@app/shared/components/meeting-card/meeting-card.component';
import { ProjectContextService } from '@app/shared/services/project-context.service';
import { ButtonComponent } from '@components/button/button.component';
import { Meeting, ProjectContext } from '@lfx-one/shared/interfaces';
import { getCurrentOrNextOccurrence } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { BehaviorSubject, catchError, map, merge, of, switchMap, tap } from 'rxjs';

import { MeetingsTopBarComponent } from './components/meetings-top-bar/meetings-top-bar.component';

@Component({
  selector: 'lfx-meetings-dashboard',
  standalone: true,
  imports: [CommonModule, MeetingCardComponent, MeetingsTopBarComponent, ButtonComponent],
  templateUrl: './meetings-dashboard.component.html',
  styleUrl: './meetings-dashboard.component.scss',
})
export class MeetingsDashboardComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);

  public meetingsLoading: WritableSignal<boolean>;
  public meetings: Signal<Meeting[]> = signal([]);
  public currentView: WritableSignal<'list' | 'calendar'>;
  public filteredMeetings: Signal<Meeting[]>;
  public refresh$: BehaviorSubject<void>;
  public searchQuery: WritableSignal<string>;
  public timeFilter: WritableSignal<'upcoming' | 'past'>;
  public topBarVisibilityFilter: WritableSignal<'mine' | 'public'>;
  public project: Signal<ProjectContext | null>;
  public isMaintainer: Signal<boolean>;
  public isNonFoundationProjectSelected: Signal<boolean>;

  public constructor() {
    // Initialize project context first (needed for reactive data loading)
    this.project = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());

    // Initialize permission checks
    this.isMaintainer = computed(() => this.personaService.currentPersona() === 'maintainer');
    this.isNonFoundationProjectSelected = computed(() => this.projectContextService.selectedProject() !== null);

    // Initialize state
    this.meetingsLoading = signal<boolean>(true);
    this.refresh$ = new BehaviorSubject<void>(undefined);
    this.currentView = signal<'list' | 'calendar'>('list');
    this.searchQuery = signal<string>('');
    this.timeFilter = signal<'upcoming' | 'past'>('upcoming');
    this.topBarVisibilityFilter = signal<'mine' | 'public'>('mine');

    // Initialize data with reactive pattern
    this.meetings = this.initializeMeetings();
    this.filteredMeetings = this.initializeFilteredMeetings();
  }

  public onViewChange(view: 'list' | 'calendar'): void {
    this.currentView.set(view);
  }

  public refreshMeetings(): void {
    this.meetingsLoading.set(true);
    this.refresh$.next();
  }

  private initializeMeetings(): Signal<Meeting[]> {
    // Convert project signal to observable to react to project changes
    const project$ = toObservable(this.project);

    return toSignal(
      merge(
        project$, // Triggers on project context changes
        this.refresh$ // Triggers on manual refresh
      ).pipe(
        tap(() => this.meetingsLoading.set(true)),
        switchMap(() => {
          const project = this.project();
          if (!project?.projectId) {
            this.meetingsLoading.set(false);
            return of([]);
          }

          return this.meetingService.getMeetings().pipe(
            map((meetings) => {
              // Sort meetings by current or next occurrence start time (earliest first)
              return meetings.sort((a, b) => {
                const occurrenceA = getCurrentOrNextOccurrence(a);
                const occurrenceB = getCurrentOrNextOccurrence(b);

                if (!occurrenceA && !occurrenceB) {
                  return 0;
                }
                if (!occurrenceA) {
                  return 1;
                }
                if (!occurrenceB) {
                  return -1;
                }

                return new Date(occurrenceA.start_time).getTime() - new Date(occurrenceB.start_time).getTime();
              });
            }),
            catchError((error) => {
              console.error('Failed to load meetings:', error);
              this.meetingsLoading.set(false);
              return of([]);
            }),
            tap(() => this.meetingsLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initializeFilteredMeetings(): Signal<Meeting[]> {
    return computed(() => {
      let filtered = this.meetings();
      const now = new Date();

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

      const timeFilterValue = this.timeFilter();
      if (timeFilterValue === 'upcoming') {
        filtered = filtered.filter((meeting) => {
          const meetingEndTime = new Date(meeting.start_time);
          meetingEndTime.setMinutes(meetingEndTime.getMinutes() + meeting.duration + 40);
          return meetingEndTime >= now;
        });
      } else {
        filtered = filtered.filter((meeting) => {
          const meetingEndTime = new Date(meeting.start_time);
          meetingEndTime.setMinutes(meetingEndTime.getMinutes() + meeting.duration + 40);
          return meetingEndTime < now;
        });
      }

      return filtered;
    });
  }
}
