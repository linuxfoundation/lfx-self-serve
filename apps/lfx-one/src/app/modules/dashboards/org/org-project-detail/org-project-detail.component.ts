// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { Component, computed, ElementRef, inject, PLATFORM_ID, signal, type Signal, viewChild } from '@angular/core';
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
  PD_HEALTH_TAG,
  PD_NON_LF_MARKER,
  lfxColors,
  PD_METRIC_OPTIONS,
  PD_STACKED_PALETTE,
  PD_TIME_RANGE_MONTHS,
  PD_TIME_RANGE_OPTIONS,
  PD_VALID_METRICS,
  PD_VALID_TIME_RANGES,
} from '@lfx-one/shared/constants';
import type {
  InfluenceCardVm,
  LeaderboardDimension,
  OrgLensCardDetailRow,
  OrgLensCardDetailSection,
  OrgLensLeaderboardMetric,
  OrgLensLeaderboardTimeRange,
  OrgLensProjectBand,
  OrgLensProjectDetailPageState,
  OrgLensProjectDetailResponse,
  OrgLensProjectDetailTab,
  OrgLensProjectInfluenceCard,
} from '@lfx-one/shared/interfaces';
import { parseLocalDateString } from '@lfx-one/shared/utils';
import type { MenuItem } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { InputTextModule } from 'primeng/inputtext';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import type { ChartData, ChartOptions, ChartType } from 'chart.js';
import { catchError, combineLatest, debounceTime, filter, map, type Observable, of, switchMap, tap } from 'rxjs';

