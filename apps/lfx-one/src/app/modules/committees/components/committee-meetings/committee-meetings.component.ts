// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, linkedSignal, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MeetingCardComponent } from '@app/modules/meetings/components/meeting-card/meeting-card.component';
import { FullCalendarComponent } from '@app/shared/components/fullcalendar/fullcalendar.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { environment } from '@environments/environment';
import { EventClickArg, EventInput } from '@fullcalendar/core';
import { CANCELLED_COLOR, MEETING_TYPE_COLORS, MEETING_TYPE_CONFIGS, SURVEY_COLOR, VOTE_COLOR } from '@lfx-one/shared/constants';
import { Committee, Meeting, PastMeeting, Survey, TimeFilter, ViewMode, Vote } from '@lfx-one/shared/interfaces';
import { addMinutesToDate } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { SurveyService } from '@services/survey.service';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { getCurrentOrNextOccurrence, hasMeetingEnded } from '@lfx-one/shared/utils';
import { catchError, debounceTime, distinctUntilChanged, filter, finalize, forkJoin, map, of, startWith, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-committee-meetings',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ClipboardModule,
    ButtonComponent,
    CardComponent,
    InputTextComponent,
    SelectComponent,
    SkeletonModule,
    MeetingCardComponent,
    FullCalendarComponent,
  ],
  templateUrl: './committee-meetings.component.html',
  styleUrl: './committee-meetings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitteeMeetingsComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly voteService = inject(VoteService);
  private readonly surveyService = inject(SurveyService);
  private readonly router = inject(Router);
  private readonly clipboard = inject(Clipboard);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  // Inputs
  public committee = input.required<Committee>();
  public canEdit = input<boolean>(false);
  public initialTimeFilter = input<TimeFilter>('upcoming');

  // Filter state — linkedSignal tracks initialTimeFilter but allows local overrides
  public timeFilter = linkedSignal(() => this.initialTimeFilter());
  public meetingTypeFilter = signal<string | null>(null);

  // View mode: list or calendar
  public viewMode = signal<ViewMode>('list');

  // Convenience computed signals — avoids repeating viewMode() === '...' in template
  public isListView = computed(() => this.viewMode() === 'list');
  public isCalendarView = computed(() => this.viewMode() === 'calendar');

  // Form for search + filter controls (bound in template)
  public searchForm = new FormGroup({
    search: new FormControl(''),
    meetingType: new FormControl<string | null>(null),
    timeFilter: new FormControl<TimeFilter>(this.initialTimeFilter()),
  });

  // Filter options
  public timeFilterOptions: { label: string; value: TimeFilter }[] = [
    { label: 'Upcoming', value: 'upcoming' },
    { label: 'Past', value: 'past' },
  ];

  public meetingTypeOptions: { label: string; value: string | null }[] = [
    { label: 'All Types', value: null },
    ...Object.entries(MEETING_TYPE_CONFIGS).map(([key, config]) => ({ label: config.label, value: key })),
  ];

  // Loading state
  public meetingsLoading = signal(true);
  public pastMeetingsLoading = signal(false);
  public calendarLoading = signal(false);

  // Data — upcoming meetings
  public upcomingMeetings: Signal<Meeting[]> = this.initUpcomingMeetings();

  // Data — past meetings, lazy-loaded reactively when filter switches to 'past'
  public pastMeetings: Signal<PastMeeting[]> = toSignal(
    toObservable(computed(() => ({ time: this.timeFilter(), uid: this.committee()?.uid }))).pipe(
      filter(({ time, uid }) => time === 'past' && !!uid),
      distinctUntilChanged((a, b) => a.uid === b.uid),
      tap(() => this.pastMeetingsLoading.set(true)),
      switchMap(({ uid }) => this.meetingService.getPastMeetingsByCommittee(uid!).pipe(finalize(() => this.pastMeetingsLoading.set(false))))
    ),
    { initialValue: [] }
  );

  // Loading computed: true when active tab's data is loading
  public loading: Signal<boolean> = computed(() => (this.timeFilter() === 'upcoming' ? this.meetingsLoading() : this.pastMeetingsLoading()));

  // Filtered data (list view)
  public filteredMeetings: Signal<(Meeting | PastMeeting)[]> = this.initFilteredMeetings();

  // Calendar: votes + surveys lazy-loaded on first switch to calendar mode
  public calendarEvents: Signal<EventInput[]> = this.initCalendarEvents();

  public constructor() {
    // Form control → signal (user dropdown selection syncs to reactive state)
    (this.searchForm.get('timeFilter') as FormControl<TimeFilter>).valueChanges
      .pipe(startWith(this.initialTimeFilter()), takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this.timeFilter.set(v));

    (this.searchForm.get('meetingType') as FormControl<string | null>).valueChanges
      .pipe(startWith(null), takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this.meetingTypeFilter.set(v));

    // Signal → form control (programmatic changes via initialTimeFilter input update the dropdown)
    toObservable(this.timeFilter)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this.searchForm.get('timeFilter')?.setValue(v, { emitEvent: false }));
  }

  /** Copies the committee's calendar subscribe URL to clipboard and shows a confirmation toast. */
  public onSubscribe(): void {
    const uid = this.committee().uid;
    const url = `${environment.urls.home}/public/api/committees/${uid}/calendar.ics`;
    this.clipboard.copy(url);
    this.messageService.add({
      severity: 'info',
      summary: 'Subscribe URL copied!',
      detail: 'Add this to Google Calendar, Outlook, or Apple Calendar.',
      life: 5000,
    });
  }

  /** Handles FullCalendar event click — navigates to meeting detail for meeting events. */
  public onCalendarEventClick(arg: EventClickArg): void {
    const props = arg.event.extendedProps as { type: string; meetingId?: string };
    if (props.type === 'meeting' && props.meetingId) {
      void this.router.navigate(['/meetings', props.meetingId]);
    }
  }

  // Private initializer functions

  private initUpcomingMeetings(): Signal<Meeting[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        tap(() => this.meetingsLoading.set(true)),
        switchMap((c) =>
          // NOTE: The query service does not support `order` — only `sort` with values
          // name_asc/desc, updated_asc/desc. There is no start_time sort upstream.
          // The `order=start_time.asc` param passed here is silently ignored;
          // the client-side sort below (lines 178-185) is the actual sorting mechanism.
          this.meetingService.getMeetingsByCommittee(c.uid, 100, 'start_time.asc').pipe(
            map((meetings) => {
              const active = meetings.filter((m) => {
                if (m.occurrences?.length) {
                  return m.occurrences.some((o) => o.status !== 'cancel' && !hasMeetingEnded(m, o));
                }
                return !hasMeetingEnded(m);
              });
              return active.sort((a, b) => {
                const oA = getCurrentOrNextOccurrence(a);
                const oB = getCurrentOrNextOccurrence(b);
                return (
                  (oA ? new Date(oA.start_time).getTime() : new Date(a.start_time).getTime()) -
                  (oB ? new Date(oB.start_time).getTime() : new Date(b.start_time).getTime())
                );
              });
            }),
            finalize(() => this.meetingsLoading.set(false))
          )
        )
      ),
      { initialValue: [] }
    );
  }

  private initFilteredMeetings(): Signal<(Meeting | PastMeeting)[]> {
    const searchTerm = toSignal((this.searchForm.get('search') as FormControl).valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged()), {
      initialValue: '',
    });

    return computed(() => {
      const time = this.timeFilter();
      const term = (searchTerm() || '').toLowerCase();
      const typeFilter = this.meetingTypeFilter();
      const items: (Meeting | PastMeeting)[] = time === 'upcoming' ? this.upcomingMeetings() : this.pastMeetings();

      return items.filter((m) => {
        const title = 'title' in m ? m.title : '';
        const meetingType = 'meeting_type' in m ? m.meeting_type : '';

        const matchesSearch = !term || title.toLowerCase().includes(term);
        const matchesType = !typeFilter || meetingType === typeFilter;

        return matchesSearch && matchesType;
      });
    });
  }

  private initCalendarEvents(): Signal<EventInput[]> {
    // Lazy-load votes, surveys, and past meetings the first time calendar view is activated
    const externalData = toSignal(
      toObservable(computed(() => ({ mode: this.viewMode(), uid: this.committee()?.uid }))).pipe(
        filter(({ mode, uid }) => mode === 'calendar' && !!uid),
        distinctUntilChanged((a, b) => a.uid === b.uid),
        tap(() => this.calendarLoading.set(true)),
        switchMap(({ uid: committeeUid }) =>
          forkJoin({
            votes: this.voteService.getVotesByCommittee(committeeUid!).pipe(catchError(() => of([] as Vote[]))),
            surveys: this.surveyService.getSurveysByCommittee(committeeUid!).pipe(catchError(() => of([] as Survey[]))),
            pastMeetings: this.meetingService.getPastMeetingsByCommittee(committeeUid!).pipe(catchError(() => of([] as PastMeeting[]))),
          }).pipe(finalize(() => this.calendarLoading.set(false)))
        ),
        tap(() => this.calendarLoading.set(false))
      ),
      { initialValue: { votes: [] as Vote[], surveys: [] as Survey[], pastMeetings: [] as PastMeeting[] } }
    );

    return computed(() => {
      const allMeetings: (Meeting | PastMeeting)[] = [...this.upcomingMeetings(), ...externalData().pastMeetings];
      const { votes, surveys } = externalData();

      const meetingEvents = allMeetings.flatMap((m) => this.meetingToEvents(m));
      const voteEvents = votes.filter((v) => !!v.end_time).map((v) => this.voteToEvent(v));
      const surveyEvents = surveys.filter((s) => !!s.survey_cutoff_date).map((s) => this.surveyToEvent(s));

      return [...meetingEvents, ...voteEvents, ...surveyEvents];
    });
  }

  private meetingToEvents(meeting: Meeting | PastMeeting): EventInput[] {
    const typeKey = (meeting.meeting_type ?? 'default').toLowerCase();
    const colors = MEETING_TYPE_COLORS[typeKey] ?? MEETING_TYPE_COLORS['default'];

    // Recurring meetings — expand each occurrence as a separate calendar event
    if (meeting.occurrences && meeting.occurrences.length > 0) {
      return meeting.occurrences.map((occ) => {
        const isCancelled = occ.status === 'cancel';
        const c = isCancelled ? CANCELLED_COLOR : colors;
        return {
          id: `${meeting.id}-${occ.occurrence_id}`,
          title: occ.title || meeting.title,
          start: occ.start_time,
          end: addMinutesToDate(occ.start_time, occ.duration ?? meeting.duration).toISOString(),
          backgroundColor: c.bg,
          borderColor: c.border,
          textColor: '#ffffff',
          display: 'block',
          extendedProps: { type: 'meeting', meetingId: meeting.id, cancelled: isCancelled },
        };
      });
    }

    // Non-recurring — single event
    return [
      {
        id: meeting.id,
        title: meeting.title,
        start: meeting.start_time,
        end: addMinutesToDate(meeting.start_time, meeting.duration).toISOString(),
        backgroundColor: colors.bg,
        borderColor: colors.border,
        textColor: '#ffffff',
        display: 'block',
        extendedProps: { type: 'meeting', meetingId: meeting.id },
      },
    ];
  }

  private voteToEvent(vote: Vote): EventInput {
    return {
      id: `vote-${vote.uid}`,
      title: `Vote closes: ${vote.name}`,
      start: vote.end_time,
      allDay: true,
      backgroundColor: VOTE_COLOR.bg,
      borderColor: VOTE_COLOR.border,
      textColor: '#ffffff',
      classNames: ['cursor-default'],
      extendedProps: { type: 'vote', voteId: vote.uid },
    };
  }

  private surveyToEvent(survey: Survey): EventInput {
    return {
      id: `survey-${survey.uid}`,
      title: `Survey: ${survey.survey_title}`,
      start: survey.survey_cutoff_date,
      allDay: true,
      backgroundColor: SURVEY_COLOR.bg,
      borderColor: SURVEY_COLOR.border,
      textColor: '#ffffff',
      classNames: ['cursor-default'],
      extendedProps: { type: 'survey', surveyId: survey.uid },
    };
  }
}
