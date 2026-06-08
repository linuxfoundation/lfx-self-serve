// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensProjectDetailService } from '@services/org-lens-project-detail.service';
import { BreadcrumbComponent } from '@components/breadcrumb/breadcrumb.component';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import { TagComponent } from '@components/tag/tag.component';
import { BASE_LINE_CHART_OPTIONS, lfxColors } from '@lfx-one/shared/constants';
import type {
  OrgLensLeaderboardMetric,
  OrgLensProjectBand,
  OrgLensProjectDetailPageState,
  OrgLensProjectDetailResponse,
  OrgLensProjectDetailTab,
  OrgLensProjectEcosystemCard,
  OrgLensProjectHealth,
  OrgLensProjectTechnicalCard,
  OrgLensScoreType,
  TagSeverity,
} from '@lfx-one/shared/interfaces';
import { formatRelativeTime, hexToRgba, parseLocalDateString } from '@lfx-one/shared/utils';
import type { MenuItem } from 'primeng/api';
import type { ChartData, ChartOptions, ChartType } from 'chart.js';
import { catchError, combineLatest, filter, map, type Observable, of, switchMap, tap } from 'rxjs';

const DEFAULT_TAB: OrgLensProjectDetailTab = 'pd-influence';
const VALID_TABS: ReadonlySet<string> = new Set<OrgLensProjectDetailTab>(['pd-influence', 'pd-leaderboards']);

const DEFAULT_SCORE: OrgLensScoreType = 'combined';
const VALID_SCORES: ReadonlySet<string> = new Set<OrgLensScoreType>(['combined', 'technical', 'ecosystem']);
const DEFAULT_METRIC: OrgLensLeaderboardMetric = 'influence';
const VALID_METRICS: ReadonlySet<string> = new Set<OrgLensLeaderboardMetric>(['influence', 'activity']);

/** Leaderboard pagination: default top-N, increment, and hard cap (LFXV2-1885 §7). */
const LEADERBOARD_PAGE_SIZE = 10;
const LEADERBOARD_MAX_ROWS = 100;

/** Hero health badge → lfx-tag severity (green Excellent / amber Healthy / red At Risk). */
const HEALTH_TAG: Record<OrgLensProjectHealth, { label: string; severity: TagSeverity }> = {
  excellent: { label: 'Excellent', severity: 'success' },
  healthy: { label: 'Healthy', severity: 'warn' },
  'at-risk': { label: 'At Risk', severity: 'danger' },
};

/** FontAwesome icons keyed by Technical / Ecosystem card. */
const TECHNICAL_ICONS: Record<OrgLensProjectTechnicalCard['key'], string> = {
  maintainers: 'fa-light fa-user-shield',
  contributors: 'fa-light fa-users',
  commits: 'fa-light fa-code-commit',
  'pull-requests': 'fa-light fa-code-pull-request',
};

const ECOSYSTEM_ICONS: Record<OrgLensProjectEcosystemCard['key'], string> = {
  collaboration: 'fa-light fa-comments',
  'meeting-attendance': 'fa-light fa-video',
  'board-members': 'fa-light fa-gavel',
  'committee-members': 'fa-light fa-people-group',
};

/** Empty-state guidance copy per Ecosystem card (shown when the count is 0). */
const ECOSYSTEM_EMPTY_COPY: Record<OrgLensProjectEcosystemCard['key'], string> = {
  collaboration: 'No cross-org collaboration recorded in the last year.',
  'meeting-attendance': 'No org reps attended project meetings in the last year.',
  'board-members': 'Your organization holds no board seats on this project.',
  'committee-members': 'Your organization holds no committee seats on this project.',
};

/** Ecosystem card scope label (per the wireframe): project-level vs foundation-level metric. */
const ECOSYSTEM_SCOPE: Record<OrgLensProjectEcosystemCard['key'], string> = {
  collaboration: 'Project',
  'meeting-attendance': 'Project',
  'board-members': 'Foundation',
  'committee-members': 'Foundation',
};

/** Leaderboard band chip → lfx-tag severity. */
const BAND_TAG: Record<OrgLensProjectBand, { label: string; severity: TagSeverity }> = {
  leading: { label: 'Leading', severity: 'success' },
  contributing: { label: 'Contributing', severity: 'info' },
  participating: { label: 'Participating', severity: 'warn' },
  'non-lf': { label: 'Non-LF', severity: 'secondary' },
};

