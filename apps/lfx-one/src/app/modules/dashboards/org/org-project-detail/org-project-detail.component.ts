// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, ElementRef, inject, PLATFORM_ID, signal, type Signal, ViewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensProjectDetailService } from '@services/org-lens-project-detail.service';
import { BreadcrumbComponent } from '@components/breadcrumb/breadcrumb.component';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { OrgProjectDetailTabBarComponent } from './org-project-detail-tab-bar.component';
import { lfxColors } from '@lfx-one/shared/constants';
import type {
  OrgLensCardDetailSection,
  OrgLensLeaderboardMetric,
  OrgLensLeaderboardTimeRange,
  OrgLensProjectBand,
  OrgLensProjectDetailPageState,
  OrgLensProjectDetailResponse,
  OrgLensProjectDetailTab,
  OrgLensProjectHealth,
  OrgLensProjectInfluenceCard,
  TagSeverity,
} from '@lfx-one/shared/interfaces';
import { parseLocalDateString } from '@lfx-one/shared/utils';
import type { MenuItem } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { TooltipModule } from 'primeng/tooltip';
import type { ChartData, ChartOptions, ChartType } from 'chart.js';
import { catchError, combineLatest, filter, map, type Observable, of, switchMap, tap } from 'rxjs';

/** Presentation VM for each influence card — includes chart objects typed for Chart.js. */
interface InfluenceCardVm {
  key: string;
  title: string;
  scopeLabel: string | null;
  hasData: boolean;
  chartType: ChartType;
  chartData: ChartData<ChartType>;
  chartOptions: ChartOptions<ChartType>;
  valueSuffix: string;
  caption: { prefix: string; emphasis: string; suffix: string };
  statLabel: string;
  testId: string;
}

const DEFAULT_TAB: OrgLensProjectDetailTab = 'pd-influence';
const VALID_TABS: ReadonlySet<string> = new Set<OrgLensProjectDetailTab>(['pd-influence', 'pd-leaderboards']);

const DEFAULT_METRIC: OrgLensLeaderboardMetric = 'influence';
const VALID_METRICS: ReadonlySet<string> = new Set<OrgLensLeaderboardMetric>(['influence', 'activity']);

const DEFAULT_TIME_RANGE: OrgLensLeaderboardTimeRange = '1y';
const VALID_TIME_RANGES: ReadonlySet<string> = new Set<OrgLensLeaderboardTimeRange>(['1y', '2y', 'all']);

/** Dimension keyed by each side-by-side leaderboard. */
type LeaderboardDimension = 'technical' | 'ecosystem';

/** Hero health badge → lfx-tag severity (green Excellent / amber Healthy / red At Risk). */
const HEALTH_TAG: Record<OrgLensProjectHealth, { label: string; severity: TagSeverity }> = {
  excellent: { label: 'Excellent', severity: 'success' },
  healthy: { label: 'Healthy', severity: 'warn' },
  'at-risk': { label: 'At Risk', severity: 'danger' },
};

/** Leaderboard band chip → lfx-tag severity. */
const BAND_TAG: Record<OrgLensProjectBand, { label: string; severity: TagSeverity }> = {
  leading: { label: 'Leading', severity: 'success' },
  contributing: { label: 'Contributing', severity: 'info' },
  participating: { label: 'Participating', severity: 'warn' },
  'non-lf': { label: 'Non-LF', severity: 'secondary' },
};

/**
 * Signal-strength bar fill constants for the section-header band chip.
 * Inlined here (not in @lfx-one/shared) to avoid conflict with the shared-package additions
 * landing with PR #921 (LFXV2-1883). Merge those once that PR lands.
 */
const BAND_SIGNAL_RANK: Record<OrgLensProjectBand, number> = {
  leading: 4,
  contributing: 3,
  participating: 2,
  'non-lf': 0,
};
const BAND_SIGNAL_FILL: Record<OrgLensProjectBand, string> = {
  leading: 'fill-emerald-500',
  contributing: 'fill-blue-500',
  participating: 'fill-amber-500',
  'non-lf': 'fill-gray-400',
};
const BAND_SIGNAL_FILL_LIGHT: Record<OrgLensProjectBand, string> = {
  leading: 'fill-emerald-200',
  contributing: 'fill-blue-200',
  participating: 'fill-amber-200',
  'non-lf': 'fill-gray-200',
};
const BAND_CHIP_CLASS: Record<OrgLensProjectBand, string> = {
  leading: 'inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700',
  contributing: 'inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700',
  participating: 'inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700',
  'non-lf': 'inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600',
};

