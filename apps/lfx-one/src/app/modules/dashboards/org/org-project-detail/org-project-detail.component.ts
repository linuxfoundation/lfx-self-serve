// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, ElementRef, inject, PLATFORM_ID, signal, type Signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensProjectDetailService } from '@services/org-lens-project-detail.service';
import { BreadcrumbComponent } from '@components/breadcrumb/breadcrumb.component';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { OrgProjectDetailTabBarComponent } from './org-project-detail-tab-bar.component';
import {
  BAND_CHIP_CLASS,
  BAND_SIGNAL_FILL,
  BAND_SIGNAL_FILL_LIGHT,
  BAND_SIGNAL_RANK,
  PD_BAND_TAG,
  PD_DEFAULT_METRIC,
  PD_DEFAULT_TAB,
  PD_VALID_TABS,
  PD_DEFAULT_TIME_RANGE,
  PD_DRAWER_QUERY_PARAM,
  PD_HEALTH_TAG,
  PD_NON_LF_MARKER,
  PD_VALID_DRAWER_CARD_KEYS,
  lfxColors,
  PD_METRIC_OPTIONS,
  PD_STACKED_PALETTE,
  PD_TIME_RANGE_MONTHS,
  PD_TIME_RANGE_OPTIONS,
  PD_VALID_METRICS,
  PD_VALID_TIME_RANGES,
} from '@lfx-one/shared/constants';
import type {
  BlockState,
  HeroState,
  InfluenceCardVm,
  LeaderboardDimension,
  OrgLensCardDetailRow,
  OrgLensCardDetailSection,
  OrgLensInfluenceBlock,
  OrgLensLeaderboardBlock,
  OrgLensLeaderboardMetric,
  OrgLensLeaderboardTimeRange,
  OrgLensProjectBand,
  OrgLensProjectDetailTab,
  OrgLensProjectInfluenceCard,
  OrgLensTrendBlock,
} from '@lfx-one/shared/interfaces';
import { parseLocalDateString } from '@lfx-one/shared/utils';
import type { MenuItem } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { InputTextModule } from 'primeng/inputtext';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import type { ChartData, ChartOptions, ChartType } from 'chart.js';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, filter, map, type Observable, of, scan, skip, startWith, switchMap, take } from 'rxjs';

/**
 * Org Lens · Project Detail sub-page (LFXV2-1885), routed at `/org/projects/:projectSlug`.
 *
 * The page is decomposed into the UX contract's independently-fetched data blocks (hero, the two
 * Our-Influence card groups, the influence-trend chart, the two leaderboard boards, and the per-card
 * drawer). Each block loads, renders, and fails on its own timeline; only the hero block gates the
 * whole page. The hero is range-independent; the Our-Influence and Leaderboards blocks fetch lazily
 * the first time their tab activates and re-fetch when the `?range=` toggle changes.
 */
@Component({
  selector: 'lfx-org-project-detail',
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    BreadcrumbComponent,
    ChartComponent,
    EmptyStateComponent,
    InputTextComponent,
    OrgProjectDetailTabBarComponent,
    TableComponent,
    TagComponent,
    DrawerModule,
    InputTextModule,
    SkeletonModule,
    TooltipModule,
  ],
  templateUrl: './org-project-detail.component.html',
})
export class OrgProjectDetailComponent {
  private readonly techTrackRef = viewChild<ElementRef<HTMLElement>>('technicalTrack');
  private readonly ecoTrackRef = viewChild<ElementRef<HTMLElement>>('ecosystemTrack');