const SCORE_OPTIONS: { id: OrgLensScoreType; label: string }[] = [
  { id: 'combined', label: 'Combined' },
  { id: 'technical', label: 'Technical' },
  { id: 'ecosystem', label: 'Ecosystem' },
];

const METRIC_OPTIONS: { id: OrgLensLeaderboardMetric; label: string }[] = [
  { id: 'influence', label: 'Calculated Influence' },
  { id: 'activity', label: 'Activity Count' },
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
  imports: [NgTemplateOutlet, BreadcrumbComponent, ChartComponent, EmptyStateComponent, MetricCardComponent, TagComponent],
  templateUrl: './org-project-detail.component.html',
})
export class OrgProjectDetailComponent {
  protected readonly accountContext = inject(AccountContextService);
  private readonly detailService = inject(OrgLensProjectDetailService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly retryTrigger = signal(0);
  protected readonly fetchLoading = signal(true);
  protected readonly fetchError = signal(false);
  protected readonly detail = signal<OrgLensProjectDetailResponse | null>(null);

  protected readonly tabs: { id: OrgLensProjectDetailTab; label: string; icon: string }[] = [
    { id: 'pd-influence', label: 'Our Influence', icon: 'fa-light fa-chart-network' },
    { id: 'pd-leaderboards', label: 'Leaderboards', icon: 'fa-light fa-ranking-star' },
  ];

  private readonly queryParamMap = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  protected readonly activeTab: Signal<OrgLensProjectDetailTab> = computed(() => this.initActiveTab());
  protected readonly pageState: Signal<OrgLensProjectDetailPageState> = computed(() => this.initPageState());

  // Hero presentation — derived from the loaded payload.
  protected readonly hero = computed(() => this.detail()?.hero ?? null);
  protected readonly breadcrumbItems = computed<MenuItem[]>(() => this.initBreadcrumb());
  protected readonly healthMeta = computed(() => {
    const health = this.hero()?.health;
    return health ? HEALTH_TAG[health] : null;
  });
  protected readonly firstCommitLabel = computed(() => this.formatMonthYear(this.hero()?.firstCommit ?? null));
  protected readonly softwareValueLabel = computed(() => this.formatCompactUsd(this.hero()?.softwareValueUsd ?? null));
  protected readonly lastUpdatedLabel = computed(() => this.formatRelative(this.hero()?.lastUpdated ?? null));
  protected readonly logoInitials = computed(() => this.initialsFor(this.hero()?.projectName ?? ''));
  protected readonly sourceUrl = computed(() => this.hero()?.sourceUrl ?? null);

  // Our Influence tab — Technical (sparkline) + Ecosystem (count) card view-models.
  private readonly monthLabels: string[] = this.buildMonthLabels();
  protected readonly technicalCards = computed(() => (this.detail()?.technical ?? []).map((card) => this.toTechnicalCard(card)));
  protected readonly ecosystemCards = computed(() => (this.detail()?.ecosystem ?? []).map((card) => this.toEcosystemCard(card)));

  // Influence Trend chart — Combined / Technical / Ecosystem overlays (legend toggles each line).
  protected readonly hasTrendHistory = computed(() => (this.detail()?.trend.length ?? 0) >= 3);
  protected readonly trendChartData = computed<ChartData<ChartType>>(() => this.buildTrendData());
  protected readonly trendChartOptions: ChartOptions<ChartType> = this.buildTrendOptions();

  // Leaderboards tab — URL-persisted score-type + metric toggles, ranking, and pagination.
  protected readonly scoreOptions = SCORE_OPTIONS;
  protected readonly metricOptions = METRIC_OPTIONS;
  protected readonly shownCount = signal(LEADERBOARD_PAGE_SIZE);
  protected readonly scoreType = computed<OrgLensScoreType>(() => this.initScoreType());
  protected readonly metric = computed<OrgLensLeaderboardMetric>(() => this.initMetric());
  protected readonly isActivityMode = computed(() => this.metric() === 'activity');
  protected readonly rankedRows = computed(() => this.buildRankedRows());
  protected readonly visibleRows = computed(() => this.rankedRows().slice(0, this.shownCount()));
  protected readonly pinnedViewingRow = computed(() => this.rankedRows().find((r) => r.isViewingOrg && r.rank > this.shownCount()) ?? null);
  protected readonly canShowMore = computed(() => this.shownCount() < Math.min(this.rankedRows().length, LEADERBOARD_MAX_ROWS));

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

  protected onTabKeydown(event: KeyboardEvent): void {
    const ids = this.tabs.map((t) => t.id);
    const idx = ids.indexOf(this.activeTab());
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (idx + 1) % ids.length;
    else if (event.key === 'ArrowLeft') next = (idx - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ids.length - 1;
    if (next !== null) {
      event.preventDefault();
      this.switchTab(ids[next]);
      if (typeof document !== 'undefined') {
        (document.getElementById(`project-detail-tab-trigger-${ids[next]}`) as HTMLElement | null)?.focus();
      }
    }
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  protected setScore(score: OrgLensScoreType): void {
    if (this.scoreType() === score) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { score: score === DEFAULT_SCORE ? null : score },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
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

  protected showMore(): void {
    this.shownCount.update((n) => Math.min(n + LEADERBOARD_PAGE_SIZE, LEADERBOARD_MAX_ROWS, this.rankedRows().length));
  }

  private initScoreType(): OrgLensScoreType {
    const raw = this.queryParamMap().get('score');
    return raw && VALID_SCORES.has(raw) ? (raw as OrgLensScoreType) : DEFAULT_SCORE;
  }

  private initMetric(): OrgLensLeaderboardMetric {
    const raw = this.queryParamMap().get('metric');
    return raw && VALID_METRICS.has(raw) ? (raw as OrgLensLeaderboardMetric) : DEFAULT_METRIC;
  }

  private buildRankedRows() {
    const rows = this.detail()?.leaderboard ?? [];
    const activity = this.isActivityMode();
    const type = this.scoreType();
    const valued = rows.map((row) => ({ row, value: activity ? row.activityCount : row.scores[type] }));
    // Score desc; tie-break by 1y delta desc, then org name asc (LFXV2-1885 §5).
    valued.sort((a, b) => b.value - a.value || b.row.trendDeltaPct - a.row.trendDeltaPct || a.row.orgName.localeCompare(b.row.orgName));
    return valued.map((entry, i) => {
      const bandMeta = BAND_TAG[bandForScore(entry.row.scores[type])];
      return {
        rank: i + 1,
        orgName: entry.row.orgName,
        orgLogoUrl: entry.row.orgLogoUrl,
        initials: this.initialsFor(entry.row.orgName),
        valueLabel: activity ? entry.value.toLocaleString() : entry.value.toFixed(1),
        bandLabel: bandMeta.label,
        bandSeverity: bandMeta.severity,
        deltaLabel: this.formatDelta(entry.row.trendDeltaPct),
        deltaClasses: this.deltaClasses(entry.row.trendDeltaPct),
        sparklinePoints: this.sparklinePoints(entry.row.trendSparkline),
        isViewingOrg: entry.row.isViewingOrg,
      };
    });
  }

  private formatDelta(delta: number): string {
    const pct = Math.round(delta * 100);
    return `${pct > 0 ? '+' : ''}${pct}%`;
  }

  private deltaClasses(delta: number): string {
    if (delta > 0.01) return 'text-emerald-600';
    if (delta < -0.01) return 'text-red-600';
    return 'text-gray-500';
  }

  /** Inline-SVG polyline points for a 64×20 sparkline (avoids 100 chart.js canvases). */
  private sparklinePoints(series: number[]): string {
    if (series.length === 0) return '';
    const width = 64;
    const height = 20;
    const pad = 2;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const range = max - min || 1;
    const span = series.length > 1 ? series.length - 1 : 1;
    return series
      .map((value, i) => {
        const x = pad + (i * (width - 2 * pad)) / span;
        const y = height - pad - ((value - min) / range) * (height - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  private initActiveTab(): OrgLensProjectDetailTab {
    const raw = this.queryParamMap().get('tab');
    return raw && VALID_TABS.has(raw) ? (raw as OrgLensProjectDetailTab) : DEFAULT_TAB;
  }

  private initDetailStream(): Observable<OrgLensProjectDetailResponse | null> {
    const orgUid$ = toObservable(computed(() => this.accountContext.selectedAccount()?.uid));
    const projectSlug$ = this.route.paramMap.pipe(map((params) => params.get('projectSlug')));
    const retryTrigger$ = toObservable(this.retryTrigger);

    return combineLatest([orgUid$.pipe(filter((id): id is string => !!id)), projectSlug$.pipe(filter((slug): slug is string => !!slug)), retryTrigger$]).pipe(
      tap(() => {
        this.fetchLoading.set(true);
        this.fetchError.set(false);
      }),
      switchMap(([orgUid, projectSlug]) => {
        const orgName = this.accountContext.selectedAccount()?.accountName ?? '';
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
        this.shownCount.set(LEADERBOARD_PAGE_SIZE);
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
    if (!hero) return [{ label: 'Projects', routerLink: ['/org/projects'] }];
    return [{ label: 'Projects', routerLink: ['/org/projects'] }, { label: hero.foundationLabel }, { label: hero.projectName }];
  }

  private formatMonthYear(dateString: string | null): string {
    if (!dateString) return '—';
    try {
      return parseLocalDateString(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    } catch {
      return dateString;
    }
  }

  private formatRelative(isoString: string | null): string {
    if (!isoString) return '—';
    const parsed = new Date(isoString);
    return Number.isNaN(parsed.getTime()) ? '—' : formatRelativeTime(parsed);
  }

  private formatCompactUsd(value: number | null): string {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }

  private initialsFor(name: string): string {
    const parts = name.split(/[\s/]+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  /** Twelve trailing short-month labels (oldest → newest) for sparkline + trend tooltips. */
  private buildMonthLabels(): string[] {
    const out: string[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      out.push(new Date(now.getFullYear(), now.getMonth() - i, 1).toLocaleDateString('en-US', { month: 'short' }));
    }
    return out;
  }

  private toTechnicalCard(card: OrgLensProjectTechnicalCard) {
    const pctLabel = `${(card.pct * 100).toFixed(1)}%`;
    const isEmpty = card.orgCount === 0;
    return {
      key: card.key,
      title: card.label,
      icon: TECHNICAL_ICONS[card.key],
      value: card.orgCount.toLocaleString(),
      subtitle: `of ${card.projectTotal.toLocaleString()} (${pctLabel})`,
      description: `Updated ${card.dataUpdatedHoursAgo}h ago`,
      isEmpty,
      chartData: this.sparklineData(card.label, card.sparkline),
      chartOptions: this.sparklineOptions(card.label),
      testId: `project-detail-technical-card-${card.key}`,
    };
  }

  private toEcosystemCard(card: OrgLensProjectEcosystemCard) {
    return {
      key: card.key,
      title: card.label,
      icon: ECOSYSTEM_ICONS[card.key],
      scopeLabel: ECOSYSTEM_SCOPE[card.key],
      count: card.count.toLocaleString(),
      isEmpty: card.count === 0,
      emptyCopy: ECOSYSTEM_EMPTY_COPY[card.key],
      description: `Updated ${card.dataUpdatedHoursAgo}h ago`,
      testId: `project-detail-ecosystem-card-${card.key}`,
    };
  }

  private sparklineData(label: string, series: number[]): ChartData<ChartType> {
    return {
      labels: this.monthLabels,
      datasets: [
        {
          label,
          data: series,
          borderColor: lfxColors.blue[500],
          backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
          fill: true,
          tension: 0,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    };
  }

  private sparklineOptions(label: string): ChartOptions<ChartType> {
    return {
      ...BASE_LINE_CHART_OPTIONS,
      plugins: {
        ...BASE_LINE_CHART_OPTIONS.plugins,
        tooltip: {
          ...(BASE_LINE_CHART_OPTIONS.plugins?.tooltip ?? {}),
          callbacks: {
            title: (context) => context[0]?.label ?? '',
            label: (context) => `${label}: ${context.parsed.y ?? 0}`,
          },
        },
      },
    };
  }

  private buildTrendData(): ChartData<ChartType> {
    const trend = this.detail()?.trend ?? [];
    const labels = trend.map((point) => this.formatTrendMonth(point.month));
    const line = (label: string, data: number[], color: string) => ({
      label,
      data,
      borderColor: color,
      backgroundColor: color,
      tension: 0.3,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: false,
    });
    return {
      labels,
      datasets: [
        line(
          'Combined',
          trend.map((p) => p.combined),
          lfxColors.blue[500]
        ),
        line(
          'Technical',
          trend.map((p) => p.technical),
          lfxColors.emerald[500]
        ),
        line(
          'Ecosystem',
          trend.map((p) => p.ecosystem),
          lfxColors.violet[500]
        ),
      ],
    };
  }

  private buildTrendOptions(): ChartOptions<ChartType> {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: false, grace: '5%', ticks: { maxTicksLimit: 6 } },
      },
    };
  }

  /** "2025-07" → "Jul 2025" for the trend x-axis. */
  private formatTrendMonth(month: string): string {
    const [year, mon] = month.split('-').map((n) => Number(n));
    if (!year || !mon) return month;
    return new Date(year, mon - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
}