const METRIC_OPTIONS: { id: OrgLensLeaderboardMetric; label: string; icon: string }[] = [
  { id: 'influence', label: 'Calculated Influence', icon: 'fa-light fa-chart-bar' },
  { id: 'activity', label: 'Activity Count', icon: 'fa-light fa-list-ol' },
];

const TIME_RANGE_OPTIONS: { id: OrgLensLeaderboardTimeRange; label: string }[] = [
  { id: '1y', label: '1 year' },
  { id: '2y', label: '2 years' },
  { id: 'all', label: 'All time' },
];

const TIME_RANGE_MONTHS: Record<OrgLensLeaderboardTimeRange, number> = { '1y': 12, '2y': 24, 'all': 36 };

/** 11-slot palette for the stacked trend chart — top-10 companies + "All others". */
const STACKED_PALETTE: string[] = [
  lfxColors.blue[600],
  lfxColors.blue[400],
  lfxColors.emerald[500],
  lfxColors.emerald[400],
  lfxColors.violet[500],
  lfxColors.violet[400],
  lfxColors.amber[500],
  lfxColors.amber[400],
  lfxColors.blue[300],
  lfxColors.emerald[300],
  lfxColors.gray[400],
];

/** Band thresholds per Boysel et al. markup-mu (Leading / Contributing / Participating / Non-LF). */
function bandForScore(score: number): OrgLensProjectBand {
  if (score >= 80) return 'leading';
  if (score >= 55) return 'contributing';
  if (score >= 35) return 'participating';
  return 'non-lf';
}

/**
 * Org Lens · Project Detail sub-page (LFXV2-1885). Opened from the Projects table /
 * Influence Summary cards via `/org/projects/:projectSlug`. Owns the fetch keyed on the
 * selected org + slug, the page-state machine, and the URL-persisted tab strip.
 */
@Component({
  selector: 'lfx-org-project-detail',
  imports: [NgTemplateOutlet, BreadcrumbComponent, ChartComponent, EmptyStateComponent, OrgProjectDetailTabBarComponent, TableComponent, TagComponent, DrawerModule, TooltipModule],
  templateUrl: './org-project-detail.component.html',
})
export class OrgProjectDetailComponent {
  @ViewChild('technicalTrack') private techTrackRef?: ElementRef<HTMLElement>;
  @ViewChild('ecosystemTrack') private ecoTrackRef?: ElementRef<HTMLElement>;

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
  protected readonly selectedCard = signal<InfluenceCardVm | null>(null);
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

  /** The viewing org's display name — falls back to a demo placeholder when no org is selected. */
  protected readonly orgName = computed(() => this.accountContext.selectedAccount()?.accountName ?? 'Acme Corp');

  // Hero presentation — derived from the loaded payload.
  protected readonly hero = computed(() => this.detail()?.hero ?? null);
  protected readonly breadcrumbItems = computed<MenuItem[]>(() => this.initBreadcrumb());
  protected readonly healthMeta = computed(() => {
    const health = this.hero()?.health;
    return health ? HEALTH_TAG[health] : null;
  });
  protected readonly firstCommitLabel = computed(() => this.formatMonthYear(this.hero()?.firstCommit ?? null));
  protected readonly softwareValueLabel = computed(() => this.formatCompactUsd(this.hero()?.softwareValueUsd ?? null));
  protected readonly logoInitials = computed(() => this.initialsFor(this.hero()?.projectName ?? ''));
  protected readonly sourceUrl = computed(() => this.hero()?.sourceUrl ?? null);

  // Org's own influence standing (from its leaderboard row) → section-title band badges.
  private readonly viewingScores = computed(() => this.detail()?.leaderboard.find((row) => row.isViewingOrg)?.scores ?? null);
  protected readonly technicalBand = computed(() => {
    const scores = this.viewingScores();
    return scores ? bandForScore(scores.technical) : null;
  });
  protected readonly ecosystemBand = computed(() => {
    const scores = this.viewingScores();
    return scores ? bandForScore(scores.ecosystem) : null;
  });

