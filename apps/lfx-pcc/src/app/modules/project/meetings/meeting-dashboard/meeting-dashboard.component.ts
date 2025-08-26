// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { FullCalendarComponent } from '@components/fullcalendar/fullcalendar.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MenuComponent } from '@components/menu/menu.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { SelectComponent } from '@components/select/select.component';
import { CalendarEvent, Meeting } from '@lfx-pcc/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { ProjectService } from '@services/project.service';
import { AnimateOnScrollModule } from 'primeng/animateonscroll';
import { MenuItem } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, startWith, switchMap, take, tap } from 'rxjs/operators';

import { MeetingCardComponent } from '../components/meeting-card/meeting-card.component';
import { MeetingModalComponent } from '../components/meeting-modal/meeting-modal.component';

@Component({
  selector: 'lfx-meeting-dashboard',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardComponent,
    MenuComponent,
    MeetingCardComponent,
    InputTextComponent,
    SelectComponent,
    SelectButtonComponent,
    FullCalendarComponent,
    ButtonComponent,
    ConfirmDialogModule,
    AnimateOnScrollModule,
  ],
  templateUrl: './meeting-dashboard.component.html',
  styleUrl: './meeting-dashboard.component.scss',
})
export class MeetingDashboardComponent {
  // Injected services
  private readonly projectService = inject(ProjectService);
  private readonly meetingService = inject(MeetingService);
  private readonly dialogService = inject(DialogService);

  // Class variables with types
  public project: typeof this.projectService.project;
  public searchForm: FormGroup;
  public visibilityFilter: WritableSignal<string | null>;
  public committeeFilter: WritableSignal<string | null>;
  public meetingsLoading: WritableSignal<boolean>;
  public meetings: Signal<Meeting[]>;
  public pastMeetingsLoading: WritableSignal<boolean>;
  public pastMeetings: Signal<Meeting[]>;
  public meetingListView: WritableSignal<'upcoming' | 'past'>;
  public visibilityOptions: Signal<{ label: string; value: string | null }[]>;
  public committeeOptions: Signal<{ label: string; value: string | null }[]>;
  public filteredMeetings: Signal<Meeting[]>;
  public publicMeetingsCount: Signal<number>;
  public privateMeetingsCount: Signal<number>;
  public menuItems: MenuItem[];
  public currentView: WritableSignal<'list' | 'calendar'>;
  public viewOptions: { label: string; value: 'list' | 'calendar' }[];
  public viewForm: FormGroup;
  public calendarEvents: Signal<CalendarEvent[]>;
  public refresh: BehaviorSubject<void>;
  private searchTerm: Signal<string>;

  public constructor() {
    // Initialize all class variables
    this.project = this.projectService.project;
    this.meetingsLoading = signal<boolean>(true);
    this.pastMeetingsLoading = signal<boolean>(true);
    this.refresh = new BehaviorSubject<void>(undefined);
    this.meetings = this.initializeMeetings();
    this.pastMeetings = this.initializePastMeetings();
    this.searchForm = this.initializeSearchForm();
    this.meetingListView = signal<'upcoming' | 'past'>('upcoming');
    this.visibilityFilter = signal<string | null>(null);
    this.committeeFilter = signal<string | null>(null);
    this.searchTerm = this.initializeSearchTerm();
    this.visibilityOptions = this.initializeVisibilityOptions();
    this.committeeOptions = this.initializeCommitteeOptions();
    this.filteredMeetings = this.initializeFilteredMeetings();
    this.publicMeetingsCount = this.initializePublicMeetingsCount();
    this.privateMeetingsCount = this.initializePrivateMeetingsCount();
    this.menuItems = this.initializeMenuItems();
    this.currentView = signal<'list' | 'calendar'>('list');
    this.viewOptions = this.initializeViewOptions();
    this.viewForm = this.initializeViewForm();
    this.calendarEvents = this.initializeCalendarEvents();
  }

  public onVisibilityChange(value: string | null): void {
    this.visibilityFilter.set(value);
  }

  public onCommitteeChange(value: string | null): void {
    this.committeeFilter.set(value);
  }

  public onMeetingListViewChange(value: 'upcoming' | 'past'): void {
    this.meetingListView.set(value);
    this.filteredMeetings = this.initializeFilteredMeetings();
    this.menuItems = this.initializeMenuItems();
    this.visibilityOptions = this.initializeVisibilityOptions();
    this.committeeOptions = this.initializeCommitteeOptions();
  }

  public onViewChange(value: 'list' | 'calendar'): void {
    this.currentView.set(value);
  }

  public onCalendarEventClick(eventInfo: any): void {
    const meetingId = eventInfo.event.extendedProps?.meetingId;
    if (meetingId) {
      const meeting = this.meetings().find((m) => m.uid === meetingId);
      if (meeting) {
        this.openMeetingModal(meeting);
      }
    }
  }

  public refreshMeetings(): void {
    this.meetingsLoading.set(true);
    this.pastMeetingsLoading.set(true);
    this.refresh.next();
  }

  private openMeetingModal(meeting: Meeting): void {
    this.dialogService
      .open(MeetingModalComponent, {
        header: meeting.title || 'Meeting Details',
        width: '700px',
        modal: true,
        closable: true,
        dismissableMask: true,
        data: {
          meeting,
        },
      })
      .onClose.pipe(take(1))
      .subscribe((result) => {
        if (result) {
          this.refreshMeetings();
        }
      });
  }

  // Private initialization methods
  private initializeSearchForm(): FormGroup {
    return new FormGroup({
      search: new FormControl<string>(''),
      visibility: new FormControl<string | null>(null),
      committee: new FormControl<string | null>(null),
    });
  }

