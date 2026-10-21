// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, LowerCasePipe } from '@angular/common';
import { Component, computed, inject, input, output, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { PollStatus, VOTE_LABEL, VOTES_PAGE_WALK_LIMIT, VoteResponseStatus } from '@lfx-one/shared';
import { MY_VOTES_STATS_WINDOW_DAYS, VOTES_STATS_WINDOW_DAYS } from '@lfx-one/shared/constants';
import {
  Committee,
  MyVotesQuickFilter,
  ProjectContext,
  StatCardItem,
  Vote,
  VoteFilterState,
  VoteListResponse,
  VotePermalinkTarget,
  VoteStatusCounts,
  VoteSummary,
} from '@lfx-one/shared/interfaces';
import {
  countVotesByStatus,
  findCursorWalkStartIndex,
  getUserTimezone,
  matchesMyVotesQuickFilter,
  recordPageToken,
  resolveCursorWalkOutcome,
} from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { VoteService } from '@services/vote.service';
import { formatInTimeZone } from 'date-fns-tz';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, combineLatest, EMPTY, expand, filter, finalize, last, map, Observable, of, startWith, switchMap, take, tap } from 'rxjs';

import { VoteCastDrawerComponent } from '../components/vote-cast-drawer/vote-cast-drawer.component';
import { VoteResultsDrawerComponent } from '../components/vote-results-drawer/vote-results-drawer.component';
import { VotesTableComponent } from '../components/votes-table/votes-table.component';
import { PageHeaderComponent } from '@components/page-header/page-header.component';

