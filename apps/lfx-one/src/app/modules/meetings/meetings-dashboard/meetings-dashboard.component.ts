// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, Location } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal, Signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { IcalSubscribeDialogComponent } from '@app/modules/committees/components/ical-subscribe-dialog/ical-subscribe-dialog.component';
import { MeetingCardComponent } from '@app/modules/meetings/components/meeting-card/meeting-card.component';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { MeetingCreateMenuComponent } from '@app/modules/meetings/meeting-composer/meeting-create-menu.component';
import { FullCalendarComponent } from '@app/shared/components/fullcalendar/fullcalendar.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { PageHeaderComponent } from '@components/page-header/page-header.component';
import { environment } from '@environments/environment';
import { EventClickArg, EventInput } from '@fullcalendar/core';
import {
  MEETING_RECORDING_COUNT_FETCH_CONCURRENCY,
  MEETING_ROLLUP_ALL_PROJECTS,
  MEETING_TYPE_CONFIGS,
  MY_MEETINGS_STATS_WINDOW_DAYS,
  QUERY_SERVICE_MAX_PAGE_SIZE,
} from '@lfx-one/shared/constants';
import {
  GroupLinkState,
  Lens,
  MeetingCalendarClickProps,
  MeetingDashboardView,
  MeetingProjectQueryOptions,
  MeetingResponseFilter,
  MeetingRollupFilterOptions,
  MeetingRollupGroupOption,
  MeetingRsvp,
  MeLensMeetingFilters,
  Meeting,
  PageResult,
  PastMeeting,
  ProjectContext,
  ViewMode,
} from '@lfx-one/shared/interfaces';
import {
  countMeetingDatesBefore,
  getApplicableMeetingRsvp,
  getCurrentOrNextOccurrence,
  getLargestSessionShareUrl,
  getPastMeetingResourceId,
  getPastMeetingStartTimeMs,
  hasMeetingEnded,
  isMeetingAccepted,
  isMeetingHiddenAsDeclined,
  isMeetingInviteResponsesEnabled,
  isMeetingOrganizedByViewer,
  isMeetingPendingRsvp,
  meetingToCalendarEvents,
  resolveMeetingCalendarClickRoute,
  sortPastMeetingsDescending,
} from '@lfx-one/shared/utils';
import { FeatureFlagService } from '@services/feature-flag.service';
import { meetingsV2EnabledSignal } from '@shared/utils/meetings-v2-flag.util';
import { LensService } from '@services/lens.service';
import { MeetingRollupPreferenceService } from '@services/meeting-rollup-preference.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
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
  filter,
  finalize,
  from,
  map,
  merge,
  mergeMap,
  Observable,
  of,
  pairwise,
  scan,
  skip,
  startWith,
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
    MeetingCreateMenuComponent,
    PageHeaderComponent,
  ],
  providers: [DialogService],
  templateUrl: './meetings-dashboard.component.html',
  styleUrl: './meetings-dashboard.component.scss',
})
export class MeetingsDashboardComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);
  private readonly lensService = inject(LensService);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly rollupPreference = inject(MeetingRollupPreferenceService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly dialogService = inject(DialogService);
  private readonly composer = inject(MeetingComposerService);

  public readonly activeLens: Signal<Lens> = this.lensService.activeLens;
  protected readonly personaLoaded = this.personaService.personaLoaded;

  public viewMode = signal<ViewMode>(this.route.snapshot.queryParamMap.get('view') === 'calendar' ? 'calendar' : 'list');
  public isListView = computed(() => this.viewMode() === 'list');
  // Calendar view is only supported on foundation/project lenses (matches the Subscribe button gate).
  // The Me lens skips the project/foundation raw fetch, so its meetings/pastMeetings loading flags
  // never settle — switching to calendar there would show the spinner indefinitely. Gating on lens
  // here keeps `viewMode` user-state intact across lens switches (no forced reset) while making the
  // calendar surface a no-op outside its supported context.
  public canShowCalendarView = computed(() => this.activeLens() === 'foundation' || this.activeLens() === 'project');
  public isCalendarView = computed(() => this.viewMode() === 'calendar' && this.canShowCalendarView());
  // Group links on the cards return here, and restore the Me lens when that is where the user was.
  public groupLinkState: Signal<GroupLinkState> = computed(() => {
    const lens = this.activeLens();
    const state: GroupLinkState = { backLabel: 'Meetings', backPath: '/meetings', fromMeLens: lens === 'me' };
    const backProject = this.project()?.slug;
    // Back from a (possibly sub-project) group returns to this lens and project.
    if ((lens === 'foundation' || lens === 'project') && backProject) {
      return { ...state, backProject, backLens: lens };
    }
    return state;
  });
  // Project the foundation/project list rolls up from; cards from any other project show their project name.
  // Empty on the Me lens, whose list already spans every project.
  public readonly rollupContextUid: Signal<string> = computed(() => (this.activeLens() === 'me' ? '' : (this.project()?.uid ?? '')));
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
  public meetingView = signal<MeetingDashboardView>(this.route.snapshot.queryParamMap.get('time') === 'past' ? 'past' : 'upcoming');
  public timeFilter: Signal<'upcoming' | 'past'>;
  public meetingTypeFilter: WritableSignal<string | null>;
  public meetingTypeOptions: Signal<{ label: string; value: string | null }[]>;
  public foundationFilter: WritableSignal<string | null>;
  public projectFilter: WritableSignal<string | null>;
  public responseFilter = signal<MeetingResponseFilter>('all');
  public organizedByMe = signal(false);
  public hideDeclined = signal(false);
  public showFoundationFilter: Signal<boolean>;
  public showProjectFilter: Signal<boolean>;
  public foundationOptions: Signal<{ label: string; value: string | null }[]>;
  public projectOptions: Signal<{ label: string; value: string | null }[]>;
  // Roll-up filters (foundation/project lens, GH-5566), seeded from the URL so a filtered view can be shared.
  // The project selection starts on the root alone (its own meetings) unless a link names projects; the
  // user's saved choice is applied once known (see seedRollupProjects).
  private readonly urlRollupProjects: string[] | null = this.readRollupProjectsQueryParam();
  public readonly rollupProjectsFilter = signal<string[]>(this.initialRollupProjects());
  public readonly groupFilter = signal<string | null>(this.route.snapshot.queryParamMap.get('group'));
  public readonly groupTypeFilter = signal<string | null>(this.route.snapshot.queryParamMap.get('group_type'));
  public rollupFilterOptions: Signal<MeetingRollupFilterOptions>;
  public rollupProjectOptions: Signal<{ label: string; value: string }[]>;
  public groupOptions: Signal<{ label: string; value: string }[]>;
  private scopedGroups: Signal<MeetingRollupGroupOption[]>;
  public groupTypeOptions: Signal<{ label: string; value: string }[]>;
  // What every foundation/project fetch sends: the roll-up plus the filters above.
  // What the project selection means: nothing checked is the default (the root's own meetings), every
  // project checked is the whole roll-up (no subset sent, which also keeps a large tree's "select all"
  // under the server's project_uids cap), anything else is that subset. The picker keeps showing exactly
  // what the user checked.
  // "All projects" chosen by a link or a saved choice before the options (and so the checkboxes) are known:
  // the requests already cover every project, even if the options never load.
  private readonly rollupAllProjects = signal<boolean>(this.urlRollupProjects?.includes(MEETING_ROLLUP_ALL_PROJECTS) ?? false);
  private readonly rollupProjectsMode: Signal<'default' | 'all' | 'subset'> = computed(() => {
    const selected = this.rollupProjectsFilter();
    const all = this.rollupProjectOptions();
    // A linked or saved "all" stays all; otherwise checking every listed project is all only when the
    // options list the whole tree (from an incomplete list it is still a subset, sent as one).
    if (this.rollupAllProjects()) return 'all';
    if (selected.length === 0) return 'default';
    const wholeTree = this.rollupFilterOptions().complete;
    return wholeTree && all.length > 0 && all.every((option) => selected.includes(option.value)) ? 'all' : 'subset';
  });
  // The project picker's label while nothing is checked: the default view, the root's own meetings.
  protected readonly rollupProjectsPlaceholder: Signal<string> = computed(() => `${this.project()?.name ?? 'This project'} only`);
  // The default view of a tree with sub-projects: an empty list there points to the project filter.
  protected readonly showRootOnlyHint: Signal<boolean> = computed(() => {
    const selected = this.rollupProjectsFilter();
    // Checking only the root is the same view as the default.
    const rootOnly = this.rollupProjectsMode() === 'default' || (selected.length === 1 && selected[0] === this.project()?.uid);
    return this.activeLens() !== 'me' && rootOnly && this.rollupProjectOptions().length > 1;
  });
  protected readonly rootOnlyEmptyTitle: Signal<string> = computed(
    () => `No ${this.timeFilter() === 'past' ? 'past ' : ''}meetings for ${this.project()?.name ?? 'this project'}`
  );
  private readonly rollupQueryOptions: Signal<MeetingProjectQueryOptions> = computed(
    () => {
      const mode = this.rollupProjectsMode();
      const projectUids = this.rollupProjectsFilter();
      const committeeUid = this.groupFilter();
      const groupType = this.groupTypeFilter();
      return {
        includeSubProjects: true,
        ...(mode === 'default' && { rootOnly: true }),
        ...(mode === 'subset' && { projectUids }),
        ...(committeeUid && { committeeUid }),
        ...(groupType && { groupType }),
      };
      // Structural equality: an equal set of options must not refetch every list.
    },
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
  );
  public project: Signal<ProjectContext | null>;
  protected readonly canWrite = this.projectContextService.canWrite;
  protected readonly canWriteMeetings: Signal<boolean> = this.projectContextService.canWriteMeetings;
  /**
   * Whether meetings v2 is the create surface for this user.
   * @description Read as a signal so the header settles on its own once LaunchDarkly resolves, and
   * defaulted to `false` so a slow or unreachable provider leaves the pre-v2 `/meetings/create`
   * button in place rather than a dropdown into a composer this user isn't targeted for. See
   * `MEETING_V2_ENABLED_FLAG`.
   */
  protected readonly meetingsV2Enabled: Signal<boolean> = meetingsV2EnabledSignal(this.featureFlagService);
  protected readonly publicCalendarUrl: Signal<string | null> = this.initPublicCalendarUrl();
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
  protected readonly nextWindowCount: Signal<number>;
  protected readonly nextMeetingLabel: Signal<string>;
  protected readonly allMeetingsCount: Signal<number>;
  protected readonly pendingRsvpCount: Signal<number>;
  protected readonly acceptedCount: Signal<number>;
  protected readonly maybeCount: Signal<number>;
  protected readonly declinedCount: Signal<number>;
  protected readonly earliestPendingRsvpLabel: Signal<string>;
  protected readonly organizerCount: Signal<number>;
  protected readonly pastThisMonthCount: Signal<number>;
  protected readonly recordingsAvailableCount: Signal<number>;
  protected readonly attendanceRate: Signal<number>;
  protected readonly statsWindowDays = MY_MEETINGS_STATS_WINDOW_DAYS;

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
  // The root the loaded roll-up filter options belong to; null while a root's options are loading.
  private rollupOptionsRootUid: string | null = null;
  // Set once the user changes the selection for the current root, so a late saved choice does not overwrite it.
  private rollupProjectsTouched = false;
  // Bumped whenever a list's first page is requested again, so a Load More page of the previous query is discarded.
  private upcomingQueryVersion = 0;
  private pastQueryVersion = 0;

  public constructor() {
    // Initialize project context first (needed for reactive data loading)
    this.project = computed(() => this.projectContextService.activeContext());

    // Initialize state
    this.meetingsLoading = signal<boolean>(true);
    this.pastMeetingsLoading = signal<boolean>(true);
    this.refresh$ = new BehaviorSubject<void>(undefined);
    this.searchQuery = signal<string>('');
    this.debouncedSearchQuery = toSignal(toObservable(this.searchQuery).pipe(debounceTime(300), distinctUntilChanged()), { initialValue: '' });
    this.timeFilter = computed(() => (this.meetingView() === 'past' ? 'past' : 'upcoming'));
    this.meetingTypeFilter = signal<string | null>(this.readMeetingTypeQueryParam());
    this.foundationFilter = signal<string | null>(null);
    this.projectFilter = signal<string | null>(null);

    this.hasMore = computed(() => this.activeLens() !== 'me' && (this.timeFilter() === 'past' ? !!this.pastPageToken() : !!this.upcomingPageToken()));

    // Initialize meeting type options
    this.meetingTypeOptions = this.initializeMeetingTypeOptions();

    // Roll-up filter options for the foundation/project lens
    this.rollupFilterOptions = this.initRollupFilterOptions();
    this.rollupProjectOptions = computed(() => this.rollupFilterOptions().projects.map((p) => ({ label: p.name, value: p.uid })));
    this.scopedGroups = this.initScopedGroups();
    this.groupOptions = this.initGroupOptions();
    this.groupTypeOptions = this.initGroupTypeOptions();

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
    this.nextWindowCount = this.initNextWindowCount();
    this.nextMeetingLabel = this.initNextMeetingLabel();
    this.allMeetingsCount = computed(() => this.sortedUpcomingUserMeetings().length);
    this.pendingRsvpCount = computed(() => this.sortedUpcomingUserMeetings().filter((m) => isMeetingPendingRsvp(m)).length);
    this.acceptedCount = computed(() => this.sortedUpcomingUserMeetings().filter((m) => isMeetingInviteResponsesEnabled(m) && isMeetingAccepted(m)).length);
    this.maybeCount = this.initResponseCount('maybe');
    this.declinedCount = this.initResponseCount('declined');
    this.earliestPendingRsvpLabel = this.initEarliestPendingRsvpLabel();
    this.organizerCount = this.initOrganizerCount();
    this.pastThisMonthCount = this.initPastThisMonthCount();
    this.recordingsAvailableCount = this.initRecordingsAvailableCount();
    this.attendanceRate = this.initAttendanceRate();

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

    // The composer saves in place instead of navigating, so this list is what the organizer looks at
    // straight after creating a meeting — refetch rather than leave the new meeting missing from it.
    // `skip(1)` drops the value `toObservable` replays on subscribe. The counter is monotonic and lives in
    // a root service, so on any mount after the first save that replay is a non-zero count describing a
    // save this instance already loaded — refetching on it would double every request the streams below
    // just made.
    // `false`: the composer only creates or edits an upcoming meeting, which cannot change whether a
    // past meeting has a recording. Dropping the whole per-uid cache here would re-run
    // `getPastMeetingRecording()` for every past meeting in the 30-day window on each save.
    toObservable(this.composer.saveCount)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.refreshMeetings(false));

    this.syncFiltersToUrl();
    this.resetRollupFiltersOnProjectChange();
    this.resetRollupFiltersOnMeLens();
    this.seedRollupProjects();

    toObservable(this.activeLens)
      .pipe(takeUntilDestroyed())
      .subscribe((lens) => {
        if (lens !== 'me') {
          this.responseFilter.set('all');
          this.organizedByMe.set(false);
          this.hideDeclined.set(false);
        }
      });
  }

  /**
   * Refetches both meeting lists. `clearRecordingCache` also drops the per-uid past-meeting
   * recording cache, which costs one `getPastMeetingRecording()` call per past meeting in the
   * window on the next render — so only callers that can actually have changed recording
   * availability (a card edit or delete, which the past list renders too) ask for it.
   */
  public refreshMeetings(clearRecordingCache = true): void {
    this.meetingsLoading.set(true);
    this.pastMeetingsLoading.set(true);
    if (clearRecordingCache) {
      this.meetingService.clearPastMeetingRecordingCache();
    }
    if (this.activeLens() === 'me') {
      this.userService.refreshUserMeetings();
      this.userService.refreshUserPastMeetings();
    }
    this.refresh$.next();
  }

  /** FullCalendar event click → navigate to the meeting detail. Cancelled occurrences are inert. */
  public onCalendarEventClick(arg: EventClickArg): void {
    const route = resolveMeetingCalendarClickRoute(arg.event.extendedProps as MeetingCalendarClickProps, arg.event.start);
    if (!route) {
      return;
    }
    void this.router.navigate(route.path, route.queryParams ? { queryParams: route.queryParams } : undefined);
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

  public onRollupProjectsFilterChange(value: string[]): void {
    this.rollupAllProjects.set(false);
    this.rollupProjectsFilter.set(value);
    this.rollupProjectsTouched = true;
    const rootUid = this.project()?.uid;
    if (rootUid) {
      this.rollupPreference.save(rootUid, this.savedRollupProjects(rootUid));
    }
    this.reconcileGroupFilters();
  }

  /** "Show all projects" on the root-only empty state: checks every project, as the user's own choice. */
  public showAllRollupProjects(): void {
    this.onRollupProjectsFilterChange(this.rollupProjectOptions().map((option) => option.value));
  }

  public onGroupTypeFilterChange(value: string | null): void {
    this.groupTypeFilter.set(value);
    this.clearGroupOutsideOptions();
  }

  public onMeetingViewChange(value: MeetingDashboardView): void {
    if (value === this.meetingView()) {
      return;
    }
    this.meetingView.set(value);
    this.foundationFilter.set(null);
    this.projectFilter.set(null);
    this.responseFilter.set('all');
    this.organizedByMe.set(false);
    this.hideDeclined.set(false);
    this.replaceQueryParams({ time: value === 'past' ? 'past' : null });
  }

  public resetFilters(): void {
    this.searchQuery.set('');
    this.meetingTypeFilter.set(null);
    this.foundationFilter.set(null);
    this.projectFilter.set(null);
    this.resetRollupProjectsToDefault();
    this.groupFilter.set(null);
    this.groupTypeFilter.set(null);
    this.responseFilter.set('all');
    this.organizedByMe.set(false);
    this.hideDeclined.set(false);
  }

  /** Opens the response queue without retaining criteria that could hide its meetings. */
  public onPendingRsvpStatClick(): void {
    this.onMeetingViewChange('upcoming');
    this.resetFilters();
    this.responseFilter.set('pending');
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

  /**
   * Anonymous, shareable view of this project's PUBLIC meetings — the link a maintainer hands to their
   * community. Null until the active project context resolves.
   *
   * Restricted to the two project-scoped lenses. `me` spans projects, and `org` keeps a retained
   * foundation/project selection that the reader is not currently looking at — linking from there would
   * point at unrelated context. `NavLens` names exactly this pair.
   */
  private initPublicCalendarUrl(): Signal<string | null> {
    return computed(() => {
      const slug = this.project()?.slug;
      const lens = this.activeLens();
      if (!slug || (lens !== 'foundation' && lens !== 'project')) {
        return null;
      }
      return `/projects/${encodeURIComponent(slug)}/calendar`;
    });
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
    const meetingView$ = toObservable(this.meetingView);
    const responseFilter$ = toObservable(this.responseFilter);
    const organizedByMe$ = toObservable(this.organizedByMe);
    const hideDeclined$ = toObservable(this.hideDeclined);
    // The viewer LFID backs the "Organized by me" predicate and can resolve after the meetings do,
    // so it participates in the stream — otherwise the first filtered emission would use a null viewer.
    const viewerUsername$ = toObservable(this.userService.viewerUsername);
    const meLens$ = combineLatest([
      lens$,
      meetingView$,
      searchQuery$,
      meetingType$,
      rawUserMeetings$,
      foundationFilter$,
      projectFilter$,
      viewerUsername$,
      responseFilter$,
      organizedByMe$,
      hideDeclined$,
    ]).pipe(
      // Reset once on a lens transition, not when inactive personal rows, identity or filters change.
      distinctUntilChanged((previous, current) => current[0] !== 'me' && previous[0] === current[0]),
      switchMap(([lens, view, searchQuery, meetingType, rawMeetings, foundation, project, viewerUsername, responseFilter, organizedByMe, hideDeclined]) => {
        if (lens !== 'me') {
          return of<PageResult<Meeting>>({ data: [], page_token: undefined, reset: true });
        }
        if (view === 'past') {
          return of<PageResult<Meeting>>({ data: [], page_token: undefined, reset: true });
        }
        const filtered = this.filterMeLensMeetings(rawMeetings, {
          searchQuery,
          meetingType,
          foundation,
          project,
          view,
          viewerUsername,
          responseFilter,
          organizedByMe,
          hideDeclined,
        });
        return of<PageResult<Meeting>>({ data: filtered, page_token: undefined, reset: true });
      })
    );

    // Project/foundation lens: server-side filtering with pagination
    const firstPage$ = combineLatest([project$, lens$, timeFilter$, this.refresh$, searchQuery$, meetingType$, toObservable(this.rollupQueryOptions)]).pipe(
      switchMap(([project, lens, timeFilter, , searchQuery, meetingType]) => {
        if (lens === 'me') {
          return EMPTY;
        }
        // A new query: pages still in flight for the previous one are dropped, and its cursor is void.
        this.upcomingQueryVersion++;
        this.upcomingPageToken.set(undefined);
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
        return this.meetingService
          .getMeetingsByProjectPaginated(project.uid, undefined, undefined, searchQuery || undefined, filters, this.rollupQueryOptions())
          .pipe(
            map((r): PageResult<Meeting> => ({ ...r, reset: true })),
            catchError(() => of<PageResult<Meeting>>({ data: [], page_token: undefined, reset: true })),
            finalize(() => this.meetingsLoading.set(false))
          );
      })
    );

    // Next pages: emits when loadMore triggers (appends to accumulator)
    const nextPage$ = this.loadMoreUpcoming$.pipe(
      switchMap((pageToken) => {
        const version = this.upcomingQueryVersion;
        const projectUid = this.project()?.uid;
        if (!projectUid) {
          return of<PageResult<Meeting>>({ data: [], page_token: undefined, reset: false });
        }
        this.loadingMore.set(true);
        const searchName = this.debouncedSearchQuery() || undefined;
        const filters = this.buildMeetingTypeFilters(this.meetingTypeFilter());
        return this.meetingService.getMeetingsByProjectPaginated(projectUid, undefined, pageToken, searchName, filters, this.rollupQueryOptions()).pipe(
          map((r): PageResult<Meeting> => ({ ...r, reset: false })),
          catchError(() => of<PageResult<Meeting>>({ data: [], page_token: undefined, reset: false })),
          // After catchError, so a late failure for an older query is dropped too and cannot clear the new cursor.
          filter(() => version === this.upcomingQueryVersion),
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
    const pastViewerUsername$ = toObservable(this.userService.viewerUsername);
    const meLens$ = combineLatest([
      lens$,
      toObservable(this.meetingView),
      searchQuery$,
      meetingType$,
      rawUserPastMeetings$,
      pastFoundationFilter$,
      pastProjectFilter$,
      pastViewerUsername$,
    ]).pipe(
      // Inactive personal emissions must not clear a scoped page that has already arrived.
      distinctUntilChanged((previous, current) => current[0] !== 'me' && previous[0] === current[0]),
      switchMap(([lens, view, searchQuery, meetingType, rawPastMeetings, foundation, project, viewerUsername]) => {
        if (lens !== 'me') {
          return of<PageResult<PastMeeting>>({ data: [], page_token: undefined, reset: true });
        }
        if (view !== 'past') {
          return of<PageResult<PastMeeting>>({ data: [], page_token: undefined, reset: true });
        }
        const filtered = this.filterMeLensMeetings(rawPastMeetings, {
          searchQuery,
          meetingType,
          foundation,
          project,
          view,
          viewerUsername,
          responseFilter: 'all',
          organizedByMe: false,
          hideDeclined: false,
        });
        return of<PageResult<PastMeeting>>({ data: filtered, page_token: undefined, reset: true });
      })
    );

    // Project/foundation lens: server-side filtering with pagination
    const firstPage$ = combineLatest([project$, lens$, timeFilter$, this.refresh$, searchQuery$, meetingType$, toObservable(this.rollupQueryOptions)]).pipe(
      switchMap(([project, lens, timeFilter, , searchQuery, meetingType]) => {
        if (lens === 'me') {
          return EMPTY;
        }
        // A new query: pages still in flight for the previous one are dropped, and its cursor is void.
        this.pastQueryVersion++;
        this.pastPageToken.set(undefined);
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
        return this.meetingService
          .getPastMeetingsByProjectPaginated(project.uid, undefined, searchQuery || undefined, filters, true, this.rollupQueryOptions())
          .pipe(
            map((r): PageResult<PastMeeting> => ({ ...r, reset: true })),
            catchError(() => of<PageResult<PastMeeting>>({ data: [], page_token: undefined, reset: true })),
            finalize(() => this.pastMeetingsLoading.set(false))
          );
      })
    );

    // Next pages: emits when loadMore triggers (appends to accumulator)
    const nextPage$ = this.loadMorePast$.pipe(
      switchMap((pageToken) => {
        const version = this.pastQueryVersion;
        const projectUid = this.project()?.uid;
        if (!projectUid) {
          return of<PageResult<PastMeeting>>({ data: [], page_token: undefined, reset: false });
        }
        this.loadingMore.set(true);
        const searchName = this.debouncedSearchQuery() || undefined;
        const filters = this.buildMeetingTypeFilters(this.meetingTypeFilter());
        return this.meetingService.getPastMeetingsByProjectPaginated(projectUid, pageToken, searchName, filters, true, this.rollupQueryOptions()).pipe(
          map((r): PageResult<PastMeeting> => ({ ...r, reset: false })),
          catchError(() => of<PageResult<PastMeeting>>({ data: [], page_token: undefined, reset: false })),
          // After catchError, so a late failure for an older query is dropped too and cannot clear the new cursor.
          filter(() => version === this.pastQueryVersion),
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
    const identity$ = toObservable(this.userService.meetingFeedIdentity);
    let previousIdentity = this.userService.meetingFeedIdentity();

    // Explicit refresh reconnects the cached source if a previous read completed through catchError.
    const rows = toSignal(
      combineLatest([lens$, timeFilter$, this.refresh$, identity$]).pipe(
        switchMap(([lens, timeFilter, , identity]) => {
          const identityChanged = identity !== previousIdentity;
          previousIdentity = identity;
          // Skip when not on Me lens, not viewing upcoming, or during SSR.
          if (lens !== 'me' || timeFilter !== 'upcoming' || !isPlatformBrowser(this.platformId)) {
            return of([] as Meeting[]);
          }
          this.meetingsLoading.set(true);
          const request$ = this.userService.getUserMeetings().pipe(
            tap(() => this.meetingsLoading.set(false)),
            catchError(() => {
              this.meetingsLoading.set(false);
              return of([] as Meeting[]);
            })
          );
          // Never keep the previous viewer's rows visible while their replacement request is pending.
          return identityChanged ? request$.pipe(startWith([] as Meeting[])) : request$;
        })
      ),
      { initialValue: [] as Meeting[] }
    );
    // Hide removed registrations even while the query index still returns them, without dropping organizers.
    return computed(() => {
      const removed = this.meetingService.removedRegistrationMeetingIds();
      return removed.size === 0 ? rows() : rows().filter((meeting) => meeting.organizer || !removed.has(meeting.id));
    });
  }

  private initializeRawUserPastMeetings(): Signal<PastMeeting[]> {
    const lens$ = toObservable(this.activeLens);
    const timeFilter$ = toObservable(this.timeFilter);
    const identity$ = toObservable(this.userService.meetingFeedIdentity);
    let previousIdentity = this.userService.meetingFeedIdentity();

    return toSignal(
      combineLatest([lens$, timeFilter$, this.refresh$, identity$]).pipe(
        switchMap(([lens, timeFilter, , identity]) => {
          const identityChanged = identity !== previousIdentity;
          previousIdentity = identity;
          // Skip when not on Me lens, not viewing past, or during SSR.
          if (lens !== 'me' || timeFilter !== 'past' || !isPlatformBrowser(this.platformId)) {
            return of([] as PastMeeting[]);
          }
          this.pastMeetingsLoading.set(true);
          const request$ = this.userService.getUserPastMeetings().pipe(
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
          return identityChanged ? request$.pipe(startWith([] as PastMeeting[])) : request$;
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

  private initResponseCount(response: MeetingRsvp['response_type']): Signal<number> {
    return computed(() => {
      let count = 0;
      for (const meeting of this.sortedUpcomingUserMeetings()) {
        if (isMeetingInviteResponsesEnabled(meeting) && getApplicableMeetingRsvp(meeting)?.response_type === response) {
          count++;
        }
      }
      return count;
    });
  }

  private filterMeLensMeetings<T extends Meeting>(items: T[], filters: MeLensMeetingFilters): T[] {
    const { searchQuery, meetingType, foundation, project, view, viewerUsername, responseFilter, organizedByMe, hideDeclined } = filters;
    let filtered = items;

    if (view === 'upcoming' && hideDeclined && responseFilter !== 'declined') {
      filtered = filtered.filter((m) => !isMeetingHiddenAsDeclined(m, viewerUsername));
    }

    if (project) {
      filtered = filtered.filter((m) => m.project_uid === project);
    } else if (foundation) {
      // Show meetings for the foundation itself and its non-foundation children only.
      // Sub-foundations (is_foundation: true with parent = this foundation) are their own
      // top-level filter entries, so exclude them and their children here.
      filtered = filtered.filter((m) => m.project_uid === foundation || (m.parent_project_uid === foundation && !m.is_foundation));
    }

    if (view === 'upcoming' && responseFilter === 'pending') {
      filtered = filtered.filter((m) => isMeetingPendingRsvp(m));
    } else if (view === 'upcoming' && responseFilter !== 'all') {
      // The BFF may carry a fallback RSVP from another date. Do not classify the next date
      // as Going/Maybe/Not going unless that response actually applies to it.
      filtered = filtered.filter((m) => {
        if (!isMeetingInviteResponsesEnabled(m) || !m.my_rsvp) return false;
        return getApplicableMeetingRsvp(m)?.response_type === responseFilter;
      });
    }
    if (view === 'upcoming' && organizedByMe) {
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

  private meetingStartLabel(meeting: Meeting, options: Intl.DateTimeFormatOptions): string {
    const occ = getCurrentOrNextOccurrence(meeting);
    return new Date(occ ? occ.start_time : meeting.start_time).toLocaleString('en-US', options);
  }

  private initNextWindowCount(): Signal<number> {
    return computed(() => countMeetingDatesBefore(this.sortedUpcomingUserMeetings(), Date.now() + this.statsWindowDays * 24 * 60 * 60 * 1000));
  }

  private initNextMeetingLabel(): Signal<string> {
    return computed(() => {
      const first = this.sortedUpcomingUserMeetings()[0];
      if (!first) return '';
      const when = this.meetingStartLabel(first, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      return first.title ? `${when} · ${first.title}` : when;
    });
  }

  private initEarliestPendingRsvpLabel(): Signal<string> {
    return computed(() => {
      const first = this.sortedUpcomingUserMeetings().find((m) => isMeetingPendingRsvp(m));
      return first ? this.meetingStartLabel(first, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
    });
  }

  private initOrganizerCount(): Signal<number> {
    return computed(() => {
      const viewer = this.userService.viewerUsername();
      const meetings = this.sortedUpcomingUserMeetings();
      return meetings.filter((m) => isMeetingOrganizedByViewer(m, viewer)).length;
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

  private initFpUpcomingCount(): Signal<number> {
    return this.initFpCount(this.fpUpcomingCountLoading, (uid) => this.meetingService.getMeetingsCountByProject(uid, this.rollupQueryOptions()));
  }

  private initFpPastCount(): Signal<number> {
    return this.initFpCount(this.fpPastCountLoading, (uid) => this.meetingService.getPastMeetingsCountByProject(uid, this.rollupQueryOptions()));
  }

  private initFpCount(loadingSignal: WritableSignal<boolean>, fetchFn: (uid: string) => Observable<number>): Signal<number> {
    const project$ = toObservable(this.project);
    const lens$ = toObservable(this.activeLens);

    return toSignal(
      combineLatest([project$, lens$, this.refresh$, toObservable(this.rollupQueryOptions)]).pipe(
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
      combineLatest([project$, lens$, timeFilter$, this.refresh$, toObservable(this.rollupQueryOptions)]).pipe(
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
          // Max-size pages keep a rolled-up foundation (every sub-project's meetings) well inside the
          // 10-page cap, so the calendar and stat tiles are not cut short.
          const fetchPage = (pageToken?: string) =>
            this.meetingService.getMeetingsByProjectPaginated(projectUid, undefined, pageToken, undefined, undefined, {
              ...this.rollupQueryOptions(),
              pageSize: QUERY_SERVICE_MAX_PAGE_SIZE,
            });
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
      combineLatest([project$, lens$, timeFilter$, this.refresh$, toObservable(this.rollupQueryOptions)]).pipe(
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
          const fetchPage = (pageToken?: string) =>
            this.meetingService.getPastMeetingsByProjectPaginated(projectUid, pageToken, undefined, undefined, false, {
              ...this.rollupQueryOptions(),
              pageSize: QUERY_SERVICE_MAX_PAGE_SIZE,
            });
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

  /** The roll-up's projects and groups, loaded per foundation/project; none on the Me lens or before hydration. */
  private initRollupFilterOptions(): Signal<MeetingRollupFilterOptions> {
    const empty: MeetingRollupFilterOptions = { projects: [], groups: [], complete: false };
    return toSignal(
      combineLatest([toObservable(this.project), toObservable(this.activeLens)]).pipe(
        map(([project, lens]) => (lens === 'me' || !isPlatformBrowser(this.platformId) ? null : (project?.uid ?? null))),
        distinctUntilChanged(),
        switchMap((uid) => {
          this.rollupOptionsRootUid = null;
          if (!uid) {
            return of(empty);
          }
          return this.meetingService.getRollupFilterOptions(uid).pipe(
            tap(() => (this.rollupOptionsRootUid = uid)),
            startWith(empty)
          );
        })
      ),
      { initialValue: empty }
    );
  }

  /** Groups of the selected projects: the root's own by default, every project's when all are selected. */
  private initScopedGroups(): Signal<MeetingRollupGroupOption[]> {
    return computed(() => {
      const groups = this.rollupFilterOptions().groups;
      const mode = this.rollupProjectsMode();
      if (mode === 'all') return groups;
      // The default shows only the root's own meetings, so only its own groups can match.
      const selected = new Set(mode === 'default' ? [this.project()?.uid] : this.rollupProjectsFilter());
      return groups.filter((group) => selected.has(group.project_uid));
    });
  }

  /** Scoped groups of the selected group type, labelled with their project when it is not the context one. */
  private initGroupOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => {
      const projectNames = new Map(this.rollupFilterOptions().projects.map((p) => [p.uid, p.name]));
      const contextUid = this.project()?.uid;
      const groupType = this.groupTypeFilter();
      return this.scopedGroups()
        .filter((group) => !groupType || group.category === groupType)
        .map((group) => {
          const projectName = group.project_uid !== contextUid ? projectNames.get(group.project_uid) : undefined;
          return { label: projectName ? `${group.name} (${projectName})` : group.name, value: group.uid };
        });
    });
  }

  /** The group categories present in the selected projects, sorted. */
  private initGroupTypeOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => {
      const categories = new Set(this.scopedGroups().flatMap((group) => (group.category ? [group.category] : [])));
      return [...categories].sort((a, b) => a.localeCompare(b)).map((category) => ({ label: category, value: category }));
    });
  }

  /** Clears the group filter once the project or group-type selection no longer offers it. */
  private clearGroupOutsideOptions(): void {
    const group = this.groupFilter();
    if (group && !this.groupOptions().some((option) => option.value === group)) {
      this.groupFilter.set(null);
    }
  }

  /** Mirrors the filters and the List/Calendar choice into the URL, so a filtered view can be bookmarked or shared. */
  private syncFiltersToUrl(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const params = computed(() => {
      return {
        projects: this.rollupProjectsQueryParam(),
        group: this.groupFilter(),
        group_type: this.groupTypeFilter(),
        type: this.meetingTypeFilter(),
        view: this.viewMode() === 'calendar' ? 'calendar' : null,
      };
    });
    toObservable(params)
      .pipe(
        skip(1),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed()
      )
      .subscribe((queryParams) => this.replaceQueryParams(queryParams));
  }

  /**
   * The roll-up filters have no controls on the Me lens, so switching there from the foundation/project
   * lens clears them. Only an actual switch counts: the lens can start on `me` until grants resolve
   * (LFXV2-2754), and that first value must not wipe filters a shared link carried.
   */
  private resetRollupFiltersOnMeLens(): void {
    toObservable(this.activeLens)
      .pipe(distinctUntilChanged(), pairwise(), takeUntilDestroyed())
      .subscribe(([previous, current]) => {
        if (current === 'me' && (previous === 'foundation' || previous === 'project')) {
          this.rollupAllProjects.set(false);
          this.rollupProjectsFilter.set([]);
          this.groupFilter.set(null);
          this.groupTypeFilter.set(null);
        }
      });
  }

  /**
   * Rewrites only the given query params on the live address. `ProjectContextService` moves `?project=`
   * with `Location.replaceState`, which leaves the Router's own query params stale, so merging through
   * `router.navigate` could put a previous project back in the URL. Same pattern as its
   * `syncProjectQueryParam`, and skipped mid-navigation for the same reason.
   */
  private replaceQueryParams(params: Record<string, string | null>): void {
    if (this.router.getCurrentNavigation()) {
      return;
    }
    const urlTree = this.router.parseUrl(this.location.path(true));
    for (const [name, value] of Object.entries(params)) {
      if (value === null) {
        delete urlTree.queryParams[name];
      } else {
        urlTree.queryParams[name] = value;
      }
    }
    this.location.replaceState(this.router.serializeUrl(urlTree));
  }

  /** Group selections belong to one tree, so switching to another foundation or project clears them; the project selection is re-seeded. */
  private resetRollupFiltersOnProjectChange(): void {
    toObservable(computed(() => this.project()?.uid))
      .pipe(distinctUntilChanged(), pairwise(), takeUntilDestroyed())
      .subscribe(([previous, current]) => {
        if (previous && previous !== current) {
          this.groupFilter.set(null);
          this.groupTypeFilter.set(null);
        }
      });
  }

  /**
   * Seeds the project selection each time the page lands on a foundation or project (GH-5566): a link's
   * `projects` param on the first one, else the root alone (its own meetings) straight away, then the
   * user's saved choice once it and the options are known. A saved or linked "all" checks every project;
   * saved projects no longer in the tree are dropped, falling back to the root. A change the user makes
   * meanwhile wins over a late saved choice.
   */
  private seedRollupProjects(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    let linked = this.urlRollupProjects;
    // Created once here, in injection context: one inside the switchMap would add an effect per root that
    // lives until the component is destroyed. Its replayed latest value serves each new root.
    const options$ = toObservable(this.rollupFilterOptions);
    combineLatest([toObservable(this.activeLens), toObservable(computed(() => this.project()?.uid ?? null))])
      .pipe(
        map(([lens, uid]) => ((lens === 'foundation' || lens === 'project') && uid ? uid : null)),
        distinctUntilChanged(),
        switchMap((rootUid) => {
          if (!rootUid) {
            return EMPTY;
          }
          this.rollupProjectsTouched = false;
          const fromLink = linked;
          linked = null;
          if (!fromLink) {
            this.rollupAllProjects.set(false);
            if (this.rollupProjectsFilter().length > 0) {
              this.rollupProjectsFilter.set([]);
            }
          }
          // A link wins; then a choice made earlier this session (its save may still be pending); then the stored one.
          const sessionChoice = fromLink ? undefined : this.rollupPreference.latestChoice(rootUid);
          const choice$ =
            fromLink || sessionChoice ? of<string[] | null>(fromLink ?? sessionChoice ?? null) : this.meetingService.getRollupProjectsPreference(rootUid);
          const rootOptions$ = options$.pipe(
            // Only options loaded for this root: a previous root's (which may contain this one) would let a
            // saved choice keep projects outside this tree.
            filter((options) => this.rollupOptionsRootUid === rootUid && options.projects.some((p) => p.uid === rootUid)),
            take(1)
          );
          return choice$.pipe(
            // "All projects" needs no options: cover every project now, check the boxes once they load.
            tap((choice) => {
              if (!this.rollupProjectsTouched && choice !== null && MeetingsDashboardComponent.isAllRollupProjectsChoice(choice)) {
                this.rollupAllProjects.set(true);
              }
            }),
            switchMap((choice) => rootOptions$.pipe(map((options) => ({ rootUid, choice, options }))))
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe(({ rootUid, choice, options }) => {
        if (this.rollupProjectsTouched) {
          return;
        }
        const all = options.projects.map((p) => p.uid);
        if (choice !== null && MeetingsDashboardComponent.isAllRollupProjectsChoice(choice)) {
          this.rollupProjectsFilter.set(all);
        } else if (choice !== null) {
          const valid = choice.filter((uid) => all.includes(uid) && uid !== rootUid);
          // The root alone is the default, shown as an empty picker; otherwise keep the root if it was chosen.
          this.rollupProjectsFilter.set(valid.length > 0 ? choice.filter((uid) => all.includes(uid)) : []);
        }
        // A group or group type from a link may sit outside the seeded scope; drop it rather than match nothing.
        this.reconcileGroupFilters();
      });
  }

  /** A saved or linked choice of every project: an empty saved list, or a link's `all`. */
  private static isAllRollupProjectsChoice(choice: string[]): boolean {
    return choice.length === 0 || choice.includes(MEETING_ROLLUP_ALL_PROJECTS);
  }

  /** Drops a group type, then a group, that the current project scope no longer offers: they would match nothing. */
  private reconcileGroupFilters(): void {
    const groupType = this.groupTypeFilter();
    if (groupType && !this.groupTypeOptions().some((option) => option.value === groupType)) {
      this.groupTypeFilter.set(null);
    }
    this.clearGroupOutsideOptions();
  }

  /** "Reset filters" returns the selection to the default (the root alone), and saves that as the user's choice. */
  private resetRollupProjectsToDefault(): void {
    this.rollupAllProjects.set(false);
    this.rollupProjectsFilter.set([]);
    const rootUid = this.project()?.uid;
    if (rootUid && this.activeLens() !== 'me') {
      this.rollupProjectsTouched = true;
      this.rollupPreference.save(rootUid, [rootUid]);
    }
  }

  /** The choice to save for a root: the root alone for the default, empty for all projects, else the subset. */
  private savedRollupProjects(rootUid: string): string[] {
    const mode = this.rollupProjectsMode();
    if (mode === 'default') return [rootUid];
    return mode === 'all' ? [] : this.rollupProjectsFilter();
  }

  /** The `projects` URL param: absent for the default (the root alone), `all` for every project, else the UIDs. */
  private rollupProjectsQueryParam(): string | null {
    const mode = this.rollupProjectsMode();
    if (mode === 'default') return null;
    if (mode === 'all') return MEETING_ROLLUP_ALL_PROJECTS;
    const selected = this.rollupProjectsFilter();
    return selected.length === 1 && selected[0] === this.project()?.uid ? null : selected.join(',');
  }

  /** The link's `projects` selection: `null` when the link names none, `['all']` for every project. */
  private readRollupProjectsQueryParam(): string[] | null {
    const value = this.route.snapshot.queryParamMap.get('projects');
    const uids = value ? value.split(',').filter(Boolean) : [];
    return uids.length > 0 ? uids : null;
  }

  /** Before seeding: the linked projects (the default until the options resolve a linked "all"), else the default. */
  private initialRollupProjects(): string[] {
    const linked = this.urlRollupProjects;
    return linked && !linked.includes(MEETING_ROLLUP_ALL_PROJECTS) ? linked : [];
  }

  /** The `type` URL param, kept only when it names a known meeting type. */
  private readMeetingTypeQueryParam(): string | null {
    const value = this.route.snapshot.queryParamMap.get('type');
    return value && Object.values(MEETING_TYPE_CONFIGS).some((config) => config.label === value) ? value : null;
  }

  /** Whether the project selection is a subset other than the root alone (the default) or all projects. */
  private isRollupProjectsNarrowed(): boolean {
    const selected = this.rollupProjectsFilter();
    return this.rollupProjectsMode() === 'subset' && !(selected.length === 1 && selected[0] === this.project()?.uid);
  }

  private initIsFiltered(): Signal<boolean> {
    return computed(
      () =>
        !!this.debouncedSearchQuery() ||
        !!this.meetingTypeFilter() ||
        !!this.foundationFilter() ||
        !!this.projectFilter() ||
        this.isRollupProjectsNarrowed() ||
        !!this.groupFilter() ||
        !!this.groupTypeFilter() ||
        (this.activeLens() === 'me' && this.timeFilter() === 'upcoming' && (this.responseFilter() !== 'all' || this.organizedByMe() || this.hideDeclined()))
    );
  }

  private initCalendarEvents(): Signal<EventInput[]> {
    return computed(() => {
      const lens = this.activeLens();
      const search = this.debouncedSearchQuery();
      const meetingType = this.meetingTypeFilter();
      // Personal calendar criteria mirror the selected view; scoped raw sources only need search/type.
      const filtered =
        lens === 'me'
          ? this.filterMeLensMeetings([...this.rawUserMeetings(), ...this.rawUserPastMeetings()], {
              searchQuery: search,
              meetingType,
              foundation: this.foundationFilter(),
              project: this.projectFilter(),
              view: this.meetingView(),
              viewerUsername: this.userService.viewerUsername(),
              responseFilter: this.responseFilter(),
              organizedByMe: this.organizedByMe(),
              hideDeclined: this.hideDeclined(),
            })
          : this.filterBySearchAndType([...this.rawFpUpcomingMeetings(), ...this.rawFpPastMeetings()], search, meetingType);
      const contextUid = this.rollupContextUid();
      return filtered.flatMap((m) => meetingToCalendarEvents(m, contextUid) as EventInput[]);
    });
  }
}