/**
 * Org Lens · Project Detail sub-page (LFXV2-1885), routed at `/org/projects/:projectSlug`.
 * Opened from the Projects table (project name link) and the Org Overview Foundations &
 * Projects tab. Owns the fetch keyed on the selected org + slug, the page-state machine,
 * and the URL-persisted tab strip.
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

  protected readonly retryTrigger = signal(0);
  protected readonly fetchLoading = signal(true);
  protected readonly fetchError = signal(false);
  protected readonly detail = signal<OrgLensProjectDetailResponse | null>(null);
  protected readonly techArrows = signal({ left: false, right: false });
  protected readonly ecoArrows = signal({ left: false, right: false });
  private readonly selectedCardKey = signal<string | null>(null);
  protected readonly drawerOpen = signal(false);

  protected readonly cardDetail = computed<OrgLensCardDetailSection | null>(() => {
    const card = this.selectedCard();
    if (!card) return null;
    return this.detail()?.cardDetails?.[card.key] ?? null;
  });

  protected readonly tabs: { id: OrgLensProjectDetailTab; label: string; icon: string }[] = [
    { id: 'pd-influence', label: 'Our Influence', icon: 'fa-light fa-chart-network' },
    { id: 'pd-leaderboards', label: 'Leaderboards', icon: 'fa-light fa-ranking-star' },
  ];

  private readonly queryParamMap = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  protected readonly activeTab: Signal<OrgLensProjectDetailTab> = computed(() => this.initActiveTab());
  protected readonly pageState: Signal<OrgLensProjectDetailPageState> = computed(() => this.initPageState());
  protected readonly hasCompany = computed(() => !!this.accountContext.selectedAccount().uid);

  // Hero presentation — derived from the loaded payload.
  protected readonly hero = computed(() => this.detail()?.hero ?? null);
  protected readonly breadcrumbItems = computed<MenuItem[]>(() => this.initBreadcrumb());
  protected readonly healthMeta = computed(() => {
    const health = this.hero()?.health;
    return health ? PD_HEALTH_TAG[health] : null;
  });
  protected readonly firstCommitLabel = computed(() => this.formatMonthYear(this.hero()?.firstCommit ?? null));
  protected readonly softwareValueLabel = computed(() => this.formatCompactUsd(this.hero()?.softwareValueUsd ?? null));
  protected readonly logoInitials = computed(() => this.initialsFor(this.hero()?.projectName ?? ''));

  // Org's own influence standing (from its leaderboard row) → section-title band badges.
  // Bands are precomputed warehouse tiers read straight through — not derived from the score client-side.
  private readonly viewingRow = computed(() => this.detail()?.leaderboard.find((row) => row.isViewingOrg) ?? null);
  protected readonly technicalBandMeta = computed(() => {
    const row = this.viewingRow();
    return row ? this.bandMeta(row.levels.technical) : null;
  });
  protected readonly ecosystemBandMeta = computed(() => {
    // Non-LF is a project-level classification, independent of whether the viewing org has a
    // leaderboard row — surface the distinct Non-LF marker whenever the project is non-LF (bandMeta
    // renders that marker for a null level). Otherwise show the viewing org's precomputed tier.
    if (this.detail()?.isNonLfProject) return this.bandMeta(null);
    const row = this.viewingRow();
    return row ? this.bandMeta(row.levels.ecosystem) : null;
  });

  // Our Influence tab — Technical + Ecosystem cards (per-card chart type and data).
  private readonly monthLabels: string[] = this.buildMonthLabels();
  protected readonly technicalCards = computed(() => {
    const months = PD_TIME_RANGE_MONTHS[this.timeRange()];
    return (this.detail()?.technical ?? []).map((card) => this.toInfluenceCard(card, lfxColors.blue[500], 'technical', months));
  });
  protected readonly ecosystemCards = computed(() => {
    const months = PD_TIME_RANGE_MONTHS[this.timeRange()];
    return (this.detail()?.ecosystem ?? []).map((card) => this.toInfluenceCard(card, lfxColors.violet[500], 'ecosystem', months));
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
  protected readonly metric = computed<OrgLensLeaderboardMetric>(() => this.initMetric());
  protected readonly timeRange = computed<OrgLensLeaderboardTimeRange>(() => this.initTimeRange());
  protected readonly isActivityMode = computed(() => this.metric() === 'activity');
  protected readonly technicalBoardTitle = computed(() => (this.isActivityMode() ? 'Contribution Activities Leaderboard' : 'Technical Influence Leaderboard'));
  protected readonly ecosystemBoardTitle = computed(() => (this.isActivityMode() ? 'Collaboration Activities Leaderboard' : 'Ecosystem Influence Leaderboard'));
  /** Project-level Non-LF marker for the ecosystem leaderboard when the project has no ecosystem influence. */
  protected readonly ecosystemBoardNonLfMarker = computed(() => (this.detail()?.isNonLfProject ? PD_NON_LF_MARKER : null));
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
  protected readonly hasStackedTrend = computed(() => (this.detail()?.trend.length ?? 0) > 0);
  protected readonly stackedTrendData = computed<ChartData<ChartType>>(() => this.buildStackedTrend());
  protected readonly stackedTrendOptions: ChartOptions<ChartType> = this.buildStackedTrendOptions();

  // Subscribe via toSignal so the fetch stream runs; results are mirrored into the signals read by the template.
  protected readonly detailData = toSignal<OrgLensProjectDetailResponse | null>(this.initDetailStream(), { initialValue: null });

  public constructor() {
    this.searchForm.controls.technical.valueChanges.pipe(debounceTime(250), takeUntilDestroyed()).subscribe((value) => this.techSearch.set(value));
    this.searchForm.controls.ecosystem.valueChanges.pipe(debounceTime(250), takeUntilDestroyed()).subscribe((value) => this.ecoSearch.set(value));

    // React when tab or card counts change to refresh horizontal scroll arrows.
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

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
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
  }

  protected closeCardDetail(): void {
    this.drawerOpen.set(false);
  }

  /** Scrolls a card track by one card slot (336 px = w-80 + gap-4). */
  protected scrollCards(el: HTMLElement, direction: 1 | -1): void {
    el.scrollBy({ left: direction * 336, behavior: 'smooth' });
  }

  /** Builds a stable `@for` track key from a detail row's cells. */
  protected rowKey(row: OrgLensCardDetailRow): string {
    return row.cells.map((cell) => cell.person?.name ?? cell.text ?? '').join('|');
  }

  protected onTrackScroll(el: HTMLElement, track: 'tech' | 'eco'): void {
    this.refreshArrows(el, track === 'tech');
  }

  /**
   * Right-hand column header for a leaderboard. Influence mode shows the band/score column;
   * Activity Count mode labels both boards "Total contributions" — org-dashboard parity (both the
   * Contribution and Collaboration activity boards reuse this header; §DN7).
   */
  protected columnLabel(): string {
    return this.isActivityMode() ? 'Total contributions' : 'Influence Score';
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
   * Rank the leaderboard for one dimension (technical / ecosystem), then apply the search filter.
   * Returns all matching rows — the paginator handles slicing.
   */
  private buildBoard(dimension: LeaderboardDimension, search: string) {
    const isActivity = this.metric() === 'activity';
    const sourceRows = isActivity
      ? ((dimension === 'technical' ? this.detail()?.activityLeaderboards.contributions : this.detail()?.activityLeaderboards.collaborations) ?? [])
      : (this.detail()?.leaderboard ?? []);

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
            activityLabel: `${activity.toLocaleString()} - ${Math.round(activityPct)}%`,
            bandLabel: '',
            bandSeverity: 'secondary' as const,
            isViewingOrg: row.isViewingOrg,
          };
        });
      const query = search.trim().toLowerCase();
      return query ? ranked.filter((r) => r.orgName.toLowerCase().includes(query)) : ranked;
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
      // Non-LF is a project-level classification, not a per-org band (§DN8) — it is surfaced once at
      // the board/section level (ecosystemBoardNonLfMarker), never stamped on an individual org chip.
      // A row with no mapped tier renders a blank chip.
      const bandMeta = entry.level ? PD_BAND_TAG[entry.level] : null;
      const activityLabel = isActivity ? `${entry.activity.toLocaleString()} - ${Math.round(entry.activityPct)}%` : entry.activity.toLocaleString();
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
    return query ? ranked.filter((r) => r.orgName.toLowerCase().includes(query)) : ranked;
  }

  private initActiveTab(): OrgLensProjectDetailTab {
    const raw = this.queryParamMap().get('tab');
    return raw && PD_VALID_TABS.has(raw) ? (raw as OrgLensProjectDetailTab) : PD_DEFAULT_TAB;
  }

  private initDetailStream(): Observable<OrgLensProjectDetailResponse | null> {
    const orgUid$ = toObservable(computed(() => this.accountContext.selectedAccount()?.uid)).pipe(filter((uid): uid is string => !!uid));
    const orgName$ = toObservable(computed(() => this.accountContext.selectedAccount()?.accountName ?? ''));
    const projectSlug$ = this.route.paramMap.pipe(map((params) => params.get('projectSlug')));
    // The ?range= toggle re-scopes card headlines, leaderboard scores, and activity totals server-side.
    const timeRange$ = toObservable(this.timeRange);
    const retryTrigger$ = toObservable(this.retryTrigger);

    return combineLatest([orgUid$, orgName$, projectSlug$.pipe(filter((slug): slug is string => !!slug)), timeRange$, retryTrigger$]).pipe(
      tap(() => {
        this.fetchLoading.set(true);
        this.fetchError.set(false);
        // A refetch (notably a ?range= change) re-scopes every headline/total server-side. Close any
        // open card drawer so it can never pair the new range label with a stale, pre-refetch payload.
        this.drawerOpen.set(false);
        this.selectedCardKey.set(null);
      }),
      switchMap(([orgUid, orgName, projectSlug, range]) => {
        return this.detailService.getProjectDetail(orgUid, orgName, projectSlug, range).pipe(
          catchError((err: unknown) => {
            console.error('[OrgProjectDetail] failed to load project detail', err);
            this.fetchError.set(true);
            this.fetchLoading.set(false);
            return of<OrgLensProjectDetailResponse | null>(null);
          })
        );
      }),
      tap((response) => {
        this.detail.set(response);
        this.searchForm.reset({ technical: '', ecosystem: '' });
        this.techSearch.set('');
        this.ecoSearch.set('');
        if (!this.fetchError()) this.fetchLoading.set(false);
      })
    );
  }

  private initPageState(): OrgLensProjectDetailPageState {
    if (this.fetchLoading()) return 'loading';
    if (this.fetchError()) return 'error';
    if (!this.detail()) return 'notFound';
    return 'ready';
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
      hasData: sparkline.length > 0,
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
    const trend = this.detail()?.trend ?? [];
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