@Component({
  selector: 'lfx-votes-dashboard',
  imports: [
    LowerCasePipe,
    ButtonComponent,
    VotesTableComponent,
    VoteResultsDrawerComponent,
    VoteCastDrawerComponent,
    RouterLink,
    EmptyStateComponent,
    SkeletonModule,
    StatCardGridComponent,
    PageHeaderComponent,
  ],
  templateUrl: './votes-dashboard.component.html',
  styleUrl: './votes-dashboard.component.scss',
})
export class VotesDashboardComponent {
  // === Services ===
  private readonly voteService = inject(VoteService);
  private readonly committeeService = inject(CommitteeService);
  private readonly lensService = inject(LensService);
  private readonly personaService = inject(PersonaService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  /** Set by VotePermalinkComponent (`/votes/:id`): the drawer to open once for the linked vote. Null on the routed dashboard. */
  public readonly permalinkTarget = input<VotePermalinkTarget | null>(null);

  // === Outputs ===
  /** Emits once when the permalink drawer has closed, so the host can drop the vote from the URL. */
  public readonly permalinkClosed = output<void>();

  // === Constants ===
  protected readonly voteLabel = VOTE_LABEL.singular;
  protected readonly voteLabelPlural = VOTE_LABEL.plural;
  private readonly viewerTimezone = isPlatformBrowser(this.platformId) ? getUserTimezone() : 'UTC';

  // === Subjects ===
  // refresh$ triggers count re-fetch (manual refresh, project change)
  protected readonly refresh$ = new BehaviorSubject<void>(undefined);
  // fetch$ triggers votes list re-fetch (pagination, manual refresh)
  private readonly fetch$ = new BehaviorSubject<void>(undefined);
  private readonly managementSummaryRefresh$ = new BehaviorSubject<void>(undefined);

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(true);
  protected readonly canWrite = this.projectContextService.canWrite;
  protected readonly resultsDrawerVisible = signal<boolean>(false);
  protected readonly castDrawerVisible = signal<boolean>(false);
  protected readonly selectedVoteId = signal<string | null>(null);
  // Confirmed deadline from votes-table's voteExtended output, held until votes()/myVotes() reflects a
  // deadline at least as new — a stale search-index refresh otherwise leaves the open results drawer
  // showing the pre-extension deadline indefinitely (per @greptile-apps, GH-3823 review).
  private readonly extendedVoteOverride = signal<Vote | null>(null);
  protected readonly rowsPerPage = signal<number>(10);
  protected readonly currentFirst = signal<number>(0);
  protected readonly totalRecords = signal<number>(0);
  protected readonly totalCountReady = signal(false);
  protected readonly myVotesLoading = signal<boolean>(true);
  protected readonly foundationFilter = signal<string | null>(null);
  protected readonly projectFilter = signal<string | null>(null);
  protected readonly myVotesQuickFilter = signal<MyVotesQuickFilter | null>(null);
  // Voting pages open on Active; the shared table's own default (All) stays for committee reuse.
  protected readonly myVotesStatusTab = signal<string>(PollStatus.ACTIVE);
  protected readonly myVotesNowMs = signal(Date.now());
  protected readonly myVotesError = signal(false);
  protected readonly myVotesComplete = signal(false);
  protected readonly managementClosingOnly = signal(false);
  protected readonly managementSummaryLoading = signal(true);
  protected readonly managementSummaryError = signal(false);
  protected readonly managementStatusCountsLoading = signal(true);
  protected readonly managementStatusCountsError = signal(false);

  // === Lens ===
  protected readonly isMeLens: Signal<boolean> = computed(() => this.lensService.activeLens() === 'me');
  protected readonly personaLoaded = this.personaService.personaLoaded;
  public showFoundationFilter: Signal<boolean> = computed(() => this.isMeLens() && this.personaService.hasBoardRole() && this.foundationOptions().length > 1);
  public showProjectFilter: Signal<boolean> = computed(() => this.isMeLens() && this.personaService.hasProjectRole() && this.projectOptions().length > 1);

  // === Filter State ===
  // Starts on Active so the first management list/count requests match the selected tab.
  protected readonly filters = signal<VoteFilterState>(
    { search: '', status: PollStatus.ACTIVE, group: null },
    { equal: (a, b) => a.search === b.search && a.status === b.status && a.group === b.group }
  );

  // === Page Tokens ===
  // Sequential token array: index 0 = token for page 2, index 1 = token for page 3, etc.
  private pageTokens: string[] = [];

  // === Permalink ===
  // The uid the permalink drawer was opened for — opening once keeps a later target re-emission
  // from reopening a drawer the user closed.
  private openedPermalinkUid: string | null = null;

  // === Computed Signals ===
  protected readonly project: Signal<ProjectContext | null> = this.initProject();
  protected readonly searchQuery: Signal<string> = this.initSearchQuery();
  protected readonly groupOptions: Signal<{ label: string; value: string | null }[]> = this.initGroupOptions();
  protected readonly isManagementVotesLens = computed(() => ['project', 'foundation'].includes(this.lensService.activeLens()) && !!this.project()?.uid);
  protected readonly managementSummaryScope = this.initManagementSummaryScope();
  protected readonly managementSummary = this.initManagementSummary();
  protected readonly managementVoteStatCards = this.initManagementVoteStatCards();
  protected readonly managementStatusCountsScope = this.initManagementStatusCountsScope();
  protected readonly managementStatusCounts: Signal<VoteStatusCounts | null> = this.initManagementStatusCounts();
  private readonly voteRequestScope = this.initVoteRequestScope();
  protected readonly votes: Signal<Vote[]> = this.initVotes();
  protected readonly selectedListVote: Signal<Vote | null> = this.initSelectedListVote();
  protected readonly myVotes: Signal<Vote[]> = this.initMyVotes();
  protected readonly totalCount: Signal<number> = this.initTotalCount();
  protected readonly foundationOptions: Signal<{ label: string; value: string | null }[]> = this.initializeFoundationOptions();
  protected readonly projectOptions: Signal<{ label: string; value: string | null }[]> = this.initializeProjectOptions();
  protected readonly filteredMyVotes: Signal<Vote[]> = this.initFilteredMyVotes();
  protected readonly myVotesSummaryScope: Signal<Vote[]> = this.initMyVotesSummaryScope();
  protected readonly myVoteStatCards: Signal<StatCardItem[]> = this.initMyVoteStatCards();
  protected readonly myVotesStatusCounts: Signal<VoteStatusCounts | null> = this.initMyVotesStatusCounts();
  /** Status-tab counts for the active lens; null while loading or after a failure, so tabs never show a false zero. */
  protected readonly tabStatusCounts: Signal<VoteStatusCounts | null> = this.initTabStatusCounts();
  // True when any server-side filter is active; drives dashboard empty-state vs. table empty-state routing.
  // Trims `search` so whitespace-only input doesn't count as an active filter.
  protected readonly hasActiveFilters: Signal<boolean> = computed(() => {
    const f = this.filters();
    return !!(f.search?.trim() || f.status || f.group || this.managementClosingOnly());
  });
  // Summary shortcut forwarded to the table: the personal shortcut in Me, Closing Soon in management closing-only mode.
  // Lazy tables never filter rows client-side, so in management this only tells the empty state a shortcut is applied.
  protected readonly tableQuickFilter: Signal<MyVotesQuickFilter | null> = computed(() => {
    if (this.isMeLens()) return this.myVotesQuickFilter();
    return this.managementClosingOnly() ? 'closing-soon' : null;
  });
  /** Results-drawer audience: the permalink's choice for the linked vote (a writer sees `creator` in the Me lens), otherwise by lens. */
  protected readonly resultsAudience: Signal<'voter' | 'creator'> = this.initResultsAudience();

  public constructor() {
    toObservable(this.isMeLens)
      .pipe(
        filter((isMe) => !isMe),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        this.myVotesQuickFilter.set(null);
        // Keep the selected tab and the server filter in step so the list never shows Active while requesting All.
        this.myVotesStatusTab.set(PollStatus.ACTIVE);
        this.filters.update((state) => ({ ...state, status: PollStatus.ACTIVE }));
      });

    this.initPermalinkDrawer();
  }

