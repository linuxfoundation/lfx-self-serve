// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, input, Signal, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  buildHealthMetricsYearOptions,
  HEALTH_METRICS_OVERVIEW_AREAS,
  HEALTH_METRICS_OVERVIEW_INSIGHTS_LINK_TARGET,
  HEALTH_METRICS_OVERVIEW_PERIODS,
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
import { environment } from '@environments/environment';
import { combineLatest, of, switchMap } from 'rxjs';

import {
  HEALTH_METRICS_OVERVIEW_FIXTURE_AREA_STATE,
  HEALTH_METRICS_OVERVIEW_FIXTURE_FINDINGS,
  HEALTH_METRICS_OVERVIEW_FIXTURE_FOUNDATION_SUMMARY,
} from './health-metrics-overview.fixture';
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

  // Default to the temporary fixture (LFXV2-3364 will replace it); overridable via setInput so
  // specs can pin the empty/missing-area/unsorted branches the fixture itself can't exercise.
  public readonly areaStates = input<HealthMetricsAreaState[]>(HEALTH_METRICS_OVERVIEW_FIXTURE_AREA_STATE);
  public readonly findings = input<HealthMetricsFinding[]>(HEALTH_METRICS_OVERVIEW_FIXTURE_FINDINGS);
  public readonly foundationSummary = input<HealthMetricsOverviewFoundationSummary>(HEALTH_METRICS_OVERVIEW_FIXTURE_FOUNDATION_SUMMARY);

  protected readonly periods = HEALTH_METRICS_OVERVIEW_PERIODS;
  protected readonly selectedPeriod = signal<(typeof HEALTH_METRICS_OVERVIEW_PERIODS)[number]>('YTD');

  protected readonly pageHeader = viewChild<ElementRef<HTMLElement>>('pageHeader');
  // Measured client-side from the sticky header (see observeHeaderHeight); this fallback only shows
  // pre-hydration and approximates the header's real rendered height.
  protected readonly headerHeightPx = signal(72);
  protected readonly railTopPx = computed(() => this.headerHeightPx() + 16);

  protected readonly tiles: Signal<HealthMetricsOverviewTileViewModel[]> = this.initTiles();
  protected readonly findingGroups: Signal<HealthMetricsOverviewFindingGroup[]> = this.initFindingGroups();
  protected readonly revenue: Signal<HealthMetricsOverviewRevenue> = this.initRevenue();

  protected readonly hasFindings = computed(() => this.findingGroups().length > 0);

  private static readonly areaNameByKey = new Map(HEALTH_METRICS_OVERVIEW_AREAS.map((areaMeta) => [areaMeta.key, areaMeta.name]));
  // Maps a display period ('2023'/'2024'/'2025'/'YTD') to its HealthMetricsRange, keyed by year so the
  // mapping self-corrects across calendar years rather than hardcoding a stale year->range table.
  private static readonly rangeByPeriodLabel = new Map(buildHealthMetricsYearOptions().map((option) => [option.label, option.range]));

  public constructor() {
    // afterNextRender only runs client-side, never during SSR — safe without an isPlatformBrowser guard.
    afterNextRender(() => this.observeHeaderHeight());
  }

  protected setPeriod(period: (typeof HEALTH_METRICS_OVERVIEW_PERIODS)[number]): void {
    this.selectedPeriod.set(period);
  }

  private initTiles(): Signal<HealthMetricsOverviewTileViewModel[]> {
    return computed(() => {
      const foundation = this.projectContextService.selectedFoundation();
      const insightsUrl = buildLensAwareInsightsUrl(foundation?.slug, true);
      return buildHealthMetricsOverviewTiles(this.areaStates(), insightsUrl);
    });
  }

  private initRevenue(): Signal<HealthMetricsOverviewRevenue> {
    return toSignal(
      combineLatest([toObservable(computed(() => this.projectContextService.selectedFoundation()?.slug ?? '')), toObservable(this.selectedPeriod)]).pipe(
        switchMap(([slug, period]) => {
          if (!slug) {
            return of(HEALTH_METRICS_OVERVIEW_REVENUE_DEFAULT_SUMMARY);
          }
          const range: HealthMetricsRange = HealthMetricsOverviewComponent.rangeByPeriodLabel.get(period) ?? 'YTD';
          return this.analyticsService.getHealthOverviewRevenue(slug, range);
        })
      ),
      { initialValue: HEALTH_METRICS_OVERVIEW_REVENUE_DEFAULT_SUMMARY }
    );
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
