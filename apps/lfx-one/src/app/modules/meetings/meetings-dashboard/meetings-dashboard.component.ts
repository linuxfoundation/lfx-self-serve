// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { IcalSubscribeDialogComponent } from '@app/modules/committees/components/ical-subscribe-dialog/ical-subscribe-dialog.component';
import { MeetingCardComponent } from '@app/modules/meetings/components/meeting-card/meeting-card.component';
import { FullCalendarComponent } from '@app/shared/components/fullcalendar/fullcalendar.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { environment } from '@environments/environment';
import { EventClickArg, EventInput } from '@fullcalendar/core';
import { CANCELLED_COLOR, MEETING_RECORDING_COUNT_FETCH_CONCURRENCY, MEETING_TYPE_COLORS, MEETING_TYPE_CONFIGS } from '@lfx-one/shared/constants';
import { Lens, MeLensMeetingFilters, Meeting, PageResult, PastMeeting, ProjectContext, ViewMode } from '@lfx-one/shared/interfaces';
import {
  addMinutesToDate,
  getCurrentOrNextOccurrence,
  getLargestSessionShareUrl,
  getPastMeetingResourceId,
  getPastMeetingStartTimeMs,
  hasMeetingEnded,
  isMeetingOrganizedByViewer,
  sortPastMeetingsDescending,
} from '@lfx-one/shared/utils';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { OnRenderDirective } from '@shared/directives/on-render.directive';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  expand,
  finalize,
  from,
  map,
  merge,
  mergeMap,
  Observable,
  of,
  scan,
  Subject,
  switchMap,
  take,
  tap,
  toArray,
} from 'rxjs';

import { MeetingsTopBarComponent } from './components/meetings-top-bar/meetings-top-bar.component';