  protected onManagementVoteStatClick(action: string): void {
    if (!this.isManagementVotesLens() || this.managementSummaryLoading() || this.managementSummaryError()) return;
    if (action !== 'closing-soon' && action !== 'active') return;
    const scopeChanged = action === 'closing-soon' || this.managementClosingOnly() || this.filters().status !== PollStatus.ACTIVE;
    this.managementClosingOnly.set(action === 'closing-soon' && !this.managementClosingOnly());
    this.myVotesStatusTab.set(PollStatus.ACTIVE);
    this.filters.update((state) => ({ ...state, status: PollStatus.ACTIVE }));
    this.pageTokens = [];
    this.currentFirst.set(0);
    if (!scopeChanged) this.fetch$.next();
    if (action === 'closing-soon') this.retryManagementSummary();
  }

  protected retryManagementSummary(): void {
    this.managementSummaryRefresh$.next();
  }

  protected onMyVoteStatClick(action: string): void {
    if (!this.isMeLens() || this.myVotesLoading() || this.myVotesError()) return;
    if (action !== 'closing-soon' && action !== 'needs-vote') return;
    this.myVotesNowMs.set(Date.now());
    this.myVotesQuickFilter.update((selected) => (selected === action ? null : action));
    this.myVotesStatusTab.set(PollStatus.ACTIVE);
    this.currentFirst.set(0);
  }

  protected onStatusTabSelected(tab: string): void {
    this.myVotesQuickFilter.set(null);
    if (this.managementClosingOnly()) {
      this.managementClosingOnly.set(false);
      this.filters.update((state) => ({ ...state, status: tab === 'all' ? null : (tab as PollStatus) }));
      this.pageTokens = [];
      this.currentFirst.set(0);
    }
    if (this.isMeLens()) {
      this.currentFirst.set(0);
    }
  }

  protected onFiltersReset(): void {
    this.myVotesQuickFilter.set(null);
    this.managementClosingOnly.set(false);
    this.pageTokens = [];
    this.currentFirst.set(0);
  }

  protected onViewVote(voteId: string): void {
    this.selectedVoteId.set(voteId);

    // Look up the picked vote synchronously — selectedListVote() hasn't re-derived yet.
    const source = this.isMeLens() ? this.myVotes() : this.votes();
    const picked = source.find((v) => v.uid === voteId) ?? null;

    if (picked && this.shouldOpenCastDrawerFor(picked)) {
      this.resultsDrawerVisible.set(false);
      this.castDrawerVisible.set(true);
    } else {
      this.castDrawerVisible.set(false);
      this.resultsDrawerVisible.set(true);
    }
  }

  protected onViewResults(voteId: string): void {
    this.selectedVoteId.set(voteId);
    this.castDrawerVisible.set(false);
    this.resultsDrawerVisible.set(true);
  }

  // Hiding the results drawer and showing the cast drawer in one synchronous handler means the
  // combined visibility signal never emits both hidden, so this switch is not reported as a close.
  protected onCastFromResults(voteId: string): void {
    this.selectedVoteId.set(voteId);
    this.resultsDrawerVisible.set(false);
    this.castDrawerVisible.set(true);
  }

  // Me-lens uses myVotes (refresh$); fetch$ feeds initVotes (non-Me) and would just cause extra churn.
  protected onVoteSubmitted(): void {
    this.refresh$.next();
  }

  protected refreshVotes(): void {
    this.loading.set(true);
    this.pageTokens = [];
    this.currentFirst.set(0);
    this.fetch$.next();
    this.refresh$.next();
  }

  /** votes-table's voteExtended output — carries the confirmed vote so the open drawer updates immediately
   *  instead of waiting on refresh()'s eventually-consistent search-index refetch (per @greptile-apps).
   *  Also reconciles the closing-soon count and filtered list (per @greptile-apps / @copilot-pull-request-reviewer,
   *  GH-3823 review): the table no longer emits `refresh` on extend (that reset pagination, per @cursor), so this
   *  handler re-triggers the summary count and current-page fetch itself — fetch$/refresh$ refetch the page/list
   *  in place without touching pageTokens or currentFirst, unlike refreshVotes(). extendedVoteOverride above keeps
   *  the open drawer and this row's rendered deadline correct in the meantime while the search index catches up. */
  protected onVoteExtended(vote: Vote): void {
    this.extendedVoteOverride.set(vote);
    if (this.isMeLens()) {
      this.refresh$.next();
    } else {
      this.fetch$.next();
      this.managementSummaryRefresh$.next();
    }
  }

