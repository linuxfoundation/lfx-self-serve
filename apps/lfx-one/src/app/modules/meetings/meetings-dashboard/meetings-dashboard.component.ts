// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MeetingCardComponent } from '@app/modules/meetings/components/meeting-card/meeting-card.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { MEETING_TYPE_CONFIGS } from '@lfx-one/shared/constants';
import { Lens, Meeting, PageResult, PastMeeting, ProjectContext } from '@lfx-one/shared/interfaces';
import { getCurrentOrNextOccurrence, hasMeetingEnded } from '@lfx-one/shared/utils';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { OnRenderDirective } from '@shared/directives/on-render.directive';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  finalize,
  map,
  merge,
  of,
  scan,
  Subject,
  switchMap,
  tap,
} from 'rxjs';

import { MeetingsTopBarComponent } from './components/meetings-top-bar/meetings-top-bar.component';

@Component({
  selector: 'lfx-meetings-dashboard',
  imports: [MeetingCardComponent, MeetingsTopBarComponent, ButtonComponent, CardComponent, OnRenderDirective],
  templateUrl: './meetings-dashboard.component.html',
  styleUrl: './meetings-dashboard.component.scss',
})
export class MeetingsDashboardComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly lensService = inject(LensService);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  public readonly activeLens: Signal<Lens> = this.lensService.activeLens;

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
  public showFoundationFilter: Signal<boolean>;
  public showProjectFilter: Signal<boolean>;
  public foundationOptions: Signal<{ label: string; value: string }[]>;
  public projectOptions: Signal<{ label: string; value: string }[]>;
  public project: Signal<ProjectContext | null>;
  public isMaintainer: Signal<boolean>;
  public isFoundationContext: Signal<boolean>;
  public foundationCreateMeetingFlag: Signal<boolean>;
  public canCreateMeeting: Signal<boolean>;
  public loadingMore = signal(false);
  public hasMore: Signal<boolean>;
  public autoLoadTriggerIndex: Signal<number>;

  // Raw user meetings cached for client-side filtering (Me lens only)
  private rawUserMeetings: Signal<Meeting[]>;
  private rawUserPastMeetings: Signal<PastMeeting[]>;

  private upcomingPageToken = signal<string | undefined>(undefined);
  private pastPageToken = signal<string | undefined>(undefined);
  private loadMoreUpcoming$ = new Subject<string>();
  private loadMorePast$ = new Subject<string>();

  public constructor() {
    // Initialize project context first (needed for reactive data loading)
    this.project = computed(() => this.projectContextService.activeContext());

    // Initialize permission checks
    this.isMaintainer = computed(() => this.personaService.currentPersona() === 'maintainer');
    this.isFoundationContext = computed(() => this.projectContextService.isFoundationContext());
    this.foundationCreateMeetingFlag = this.featureFlagService.getBooleanFlag('foundation-create-meeting', false);
    this.canCreateMeeting = computed(() => {
      if (this.activeLens() === 'me') {
        return false;
      }
      const isMaintainerAndNotFoundation = this.isMaintainer() && !this.isFoundationContext();
      const hasFeatureFlag = this.foundationCreateMeetingFlag();
      return isMaintainerAndNotFoundation || hasFeatureFlag;
    });

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
    this.foundationOptions = this.initializeFoundationOptions();
    this.projectOptions = this.initializeProjectOptions();
    this.showFoundationFilter = computed(() => this.activeLens() === 'me' && this.personaService.hasBoardRole() && this.foundationOptions().length > 1);
    this.showProjectFilter = computed(() => this.activeLens() === 'me' && this.personaService.hasProjectRole() && this.projectOptions().length > 1);
    this.hasMore = computed(() => this.activeLens() !== 'me' && (this.timeFilter() === 'past' ? !!this.pastPageToken() : !!this.upcomingPageToken()));

    // Initialize meeting type options
    this.meetingTypeOptions = this.initializeMeetingTypeOptions();

    // Initialize Me lens data (fetched once, filtered client-side)
    this.rawUserMeetings = this.initializeRawUserMeetings();
    this.rawUserPastMeetings = this.initializeRawUserPastMeetings();

    // Initialize data with reactive pattern
    this.upcomingMeetings = this.initializeUpcomingMeetings();
    this.pastMeetings = this.initializePastMeetings();
    this.filteredMeetings = this.initializeFilteredMeetings();

    // Sentinel is placed at 50% of the list to trigger auto-load as user scrolls
    this.autoLoadTriggerIndex = computed(() => Math.floor(this.filteredMeetings().length / 2));
  }

  public refreshMeetings(): void {
    this.meetingsLoading.set(true);
    this.pastMeetingsLoading.set(true);
    this.refresh$.next();
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
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { time: value === 'past' ? 'past' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
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

  private initializeUpcomingMeetings(): Signal<Meeting[]> {
    const project$ = toObservable(this.project);
    const lens$ = toObservable(this.activeLens);
    const timeFilter$ = toObservable(this.timeFilter);
    const searchQuery$ = toObservable(this.debouncedSearchQuery);
    const meetingType$ = toObservable(this.meetingTypeFilter);

    // Me lens: client-side filtering on cached data (no additional API calls)
    const rawUserMeetings$ = toObservable(this.rawUserMeetings);
    const meLens$ = combineLatest([lens$, timeFilter$, searchQuery$, meetingType$, rawUserMeetings$]).pipe(
      switchMap(([lens, timeFilter, searchQuery, meetingType, rawMeetings]) => {
        if (lens !== 'me' || timeFilter !== 'upcoming') {
          return of<PageResult<Meeting>>({ data: [], page_token: undefined, reset: true });
        }
        const filtered = this.filterBySearchAndType(rawMeetings, searchQuery, meetingType);
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

        this.meetingsLoading.set(true);
        const filters = this.buildMeetingTypeFilters(meetingType);
        return this.meetingService.getMeetingsByProjectPaginated(project.uid, 50, undefined, undefined, searchQuery || undefined, filters).pipe(
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
        return this.meetingService.getMeetingsByProjectPaginated(projectUid, 50, undefined, pageToken, searchName, filters).pipe(
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
    const meLens$ = combineLatest([lens$, timeFilter$, searchQuery$, meetingType$, rawUserPastMeetings$]).pipe(
      switchMap(([lens, timeFilter, searchQuery, meetingType, rawPastMeetings]) => {
        if (lens !== 'me' || timeFilter !== 'past') {
          return of<PageResult<PastMeeting>>({ data: [], page_token: undefined, reset: true });
        }
        const filtered = this.filterBySearchAndType(rawPastMeetings, searchQuery, meetingType);
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

        this.pastMeetingsLoading.set(true);
        const filters = this.buildMeetingTypeFilters(meetingType);
        return this.meetingService.getPastMeetingsByProjectPaginated(project.uid, 50, undefined, searchQuery || undefined, filters).pipe(
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
        return this.meetingService.getPastMeetingsByProjectPaginated(projectUid, 50, pageToken, searchName, filters).pipe(
          map((r): PageResult<PastMeeting> => ({ ...r, reset: false })),
          catchError(() => of<PageResult<PastMeeting>>({ data: [], page_token: undefined, reset: false })),
          finalize(() => this.loadingMore.set(false))
        );
      })
    );

    return toSignal(
      merge(meLens$, firstPage$, nextPage$).pipe(
        tap((response) => this.pastPageToken.set(response.page_token)),
        scan((acc: PastMeeting[], response: PageResult<PastMeeting>) => {
          // TODO: Remove client-side sorting once API supports sorting by scheduled_start_time
          const sorted = response.data.sort((a, b) => {
            const timeA = new Date(a.scheduled_start_time).getTime();
            const timeB = new Date(b.scheduled_start_time).getTime();
            return timeB - timeA;
          });
          return response.reset ? sorted : [...acc, ...sorted];
        }, [])
      ),
      { initialValue: [] }
    );
  }

  private initializeRawUserMeetings(): Signal<Meeting[]> {
    const lens$ = toObservable(this.activeLens);
    const projectFilter$ = toObservable(this.projectFilter);
    const foundationFilter$ = toObservable(this.foundationFilter);

    return toSignal(
      combineLatest([lens$, this.refresh$, projectFilter$, foundationFilter$]).pipe(
        switchMap(([lens, , projectFilter, foundationFilter]) => {
          if (lens !== 'me') {
            return of([] as Meeting[]);
          }
          this.meetingsLoading.set(true);
          return this.userService.getUserMeetings(undefined, projectFilter ?? undefined, foundationFilter ?? undefined).pipe(
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
    const projectFilter$ = toObservable(this.projectFilter);
    const foundationFilter$ = toObservable(this.foundationFilter);

    return toSignal(
      combineLatest([lens$, this.refresh$, projectFilter$, foundationFilter$]).pipe(
        switchMap(([lens, , projectFilter, foundationFilter]) => {
          if (lens !== 'me') {
            return of([] as PastMeeting[]);
          }
          this.pastMeetingsLoading.set(true);
          return this.userService.getUserPastMeetings(undefined, projectFilter ?? undefined, foundationFilter ?? undefined).pipe(
            tap(() => this.pastMeetingsLoading.set(false)),
            catchError(() => {
              this.pastMeetingsLoading.set(false);
              return of([] as PastMeeting[]);
            })
          );
        })
      ),
      { initialValue: [] as PastMeeting[] }
    );
  }

  private filterAndSortUpcomingMeetings(meetings: Meeting[]): Meeting[] {
    // TODO: Remove client-side filtering once API supports filtering by end time + 40-minute buffer
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

  private initializeFoundationOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => {
      const projects = this.personaService.detectedProjects();
      return projects.filter((p) => p.isFoundation).map((p) => ({ label: p.projectName ?? p.projectSlug, value: p.projectUid }));
    });
  }

  private initializeProjectOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => {
      const projects = this.personaService.detectedProjects();
      const foundation = this.foundationFilter();

      // Filter to non-foundation projects
      let candidates = projects.filter((p) => !p.isFoundation);

      // If a foundation is selected, show only its children
      if (foundation) {
        candidates = candidates.filter((p) => p.parentProjectUid === foundation);
      }

      return candidates.map((p) => ({ label: p.projectName ?? p.projectSlug, value: p.projectUid }));
    });
  }

  private buildMeetingTypeFilters(meetingType: string | null): string[] | undefined {
    if (!meetingType) {
      return undefined;
    }
    return [`meeting_type:${meetingType}`];
  }
}