@Component({
  selector: 'lfx-meetings-dashboard',
  imports: [
    MeetingCardComponent,
    MeetingsTopBarComponent,
    ButtonComponent,
    CardComponent,
    OnRenderDirective,
    EmptyStateComponent,
    FullCalendarComponent,
    SkeletonModule,
  ],
  providers: [DialogService],
  templateUrl: './meetings-dashboard.component.html',
  styleUrl: './meetings-dashboard.component.scss',
})
export class MeetingsDashboardComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly personaService = inject(PersonaService);
  private readonly lensService = inject(LensService);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly dialogService = inject(DialogService);

  public readonly activeLens: Signal<Lens> = this.lensService.activeLens;
  protected readonly personaLoaded = this.personaService.personaLoaded;

  public viewMode = signal<ViewMode>('list');
  public isListView = computed(() => this.viewMode() === 'list');
  // Calendar view is only supported on foundation/project lenses (matches the Subscribe button gate).
  // The Me lens skips the project/foundation raw fetch, so its meetings/pastMeetings loading flags
  // never settle — switching to calendar there would show the spinner indefinitely. Gating on lens
  // here keeps `viewMode` user-state intact across lens switches (no forced reset) while making the
  // calendar surface a no-op outside its supported context.
  public canShowCalendarView = computed(() => this.activeLens() === 'foundation' || this.activeLens() === 'project');
  public isCalendarView = computed(() => this.viewMode() === 'calendar' && this.canShowCalendarView());
  public calendarEvents: Signal<EventInput[]>;
  public calendarLoading: Signal<boolean>;

  public meetingsLoading: WritableSignal<boolean>;
  public pastMeetingsLoading: WritableSignal<boolean>;
  public upcomingMeetings: Signal<Meeting[]>;
  public pastMeetings: Signal<PastMeeting[]>;
  public filteredMeetings: Signal<(Meeting | PastMeeting)[]>;
  public refresh$: BehaviorSubject<void>;
  public searchQuery: WritableSignal<string>;
  public debouncedSearchQuery: Signal<string>;
  public timeFilter: WritableSignal<'upcoming' | 'past'>;
  public meetingTypeFilter: WritableSignal<string | null>;
  public meetingTypeOptions: Signal<{ label: string; value: string | null }[]>;
  public foundationFilter: WritableSignal<string | null>;
  public projectFilter: WritableSignal<string | null>;
  public pendingRsvpOnly: WritableSignal<boolean>;
  public organizerOnly: WritableSignal<boolean>;
  public showFoundationFilter: Signal<boolean>;
  public showProjectFilter: Signal<boolean>;
  public foundationOptions: Signal<{ label: string; value: string | null }[]>;
  public projectOptions: Signal<{ label: string; value: string | null }[]>;
  public project: Signal<ProjectContext | null>;
  protected readonly canWrite = this.projectContextService.canWrite;
  protected readonly canWriteMeetings: Signal<boolean> = this.initCanWriteMeetings();
  protected readonly isFiltered = this.initIsFiltered();
  public loadingMore = signal(false);
  public hasMore: Signal<boolean>;
  public autoLoadTriggerIndex: Signal<number>;

  private fpUpcomingLoading = signal(false);
  private fpPastLoading = signal(false);
  // Per-lens loading flags so Me/FP recording-count pipelines cannot clobber each other on lens switch.
  protected readonly meRecordingsCountLoading = signal(false);
  protected readonly fpRecordingsCountLoading = signal(false);
  protected fpUpcomingCountLoading = signal(false);
  protected fpPastCountLoading = signal(false);

  // Raw user meetings cached for client-side filtering (Me lens only)
  private rawUserMeetings: Signal<Meeting[]>;
  private rawUserPastMeetings: Signal<PastMeeting[]>;
  // Pre-filtered/sorted upcoming meetings (shared source for Me lens stat cards)
  private sortedUpcomingUserMeetings: Signal<Meeting[]>;
  // Raw FP/project meetings for stat cards (independent of time-filter tab)
  private rawFpUpcomingMeetings: Signal<Meeting[]>;
  private rawFpPastMeetings: Signal<PastMeeting[]>;
  // Time-filtered meetings for deriving filter options. Server pre-filters past from upcoming;
  // the filter inside filterAndSortUpcomingMeetings is a safety net for SWR-cached responses.
  private timeFilteredMeetings: Signal<(Meeting | PastMeeting)[]>;

  // Me lens stat cards
  protected readonly meLensStatsLoading: Signal<boolean>;
  protected readonly upcomingCount: Signal<number>;
  protected readonly nextMeetingDate: Signal<string>;
  protected readonly pastThisMonthCount: Signal<number>;
  protected readonly recurringCount: Signal<number>;
  protected readonly recordingsAvailableCount: Signal<number>;
  protected readonly attendanceRate: Signal<number>;
  protected readonly recurringAcrossLabel: Signal<string>;

  // Foundation/Project lens stat cards
  protected readonly fpStatsLoading: Signal<boolean>;
  protected readonly fpUpcomingCount: Signal<number>;
  protected readonly fpPastCount: Signal<number>;
  protected readonly fpRecurringCount: Signal<number>;
  protected readonly fpRecordingsAvailableCount: Signal<number>;

  private upcomingPageToken = signal<string | undefined>(undefined);
  private pastPageToken = signal<string | undefined>(undefined);
  private loadMoreUpcoming$ = new Subject<string>();
  private loadMorePast$ = new Subject<string>();

  public constructor() {
    // Initialize project context first (needed for reactive data loading)
    this.project = computed(() => this.projectContextService.activeContext());

    // Initialize state
    this.meetingsLoading = signal<boolean>(true);
    this.pastMeetingsLoading = signal<boolean>(true);
    this.refresh$ = new BehaviorSubject<void>(undefined);
    this.searchQuery = signal<string>('');
    this.debouncedSearchQuery = toSignal(toObservable(this.searchQuery).pipe(debounceTime(300), distinctUntilChanged()), { initialValue: '' });
    const initialTimeFilter = this.route.snapshot.queryParamMap.get('time') === 'past' ? 'past' : 'upcoming';
    this.timeFilter = signal<'upcoming' | 'past'>(initialTimeFilter);
    this.meetingTypeFilter = signal<string | null>(null);
    this.foundationFilter = signal<string | null>(null);
    this.projectFilter = signal<string | null>(null);
    this.pendingRsvpOnly = signal<boolean>(false);
    this.organizerOnly = signal<boolean>(false);
    this.hasMore = computed(() => this.activeLens() !== 'me' && (this.timeFilter() === 'past' ? !!this.pastPageToken() : !!this.upcomingPageToken()));

    // Initialize meeting type options
    this.meetingTypeOptions = this.initializeMeetingTypeOptions();

    // Initialize Me lens data (fetched once, filtered client-side)
    this.rawUserMeetings = this.initializeRawUserMeetings();
    this.rawUserPastMeetings = this.initializeRawUserPastMeetings();
    // Single shared source for all Me-lens upcoming stats — avoids re-filtering rawUserMeetings on each stat signal
    this.sortedUpcomingUserMeetings = computed(() => this.filterAndSortUpcomingMeetings(this.rawUserMeetings()));
    this.timeFilteredMeetings = computed(() => {
      if (this.timeFilter() === 'past') {
        return this.rawUserPastMeetings();
      }
      return this.sortedUpcomingUserMeetings();
    });

    // Filter options derived from time-filtered meetings (only show projects with meetings in current view)
    this.foundationOptions = this.initializeFoundationOptions();
    this.projectOptions = this.initializeProjectOptions();
    // Show filter when there's at least one real option (beyond the "All" entry) and user has the right persona role
    this.showFoundationFilter = computed(() => this.activeLens() === 'me' && this.personaService.hasBoardRole() && this.foundationOptions().length > 1);
    this.showProjectFilter = computed(() => this.activeLens() === 'me' && this.personaService.hasProjectRole() && this.projectOptions().length > 1);

    // Me lens stat cards (computed from shared sorted upcoming signal).
    // Only look at the active tab's loading signal — the inactive tab's raw fetch is gated off,
    // so its loading flag stays pinned at its initial `true` and would never resolve.
    this.meLensStatsLoading = computed(() => (this.timeFilter() === 'past' ? this.pastMeetingsLoading() : this.meetingsLoading()));
    this.upcomingCount = computed(() => this.sortedUpcomingUserMeetings().length);
    this.nextMeetingDate = this.initNextMeetingDate();
    this.pastThisMonthCount = this.initPastThisMonthCount();
    this.recurringCount = computed(() => this.sortedUpcomingUserMeetings().filter((m) => m.recurrence !== null).length);
    this.recordingsAvailableCount = this.initRecordingsAvailableCount();
    this.attendanceRate = this.initAttendanceRate();
    this.recurringAcrossLabel = this.initRecurringAcrossLabel();

    // Initialize data with reactive pattern
    this.upcomingMeetings = this.initializeUpcomingMeetings();
    this.pastMeetings = this.initializePastMeetings();
    this.filteredMeetings = this.initializeFilteredMeetings();

    // Raw FP meetings for stat cards — fetched once, independent of time-filter tab
    this.rawFpUpcomingMeetings = this.initializeRawFpUpcomingMeetings();
    this.rawFpPastMeetings = this.initializeRawFpPastMeetings();

    // Foundation/Project lens stat cards
    // fpStatsLoading gates recurring/recordings cards (backed by raw full-page fetches).
    // fpUpcomingCount/fpPastCount use the count API directly — they resolve independently.
    this.fpStatsLoading = computed(() => (this.timeFilter() === 'past' ? this.fpPastLoading() : this.fpUpcomingLoading()));
    this.fpUpcomingCount = this.initFpUpcomingCount();
    this.fpPastCount = this.initFpPastCount();
    this.fpRecurringCount = computed(() => (this.activeLens() !== 'me' ? this.rawFpUpcomingMeetings().filter((m) => m.recurrence !== null).length : 0));
    this.fpRecordingsAvailableCount = this.initFpRecordingsAvailableCount();

    // Sentinel is placed at 50% of the list to trigger auto-load as user scrolls
    this.autoLoadTriggerIndex = computed(() => Math.floor(this.filteredMeetings().length / 2));

    // Sourced from non-paginated raw signals so the calendar doesn't silently miss meetings the user hasn't scrolled to yet.
    this.calendarEvents = this.initCalendarEvents();
    // Mirrors whichever raw source backs calendarEvents (FP signals on FP lens, user signals on Me) so the spinner reflects the calendar's real loading state.
    this.calendarLoading = computed(() =>
      this.activeLens() === 'me' ? this.meetingsLoading() || this.pastMeetingsLoading() : this.fpUpcomingLoading() || this.fpPastLoading()
    );
  }

  public refreshMeetings(): void {
    this.meetingsLoading.set(true);
    this.pastMeetingsLoading.set(true);
    this.meetingService.clearPastMeetingRecordingCache();
    this.refresh$.next();
  }

  /** FullCalendar event click → navigate to the meeting detail. Cancelled occurrences are inert. */
  public onCalendarEventClick(arg: EventClickArg): void {
    const props = arg.event.extendedProps as { type: string; meetingId?: string; cancelled?: boolean; password?: string };
    if (props.cancelled) return;
    if (props.type === 'meeting' && props.meetingId) {
      void this.router.navigate(['/meetings', props.meetingId], props.password ? { queryParams: { password: props.password } } : {});
    }
  }

  /** Opens iCal Subscribe modal — foundation/project lenses only; me/org lenses tracked separately. */
  public onSubscribe(): void {
    const lens = this.activeLens();
    const projectCtx = this.project();

    if (lens !== 'foundation' && lens !== 'project') {
      console.warn(`Subscribe is not supported on the "${lens}" lens; aborting dialog open`);
      return;
    }
    if (!projectCtx?.uid) {
      console.warn(`Subscribe clicked on ${lens} lens with no uid; aborting dialog open`);
      return;
    }

    const feedUrl = `${environment.urls.home}/public/api/projects/${encodeURIComponent(projectCtx.uid)}/calendar.ics`;
    const name = projectCtx.name ?? (lens === 'foundation' ? 'Foundation' : 'Project');

    this.dialogService.open(IcalSubscribeDialogComponent, {
      header: `Subscribe — ${name}`,
      width: '480px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { feedUrl, name },
    });
  }

  public onMeetingTypeChange(value: string | null): void {
    this.meetingTypeFilter.set(value);
  }

  public onFoundationFilterChange(value: string | null): void {
    this.foundationFilter.set(value);
    this.projectFilter.set(null);
  }

  public onProjectFilterChange(value: string | null): void {
    this.projectFilter.set(value);
  }

  public onTimeFilterChange(value: 'upcoming' | 'past'): void {
    this.timeFilter.set(value);
    this.foundationFilter.set(null);
    this.projectFilter.set(null);
    // Pending RSVP is an upcoming-only concept, so it resets on tab switch. "Organized by me" is
    // valid on both tabs and deliberately persists across them.
    this.pendingRsvpOnly.set(false);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { time: value === 'past' ? 'past' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  public resetFilters(): void {
    this.searchQuery.set('');
    this.meetingTypeFilter.set(null);
    this.foundationFilter.set(null);
    this.projectFilter.set(null);
    this.pendingRsvpOnly.set(false);
    this.organizerOnly.set(false);
  }

  public loadMore(): void {
    const isPast = this.timeFilter() === 'past';
    const pageToken = isPast ? this.pastPageToken() : this.upcomingPageToken();

    if (!pageToken || this.loadingMore()) {
      return;
    }

    if (isPast) {
      this.loadMorePast$.next(pageToken);
    } else {
      this.loadMoreUpcoming$.next(pageToken);
    }
  }

  private initCanWriteMeetings(): Signal<boolean> {
    return toSignal(
      toObservable(this.projectContextService.activeContext).pipe(
        switchMap((ctx) => {
          if (!ctx?.slug) return of(false);
          return this.projectService.getProject(ctx.slug, false, { meetingCoordinator: true }).pipe(
            map((project) => project?.writer === true || project?.meetingCoordinator === true),
            catchError(() => of(false))
          );
        })
      ),
      { initialValue: false }
    );
  }

  private initializeUpcomingMeetings(): Signal<Meeting[]> {
    const project$ = toObservable(this.project);
    const lens$ = toObservable(this.activeLens);
    const timeFilter$ = toObservable(this.timeFilter);
    const searchQuery$ = toObservable(this.debouncedSearchQuery);
    const meetingType$ = toObservable(this.meetingTypeFilter);

    // Me lens: client-side filtering on cached data (no additional API calls)
    const rawUserMeetings$ = toObservable(this.rawUserMeetings);
    const foundationFilter$ = toObservable(this.foundationFilter);
    const projectFilter$ = toObservable(this.projectFilter);
    const pendingRsvpOnly$ = toObservable(this.pendingRsvpOnly);
    const organizerOnly$ = toObservable(this.organizerOnly);
    // The viewer LFID backs the "Organized by me" predicate and can resolve after the meetings do,
    // so it participates in the stream — otherwise the first filtered emission would use a null viewer.
    const viewerUsername$ = toObservable(this.userService.viewerUsername);
    const meLens$ = combineLatest([
      lens$,
      timeFilter$,
      searchQuery$,
      meetingType$,
      rawUserMeetings$,
      foundationFilter$,
      projectFilter$,
      pendingRsvpOnly$,
      organizerOnly$,
      viewerUsername$,
    ]).pipe(
      switchMap(([lens, timeFilter, searchQuery, meetingType, rawMeetings, foundation, project, pendingRsvpOnly, organizerOnly, viewerUsername]) => {
        if (lens !== 'me' || timeFilter !== 'upcoming') {
          return of<PageResult<Meeting>>({ data: [], page_token: undefined, reset: true });
        }
        const filtered = this.filterMeLensMeetings(rawMeetings, {
          searchQuery,
          meetingType,
          foundation,
          project,
          pendingRsvpOnly,
          organizerOnly,
          viewerUsername,
        });
        return of<PageResult<Meeting>>({ data: filtered, page_token: undefined, reset: true });
      })
    );

    // Project/foundation lens: server-side filtering with pagination
    const firstPage$ = combineLatest([project$, lens$, timeFilter$, this.refresh$, searchQuery$, meetingType$]).pipe(
      switchMap(([project, lens, timeFilter, , searchQuery, meetingType]) => {
        if (lens === 'me') {
          return EMPTY;
        }
        if (timeFilter !== 'upcoming') {
          this.meetingsLoading.set(false);
          return of<PageResult<Meeting>>({ data: [], page_token: undefined, reset: true });
        }

        if (!project?.uid) {
          this.meetingsLoading.set(false);
          return of<PageResult<Meeting>>({ data: [], page_token: undefined, reset: true });
        }

        if (!isPlatformBrowser(this.platformId)) {
          return of<PageResult<Meeting>>({ data: [], page_token: undefined, reset: true });
        }

        this.meetingsLoading.set(true);
        const filters = this.buildMeetingTypeFilters(meetingType);
        return this.meetingService.getMeetingsByProjectPaginated(project.uid, undefined, undefined, searchQuery || undefined, filters).pipe(
          map((r): PageResult<Meeting> => ({ ...r, reset: true })),
          catchError(() => of<PageResult<Meeting>>({ data: [], page_token: undefined, reset: true })),
          finalize(() => this.meetingsLoading.set(false))
        );
      })
    );

    // Next pages: emits when loadMore triggers (appends to accumulator)
    const nextPage$ = this.loadMoreUpcoming$.pipe(
      switchMap((pageToken) => {
        const projectUid = this.project()?.uid;
        if (!projectUid) {
          return of<PageResult<Meeting>>({ data: [], page_token: undefined, reset: false });
        }
        this.loadingMore.set(true);
        const searchName = this.debouncedSearchQuery() || undefined;
        const filters = this.buildMeetingTypeFilters(this.meetingTypeFilter());
        return this.meetingService.getMeetingsByProjectPaginated(projectUid, undefined, pageToken, searchName, filters).pipe(
          map((r): PageResult<Meeting> => ({ ...r, reset: false })),
          catchError(() => of<PageResult<Meeting>>({ data: [], page_token: undefined, reset: false })),
          finalize(() => this.loadingMore.set(false))
        );
      })
    );

    return toSignal(
      merge(meLens$, firstPage$, nextPage$).pipe(
        tap((response) => this.upcomingPageToken.set(response.page_token)),
        scan((acc: Meeting[], response: PageResult<Meeting>) => {
          const filtered = this.filterAndSortUpcomingMeetings(response.data);
          return response.reset ? filtered : [...acc, ...filtered];
        }, [])
      ),
      { initialValue: [] }
    );
  }

  private initializePastMeetings(): Signal<PastMeeting[]> {
    const project$ = toObservable(this.project);
    const lens$ = toObservable(this.activeLens);
    const timeFilter$ = toObservable(this.timeFilter);
    const searchQuery$ = toObservable(this.debouncedSearchQuery);
    const meetingType$ = toObservable(this.meetingTypeFilter);

    // Me lens: client-side filtering on cached data (no additional API calls)
    const rawUserPastMeetings$ = toObservable(this.rawUserPastMeetings);
    const pastFoundationFilter$ = toObservable(this.foundationFilter);
    const pastProjectFilter$ = toObservable(this.projectFilter);
    const pastOrganizerOnly$ = toObservable(this.organizerOnly);
    const pastViewerUsername$ = toObservable(this.userService.viewerUsername);
    const meLens$ = combineLatest([
      lens$,
      timeFilter$,
      searchQuery$,
      meetingType$,
      rawUserPastMeetings$,
      pastFoundationFilter$,
      pastProjectFilter$,
      pastOrganizerOnly$,
      pastViewerUsername$,
    ]).pipe(
      switchMap(([lens, timeFilter, searchQuery, meetingType, rawPastMeetings, foundation, project, organizerOnly, viewerUsername]) => {
        if (lens !== 'me' || timeFilter !== 'past') {
          return of<PageResult<PastMeeting>>({ data: [], page_token: undefined, reset: true });
        }
        const filtered = this.filterMeLensMeetings(rawPastMeetings, {
          searchQuery,
          meetingType,
          foundation,
          project,
          // Pending-RSVP chip is upcoming-only, so past-meeting filtering always passes `false`.
          pendingRsvpOnly: false,
          organizerOnly,
          viewerUsername,
        });
        return of<PageResult<PastMeeting>>({ data: filtered, page_token: undefined, reset: true });
      })
    );

    // Project/foundation lens: server-side filtering with pagination
    const firstPage$ = combineLatest([project$, lens$, timeFilter$, this.refresh$, searchQuery$, meetingType$]).pipe(
      switchMap(([project, lens, timeFilter, , searchQuery, meetingType]) => {
        if (lens === 'me') {
          return EMPTY;
        }
        if (timeFilter !== 'past') {
          this.pastMeetingsLoading.set(false);
          return of<PageResult<PastMeeting>>({ data: [], page_token: undefined, reset: true });
        }

        if (!project?.uid) {
          this.pastMeetingsLoading.set(false);
          return of<PageResult<PastMeeting>>({ data: [], page_token: undefined, reset: true });
        }

        if (!isPlatformBrowser(this.platformId)) {
          return of<PageResult<PastMeeting>>({ data: [], page_token: undefined, reset: true });
        }

        this.pastMeetingsLoading.set(true);
        const filters = this.buildMeetingTypeFilters(meetingType);
        return this.meetingService.getPastMeetingsByProjectPaginated(project.uid, undefined, searchQuery || undefined, filters).pipe(
          map((r): PageResult<PastMeeting> => ({ ...r, reset: true })),
          catchError(() => of<PageResult<PastMeeting>>({ data: [], page_token: undefined, reset: true })),
          finalize(() => this.pastMeetingsLoading.set(false))
        );
      })
    );

    // Next pages: emits when loadMore triggers (appends to accumulator)
    const nextPage$ = this.loadMorePast$.pipe(
      switchMap((pageToken) => {
        const projectUid = this.project()?.uid;
        if (!projectUid) {
          return of<PageResult<PastMeeting>>({ data: [], page_token: undefined, reset: false });
        }
        this.loadingMore.set(true);
        const searchName = this.debouncedSearchQuery() || undefined;
        const filters = this.buildMeetingTypeFilters(this.meetingTypeFilter());
        return this.meetingService.getPastMeetingsByProjectPaginated(projectUid, pageToken, searchName, filters).pipe(
          map((r): PageResult<PastMeeting> => ({ ...r, reset: false })),
          catchError(() => of<PageResult<PastMeeting>>({ data: [], page_token: undefined, reset: false })),
          finalize(() => this.loadingMore.set(false))
        );
      })
    );

    return toSignal(
      merge(meLens$, firstPage$, nextPage$).pipe(
        tap((response) => this.pastPageToken.set(response.page_token)),
        // Sort the full accumulator (not just the incoming page) descending by date: the upstream
        // query-service can't sort past meetings by start_time, and the name-based page cursor means
        // a freshly loaded page may contain meetings more recent than ones already shown. Re-sorting
        // the merged list keeps the rendered order most-recent-first across "Load More". (LFXV2-2053)
        scan(
          (acc: PastMeeting[], response: PageResult<PastMeeting>) => sortPastMeetingsDescending(response.reset ? response.data : [...acc, ...response.data]),
          []
        )
      ),
      { initialValue: [] }
    );
  }

  private initializeRawUserMeetings(): Signal<Meeting[]> {
    const lens$ = toObservable(this.activeLens);
    const timeFilter$ = toObservable(this.timeFilter);

    return toSignal(
      combineLatest([lens$, timeFilter$, this.refresh$]).pipe(
        switchMap(([lens, timeFilter]) => {
          // Skip when not on Me lens, not viewing upcoming, or during SSR.
          if (lens !== 'me' || timeFilter !== 'upcoming' || !isPlatformBrowser(this.platformId)) {
            return of([] as Meeting[]);
          }
          this.meetingsLoading.set(true);
          return this.userService.getUserMeetings().pipe(
            tap(() => this.meetingsLoading.set(false)),
            catchError(() => {
              this.meetingsLoading.set(false);
              return of([] as Meeting[]);
            })
          );
        })
      ),
      { initialValue: [] as Meeting[] }
    );
  }

  private initializeRawUserPastMeetings(): Signal<PastMeeting[]> {
    const lens$ = toObservable(this.activeLens);
    const timeFilter$ = toObservable(this.timeFilter);

    return toSignal(
      combineLatest([lens$, timeFilter$, this.refresh$]).pipe(
        switchMap(([lens, timeFilter]) => {
          // Skip when not on Me lens, not viewing past, or during SSR.
          if (lens !== 'me' || timeFilter !== 'past' || !isPlatformBrowser(this.platformId)) {
            return of([] as PastMeeting[]);
          }
          this.pastMeetingsLoading.set(true);
          return this.userService.getUserPastMeetings().pipe(
            tap((meetings) => {
              this.pastMeetingsLoading.set(false);
              const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
              this.meRecordingsCountLoading.set(this.filterRecentPastMeetings(meetings, cutoff).length > 0);
            }),
            catchError(() => {
              this.pastMeetingsLoading.set(false);
              this.meRecordingsCountLoading.set(false);
              return of([] as PastMeeting[]);
            })
          );
        })
      ),
      { initialValue: [] as PastMeeting[] }
    );
  }

  private filterAndSortUpcomingMeetings(meetings: Meeting[]): Meeting[] {
    // Server filters past meetings before sending, but HTTP SWR cache can serve responses up to
    // ~150s old. Re-apply the filter here as a safety net for meetings that ended after caching.
    const activeMeetings = meetings.filter((meeting) => {
      if (meeting.occurrences && meeting.occurrences.length > 0) {
        return meeting.occurrences.some((occurrence) => occurrence.status !== 'cancel' && !hasMeetingEnded(meeting, occurrence));
      }
      return !hasMeetingEnded(meeting);
    });

    return activeMeetings.sort((a, b) => {
      const occurrenceA = getCurrentOrNextOccurrence(a);
      const occurrenceB = getCurrentOrNextOccurrence(b);
      const timeA = occurrenceA ? new Date(occurrenceA.start_time).getTime() : new Date(a.start_time).getTime();
      const timeB = occurrenceB ? new Date(occurrenceB.start_time).getTime() : new Date(b.start_time).getTime();
      return timeA - timeB;
    });
  }

  private initializeMeetingTypeOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const types = Object.entries(MEETING_TYPE_CONFIGS).map(([, config]) => ({
        label: config.label,
        value: config.label,
      }));

      return [{ label: 'All Types', value: null }, ...types];
    });
  }

  private initializeFilteredMeetings(): Signal<(Meeting | PastMeeting)[]> {
    return computed(() => {
      return this.timeFilter() === 'past' ? this.pastMeetings() : this.upcomingMeetings();
    });
  }

  private filterMeLensMeetings<T extends Meeting>(items: T[], filters: MeLensMeetingFilters): T[] {
    const { searchQuery, meetingType, foundation, project, pendingRsvpOnly, organizerOnly, viewerUsername } = filters;
    let filtered = items;

    if (project) {
      filtered = filtered.filter((m) => m.project_uid === project);
    } else if (foundation) {
      // Show meetings for the foundation itself and its non-foundation children only.
      // Sub-foundations (is_foundation: true with parent = this foundation) are their own
      // top-level filter entries, so exclude them and their children here.
      filtered = filtered.filter((m) => m.project_uid === foundation || (m.parent_project_uid === foundation && !m.is_foundation));
    }

    if (pendingRsvpOnly) {
      // Pending = no RSVP recorded. accepted, declined, and maybe are all valid responses.
      filtered = filtered.filter((m) => !m.my_rsvp);
    }

    if (organizerOnly) {
      // Matches the card's "Organized by you" chip (created_by-derived), NOT meeting.organizer —
      // that FGA flag includes inherited grants, so it would surface meetings the user never created.
      filtered = filtered.filter((m) => isMeetingOrganizedByViewer(m, viewerUsername));
    }

    return this.filterBySearchAndType(filtered, searchQuery, meetingType);
  }

  private filterBySearchAndType<T extends { title?: string; meeting_type?: string | null }>(items: T[], searchQuery: string, meetingType: string | null): T[] {
    let filtered = items;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((m) => m.title?.toLowerCase().includes(query));
    }
    if (meetingType) {
      filtered = filtered.filter((m) => m.meeting_type === meetingType);
    }
    return filtered;
  }

  private initializeFoundationOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const meetings = this.timeFilteredMeetings();
      const seen = new Map<string, string>();

      for (const m of meetings) {
        if (m.is_foundation && m.project_uid && !seen.has(m.project_uid)) {
          seen.set(m.project_uid, m.project_name || m.project_uid);
        }
      }

      const options = [...seen.entries()].map(([uid, name]) => ({ label: name, value: uid })).sort((a, b) => a.label.localeCompare(b.label));

      return [{ label: 'All Foundations', value: null }, ...options];
    });
  }

  private initializeProjectOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const meetings = this.timeFilteredMeetings();
      const foundation = this.foundationFilter();
      const seen = new Map<string, string>();

      for (const m of meetings) {
        if (!m.is_foundation && m.project_uid && !seen.has(m.project_uid)) {
          // If a foundation is selected, only show its children
          if (foundation && m.parent_project_uid !== foundation) {
            continue;
          }
          seen.set(m.project_uid, m.project_name || m.project_uid);
        }
      }

      const options = [...seen.entries()].map(([uid, name]) => ({ label: name, value: uid })).sort((a, b) => a.label.localeCompare(b.label));

      return [{ label: 'All Projects', value: null }, ...options];
    });
  }

  private initNextMeetingDate(): Signal<string> {
    return computed(() => {
      const first = this.sortedUpcomingUserMeetings()[0];
      if (!first) return '';
      const occ = getCurrentOrNextOccurrence(first);
      const d = new Date(occ ? occ.start_time : first.start_time);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
  }

  private initPastThisMonthCount(): Signal<number> {
    return computed(() => {
      const now = new Date();
      return this.rawUserPastMeetings().filter((m) => {
        const d = new Date(m.scheduled_start_time ?? m.start_time);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      }).length;
    });
  }

  // Availability is derived live from the recording resource (the same source "See Recording"
  // uses) rather than a stored flag, so the count can never disagree with the buttons. The
  // 30-day window bounds the per-meeting recording fetches.
  private countMeetingsWithRecording(meetings: PastMeeting[], loading: WritableSignal<boolean>): Observable<number> {
    const ids = meetings.map((m) => getPastMeetingResourceId(m));
    if (ids.length === 0) {
      loading.set(false);
      return of(0);
    }
    loading.set(true);
    return from(ids).pipe(
      mergeMap(
        (id) =>
          this.meetingService.getPastMeetingRecording(id).pipe(
            map((rec) => (getLargestSessionShareUrl(rec) ? 1 : 0)),
            catchError(() => of(0))
          ),
        MEETING_RECORDING_COUNT_FETCH_CONCURRENCY
      ),
      toArray(),
      map((flags) => flags.reduce((a, b) => a + b, 0)),
      finalize(() => loading.set(false))
    );
  }

  private filterRecentPastMeetings(past: PastMeeting[], cutoff: number): PastMeeting[] {
    return past.filter((m) => {
      const startMs = getPastMeetingStartTimeMs(m);
      return startMs !== null && startMs >= cutoff;
    });
  }

  private initRecordingsAvailableCount(): Signal<number> {
    return toSignal(
      combineLatest([toObservable(this.activeLens), toObservable(this.rawUserPastMeetings)]).pipe(
        switchMap(([lens, past]) => {
          if (lens !== 'me') return of(0);
          const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
          return this.countMeetingsWithRecording(this.filterRecentPastMeetings(past, cutoff), this.meRecordingsCountLoading);
        })
      ),
      { initialValue: 0 }
    );
  }

  private initAttendanceRate(): Signal<number> {
    return computed(() => {
      const now = new Date();
      const pastThisMonth = this.rawUserPastMeetings().filter((m) => {
        const d = new Date(m.scheduled_start_time ?? m.start_time);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      });
      if (pastThisMonth.length === 0) return 0;
      const attended = pastThisMonth.filter((m) => m.user_attended === true).length;
      return Math.round((attended / pastThisMonth.length) * 100);
    });
  }

  private initRecurringAcrossLabel(): Signal<string> {
    return computed(() => {
      const recurring = this.sortedUpcomingUserMeetings().filter((m) => m.recurrence !== null);
      const uniqueProjects = new Set(recurring.map((m) => m.project_name).filter(Boolean));
      const count = uniqueProjects.size;
      const projectWord = count === 1 ? 'project' : 'projects';
      return count > 0 ? `Across ${count} ${projectWord}` : '';
    });
  }

  private initFpUpcomingCount(): Signal<number> {
    return this.initFpCount(this.fpUpcomingCountLoading, (uid) => this.meetingService.getMeetingsCountByProject(uid));
  }

  private initFpPastCount(): Signal<number> {
    return this.initFpCount(this.fpPastCountLoading, (uid) => this.meetingService.getPastMeetingsCountByProject(uid));
  }

  private initFpCount(loadingSignal: WritableSignal<boolean>, fetchFn: (uid: string) => Observable<number>): Signal<number> {
    const project$ = toObservable(this.project);
    const lens$ = toObservable(this.activeLens);

    return toSignal(
      combineLatest([project$, lens$, this.refresh$]).pipe(
        switchMap(([project, lens]) => {
          if (lens === 'me' || !project?.uid) {
            loadingSignal.set(false);
            return of(0);
          }
          if (!isPlatformBrowser(this.platformId)) {
            loadingSignal.set(true);
            return of(0);
          }
          loadingSignal.set(true);
          return fetchFn(project.uid).pipe(
            catchError(() => of(0)),
            finalize(() => loadingSignal.set(false))
          );
        })
      ),
      { initialValue: 0 }
    );
  }

  private initFpRecordingsAvailableCount(): Signal<number> {
    return toSignal(
      combineLatest([toObservable(this.activeLens), toObservable(this.rawFpPastMeetings)]).pipe(
        switchMap(([lens, past]) => {
          if (lens === 'me') return of(0);
          const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
          return this.countMeetingsWithRecording(this.filterRecentPastMeetings(past, cutoff), this.fpRecordingsCountLoading);
        })
      ),
      { initialValue: 0 }
    );
  }

  private initializeRawFpUpcomingMeetings(): Signal<Meeting[]> {
    const project$ = toObservable(this.project);
    const lens$ = toObservable(this.activeLens);
    const timeFilter$ = toObservable(this.timeFilter);

    return toSignal(
      combineLatest([project$, lens$, timeFilter$, this.refresh$]).pipe(
        switchMap(([project, lens, timeFilter]) => {
          if (lens === 'me' || !project?.uid || timeFilter !== 'upcoming') {
            return of([] as Meeting[]);
          }
          // SSR: pin loading=true so the stat cards render their skeleton instead of "0".
          // The client refires this switchMap post-hydration to do the real fetch.
          if (!isPlatformBrowser(this.platformId)) {
            this.fpUpcomingLoading.set(true);
            return of([] as Meeting[]);
          }
          const projectUid = project.uid;
          this.fpUpcomingLoading.set(true);
          const fetchPage = (pageToken?: string) => this.meetingService.getMeetingsByProjectPaginated(projectUid, undefined, pageToken);
          return fetchPage().pipe(
            expand((response) => (response.page_token ? fetchPage(response.page_token) : EMPTY)),
            take(10),
            toArray(),
            map((responses) => this.filterAndSortUpcomingMeetings(responses.flatMap((r) => r.data))),
            catchError(() => of([] as Meeting[])),
            finalize(() => this.fpUpcomingLoading.set(false))
          );
        })
      ),
      { initialValue: [] as Meeting[] }
    );
  }

  private initializeRawFpPastMeetings(): Signal<PastMeeting[]> {
    const project$ = toObservable(this.project);
    const lens$ = toObservable(this.activeLens);
    const timeFilter$ = toObservable(this.timeFilter);

    return toSignal(
      combineLatest([project$, lens$, timeFilter$, this.refresh$]).pipe(
        switchMap(([project, lens, timeFilter]) => {
          if (lens === 'me' || !project?.uid || timeFilter !== 'past') {
            return of([] as PastMeeting[]);
          }
          // SSR: pin loading=true so the stat cards render their skeleton instead of "0".
          if (!isPlatformBrowser(this.platformId)) {
            this.fpPastLoading.set(true);
            return of([] as PastMeeting[]);
          }
          const projectUid = project.uid;
          this.fpPastLoading.set(true);
          const fetchPage = (pageToken?: string) => this.meetingService.getPastMeetingsByProjectPaginated(projectUid, pageToken);
          return fetchPage().pipe(
            expand((response) => (response.page_token ? fetchPage(response.page_token) : EMPTY)),
            take(10),
            toArray(),
            map((responses) => responses.flatMap((r) => r.data)),
            tap((meetings) => {
              const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
              this.fpRecordingsCountLoading.set(this.filterRecentPastMeetings(meetings, cutoff).length > 0);
            }),
            catchError(() => {
              this.fpRecordingsCountLoading.set(false);
              return of([] as PastMeeting[]);
            }),
            finalize(() => this.fpPastLoading.set(false))
          );
        })
      ),
      { initialValue: [] as PastMeeting[] }
    );
  }

  private buildMeetingTypeFilters(meetingType: string | null): string[] | undefined {
    if (!meetingType) {
      return undefined;
    }
    return [`meeting_type:${meetingType}`];
  }

  private initIsFiltered(): Signal<boolean> {
    return computed(
      () =>
        !!this.debouncedSearchQuery() ||
        !!this.meetingTypeFilter() ||
        !!this.foundationFilter() ||
        !!this.projectFilter() ||
        this.pendingRsvpOnly() ||
        this.organizerOnly()
    );
  }

  private initCalendarEvents(): Signal<EventInput[]> {
    return computed(() => {
      const lens = this.activeLens();
      const search = this.debouncedSearchQuery();
      const meetingType = this.meetingTypeFilter();
      // Me lens: apply the same filters as the list view (foundation/project/pendingRsvp); FP lens raw signals are already scoped, only search+type apply.
      const filtered =
        lens === 'me'
          ? this.filterMeLensMeetings([...this.rawUserMeetings(), ...this.rawUserPastMeetings()], {
              searchQuery: search,
              meetingType,
              foundation: this.foundationFilter(),
              project: this.projectFilter(),
              pendingRsvpOnly: this.pendingRsvpOnly(),
              organizerOnly: this.organizerOnly(),
              viewerUsername: this.userService.viewerUsername(),
            })
          : this.filterBySearchAndType([...this.rawFpUpcomingMeetings(), ...this.rawFpPastMeetings()], search, meetingType);
      return filtered.flatMap((m) => this.meetingToEvents(m));
    });
  }

  private meetingToEvents(meeting: Meeting | PastMeeting): EventInput[] {
    const typeKey = (meeting.meeting_type ?? 'default').toLowerCase();
    const colors = MEETING_TYPE_COLORS[typeKey] ?? MEETING_TYPE_COLORS['default'];

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
          // meeting-event scopes the shared dimming/future-event styles; cursor-default disables the click affordance on cancelled occurrences.
          classNames: isCancelled ? ['meeting-event', 'cursor-default'] : ['meeting-event'],
          extendedProps: { type: 'meeting', meetingId: meeting.id, cancelled: isCancelled, password: meeting.password },
        };
      });
    }

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
        classNames: ['meeting-event'],
        extendedProps: { type: 'meeting', meetingId: meeting.id, password: meeting.password },
      },
    ];
  }
}