  protected onPageChange(event: { first: number; rows: number }): void {
    if (event.rows !== this.rowsPerPage()) {
      this.pageTokens = [];
      this.rowsPerPage.set(event.rows);
      this.currentFirst.set(0);
      this.fetch$.next();
      return;
    }

    this.currentFirst.set(event.first);
    this.fetch$.next();
  }

  protected onFoundationFilterChange(value: string | null): void {
    this.pageTokens = [];
    this.currentFirst.set(0);
    this.foundationFilter.set(value);
    this.projectFilter.set(null);
  }

  protected onProjectFilterChange(value: string | null): void {
    this.pageTokens = [];
    this.currentFirst.set(0);
    this.projectFilter.set(value);
  }

  protected onFiltersChange(state: VoteFilterState): void {
    this.pageTokens = [];
    this.currentFirst.set(0);
    this.filters.set(state);
  }

  private buildFilters(): string[] {
    const queryFilters: string[] = [];
    const { status, group } = this.filters();
    if (status) {
      queryFilters.push(`status:${status}`);
    }
    if (group) {
      queryFilters.push(`committee_name:${group}`);
    }
    return queryFilters;
  }

  // === Private Initializers ===
  private initManagementSummaryScope() {
    return computed(
      () => {
        const lens = this.lensService.activeLens();
        const uid = this.project()?.uid;
        if ((lens !== 'project' && lens !== 'foundation') || !uid) return null;
        return { uid, lens, group: this.filters().group };
      },
      { equal: (a, b) => a?.uid === b?.uid && a?.lens === b?.lens && a?.group === b?.group }
    );
  }

  private initManagementSummary(): Signal<VoteSummary | null> {
    return toSignal(
      combineLatest([toObservable(this.managementSummaryScope), this.refresh$, this.managementSummaryRefresh$]).pipe(
        switchMap(([scope]) => {
          this.managementSummaryLoading.set(!!scope);
          this.managementSummaryError.set(false);
          if (!scope) return of(null);
          return this.voteService.getVotesSummaryByProject(scope.uid, scope.group || undefined).pipe(
            catchError(() => {
              if (this.managementSummaryScope() === scope) this.managementSummaryError.set(true);
              return of(null);
            }),
            finalize(() => {
              if (this.managementSummaryScope() === scope) this.managementSummaryLoading.set(false);
            }),
            startWith(null)
          );
        })
      ),
      { initialValue: null }
    );
  }

  /** Status-tab counts follow scope, search and Group only — never the status tab, closing-only toggle or pagination. */
  private initManagementStatusCountsScope() {
    return computed(
      () => {
        const lens = this.lensService.activeLens();
        const uid = this.project()?.uid;
        if ((lens !== 'project' && lens !== 'foundation') || !uid) return null;
        const { search, group } = this.filters();
        return { uid, lens, search: search.trim(), group };
      },
      { equal: (a, b) => a?.uid === b?.uid && a?.lens === b?.lens && a?.search === b?.search && a?.group === b?.group }
    );
  }