  // Our Influence tab — Technical + Ecosystem cards (per-card chart type and data).
  private readonly monthLabels: string[] = this.buildMonthLabels();
  protected readonly technicalCards = computed(() => {
    const months = TIME_RANGE_MONTHS[this.timeRange()];
    return (this.detail()?.technical ?? []).map((card) => this.toInfluenceCard(card, lfxColors.blue[500], 'technical', months));
  });
  protected readonly ecosystemCards = computed(() => {
    const months = TIME_RANGE_MONTHS[this.timeRange()];
    return (this.detail()?.ecosystem ?? []).map((card) => this.toInfluenceCard(card, lfxColors.violet[500], 'ecosystem', months));
  });

  // Sparkline card options — stable class-level references so Angular passes them correctly through ng-template context.
  protected readonly lineCardOptions: ChartOptions<ChartType> = this.buildLineAreaCardOptions();
  protected readonly barCardOptions: ChartOptions<ChartType> = this.buildBarCardOptions();

  // Leaderboards tab — URL-persisted metric toggle + time range + two side-by-side boards + stacked trend.
  protected readonly metricOptions = METRIC_OPTIONS;
  protected readonly timeRangeOptions = TIME_RANGE_OPTIONS;
  protected readonly metric = computed<OrgLensLeaderboardMetric>(() => this.initMetric());
  protected readonly timeRange = computed<OrgLensLeaderboardTimeRange>(() => this.initTimeRange());
  protected readonly isActivityMode = computed(() => this.metric() === 'activity');
  protected readonly scoreColumnLabel = computed(() => (this.isActivityMode() ? 'Activity (12mo)' : 'Influence Score'));
  protected readonly techSearch = signal('');
  protected readonly ecoSearch = signal('');
  protected readonly technicalBoard = computed(() => this.buildBoard('technical', this.techSearch()));
  protected readonly ecosystemBoard = computed(() => this.buildBoard('ecosystem', this.ecoSearch()));

  // Stacked area trend chart — top-10 companies + "All others" stacked by combined influence score.
  protected readonly hasStackedTrend = computed(() => (this.detail()?.leaderboard.length ?? 0) > 0);
  protected readonly stackedTrendData = computed<ChartData<ChartType>>(() => this.buildStackedTrend());
  protected readonly stackedTrendOptions: ChartOptions<ChartType> = this.buildStackedTrendOptions();

  // After cards populate (async data load), check whether each track is actually scrollable.
  private readonly _scrollEffect = effect(() => {
    const techLen = this.technicalCards().length;
    const ecoLen = this.ecosystemCards().length;
    if (techLen === 0 && ecoLen === 0) return;
    Promise.resolve().then(() => {
      this.refreshArrows(this.techTrackRef?.nativeElement, true);
      this.refreshArrows(this.ecoTrackRef?.nativeElement, false);
    });
  });

  // Subscribe via toSignal so the fetch stream runs; results are mirrored into the signals read by the template.
  protected readonly detailData = toSignal<OrgLensProjectDetailResponse | null>(this.initDetailStream(), { initialValue: null });