  private initializeSearchTerm(): Signal<string> {
    return toSignal(this.searchForm.get('search')!.valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged()), { initialValue: '' });
  }

  private initializeMeetings(): Signal<Meeting[]> {
    return toSignal(
      this.project()
        ? this.refresh.pipe(
            switchMap(() => this.meetingService.getUpcomingMeetingsByProject(this.project()!.uid, 100).pipe(tap(() => this.meetingsLoading.set(false))))
          )
        : of([]),
      {
        initialValue: [],
      }
    );
  }

  private initializePastMeetings(): Signal<Meeting[]> {
    return toSignal(
      this.project()
        ? this.refresh.pipe(
            switchMap(() => this.meetingService.getPastMeetingsByProject(this.project()!.uid, 100).pipe(tap(() => this.pastMeetingsLoading.set(false))))
          )
        : of([]),
      {
        initialValue: [],
      }
    );
  }

  private initializeVisibilityOptions(): Signal<{ label: string; value: string | null }[]> {
    return signal([
      { label: 'All Visibilities', value: null },
      { label: 'Public', value: 'public' },
      { label: 'Private', value: 'private' },
    ]);
  }

  private initializeCommitteeOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const meetings = this.meetingListView() === 'upcoming' ? this.meetings() : this.pastMeetings();
      const committeeMap = new Map<string, string>();

      // Extract unique committees from all meetings
      meetings.forEach((meeting) => {
        meeting.meeting_committees?.forEach((committee) => {
          committeeMap.set(committee.uid, committee.name);
        });
      });

      // Convert to options array
      const options: { label: string; value: string | null }[] = [{ label: 'All Committees', value: null }];
      Array.from(committeeMap.entries())
        .sort(([, a], [, b]) => a.localeCompare(b))
        .forEach(([id, name]) => {
          options.push({ label: name, value: id });
        });

      return options;
    });
  }

  private initializeFilteredMeetings(): Signal<Meeting[]> {
    return computed(() => {
      let filtered = this.meetingListView() === 'upcoming' ? this.meetings() : this.pastMeetings();

      // Apply search filter
      const searchTerm = this.searchTerm()?.toLowerCase() || '';
      if (searchTerm) {
        filtered = filtered.filter(
          (meeting) =>
            meeting.title?.toLowerCase().includes(searchTerm) ||
            meeting.description?.toLowerCase().includes(searchTerm) ||
            meeting.meeting_type?.toLowerCase().includes(searchTerm) ||
            meeting.meeting_committees?.some((committee) => committee.name.toLowerCase().includes(searchTerm))
        );
      }

      // Apply visibility filter
      const visibility = this.visibilityFilter();
      if (visibility) {
        filtered = filtered.filter((meeting) => meeting.visibility === visibility);
      }

      // Apply committee filter
      const committee = this.committeeFilter();
      if (committee) {
        filtered = filtered.filter((meeting) => meeting.meeting_committees?.some((c) => c.uid === committee));
      }

      return filtered;
    });
  }

  private initializeMenuItems(): MenuItem[] {
    const project = this.project();
    return [
      {
        label: 'Create Meeting',
        icon: 'fa-light fa-calendar-plus text-sm',
        routerLink: project ? `/project/${project.slug}/meetings/create` : '#',
      },
      {
        label: this.meetingListView() === 'past' ? 'Upcoming Meetings' : 'Meeting History',
        icon: 'fa-light fa-calendar-days text-sm',
        command: () => this.onMeetingListViewChange(this.meetingListView() === 'upcoming' ? 'past' : 'upcoming'),
      },
      {
        label: 'Public Calendar',
        icon: 'fa-light fa-calendar-check text-sm',
      },
    ];
  }

  private initializePublicMeetingsCount(): Signal<number> {
    return computed(() => this.meetings().filter((m) => m.visibility === 'public').length);
  }

  private initializePrivateMeetingsCount(): Signal<number> {
    return computed(() => this.meetings().filter((m) => m.visibility === 'private').length);
  }

  private initializeViewOptions(): { label: string; value: 'list' | 'calendar' }[] {
    return [
      { label: 'List', value: 'list' },
      { label: 'Calendar', value: 'calendar' },
    ];
  }

  private initializeViewForm(): FormGroup {
    return new FormGroup({
      view: new FormControl<'list' | 'calendar'>('list'),
    });
  }

  private initializeCalendarEvents(): Signal<CalendarEvent[]> {
    return computed(() => {
      return [...this.meetings(), ...this.pastMeetings()].map((meeting): CalendarEvent => {
        const startTime = meeting.start_time ? new Date(meeting.start_time) : new Date();
        const duration = meeting.duration || 60; // Default 1 hour duration
        const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

        // Color coding based on visibility and committee
        let backgroundColor = '#6b7280'; // Default gray for private
        let borderColor = '#374151';

        if (meeting.visibility === 'public') {
          backgroundColor = '#3b82f6'; // Blue for public
          borderColor = '#1d4ed8';
        }

        // Create a more informative title
        const committeeName = meeting.meeting_committees?.[0]?.name;
        const displayTitle = committeeName ? `${meeting.title || 'Meeting'} (${committeeName})` : meeting.title || 'Meeting';

        return {
          id: meeting.uid,
          title: displayTitle,
          start: startTime.toISOString(),
          end: endTime.toISOString(),
          backgroundColor,
          borderColor,
          textColor: '#ffffff',
          classNames: ['meeting-event'],
          extendedProps: {
            meetingId: meeting.uid,
            visibility: meeting.visibility || 'private',
            committee: meeting.meeting_committees?.[0]?.name,
            meetingType: meeting.meeting_type,
            description: meeting.description,
            title: meeting.title,
          },
        };
      });
    });
  }
}