  /**
   * Server status-tab counts for the management lens (#3687). Writes are guarded by scope identity
   * so a superseded response can't flag the current scope. The All tab's optimistic
   * `mergeRecentlyOpenedVotes` overlay can show a just-opened vote as Active while these counts
   * still read it as Draft; they converge on the next refresh once the index catches up (GH-2730).
   */
  private initManagementStatusCounts(): Signal<VoteStatusCounts | null> {
    return toSignal(
      combineLatest([toObservable(this.managementStatusCountsScope), this.refresh$]).pipe(
        switchMap(([scope]) => {
          this.managementStatusCountsLoading.set(!!scope);
          this.managementStatusCountsError.set(false);
          if (!scope) return of(null);
          return this.voteService.getVoteStatusCountsByProject(scope.uid, scope.search || undefined, scope.group || undefined).pipe(
            catchError(() => {
              if (this.managementStatusCountsScope() === scope) this.managementStatusCountsError.set(true);
              return of(null);
            }),
            finalize(() => {
              if (this.managementStatusCountsScope() === scope) this.managementStatusCountsLoading.set(false);
            }),
            startWith(null)
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initManagementVoteStatCards(): Signal<StatCardItem[]> {
    return computed(() => {
      const summary = this.managementSummary();
      const disabled = this.managementSummaryLoading() || this.managementSummaryError();
      return [
        {
          value: summary?.closing_soon ?? '—',
          label: `Votes Closing in the Next ${VOTES_STATS_WINDOW_DAYS} Days`,
          icon: 'fa-light fa-calendar-clock',
          iconContainerClass: 'bg-blue-100 text-blue-600',
          action: 'closing-soon',
          selected: this.managementClosingOnly(),
          disabled,
        },
        {
          value: summary?.active_votes ?? '—',
          label: 'Active Votes',
          icon: 'fa-light fa-check-to-slot',
          iconContainerClass: 'bg-gray-100 text-gray-600',
          action: 'active',
          selected: this.myVotesStatusTab() === PollStatus.ACTIVE && !this.managementClosingOnly(),
          disabled,
        },
      ];
    });
  }

  private initResultsAudience(): Signal<'voter' | 'creator'> {
    return computed(() => {
      const target = this.permalinkTarget();
      if (target && this.selectedVoteId() === target.uid) {
        return target.audience;
      }
      return this.isMeLens() ? 'voter' : 'creator';
    });
  }

  /** Opens the permalink target's drawer once, then reports when every drawer has closed again. */
  private initPermalinkDrawer(): void {
    toObservable(this.permalinkTarget)
      .pipe(
        filter((target): target is VotePermalinkTarget => target !== null),
        takeUntilDestroyed()
      )
      .subscribe((target) => {
        if (target.uid === this.openedPermalinkUid) return;
        this.openedPermalinkUid = target.uid;
        this.selectedVoteId.set(target.uid);
        this.castDrawerVisible.set(target.drawer === 'cast');
        this.resultsDrawerVisible.set(target.drawer === 'results');
      });

    // Observe the combined signal, not separate streams: a synchronous results → cast switch
    // must not transiently report both drawers closed while their emissions settle.
    const anyDrawerOpen = computed(() => this.castDrawerVisible() || this.resultsDrawerVisible());
    toObservable(anyDrawerOpen)
      .pipe(
        filter((open) => !open && this.openedPermalinkUid !== null),
        take(1),
        takeUntilDestroyed()
      )
      .subscribe(() => this.permalinkClosed.emit());
  }

  private initProject(): Signal<ProjectContext | null> {
    return computed(() => this.projectContextService.activeContext());
  }

  private initSearchQuery(): Signal<string> {
    return computed(() => this.filters().search.trim());
  }

  private initGroupOptions(): Signal<{ label: string; value: string | null }[]> {
    const project$ = toObservable(this.project);
    const lens$ = toObservable(this.lensService.activeLens);

    const managementOptions = toSignal(
      combineLatest([project$, lens$]).pipe(
        switchMap(([project, lens]) => {
          if (lens === 'me' || !project?.uid) {
            return of([]);
          }
          return this.committeeService.getCommitteesByProject(project.uid).pipe(catchError(() => of([])));
        }),
        map((committees: Committee[]) => {
          const options: { label: string; value: string | null }[] = [{ label: 'All Groups', value: null }];
          const sorted = [...committees].sort((a, b) => a.name.localeCompare(b.name));
          for (const committee of sorted) {
            options.push({ label: committee.name, value: committee.name });
          }
          return options;
        })
      ),
      { initialValue: [{ label: 'All Groups', value: null }] }
    );
    return computed(() => {
      if (!this.isMeLens()) return managementOptions();
      const names = new Set<string>();
      for (const vote of this.filteredMyVotes()) {
        if (vote.committee_name?.trim()) names.add(vote.committee_name);
      }
      return [{ label: 'All Groups', value: null }, ...[...names].sort((a, b) => a.localeCompare(b, 'en-US')).map((name) => ({ label: name, value: name }))];
    });
  }

  private initVoteRequestScope() {
    // One signal snapshot coalesces status and closing-only updates from the same action.
    return computed(() => ({
      project: this.project(),
      filters: this.filters(),
      lens: this.lensService.activeLens(),
      closingOnly: this.managementClosingOnly(),
    }));
  }

  private initTotalCount(): Signal<number> {
    const scope$ = toObservable(this.voteRequestScope);

    return toSignal(
      combineLatest([scope$, this.refresh$]).pipe(
        switchMap(([{ project, lens, closingOnly }]) => {
          this.totalCountReady.set(false);
          if (lens === 'me' || closingOnly) {
            return of(0);
          }
          if (!project?.uid) {
            return of(0);
          }
          const searchName = this.searchQuery();
          const queryFilters = this.buildFilters();
          return this.voteService.getVotesCountByProject(project.uid, searchName || undefined, queryFilters.length ? queryFilters : undefined).pipe(
            tap((count) => {
              if (!this.managementClosingOnly() && this.project()?.uid === project.uid) {
                this.totalRecords.set(count);
                this.totalCountReady.set(true);
              }
            }),
            catchError(() => of(0))
          );
        })
      ),
      { initialValue: 0 }
    );
  }

  private initVotes(): Signal<Vote[]> {
    const scope$ = toObservable(this.voteRequestScope);

    // Lens-change pagination reset lives inside the pipeline, before the switchMap reads
    // currentFirst/pageTokens (previously a constructor subscription — but a toObservable's
    // initial emission also ran it, so every landing paid a fetch$.next() that aborted the
    // in-flight first fetch and re-issued it; observed in the network log as duplicate aborted
    // GET /api/votes requests on arrival, GH-2826).
    let previousScope: string | undefined;

    return toSignal(
      combineLatest([scope$, this.fetch$]).pipe(
        tap(() => this.loading.set(true)),
        tap(([{ project, lens }]) => {
          const scope = `${lens}:${project?.uid ?? ''}`;
          if (scope !== previousScope) {
            previousScope = scope;
            this.managementClosingOnly.set(false);
            this.pageTokens = [];
            this.currentFirst.set(0);
          }
        }),
        switchMap(([{ project, filters: filterState, lens }]) => {
          if (lens === 'me' || !project?.uid) {
            this.loading.set(false);
            return of([]);
          }

          const rows = this.rowsPerPage();
          const pageIndex = this.currentFirst() / rows;
          const searchName = this.searchQuery();
          const queryFilters = this.buildFilters();

          return this.fetchVotePage(project.uid, rows, pageIndex, searchName || undefined, queryFilters.length ? queryFilters : undefined).pipe(
            tap(() => this.loading.set(false)),
            tap((response) => {
              if (this.managementClosingOnly() && response.total_records !== undefined) this.totalRecords.set(response.total_records);
            }),
            map((response: VoteListResponse) => response.data),
            // Optimistic merge (GH-2730): overlay just-opened votes' known-active status over stale
            // index rows. Skipped under a server-side `status:` filter — the filtered response can't
            // contain the just-opened row (Active tab: absent until convergence) and mustn't re-badge
            // it (Draft tab: an Active-badged row would violate the filter while `totalRecords` still
            // counts it as draft); only the All tab (`status: null`) keeps the re-badge overlay.
            //
            // mergeRecentlyCreatedVotes (GH-4007) inserts a just-created/cloned vote missing from the
            // page entirely. Unlike the re-badge overlay above, this must run under every tab — a
            // created vote has a real status already, so passing `statusFilter` lets it insert into
            // whichever tab its own status actually matches (and nowhere else), scoped to this
            // project and limited to the first page so it isn't duplicated across paginated pages.
            // `closingOnly`/`nowMs` additionally gate insertion under the Closing Soon quick filter —
            // the lazy table doesn't locally re-filter returned rows, so a newly created vote outside
            // the rolling seven-day window must never be inserted while that filter is active.
            map((votes) =>
              this.voteService.mergeRecentlyCreatedVotes(filterState.status ? votes : this.voteService.mergeRecentlyOpenedVotes(votes), {
                projectUid: project.uid,
                statusFilter: filterState.status,
                closingOnly: this.managementClosingOnly(),
                nowMs: Date.now(),
                isFirstPage: pageIndex === 0,
              })
            ),
            catchError(() => {
              this.loading.set(false);
              return of([]);
            })
          );
        })
      ),
      { initialValue: [] }
    );
  }

  /**
   * Fetches one page of votes. Cursor pagination only returns the *next* page's token, so a direct jump to a page whose
   * token hasn't been collected yet walks forward from the nearest cached token, caching intermediate tokens along the way.
   * The walk is bounded (VOTES_PAGE_WALK_LIMIT, matching the meetings-dashboard cursor walk): on overflow the paginator
   * clamps to the last reached page; on cursor exhaustion (data shrank after tokens were cached) it restarts from page 1
   * with a fresh token chain. HTTP errors propagate to the caller so a failed request is never mistaken for exhaustion.
   */
  private fetchVotePage(projectUid: string, rows: number, pageIndex: number, searchName?: string, filters?: string[]): Observable<VoteListResponse> {
    const closingOnly = this.managementClosingOnly();
    const startIndex = findCursorWalkStartIndex(this.pageTokens, pageIndex);

    // Index of the last successfully fetched page — fetchSingle's tap runs before expand's projector sees each response.
    let fetchedIndex = startIndex;

    const fetchSingle = (index: number): Observable<VoteListResponse> =>
      this.voteService
        .getVotesByProjectPaginated(projectUid, rows, index > 0 ? this.pageTokens[index - 1] : undefined, searchName, filters, closingOnly || undefined)
        .pipe(
          tap((response: VoteListResponse) => {
            fetchedIndex = index;
            // Cache the next-page cursor; when the cursor exhausts, stale tokens beyond this page are dropped.
            this.pageTokens = recordPageToken(this.pageTokens, index, response.page_token);
          })
        );

    return fetchSingle(startIndex).pipe(
      // Walk forward one page per request until the target page is fetched or the cursor exhausts.
      expand((response: VoteListResponse) => (fetchedIndex === pageIndex || !response.page_token ? EMPTY : fetchSingle(fetchedIndex + 1))),
      // Hard request ceiling: the start page plus VOTES_PAGE_WALK_LIMIT hops (matches the meetings-dashboard walk bound).
      take(VOTES_PAGE_WALK_LIMIT + 1),
      // Only the final page's response reaches the subscriber — intermediate walk pages just cache tokens. Terminal
      // handling lives after take() because expand's projector never runs for the emission take() cuts off at.
      last(),
      switchMap((response: VoteListResponse) => {
        const outcome = resolveCursorWalkOutcome(response, fetchedIndex, pageIndex);

        // Data shrank after tokens were cached (empty target page or exhausted cursor) — restart from
        // page 1 with a fresh token chain instead of showing an empty table.
        if (outcome.action === 'restart') {
          this.pageTokens = [];
          this.currentFirst.set(0);
          return outcome.refetch ? fetchSingle(0) : of(response);
        }

        // take() truncated the walk before the target — clamp the paginator to the last reached page.
        if (outcome.action === 'clamp') {
          this.currentFirst.set(outcome.clampIndex * rows);
        }
        return of(response);
      })
    );
  }

  private initSelectedListVote(): Signal<Vote | null> {
    return computed(() => {
      const id = this.selectedVoteId();
      if (!id) return null;
      const source = this.isMeLens() ? this.myVotes() : this.votes();
      const row = source.find((v) => v.uid === id) || null;
      const override = this.extendedVoteOverride();
      if (override?.uid === id && (!row || new Date(row.end_time).getTime() < new Date(override.end_time).getTime())) {
        return { ...(row ?? override), ...override };
      }
      return row;
    });
  }

  private initMyVotes(): Signal<Vote[]> {
    const lens$ = toObservable(this.lensService.activeLens);

    return toSignal(
      combineLatest([lens$, this.refresh$]).pipe(
        switchMap(([lens]) => {
          this.myVotesComplete.set(false);
          // A cleared personal feed stays pending so returning to Me cannot show an incomplete result before its request starts.
          this.myVotesLoading.set(true);
          if (lens !== 'me') {
            return of([] as Vote[]);
          }
          this.myVotesError.set(false);
          return this.voteService.getMyVotes().pipe(
            tap((response) => this.myVotesComplete.set(response.complete === true)),
            // Optimistic merge (GH-2730), same overlay as the project lens: just-opened votes'
            // known-active status over stale index rows. getMyVotes() is invitation-scoped
            // (built from the caller's own invitation/response records), not creator-scoped, so
            // mergeRecentlyCreatedVotes (GH-4007) does not apply here — inserting a just-created
            // vote would show the creator a ballot they were never invited to, and the raw Vote
            // snapshot lacks the response_status the Me lens's action/drawer logic depends on.
            map((response) => this.voteService.mergeRecentlyOpenedVotes(response.votes)),
            tap(() => this.myVotesNowMs.set(Date.now())),
            catchError(() => {
              this.myVotesError.set(true);
              return of([] as Vote[]);
            }),
            finalize(() => this.myVotesLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initializeFoundationOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const items = this.myVotes();
      const seen = new Map<string, string>();
      for (const item of items) {
        if (item.is_foundation && item.project_uid && !seen.has(item.project_uid)) {
          seen.set(item.project_uid, item.project_name || item.project_uid);
        }
      }
      const options = [...seen.entries()].map(([uid, name]) => ({ label: name, value: uid })).sort((a, b) => a.label.localeCompare(b.label));
      return [{ label: 'All Foundations', value: null }, ...options];
    });
  }

  private initializeProjectOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const items = this.myVotes();
      const foundation = this.foundationFilter();
      const seen = new Map<string, string>();
      for (const item of items) {
        if (!item.is_foundation && item.project_uid && !seen.has(item.project_uid)) {
          if (foundation && item.parent_project_uid !== foundation) continue;
          seen.set(item.project_uid, item.project_name || item.project_uid);
        }
      }
      const options = [...seen.entries()].map(([uid, name]) => ({ label: name, value: uid })).sort((a, b) => a.label.localeCompare(b.label));
      return [{ label: 'All Projects', value: null }, ...options];
    });
  }

  private initMyVotesSummaryScope(): Signal<Vote[]> {
    return computed(() => {
      const group = this.filters().group;
      const votes = this.filteredMyVotes();
      return group ? votes.filter((vote) => vote.committee_name === group) : votes;
    });
  }

  /** Personal status-tab counts over the same scope as the list; quick filters and the status tab never narrow them. */
  private initMyVotesStatusCounts(): Signal<VoteStatusCounts | null> {
    return computed(() => {
      if (this.myVotesLoading() || this.myVotesError() || !this.myVotesComplete()) return null;
      // Mirrors the table's client-side name search (votes-table `initDisplayedVotes`) so each count equals its tab's rows.
      const term = this.filters().search.toLowerCase();
      const votes = this.myVotesSummaryScope();
      return countVotesByStatus(term ? votes.filter((vote) => vote.name.toLowerCase().includes(term)) : votes);
    });
  }

  private initTabStatusCounts(): Signal<VoteStatusCounts | null> {
    return computed(() => {
      if (this.isMeLens()) return this.myVotesStatusCounts();
      if (this.managementStatusCountsLoading() || this.managementStatusCountsError()) return null;
      return this.managementStatusCounts();
    });
  }

  private initMyVoteStatCards(): Signal<StatCardItem[]> {
    return computed(() => {
      let closingSoon = 0;
      let needsVote = 0;
      let nextDeadline = Infinity;
      let earliestDeadline = Infinity;
      const nowMs = this.myVotesNowMs();
      for (const vote of this.myVotesSummaryScope()) {
        const endMs = Date.parse(vote.end_time);
        if (matchesMyVotesQuickFilter(vote, 'closing-soon', nowMs)) {
          closingSoon++;
          nextDeadline = Math.min(nextDeadline, endMs);
        }
        if (matchesMyVotesQuickFilter(vote, 'needs-vote', nowMs)) {
          needsVote++;
          if (Number.isFinite(endMs)) earliestDeadline = Math.min(earliestDeadline, endMs);
        }
      }
      const unavailable = this.myVotesError();
      const disabled = this.myVotesLoading() || unavailable;
      const selected = this.myVotesQuickFilter();
      return [
        {
          value: unavailable ? '—' : closingSoon,
          label: `Votes Closing in the Next ${MY_VOTES_STATS_WINDOW_DAYS} Days`,
          icon: 'fa-light fa-calendar-clock',
          iconContainerClass: 'bg-blue-100 text-blue-600',
          action: 'closing-soon',
          selected: selected === 'closing-soon',
          disabled,
          subLine: !disabled && Number.isFinite(nextDeadline) ? `Next: ${formatInTimeZone(nextDeadline, this.viewerTimezone, 'MMM d, yyyy')}` : undefined,
        },
        {
          value: unavailable ? '—' : needsVote,
          label: 'Need Your Vote',
          icon: 'fa-light fa-check-to-slot',
          iconContainerClass: 'bg-amber-100 text-amber-600',
          action: 'needs-vote',
          selected: selected === 'needs-vote',
          disabled,
          subLine:
            !disabled && Number.isFinite(earliestDeadline)
              ? `Earliest deadline: ${formatInTimeZone(earliestDeadline, this.viewerTimezone, 'MMM d, yyyy')}`
              : undefined,
        },
      ];
    });
  }

  private initFilteredMyVotes(): Signal<Vote[]> {
    return computed(() => {
      let filtered = this.myVotes();
      const project = this.projectFilter();
      const foundation = this.foundationFilter();

      if (project) {
        filtered = filtered.filter((v) => v.project_uid === project);
      } else if (foundation) {
        filtered = filtered.filter((v) => v.project_uid === foundation || (v.parent_project_uid === foundation && !v.is_foundation));
      }

      return filtered;
    });
  }

  // Me lens routes all active-awaiting votes to the cast drawer (regardless of poll_type):
  // - GENERIC renders the real ballot form
  // - Advanced types (CONDORCET_IRV, INSTANT_RUNOFF_VOTE, MEEK_STV) render the "Coming soon"
  //   placeholder inside the cast drawer
  // Either way no PCC link is shown in Me lens. Project / Foundation / Organization lenses
  // continue to open the read-only results drawer (existing behaviour) where the PCC link
  // still lives for ops/admin workflows.
  private shouldOpenCastDrawerFor(vote: Vote): boolean {
    return this.isMeLens() && vote.status === PollStatus.ACTIVE && vote.response_status === VoteResponseStatus.AWAITING_RESPONSE;
  }
}