  protected switchTab(tab: OrgLensProjectDetailTab): void {
    if (this.activeTab() === tab) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === DEFAULT_TAB ? null : tab },
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
      queryParams: { metric: metric === DEFAULT_METRIC ? null : metric },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected setTimeRange(range: OrgLensLeaderboardTimeRange): void {
    if (this.timeRange() === range) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { range: range === DEFAULT_TIME_RANGE ? null : range },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onSearch(dimension: LeaderboardDimension, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    (dimension === 'technical' ? this.techSearch : this.ecoSearch).set(value);
  }

  protected bandChipClass(band: OrgLensProjectBand): string {
    return BAND_CHIP_CLASS[band];
  }

  protected bandLabel(band: OrgLensProjectBand): string {
    return BAND_TAG[band].label;
  }

  protected bandSignalBars(band: OrgLensProjectBand): { x: number; y: number; h: number; fillClass: string }[] {
    const rank = BAND_SIGNAL_RANK[band];
    const heights = [5, 8.3, 11.6, 15];
    const barWidth = 2.6;
    const gap = 1.8;
    return heights.map((h, i) => ({
      x: i * (barWidth + gap),
      y: 15 - h,
      h,
      fillClass: i < rank ? BAND_SIGNAL_FILL[band] : BAND_SIGNAL_FILL_LIGHT[band],
    }));
  }

  protected openCardDetail(card: InfluenceCardVm): void {
    this.selectedCard.set(card);
    this.drawerOpen.set(true);
  }

  protected closeCardDetail(): void {
    this.drawerOpen.set(false);
  }

  /** Returns initials for a person name (used in drawer person-cell avatars). */
  protected personInitials(name: string): string {
    return this.initialsFor(name);
  }

  /** Scrolls a card track by one card slot (336 px = w-80 + gap-4). */
  protected scrollCards(el: HTMLElement, direction: 1 | -1): void {
    el.scrollBy({ left: direction * 336, behavior: 'smooth' });
  }

  /** Updates left/right arrow visibility from the track's scroll position. */
  protected onTrackScroll(el: HTMLElement, track: 'tech' | 'eco'): void {
    this.refreshArrows(el, track === 'tech');
  }

  private initMetric(): OrgLensLeaderboardMetric {
    const raw = this.queryParamMap().get('metric');
    return raw && VALID_METRICS.has(raw) ? (raw as OrgLensLeaderboardMetric) : DEFAULT_METRIC;
  }

  private initTimeRange(): OrgLensLeaderboardTimeRange {
    const raw = this.queryParamMap().get('range');
    return raw && VALID_TIME_RANGES.has(raw) ? (raw as OrgLensLeaderboardTimeRange) : DEFAULT_TIME_RANGE;
  }

  /** Per-dimension activity count (12mo) derived from that dimension's score, so the two boards differ. */
  private activityFor(score: number): number {
    return Math.round(score * 46);
  }

  /**
   * Rank the leaderboard for one dimension (technical / ecosystem), then apply the search filter.
   * Returns all matching rows — the paginator handles slicing.
   */
  private buildBoard(dimension: LeaderboardDimension, search: string) {
    const valued = (this.detail()?.leaderboard ?? []).map((row) => ({ row, score: row.scores[dimension] }));
    valued.sort((a, b) => b.score - a.score || a.row.orgName.localeCompare(b.row.orgName));
    const ranked = valued.map((entry, i) => {
      const bandMeta = BAND_TAG[bandForScore(entry.score)];
      return {
        rank: i + 1,
        orgName: entry.row.orgName,
        orgLogoUrl: entry.row.orgLogoUrl,
        initials: this.initialsFor(entry.row.orgName),
        activityLabel: this.activityFor(entry.score).toLocaleString(),
        bandLabel: bandMeta.label,
        bandSeverity: bandMeta.severity,
        isViewingOrg: entry.row.isViewingOrg,
      };
    });
    const query = search.trim().toLowerCase();
    return query ? ranked.filter((r) => r.orgName.toLowerCase().includes(query)) : ranked;
  }

  private initActiveTab(): OrgLensProjectDetailTab {
    const raw = this.queryParamMap().get('tab');
    return raw && VALID_TABS.has(raw) ? (raw as OrgLensProjectDetailTab) : DEFAULT_TAB;
  }

  private initDetailStream(): Observable<OrgLensProjectDetailResponse | null> {
    const orgUid$ = toObservable(computed(() => this.accountContext.selectedAccount()?.uid ?? 'demo-org'));
    const orgName$ = toObservable(computed(() => this.accountContext.selectedAccount()?.accountName ?? 'Acme Corp'));
    const projectSlug$ = this.route.paramMap.pipe(map((params) => params.get('projectSlug')));
    const retryTrigger$ = toObservable(this.retryTrigger);

    return combineLatest([orgUid$, orgName$, projectSlug$.pipe(filter((slug): slug is string => !!slug)), retryTrigger$]).pipe(
      tap(() => {
        this.fetchLoading.set(true);
        this.fetchError.set(false);
      }),
      switchMap(([orgUid, orgName, projectSlug]) => {
        return this.detailService.getProjectDetail(orgUid, orgName, projectSlug).pipe(
          catchError(() => {
            this.fetchError.set(true);
            this.fetchLoading.set(false);
            return of<OrgLensProjectDetailResponse | null>(null);
          })
        );
      }),
      tap((response) => {
        this.detail.set(response);
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

  private initialsFor(name: string): string {
    const parts = name.split(/[\s/]+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  /** Shared external-tooltip callback: positions a fixed DOM overlay near the cursor. */
  private buildExternalTooltipFn(
    valueSuffix = ''
  ): (args: {
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

      const title = tooltip.title?.[0] ?? '';
      const rows = (tooltip.dataPoints ?? [])
        .map(
          (p) =>
            '<div style="display:flex;align-items:center;gap:6px;margin-top:6px">' +
            `<span style="width:8px;height:8px;border-radius:9999px;flex-shrink:0;background:${p.dataset.borderColor}"></span>` +
            `<span style="font-size:12px;color:#6B7280;white-space:nowrap">${p.dataset.label ?? ''}: ` +
            `<strong style="color:#111827;font-weight:600">${p.formattedValue}${valueSuffix}</strong></span>` +
            '</div>'
        )
        .join('');

      tip.innerHTML = `<p style="font-size:12px;font-weight:600;color:#111827;white-space:nowrap">${title}</p>${rows}`;
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

  /** 36 trailing short-month labels (oldest → newest) — sliced to the active time range as needed. */
  private buildMonthLabels(): string[] {
    const out: string[] = [];
    const now = new Date();
    for (let i = 35; i >= 0; i--) {
      out.push(new Date(now.getFullYear(), now.getMonth() - i, 1).toLocaleDateString('en-US', { month: 'short' }));
    }
    return out;
  }

  private toInfluenceCard(card: OrgLensProjectInfluenceCard, colorHex: string, group: 'technical' | 'ecosystem', months = 12): InfluenceCardVm {
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

  private buildCardChartData(series: number[], projectSeries: number[], colorHex: string, variant: 'area' | 'bar' | 'line', labels: string[]): ChartData<ChartType> {
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
   * Builds a stacked area chart dataset from the leaderboard: top-10 companies by combined
   * score each get their own band; any remaining companies are summed into "All others".
   * Monthly series are derived deterministically from each org's current score so the chart
   * shows a plausible trajectory without requiring per-company historical fixture data.
   */
  private buildStackedTrend(): ChartData<ChartType> {
    const board = this.detail()?.leaderboard ?? [];
    if (board.length === 0) return { labels: [], datasets: [] };

    const months = TIME_RANGE_MONTHS[this.timeRange()];
    const labels = this.monthLabels.slice(-months);

    const sorted = [...board].sort((a, b) => b.scores.combined - a.scores.combined);
    const top10 = sorted.slice(0, 10);
    const rest = sorted.slice(10);

    interface StackEntry { name: string; score: number; seed: number }
    const entries: StackEntry[] = top10.map((r, i) => ({ name: r.orgName, score: r.scores.combined, seed: i }));
    if (rest.length > 0) {
      const avg = rest.reduce((s, r) => s + r.scores.combined, 0) / rest.length;
      entries.push({ name: 'All others', score: avg, seed: 10 });
    }

    // Build raw series, then normalize each month so all series sum to 100%.
    const rawSeries: number[][] = entries.map((entry) => this.buildTrendSeries(entry.score, months, entry.seed));
    const pctSeries: number[][] = rawSeries.map((series, si) =>
      series.map((val, mi) => {
        const total = rawSeries.reduce((sum, s) => sum + (s[mi] ?? 0), 0);
        return total > 0 ? Math.round((val / total) * 1000) / 10 : 0;
      })
    );

    const datasets = entries.map((entry, i) => {
      const color = STACKED_PALETTE[i] ?? lfxColors.gray[300];
      return {
        label: entry.name,
        data: pctSeries[i],
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

  /**
   * Generates a deterministic N-month series ending near `currentScore`.
   * Each seed value shifts the wave phase so companies look distinct.
   */
  private buildTrendSeries(currentScore: number, months: number, seed: number): number[] {
    const startRatio = 0.72 + (seed % 5) * 0.04;
    const series: number[] = [];
    for (let i = 0; i < months; i++) {
      const t = months === 1 ? 1 : i / (months - 1);
      const wave = Math.sin((i + seed * 2.1) * 0.8) * 0.05;
      series.push(Math.round(currentScore * (startRatio + (1 - startRatio) * t + wave) * 10) / 10);
    }
    return series;
  }
}
