// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, input, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  buildHealthMetricsOverviewPeriods,
  HEALTH_METRICS_OVERVIEW_AREAS,
  HEALTH_METRICS_OVERVIEW_FOUNDATION_SUMMARY_DEFAULT,
  HEALTH_METRICS_OVERVIEW_INSIGHTS_LINK_TARGET,
  HEALTH_METRICS_OVERVIEW_REVENUE_DEFAULT_SUMMARY,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsOverviewPccUrl,
  buildHealthMetricsOverviewTiles,
  buildLensAwareInsightsUrl,
  groupHealthMetricsOverviewFindings,
  resolveHealthMetricsOverviewGroupMeta,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { initializeRangeDataFetching } from '@shared/utils/health-metrics-data.util';
import { environment } from '@environments/environment';
import { of, switchMap, tap } from 'rxjs';

import { HEALTH_METRICS_OVERVIEW_FIXTURE_AREA_STATE, HEALTH_METRICS_OVERVIEW_FIXTURE_FINDINGS } from './health-metrics-overview.fixture';
import { HealthMetricsOverviewFindingItemComponent } from './health-metrics-overview-finding-item/health-metrics-overview-finding-item.component';
import { HealthMetricsOverviewRailComponent } from './health-metrics-overview-rail/health-metrics-overview-rail.component';
import { HealthMetricsOverviewTileComponent } from './health-metrics-overview-tile/health-metrics-overview-tile.component';