  protected readonly accountContext = inject(AccountContextService);
  private readonly detailService = inject(OrgLensProjectDetailService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  // Per-block retry counters — bumping one re-runs only that block's fetch, so one failed block
  // never forces a whole-page reload.
  private readonly heroRetry = signal(0);
  private readonly influenceRetry = signal(0);
  private readonly trendRetry = signal(0);
  private readonly techRetry = signal(0);
  private readonly ecoRetry = signal(0);

  protected readonly techArrows = signal({ left: false, right: false });
  protected readonly ecoArrows = signal({ left: false, right: false });
  private readonly selectedCardKey = signal<string | null>(null);
  protected readonly drawerOpen = signal(false);

  // B5 drawer state + per-(card, range) cache so re-opening the same card at the same range is
  // instant (no spinner flash); a range change closes the drawer and its cache key differs.
  protected readonly drawerState = signal<BlockState<OrgLensCardDetailSection>>({ status: 'loading', data: null });
  private readonly drawerCache = new Map<string, OrgLensCardDetailSection | null>();

  // B5 drawer roster (DN9) — fetched lazily and server-side paginated on open + page change, so the
  // big code-activity rosters never ship in the main payload.
  protected readonly rosterRows = signal<OrgLensCardDetailRow[]>([]);
  protected readonly rosterTotal = signal(0);
  protected readonly rosterFirst = signal(0);
  protected readonly rosterRowsPerPage = signal(10);
  protected readonly rosterLoading = signal(false);

  protected readonly tabs: { id: OrgLensProjectDetailTab; label: string; icon: string }[] = [
    { id: 'pd-influence', label: 'Our Influence', icon: 'fa-light fa-chart-network' },
    { id: 'pd-leaderboards', label: 'Leaderboards', icon: 'fa-light fa-ranking-star' },
  ];

  private readonly queryParamMap = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  protected readonly activeTab: Signal<OrgLensProjectDetailTab> = computed(() => this.initActiveTab());
  protected readonly metric = computed<OrgLensLeaderboardMetric>(() => this.initMetric());
  protected readonly timeRange = computed<OrgLensLeaderboardTimeRange>(() => this.initTimeRange());
  protected readonly hasCompany = computed(() => !!this.accountContext.selectedAccount().uid);
  private readonly orgName = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');
  protected readonly projectSlug = toSignal(this.route.paramMap.pipe(map((params) => params.get('projectSlug'))), { initialValue: null });
  private readonly drawerCardParam = computed<string | null>(() => {
    const raw = this.queryParamMap().get(PD_DRAWER_QUERY_PARAM);
    return raw && PD_VALID_DRAWER_CARD_KEYS.has(raw) ? raw : null;
  });

  // Fetch triggers. Hero is range-independent (drops range$); the tab-scoped blocks gate on an
  // "activated" flag that flips true the first time their tab is shown and stays true, so returning
  // to a tab at the same range paints from cache while a range change re-fetches.
  private readonly orgUid$ = toObservable(computed(() => this.accountContext.selectedAccount()?.uid ?? null)).pipe(
    filter((uid): uid is string => !!uid),
    distinctUntilChanged()
  );
  private readonly slug$ = this.route.paramMap.pipe(
    map((params) => params.get('projectSlug')),
    filter((slug): slug is string => !!slug),
    distinctUntilChanged()
  );
  private readonly range$ = toObservable(this.timeRange).pipe(distinctUntilChanged());
  private readonly influenceActivated$ = toObservable(this.activeTab).pipe(
    map((tab) => tab === 'pd-influence'),
    scan((seen, active) => seen || active, false),
    distinctUntilChanged()
  );
  private readonly leaderboardsActivated$ = toObservable(this.activeTab).pipe(
    map((tab) => tab === 'pd-leaderboards'),
    scan((seen, active) => seen || active, false),
    distinctUntilChanged()
  );

  // Per-block state signals, each driven by its own stream (see build*State).
  protected readonly heroState = toSignal(this.buildHeroState(), { initialValue: { status: 'loading', data: null } as HeroState });
  protected readonly influenceState = toSignal(this.buildInfluenceState(), {
    initialValue: { status: 'loading', data: null } as BlockState<OrgLensInfluenceBlock>,
  });
  protected readonly trendState = toSignal(this.buildTrendState(), { initialValue: { status: 'loading', data: null } as BlockState<OrgLensTrendBlock> });
  protected readonly techBoardState = toSignal(
    this.buildBoardState((uid, name, slug, range) => this.detailService.getTechnicalBoard(uid, name, slug, range), this.techRetry),
    {
      initialValue: { status: 'loading', data: null } as BlockState<OrgLensLeaderboardBlock>,
    }
  );
  protected readonly ecoBoardState = toSignal(
    this.buildBoardState((uid, name, slug, range) => this.detailService.getEcosystemBoard(uid, name, slug, range), this.ecoRetry),
    {
      initialValue: { status: 'loading', data: null } as BlockState<OrgLensLeaderboardBlock>,
    }
  );

  // Hero presentation — derived from the hero block.
  protected readonly hero = computed(() => this.heroState().data?.hero ?? null);
  protected readonly isNonLfProject = computed(() => this.heroState().data?.isNonLfProject ?? false);
  protected readonly breadcrumbItems = computed<MenuItem[]>(() => this.initBreadcrumb());
  protected readonly healthMeta = computed(() => {
    const health = this.hero()?.health;
    return health ? PD_HEALTH_TAG[health] : null;
  });
  protected readonly firstCommitLabel = computed(() => this.formatMonthYear(this.hero()?.firstCommit ?? null));
  protected readonly softwareValueLabel = computed(() => this.formatCompactUsd(this.hero()?.softwareValueUsd ?? null));
  protected readonly logoInitials = computed(() => this.initialsFor(this.hero()?.projectName ?? ''));

  // Section-title band badges — read the viewing org's precomputed tiers carried inline on the
  // Our-Influence block, so the Our-Influence tab never depends on (or waits for) the leaderboards.
  protected readonly technicalBandMeta = computed(() => {
    const level = this.influenceState().data?.levels.technical ?? null;
    return level ? this.bandMeta(level) : null;
  });
  protected readonly ecosystemBandMeta = computed(() => {
    // Non-LF is a project-level classification: surface the distinct marker whenever the project is
    // non-LF; otherwise show the viewing org's precomputed ecosystem tier.
    if (this.isNonLfProject()) return this.bandMeta(null);
    const level = this.influenceState().data?.levels.ecosystem ?? null;
    return level ? this.bandMeta(level) : null;
  });

  // Our Influence tab — Technical + Ecosystem cards (per-card chart type and data).
  private readonly monthLabels: string[] = this.buildMonthLabels();
  protected readonly technicalCards = computed(() => {
    const months = PD_TIME_RANGE_MONTHS[this.timeRange()];
    return (this.influenceState().data?.technical ?? []).map((card) => this.toInfluenceCard(card, lfxColors.blue[500], 'technical', months));
  });
  protected readonly ecosystemCards = computed(() => {
    const months = PD_TIME_RANGE_MONTHS[this.timeRange()];
    return (this.influenceState().data?.ecosystem ?? []).map((card) => this.toInfluenceCard(card, lfxColors.violet[500], 'ecosystem', months));
  });
  // Live VM for the open drawer card, re-derived from the current (range-scoped) cards so the drawer
  // hero stat/caption track the ?range= toggle instead of a stale open-time snapshot.
  protected readonly selectedCard = computed<InfluenceCardVm | null>(() => {
    const key = this.selectedCardKey();
    if (!key) return null;
    return [...this.technicalCards(), ...this.ecosystemCards()].find((card) => card.key === key) ?? null;
  });

  // Leaderboards tab — URL-persisted metric toggle + time range + two side-by-side boards + stacked trend.
  protected readonly metricOptions = PD_METRIC_OPTIONS;
  protected readonly timeRangeOptions = PD_TIME_RANGE_OPTIONS;
  protected readonly isActivityMode = computed(() => this.metric() === 'activity');
  protected readonly technicalBoardTitle = computed(() => (this.isActivityMode() ? 'Contribution Activities Leaderboard' : 'Technical Influence Leaderboard'));
  protected readonly ecosystemBoardTitle = computed(() => (this.isActivityMode() ? 'Collaboration Activities Leaderboard' : 'Ecosystem Influence Leaderboard'));
  protected readonly technicalColumnLabel = computed(() => (this.isActivityMode() ? 'Total contributions' : 'Influence Score'));
  protected readonly ecosystemColumnLabel = computed(() => (this.isActivityMode() ? 'Total collaborations' : 'Influence Score'));
  /** Project-level Non-LF marker for the ecosystem leaderboard when the project has no ecosystem influence. */
  protected readonly ecosystemBoardNonLfMarker = computed(() => (this.isNonLfProject() ? PD_NON_LF_MARKER : null));
  protected readonly drawerTimeRangeLabel = computed(() => (this.timeRange() === 'all' ? 'All time' : `Last ${PD_TIME_RANGE_MONTHS[this.timeRange()]} months`));
  protected readonly searchForm = new FormGroup({
    technical: new FormControl('', { nonNullable: true }),
    ecosystem: new FormControl('', { nonNullable: true }),
  });
  protected readonly techSearch = signal('');
  protected readonly ecoSearch = signal('');
  protected readonly techSearchHasQuery = computed(() => this.techSearch().trim().length > 0);
  protected readonly ecoSearchHasQuery = computed(() => this.ecoSearch().trim().length > 0);
  protected readonly technicalBoard = computed(() => this.buildBoard('technical', this.techSearch()));
  protected readonly ecosystemBoard = computed(() => this.buildBoard('ecosystem', this.ecoSearch()));

  // Stacked area trend chart — top-10 companies + "All others" stacked by combined influence score,
  // built from the real per-org monthly series on the wire.
  protected readonly hasStackedTrend = computed(() => (this.trendState().data?.trend.length ?? 0) > 0);
  protected readonly stackedTrendData = computed<ChartData<ChartType>>(() => this.buildStackedTrend());
  protected readonly stackedTrendOptions: ChartOptions<ChartType> = this.buildStackedTrendOptions();

  // Live drawer detail section for the open card.
  protected readonly cardDetail = computed<OrgLensCardDetailSection | null>(() => this.drawerState().data);

  public constructor() {
    this.searchForm.controls.technical.valueChanges.pipe(debounceTime(250), takeUntilDestroyed()).subscribe((value) => this.techSearch.set(value));
    this.searchForm.controls.ecosystem.valueChanges.pipe(debounceTime(250), takeUntilDestroyed()).subscribe((value) => this.ecoSearch.set(value));

    // A refetch driver (range / org / slug change) re-scopes every range-scoped block server-side.
    // Close any open card drawer so it can never pair a new range label with a stale payload.
    combineLatest([this.orgUid$, this.slug$, this.range$])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.closeCardDetail());

    combineLatest([this.orgUid$, this.slug$])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.resetLeaderboardSearch());