import type {
  HealthMetricsAreaState,
  HealthMetricsFinding,
  HealthMetricsOverviewFindingGroup,
  HealthMetricsOverviewFindingViewModel,
  HealthMetricsOverviewFoundationSummary,
  HealthMetricsOverviewRevenue,
  HealthMetricsOverviewTileViewModel,
  HealthMetricsRange,
  HealthMetricsYearOption,
  ProjectContext,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-health-metrics-overview',
  imports: [NgClass, HealthMetricsOverviewTileComponent, HealthMetricsOverviewFindingItemComponent, HealthMetricsOverviewRailComponent],
  templateUrl: './health-metrics-overview.component.html',
  styleUrl: './health-metrics-overview.component.scss',
})
export class HealthMetricsOverviewComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  // Default to the temporary fixture (LFXV2-3364 will replace it); overridable via setInput so
  // specs can pin the empty/missing-area/unsorted branches the fixture itself can't exercise.
  public readonly areaStates = input<HealthMetricsAreaState[]>(HEALTH_METRICS_OVERVIEW_FIXTURE_AREA_STATE);
  public readonly findings = input<HealthMetricsFinding[]>(HEALTH_METRICS_OVERVIEW_FIXTURE_FINDINGS);

  // Fresh per component instance (not a static/module-level constant) so the derived labels stay
  // correct across a calendar-year rollover in a long-running SSR process.
  protected readonly periods: readonly HealthMetricsYearOption[] = buildHealthMetricsOverviewPeriods();
  protected readonly selectedRange = signal<HealthMetricsRange>('YTD');

  protected readonly revenueLoading = signal(true);
  protected readonly revenue = signal<HealthMetricsOverviewRevenue>(HEALTH_METRICS_OVERVIEW_REVENUE_DEFAULT_SUMMARY);

  protected readonly pageHeader = viewChild<ElementRef<HTMLElement>>('pageHeader');
  // Measured client-side from the sticky header (see observeHeaderHeight); this fallback only shows
  // pre-hydration and approximates the header's real rendered height.
  protected readonly headerHeightPx = signal(72);
  protected readonly railTopPx = computed(() => this.headerHeightPx() + 16);

  protected readonly foundationSummaryLoading = signal(true);

  protected readonly tiles: Signal<HealthMetricsOverviewTileViewModel[]> = this.initTiles();
  protected readonly findingGroups: Signal<HealthMetricsOverviewFindingGroup[]> = this.initFindingGroups();
  // Live-fetched from HEALTH_OVERVIEW_PROFILE, keyed off the selected foundation — re-fetches
  // whenever the foundation changes (unlike areaStates/findings, still LFXV2-3364 fixtures).
  protected readonly foundationSummary: Signal<HealthMetricsOverviewFoundationSummary> = this.initFoundationSummary();

  protected readonly hasFindings = computed(() => this.findingGroups().length > 0);

  private static readonly areaNameByKey = new Map(HEALTH_METRICS_OVERVIEW_AREAS.map((areaMeta) => [areaMeta.key, areaMeta.name]));

  public constructor() {
    // afterNextRender only runs client-side, never during SSR — safe without an isPlatformBrowser guard.
    afterNextRender(() => this.observeHeaderHeight());
    if (isPlatformBrowser(this.platformId)) {
      initializeRangeDataFetching({
        projectContextService: this.projectContextService,
        range: this.selectedRange,
        loading: this.revenueLoading,
        data: this.revenue,
        defaultValue: HEALTH_METRICS_OVERVIEW_REVENUE_DEFAULT_SUMMARY,
        fetchFn: (slug, range) => this.analyticsService.getHealthOverviewRevenue(slug, range),
        destroyRef: this.destroyRef,
      });
    }
  }

  protected setPeriod(period: HealthMetricsYearOption): void {
    this.selectedRange.set(period.range);
  }

  private initFoundationSummary(): Signal<HealthMetricsOverviewFoundationSummary> {
    if (!isPlatformBrowser(this.platformId)) {
      // Never subscribe the fetch pipeline during SSR (see ssr-safety.md), and leave
      // foundationSummaryLoading at its static `true` default so the serialized skeleton matches
      // the client's pre-hydration state — mirrors the revenue fetch's constructor-level guard.
      // Resolving straight to the loaded default here previously caused a hydration mismatch: the
      // server always finished "loaded" while the client always starts "loading".
      return computed(() => HEALTH_METRICS_OVERVIEW_FOUNDATION_SUMMARY_DEFAULT);
    }

    return toSignal(
      toObservable(computed(() => this.projectContextService.selectedFoundation()?.slug ?? '')).pipe(
        tap(() => this.foundationSummaryLoading.set(true)),
        switchMap((slug) => {
          // Handle the empty-slug case inside switchMap so clearing the foundation also
          // cancels any in-flight request for the previous slug (see foundation-projects.component.ts).
          if (!slug) return of(HEALTH_METRICS_OVERVIEW_FOUNDATION_SUMMARY_DEFAULT);
          // Error handling lives in AnalyticsService.getFoundationProfileSummary, which returns
          // the zero-filled default on failure — no component-level catchError needed.
          return this.analyticsService.getFoundationProfileSummary(slug);
        }),
        tap(() => this.foundationSummaryLoading.set(false))
      ),
      { initialValue: HEALTH_METRICS_OVERVIEW_FOUNDATION_SUMMARY_DEFAULT }
    );
  }

  private initTiles(): Signal<HealthMetricsOverviewTileViewModel[]> {
    return computed(() => {
      const foundation = this.projectContextService.selectedFoundation();
      const insightsUrl = buildLensAwareInsightsUrl(foundation?.slug, true);
      return buildHealthMetricsOverviewTiles(this.areaStates(), insightsUrl);
    });
  }

  private initFindingGroups(): Signal<HealthMetricsOverviewFindingGroup[]> {
    return computed(() => {
      const foundation = this.projectContextService.selectedFoundation();
      const foundationSfid = this.projectContextService.selectedFoundationSfid();

      return groupHealthMetricsOverviewFindings(this.findings()).map((groupRows) => {
        const groupMeta = resolveHealthMetricsOverviewGroupMeta(groupRows.classification);
        return {
          group: groupRows.group,
          classification: groupRows.classification,
          groupTextClass: groupMeta.textClass,
          groupIcon: groupMeta.icon,
          findings: groupRows.findings.map((finding) => HealthMetricsOverviewComponent.toFindingViewModel(finding, foundation, foundationSfid)),
        };
      });
    });
  }

  private observeHeaderHeight(): void {
    const header = this.pageHeader()?.nativeElement;
    // afterNextRender guarantees client-side execution, but not that ResizeObserver exists there
    // (e.g. jsdom in specs) — guard per .claude/rules/ssr-safety.md.
    if (!header || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      // contentRect is the content box only (excludes padding/border); this header has vertical
      // padding, so border-box size is required to get its true rendered height. borderBoxSize
      // isn't implemented in every engine (e.g. older Safari/jsdom) — fall back to getBoundingClientRect.
      const height = entry.borderBoxSize?.[0]?.blockSize ?? header.getBoundingClientRect().height;
      this.headerHeightPx.set(height);
    });
    observer.observe(header);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  private static toFindingViewModel(
    finding: HealthMetricsFinding,
    foundation: ProjectContext | null,
    foundationSfid: string | null
  ): HealthMetricsOverviewFindingViewModel {
    const isInsightsLink = finding.linkTarget === HEALTH_METRICS_OVERVIEW_INSIGHTS_LINK_TARGET;
    // PCC's `/project/{id}/...` routes are keyed by the Salesforce ID, not the LFX v2 project uid —
    // resolve through `selectedFoundationSfid` (null while resolving degrades to a hidden link).
    const linkHref = isInsightsLink
      ? buildLensAwareInsightsUrl(foundation?.slug, true)
      : buildHealthMetricsOverviewPccUrl(environment.urls.pcc, foundationSfid ?? '', finding.linkTarget);

    return {
      classification: finding.classification,
      area: finding.area,
      areaLabel: HealthMetricsOverviewComponent.areaNameByKey.get(finding.area) ?? finding.area,
      title: finding.title,
      sentence: finding.sentence,
      // Carried through though the finding-item component doesn't render it — see HealthMetricsFinding.emphasis doc comment.
      emphasis: finding.emphasis,
      keyValue: finding.keyValue,
      keyLabel: finding.keyLabel,
      sortRank: finding.sortRank,
      evaluatedAt: finding.evaluatedAt,
      linkHref,
      linkIsExternal: isInsightsLink,
      visual: finding.visual,
    };
  }
}