    // Refresh horizontal scroll arrows when the Our-Influence cards change.
    toObservable(
      computed(() => ({
        tab: this.activeTab(),
        techLen: this.technicalCards().length,
        ecoLen: this.ecosystemCards().length,
      }))
    )
      .pipe(
        filter(({ tab, techLen, ecoLen }) => tab === 'pd-influence' && (techLen > 0 || ecoLen > 0)),
        switchMap(() => Promise.resolve()),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        this.refreshArrows(this.techTrackRef()?.nativeElement, true);
        this.refreshArrows(this.ecoTrackRef()?.nativeElement, false);
      });

    if (isPlatformBrowser(this.platformId)) {
      toObservable(
        computed(() => {
          const key = this.drawerCardParam();
          if (!key) return null;
          return [...this.technicalCards(), ...this.ecosystemCards()].find((card) => card.key === key) ?? null;
        })
      )
        .pipe(
          filter((card): card is InfluenceCardVm => card !== null),
          take(1),
          takeUntilDestroyed()
        )
        .subscribe((card) => this.openCardDetail(card));
    }
  }

  protected switchTab(tab: OrgLensProjectDetailTab): void {
    if (this.activeTab() === tab) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === PD_DEFAULT_TAB ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected retryHero(): void {
    this.heroRetry.update((v) => v + 1);
  }

  protected retryInfluence(): void {
    this.influenceRetry.update((v) => v + 1);
  }

  protected retryTrend(): void {
    this.trendRetry.update((v) => v + 1);
  }

  protected retryTechnicalBoard(): void {
    this.techRetry.update((v) => v + 1);
  }

  protected retryEcosystemBoard(): void {
    this.ecoRetry.update((v) => v + 1);
  }

  protected retryDrawer(): void {
    const key = this.selectedCardKey();
    if (key) {
      this.loadDrawer(key, true);
      this.loadRosterPage(key, 0, this.rosterRowsPerPage());
    }
  }

  protected setMetric(metric: OrgLensLeaderboardMetric): void {
    if (this.metric() === metric) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { metric: metric === PD_DEFAULT_METRIC ? null : metric },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected setTimeRange(range: OrgLensLeaderboardTimeRange): void {
    if (this.timeRange() === range) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { range: range === PD_DEFAULT_TIME_RANGE ? null : range },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected openCardDetail(card: InfluenceCardVm): void {
    this.selectedCardKey.set(card.key);
    this.drawerOpen.set(true);
    this.resetRoster();
    this.loadDrawer(card.key);
    this.loadRosterPage(card.key, 0, this.rosterRowsPerPage());
  }

  protected closeCardDetail(): void {
    this.drawerOpen.set(false);
    this.selectedCardKey.set(null);
    this.resetRoster();
  }

  protected onDrawerVisibleChange(visible: boolean): void {
    if (!visible) this.closeCardDetail();
  }

  /** lfx-table lazy-load callback: fetch the requested page (and page size) of the open card's roster. */
  protected onRosterLazyLoad(event: { first?: number; rows?: number }): void {
    const cardKey = this.selectedCardKey();
    if (!cardKey) return;
    const rowsPerPage = event.rows && event.rows > 0 ? event.rows : this.rosterRowsPerPage();
    this.loadRosterPage(cardKey, event.first ?? 0, rowsPerPage);
  }

  /** Scrolls a card track by one card slot (336 px = w-80 + gap-4). */
  protected scrollCards(el: HTMLElement, direction: 1 | -1): void {
    el.scrollBy({ left: direction * 336, behavior: 'smooth' });
  }

  protected onTrackScroll(el: HTMLElement, track: 'tech' | 'eco'): void {
    this.refreshArrows(el, track === 'tech');
  }

  /** B5 — Lazy-fetch the drawer section for one card, cached per (org, project, card, range); force bypasses the cache for retry. */
  private loadDrawer(cardKey: string, force = false): void {
    const uid = this.accountContext.selectedAccount()?.uid;
    const slug = this.projectSlug();
    if (!uid || !slug) return;
    const range = this.timeRange();
    const cacheKey = `${uid}|${slug}|${cardKey}|${range}`;

    if (force) this.drawerCache.delete(cacheKey);
    if (this.drawerCache.has(cacheKey)) {
      const cached = this.drawerCache.get(cacheKey) ?? null;
      this.drawerState.set({ status: cached ? 'ready' : 'empty', data: cached });
      return;
    }

    this.drawerState.set({ status: 'loading', data: null });
    this.detailService
      .getCardDrawer(uid, this.orgName(), slug, cardKey, range)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (section) => {
          this.drawerCache.set(cacheKey, section);
          if (
            this.accountContext.selectedAccount()?.uid !== uid ||
            this.projectSlug() !== slug ||
            this.selectedCardKey() !== cardKey ||
            this.timeRange() !== range
          )
            return;
          this.drawerState.set(section ? { status: 'ready', data: section } : { status: 'empty', data: null });
        },
        error: (err: unknown) => {
          console.error('[OrgProjectDetail] failed to load card detail', err);
          if (
            this.accountContext.selectedAccount()?.uid !== uid ||
            this.projectSlug() !== slug ||
            this.selectedCardKey() !== cardKey ||
            this.timeRange() !== range
          )
            return;
          this.drawerState.set({ status: 'error', data: null });
        },
      });
  }

  private resetRoster(): void {
    this.rosterRows.set([]);
    this.rosterTotal.set(0);
    this.rosterFirst.set(0);
    this.rosterRowsPerPage.set(10);
    this.rosterLoading.set(false);
  }

  private resetLeaderboardSearch(): void {
    this.searchForm.reset({ technical: '', ecosystem: '' }, { emitEvent: false });
    this.techSearch.set('');
    this.ecoSearch.set('');
  }

  /** Fetch one server-paginated page of the open card's roster and update the drawer table state. */
  private loadRosterPage(cardKey: string, first: number, rowsPerPage: number): void {
    const uid = this.accountContext.selectedAccount()?.uid;
    const slug = this.projectSlug();
    if (!uid || !slug) return;
    const range = this.timeRange();
    const page = Math.floor(first / rowsPerPage);
    this.rosterFirst.set(first);
    this.rosterRowsPerPage.set(rowsPerPage);
    this.rosterLoading.set(true);
    this.detailService
      .getCardRoster(uid, this.orgName(), slug, cardKey, range, page, rowsPerPage)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (
            this.accountContext.selectedAccount()?.uid !== uid ||
            this.projectSlug() !== slug ||
            this.selectedCardKey() !== cardKey ||
            this.timeRange() !== range ||
            this.rosterFirst() !== first ||
            this.rosterRowsPerPage() !== rowsPerPage
          )
            return;
          this.rosterRows.set(result.rows);
          this.rosterTotal.set(result.total);
          this.rosterLoading.set(false);
        },
        error: (err: unknown) => {
          console.error('[OrgProjectDetail] failed to load card roster', err);
          if (
            this.accountContext.selectedAccount()?.uid !== uid ||
            this.projectSlug() !== slug ||
            this.selectedCardKey() !== cardKey ||
            this.timeRange() !== range ||
            this.rosterFirst() !== first ||
            this.rosterRowsPerPage() !== rowsPerPage
          )
            return;
          this.rosterRows.set([]);
          this.rosterTotal.set(0);
          this.rosterLoading.set(false);
        },
      });
  }

  private initMetric(): OrgLensLeaderboardMetric {
    const raw = this.queryParamMap().get('metric');
    return raw && PD_VALID_METRICS.has(raw) ? (raw as OrgLensLeaderboardMetric) : PD_DEFAULT_METRIC;
  }

  private initTimeRange(): OrgLensLeaderboardTimeRange {
    const raw = this.queryParamMap().get('range');
    return raw && PD_VALID_TIME_RANGES.has(raw) ? (raw as OrgLensLeaderboardTimeRange) : PD_DEFAULT_TIME_RANGE;
  }

  /**
   * Rank one board's dimension (technical / ecosystem), then apply the search filter. Reads from that
   * board's own block so each board paints as soon as its own fetch resolves. Returns all matching
   * rows — the paginator handles slicing.
   */
  private buildBoard(dimension: LeaderboardDimension, search: string) {
    const block = dimension === 'technical' ? this.techBoardState().data : this.ecoBoardState().data;
    const isActivity = this.metric() === 'activity';
    if (dimension === 'ecosystem' && !isActivity && this.isNonLfProject()) {
      return [];
    }
    const sourceRows = isActivity ? (block?.activity ?? []) : (block?.influence ?? []);

    if (isActivity) {
      const ranked = [...sourceRows]
        .sort((a, b) => (a.warehouseRank ?? Number.MAX_SAFE_INTEGER) - (b.warehouseRank ?? Number.MAX_SAFE_INTEGER))
        .map((row, i) => {
          const activity = dimension === 'technical' ? row.activityCount.contributions : row.activityCount.collaborations;
          const activityPct = dimension === 'technical' ? row.activityCount.contributionsPct : row.activityCount.collaborationsPct;
          return {
            // Prefer the warehouse RANK; fall back to positional order so a missing rank never renders as "#0".
            rank: row.warehouseRank ?? i + 1,
            orgName: row.orgName,
            orgLogoUrl: row.orgLogoUrl,
            initials: this.initialsFor(row.orgName),
            activityLabel: `${activity.toLocaleString('en-US')} - ${Math.round(activityPct)}%`,
            bandLabel: '',
            bandSeverity: 'secondary' as const,
            isViewingOrg: row.isViewingOrg,
          };
        });
      const query = search.trim().toLowerCase();
      return this.pinViewingRow(query ? ranked.filter((r) => r.orgName.toLowerCase().includes(query)) : ranked);
    }

    const valued = sourceRows.map((row) => {
      // Each board ranks its own dimension: technical → contribution totals, ecosystem → collaboration totals.
      const activity = dimension === 'technical' ? row.activityCount.contributions : row.activityCount.collaborations;
      const activityPct = dimension === 'technical' ? row.activityCount.contributionsPct : row.activityCount.collaborationsPct;
      return {
        row,
        level: row.levels[dimension],
        activity,
        activityPct,
        sortKey: isActivity ? activity : row.scores[dimension],
      };
    });
    valued.sort((a, b) => b.sortKey - a.sortKey || a.row.orgName.localeCompare(b.row.orgName));
    const ranked = valued.map((entry, i) => {
      // Bands are precomputed per-org warehouse tiers (Silent/Participating/Contributing/Leading).
      // Non-LF is a project-level classification, not a per-org band — it is surfaced once at the
      // board/section level (ecosystemBoardNonLfMarker), never stamped on an individual org chip.
      // A row with no mapped tier renders a blank chip.
      const bandMeta = entry.level ? PD_BAND_TAG[entry.level] : null;
      const activityLabel = isActivity
        ? `${entry.activity.toLocaleString('en-US')} - ${Math.round(entry.activityPct)}%`
        : entry.activity.toLocaleString('en-US');
      return {
        rank: i + 1,
        orgName: entry.row.orgName,
        orgLogoUrl: entry.row.orgLogoUrl,
        initials: this.initialsFor(entry.row.orgName),
        activityLabel,
        bandLabel: bandMeta?.label ?? '',
        bandSeverity: bandMeta?.severity ?? ('secondary' as const),
        isViewingOrg: entry.row.isViewingOrg,
      };
    });
    const query = search.trim().toLowerCase();
    return this.pinViewingRow(query ? ranked.filter((r) => r.orgName.toLowerCase().includes(query)) : ranked);
  }

  private pinViewingRow<T extends { isViewingOrg: boolean }>(rows: T[]): T[] {
    const idx = rows.findIndex((r) => r.isViewingOrg);
    return idx > 0 ? [rows[idx], ...rows.slice(0, idx), ...rows.slice(idx + 1)] : rows;
  }

  private initActiveTab(): OrgLensProjectDetailTab {
    const raw = this.queryParamMap().get('tab');
    return raw && PD_VALID_TABS.has(raw) ? (raw as OrgLensProjectDetailTab) : PD_DEFAULT_TAB;
  }

  /** B1 — Hero stream: range-independent, keyed on (org, slug); a null result is the page not-found. */
  private buildHeroState(): Observable<HeroState> {
    return combineLatest([this.orgUid$, this.slug$, toObservable(this.heroRetry)]).pipe(
      switchMap(([uid, slug]) =>
        this.detailService.getHero(uid, this.orgName(), slug).pipe(
          map((block): HeroState => (block === null ? { status: 'notFound', data: null } : { status: 'ready', data: block })),
          startWith<HeroState>({ status: 'loading', data: null }),
          catchError((err: unknown): Observable<HeroState> => {
            console.error('[OrgProjectDetail] failed to load hero', err);
            return of<HeroState>({ status: 'error', data: null });
          })
        )
      )
    );
  }

  /** B3/B4 — Our-Influence stream: lazy on first pd-influence activation, re-fetches on range change. */
  private buildInfluenceState(): Observable<BlockState<OrgLensInfluenceBlock>> {
    return combineLatest([this.orgUid$, this.slug$, this.range$, this.influenceActivated$, toObservable(this.influenceRetry)]).pipe(
      filter(([, , , activated]) => activated),
      switchMap(([uid, slug, range]) =>
        this.detailService.getInfluenceBlock(uid, this.orgName(), slug, range).pipe(
          map((block): BlockState<OrgLensInfluenceBlock> => (block ? { status: 'ready', data: block } : { status: 'empty', data: null })),
          startWith<BlockState<OrgLensInfluenceBlock>>({ status: 'loading', data: null }),
          catchError((err: unknown): Observable<BlockState<OrgLensInfluenceBlock>> => {
            console.error('[OrgProjectDetail] failed to load influence cards', err);
            return of<BlockState<OrgLensInfluenceBlock>>({ status: 'error', data: null });
          })
        )
      )
    );
  }

  /** B6 — Influence Trend stream: lazy on first pd-leaderboards activation. */
  private buildTrendState(): Observable<BlockState<OrgLensTrendBlock>> {
    return combineLatest([this.orgUid$, this.slug$, this.leaderboardsActivated$, toObservable(this.trendRetry)]).pipe(
      filter(([, , activated]) => activated),
      switchMap(([uid, slug]) =>
        this.detailService.getTrendBlock(uid, this.orgName(), slug).pipe(
          map(
            (block): BlockState<OrgLensTrendBlock> => (block && block.trend.length > 0 ? { status: 'ready', data: block } : { status: 'empty', data: block })
          ),
          startWith<BlockState<OrgLensTrendBlock>>({ status: 'loading', data: null }),
          catchError((err: unknown): Observable<BlockState<OrgLensTrendBlock>> => {
            console.error('[OrgProjectDetail] failed to load influence trend', err);
            return of<BlockState<OrgLensTrendBlock>>({ status: 'error', data: null });
          })
        )
      )
    );
  }

  /**
   * B7/B8 — Leaderboard board stream (one dimension). Lazy on first pd-leaderboards activation and
   * re-fetches on range change. Both boards use this builder with their own fetch + retry, so they
   * fetch independently and in parallel — whichever lands first paints first.
   */
  private buildBoardState(
    fetch: (uid: string, name: string, slug: string, range: OrgLensLeaderboardTimeRange) => Observable<OrgLensLeaderboardBlock | null>,
    retry: Signal<number>
  ): Observable<BlockState<OrgLensLeaderboardBlock>> {
    return combineLatest([this.orgUid$, this.slug$, this.range$, this.leaderboardsActivated$, toObservable(retry)]).pipe(
      filter(([, , , activated]) => activated),
      switchMap(([uid, slug, range]) =>
        fetch(uid, this.orgName(), slug, range).pipe(
          map((block): BlockState<OrgLensLeaderboardBlock> => (block ? { status: 'ready', data: block } : { status: 'empty', data: null })),
          startWith<BlockState<OrgLensLeaderboardBlock>>({ status: 'loading', data: null }),
          catchError((err: unknown): Observable<BlockState<OrgLensLeaderboardBlock>> => {
            console.error('[OrgProjectDetail] failed to load leaderboard board', err);
            return of<BlockState<OrgLensLeaderboardBlock>>({ status: 'error', data: null });
          })
        )
      )
    );
  }

  private initBreadcrumb(): MenuItem[] {
    const hero = this.hero();
    const root: MenuItem = { label: 'Projects', routerLink: ['/org/projects'] };
    return hero ? [root, { label: hero.projectName }] : [root];
  }

  private formatMonthYear(dateString: string | null): string {
    if (!dateString) return '—';
    try {
      return parseLocalDateString(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    } catch {
      return dateString;
    }
  }

  private formatCompactUsd(value: number | null): string {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }

  private refreshArrows(el: HTMLElement | undefined, tech: boolean): void {
    if (!el || !isPlatformBrowser(this.platformId)) return;
    (tech ? this.techArrows : this.ecoArrows).set({
      left: el.scrollLeft > 0,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }

  /**
   * Section-title badge for a precomputed influence tier. A null band marks a non-LF project
   * (ecosystem has no tier) → the distinct Non-LF marker rather than a band chip.
   */
  private bandMeta(band: OrgLensProjectBand | null): { chipClass: string; bars: { x: number; y: number; h: number; fillClass: string }[]; label: string } {
    if (band === null) {
      return {
        chipClass: PD_NON_LF_MARKER.chipClass,
        bars: this.buildSignalBars(PD_NON_LF_MARKER.signalRank, PD_NON_LF_MARKER.signalFill, PD_NON_LF_MARKER.signalFillLight),
        label: PD_NON_LF_MARKER.label,
      };
    }
    return {
      chipClass: BAND_CHIP_CLASS[band],
      bars: this.buildSignalBars(BAND_SIGNAL_RANK[band], BAND_SIGNAL_FILL[band], BAND_SIGNAL_FILL_LIGHT[band]),
      label: PD_BAND_TAG[band].label,
    };
  }

  private buildSignalBars(rank: number, fill: string, fillLight: string): { x: number; y: number; h: number; fillClass: string }[] {
    const heights = [5, 8.3, 11.6, 15];
    const barWidth = 2.6;
    const gap = 1.8;
    return heights.map((h, i) => ({
      x: i * (barWidth + gap),
      y: 15 - h,
      h,
      fillClass: i < rank ? fill : fillLight,
    }));
  }

  private initialsFor(name: string): string {
    const parts = name.split(/[\s/]+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  /** Shared external-tooltip callback: positions a fixed DOM overlay near the cursor. */
  private buildExternalTooltipFn(valueSuffix = ''): (args: {
    chart: { canvas: HTMLElement & { getBoundingClientRect(): DOMRect } };
    tooltip: {
      opacity: number;
      caretX: number;
      caretY: number;
      title?: string[];
      dataPoints?: { dataset: { borderColor: string; backgroundColor: string; label?: string }; formattedValue: string }[];
    };
  }) => void {
    return ({ chart, tooltip }) => {
      const tip = chart.canvas.closest('[data-sparkline-host]')?.querySelector<HTMLElement>('[data-lfx-tip]');
      if (!tip) return;

      if (tooltip.opacity === 0) {
        tip.style.display = 'none';
        return;
      }

      const rect = chart.canvas.getBoundingClientRect();
      tip.style.left = `${rect.left + tooltip.caretX + 12}px`;
      tip.style.top = `${rect.top + tooltip.caretY}px`;
      tip.style.transform = 'translateY(-100%)';

      tip.replaceChildren();

      const titleEl = document.createElement('p');
      titleEl.style.cssText = 'font-size:12px;font-weight:600;color:#111827;white-space:nowrap';
      titleEl.textContent = tooltip.title?.[0] ?? '';
      tip.appendChild(titleEl);

      for (const p of tooltip.dataPoints ?? []) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px';

        const dot = document.createElement('span');
        dot.style.cssText = `width:8px;height:8px;border-radius:9999px;flex-shrink:0;background:${p.dataset.borderColor ?? ''}`;
        row.appendChild(dot);

        const labelEl = document.createElement('span');
        labelEl.style.cssText = 'font-size:12px;color:#6B7280;white-space:nowrap';
        labelEl.textContent = `${p.dataset.label ?? ''}: `;

        const valueEl = document.createElement('strong');
        valueEl.style.cssText = 'color:#111827;font-weight:600';
        valueEl.textContent = `${p.formattedValue}${valueSuffix}`;
        labelEl.appendChild(valueEl);
        row.appendChild(labelEl);

        tip.appendChild(row);
      }

      tip.style.display = 'block';
    };
  }

  private buildLineAreaCardOptions(valueSuffix = ''): ChartOptions<ChartType> {
    const external = this.buildExternalTooltipFn(valueSuffix) as NonNullable<NonNullable<ChartOptions<ChartType>['plugins']>['tooltip']>['external'];
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { enabled: false, external } },
      scales: { x: { display: false }, y: { display: false } },
    };
  }

  private buildBarCardOptions(valueSuffix = ''): ChartOptions<ChartType> {
    const external = this.buildExternalTooltipFn(valueSuffix) as NonNullable<NonNullable<ChartOptions<ChartType>['plugins']>['tooltip']>['external'];
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { enabled: false, external } },
      scales: { x: { display: false }, y: { display: false, beginAtZero: true } },
    };
  }

  /** Maps a card key to its preferred visualization variant. */
  private chartVariantFor(key: string): 'area' | 'bar' | 'line' {
    if (['pull-requests', 'meeting-attendance', 'event-attendance'].includes(key)) return 'bar';
    if (['avg-merge-time', 'board-members'].includes(key)) return 'line';
    return 'area';
  }

  /** 36 trailing short-month labels (oldest → newest) — UTC-aligned with the BFF month axis. */
  private buildMonthLabels(): string[] {
    const out: string[] = [];
    const now = new Date();
    for (let i = 35; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      out.push(d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }));
    }
    return out;
  }

  private toInfluenceCard(card: OrgLensProjectInfluenceCard, colorHex: string, group: 'technical' | 'ecosystem', months: number): InfluenceCardVm {
    const variant = this.chartVariantFor(card.key);
    const valueSuffix = card.key === 'avg-merge-time' ? ' days' : '';
    const sparkline = card.sparkline.slice(-months);
    const projectSparkline = card.projectSparkline.slice(-months);
    const labels = this.monthLabels.slice(-sparkline.length);
    return {
      key: card.key,
      title: card.label,
      scopeLabel: card.scopeLabel,
      hasData: sparkline.some((value) => value !== null),
      chartType: (variant === 'bar' ? 'bar' : 'line') as ChartType,
      chartData: this.buildCardChartData(sparkline, projectSparkline, colorHex, variant, labels),
      chartOptions: variant === 'bar' ? this.buildBarCardOptions(valueSuffix) : this.buildLineAreaCardOptions(valueSuffix),
      valueSuffix,
      caption: card.caption,
      statLabel: card.caption.suffix.trim().replace(/\.$/, ''),
      testId: `project-detail-${group}-card-${card.key}`,
    };
  }

  private buildCardChartData(
    series: (number | null)[],
    projectSeries: number[],
    colorHex: string,
    variant: 'area' | 'bar' | 'line',
    labels: string[]
  ): ChartData<ChartType> {
    if (variant === 'bar') {
      return {
        labels,
        datasets: [{ label: 'Your company', data: series, backgroundColor: colorHex + '99', borderColor: colorHex, borderWidth: 0, borderRadius: 4 }],
      };
    }
    const fill = variant === 'area';
    const datasets: ChartData<ChartType>['datasets'] = [
      {
        label: 'Your company',
        data: series,
        borderColor: colorHex,
        backgroundColor: fill ? colorHex + '33' : 'transparent',
        fill: fill ? 'origin' : false,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 0,
      },
    ];
    if (projectSeries.length > 0) {
      datasets.push({
        label: 'Project average',
        data: projectSeries,
        borderColor: lfxColors.gray[300],
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.4,
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 0,
      });
    }
    return { labels, datasets };
  }

  /**
   * Builds a 100%-stacked area chart from the real per-org monthly combined-influence series.
   * The server already sends the top-N named orgs plus a single "All others" band that sums the
   * complete remaining tail, so every series is rendered as-is (no client-side truncation) and
   * each month is normalized so all series sum to 100%.
   */
  private buildStackedTrend(): ChartData<ChartType> {
    const trend = this.trendState().data?.trend ?? [];
    if (trend.length === 0) return { labels: [], datasets: [] };

    const months = PD_TIME_RANGE_MONTHS[this.timeRange()];
    const series = trend.map((t) => ({ name: t.orgName, data: t.combined.slice(-months) }));
    const len = series.reduce((max, s) => Math.max(max, s.data.length), 0);
    if (len === 0) return { labels: [], datasets: [] };

    const labels = this.monthLabels.slice(-len);
    const entries = series.map((s) => ({ name: s.name, data: this.padStart(s.data, len) }));

    // Normalize each month so all series sum to 100%.
    const monthTotals = Array.from({ length: len }, (_, i) => entries.reduce((sum, e) => sum + (e.data[i] ?? 0), 0));
    const pctSeries = entries.map((e) => e.data.map((val, i) => (monthTotals[i] > 0 ? (val / monthTotals[i]) * 100 : 0)));

    // Rank by most-recent-month share (most influential now → first/bottom of stack).
    const lastIdx = len - 1;
    const ranked = entries.map((entry, i) => ({ entry, pct: pctSeries[i], lastShare: pctSeries[i][lastIdx] ?? 0 })).sort((a, b) => b.lastShare - a.lastShare);

    const datasets = ranked.map((item, rankIdx) => {
      const color = PD_STACKED_PALETTE[rankIdx] ?? lfxColors.gray[300];
      return {
        label: item.entry.name,
        data: item.pct,
        backgroundColor: color + '99',
        borderColor: color,
        borderWidth: 1.5,
        fill: 'stack',
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 3,
      };
    });

    return { labels, datasets };
  }

  /** Left-pads a monthly series with zeros so every org series aligns to the same length. */
  private padStart(data: number[], len: number): number[] {
    if (data.length >= len) return data.slice(-len);
    return [...Array.from({ length: len - data.length }, () => 0), ...data];
  }

  private buildStackedTrendOptions(): ChartOptions<ChartType> {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 16 } },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: { label: (ctx) => ` ${ctx.dataset.label ?? ''}: ${(ctx.parsed as { y: number }).y.toFixed(1)}%` },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: { stacked: true, min: 0, max: 100, ticks: { maxTicksLimit: 6, callback: (v) => `${v}%` } },
      },
    };
  }
}
