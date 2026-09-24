// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, Signal, signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  HEALTH_METRICS_OVERVIEW_AREAS,
  HEALTH_METRICS_OVERVIEW_FOUNDATION_SUMMARY_DEFAULT,
  HEALTH_METRICS_OVERVIEW_INSIGHTS_LINK_TARGET,
  HEALTH_METRICS_OVERVIEW_NO_DATA_STAT_VALUE,
  HEALTH_METRICS_OVERVIEW_REVENUE_DEFAULT_SUMMARY,
  HEALTH_METRICS_OVERVIEW_STATUSLESS_AREAS,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsOverviewEngagementRoute,
  buildHealthMetricsOverviewPccUrl,
  buildHealthMetricsOverviewTiles,
  buildLensAwareInsightsUrl,
  groupHealthMetricsOverviewFindings,
  resolveHealthMetricsOverviewGroupMeta,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { environment } from '@environments/environment';
import { Observable, of, startWith, switchMap, tap } from 'rxjs';

import { HealthMetricsOverviewFindingItemComponent } from './health-metrics-overview-finding-item/health-metrics-overview-finding-item.component';
import { HealthMetricsOverviewRailComponent } from './health-metrics-overview-rail/health-metrics-overview-rail.component';
import { HealthMetricsOverviewTileComponent } from './health-metrics-overview-tile/health-metrics-overview-tile.component';
import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsAreaState,
  HealthMetricsFinding,
  HealthMetricsOverviewArea,
  HealthMetricsOverviewFindingGroup,
  HealthMetricsOverviewFindingViewModel,
  HealthMetricsOverviewFoundationSummary,
  HealthMetricsOverviewKpisByRange,
  HealthMetricsOverviewRevenue,
  HealthMetricsOverviewRevenueByRange,
  HealthMetricsOverviewTileViewModel,
  ProjectContext,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-health-metrics-overview',
  imports: [NgClass, HealthMetricsOverviewTileComponent, HealthMetricsOverviewFindingItemComponent, HealthMetricsOverviewRailComponent],
  templateUrl: './health-metrics-overview.component.html',
  styleUrl: './health-metrics-overview.component.scss',
})
export class HealthMetricsOverviewComponent {
  protected readonly chrome = inject(HealthMetricsChromeService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly platformId = inject(PLATFORM_ID);

  // Empty until the findings feed is wired up — the list renders its "not available yet" state.
  public readonly findings = input<HealthMetricsFinding[]>([]);

  // Period selection and the sticky-header offset live on the gate-provided chrome service so they
  // persist across tab switches — see HealthMetricsChromeService.
  private readonly selectedRange = this.chrome.selectedRange;

  // Fetched once per foundation for every period at once (HEALTH_OVERVIEW_REVENUE keys on
  // foundation_slug with the period as a column suffix), then projected by the selected period.
  protected readonly revenueLoading = signal(true);
  protected readonly revenueByRange: Signal<HealthMetricsOverviewRevenueByRange> = this.initRevenueByRange();
  protected readonly revenue = computed<HealthMetricsOverviewRevenue>(
    () => this.revenueByRange()[this.selectedRange()] ?? HEALTH_METRICS_OVERVIEW_REVENUE_DEFAULT_SUMMARY
  );

  protected readonly foundationSummaryLoading = signal(true);

  // Live rows for every tile (Engagement from ENGAGEMENT_GROUP_ATTENDANCE, the rest from HEALTH_OVERVIEW_KPIS).
  // All periods arrive in one read, like revenue above, so changing the period costs no request.
  protected readonly kpiAreaStatesLoading = signal(true);
  protected readonly kpiByRange: Signal<HealthMetricsOverviewKpisByRange> = this.initKpiByRange();
  protected readonly kpiAreaStates = computed<HealthMetricsAreaState[]>(() => this.kpiByRange()[this.selectedRange()] ?? []);

  protected readonly tiles: Signal<HealthMetricsOverviewTileViewModel[]> = this.initTiles();
  protected readonly findingGroups: Signal<HealthMetricsOverviewFindingGroup[]> = this.initFindingGroups();
  // Live-fetched from HEALTH_OVERVIEW_PROFILE, keyed off the selected foundation only — re-fetches
  // whenever the foundation changes (unlike findings, which have no live source yet).
  protected readonly foundationSummary: Signal<HealthMetricsOverviewFoundationSummary> = this.initFoundationSummary();

  protected readonly hasFindings = computed(() => this.findingGroups().length > 0);

  private static readonly areaNameByKey = new Map(HEALTH_METRICS_OVERVIEW_AREAS.map((areaMeta) => [areaMeta.key, areaMeta.name]));

  private initRevenueByRange(): Signal<HealthMetricsOverviewRevenueByRange> {
    return this.initByRangeFetch(this.revenueLoading, {}, (slug) => this.analyticsService.getHealthOverviewRevenue(slug));
  }

  private initKpiByRange(): Signal<HealthMetricsOverviewKpisByRange> {
    return this.initByRangeFetch(this.kpiAreaStatesLoading, {}, (slug) => this.analyticsService.getHealthOverviewKpis(slug));
  }

  /**
   * Foundation-only fetch for the two all-periods endpoints — one read per foundation change, never
   * per period change. Mirrors initFoundationSummary's SSR guard and in-switchMap empty-slug handling.
   */
  private initByRangeFetch<T>(loading: WritableSignal<boolean>, emptyValue: T, fetchFn: (slug: string) => Observable<T>): Signal<T> {
    if (!isPlatformBrowser(this.platformId)) {
      // Leave `loading` at its static `true` default so the serialized skeleton matches the client's
      // pre-hydration state — resolving to a loaded empty map here would be a hydration mismatch.
      return computed(() => emptyValue);
    }

    // Latches on the first non-empty slug emission, so "none selected yet" keeps the skeleton up while
    // a foundation cleared after one was selected still reaches a terminal empty state instead of wedging.
    let foundationSeen = false;

    return toSignal(
      toObservable(computed(() => this.projectContextService.selectedFoundation()?.slug ?? '')).pipe(
        tap(() => loading.set(true)),
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight
        // request for the previous slug. Errors are absorbed by AnalyticsService's catchError.
        switchMap((slug) => {
          foundationSeen = foundationSeen || slug !== '';

          return (slug ? fetchFn(slug) : of(emptyValue)).pipe(
            // Before the first foundation resolves the tiles and rail stay on their skeleton rather than
            // flashing a terminal "unavailable" message for data that was never fetched.
            tap(() => {
              if (foundationSeen) loading.set(false);
            }),
            // Drops the previous foundation's map the moment the slug changes. Without it the tile
            // strip keeps rendering the old foundation's live rows until the new request resolves,
            // because mergeAreaStates prefers any live row over the loading placeholder.
            startWith(emptyValue)
          );
        })
      ),
      { initialValue: emptyValue }
    );
  }

  private initFoundationSummary(): Signal<HealthMetricsOverviewFoundationSummary> {
    if (!isPlatformBrowser(this.platformId)) {
      // Never subscribe the fetch pipeline during SSR (see ssr-safety.md), and leave
      // foundationSummaryLoading at its static `true` default so the serialized skeleton matches
      // the client's pre-hydration state — same guard initByRangeFetch applies to the two
      // all-periods fetches. Resolving straight to the loaded default here previously caused a
      // hydration mismatch: the server always finished "loaded" while the client always starts "loading".
      return computed(() => HEALTH_METRICS_OVERVIEW_FOUNDATION_SUMMARY_DEFAULT);
    }

    // Same latch as initByRangeFetch, with the same two guarantees: before any foundation is selected the
    // rail keeps its skeleton rather than rendering the zero-filled default as a real "0 projects", and a
    // foundation cleared after one was selected still leaves the loading state instead of wedging.
    let foundationSeen = false;

    return toSignal(
      toObservable(computed(() => this.projectContextService.selectedFoundation()?.slug ?? '')).pipe(
        tap(() => this.foundationSummaryLoading.set(true)),
        switchMap((slug) => {
          foundationSeen = foundationSeen || slug !== '';

          // Handle the empty-slug case inside switchMap so clearing the foundation also
          // cancels any in-flight request for the previous slug (see foundation-projects.component.ts).
          const source = slug
            ? // Error handling lives in AnalyticsService.getFoundationProfileSummary, which returns
              // the zero-filled default on failure — no component-level catchError needed.
              this.analyticsService.getFoundationProfileSummary(slug)
            : of(HEALTH_METRICS_OVERVIEW_FOUNDATION_SUMMARY_DEFAULT);

          return source.pipe(
            tap(() => {
              if (foundationSeen) this.foundationSummaryLoading.set(false);
            })
          );
        })
      ),
      { initialValue: HEALTH_METRICS_OVERVIEW_FOUNDATION_SUMMARY_DEFAULT }
    );
  }

  private initTiles(): Signal<HealthMetricsOverviewTileViewModel[]> {
    return computed(() => {
      const foundation = this.projectContextService.selectedFoundation();
      const insightsUrl = buildLensAwareInsightsUrl(foundation?.slug, true);
      const areaStates = HealthMetricsOverviewComponent.mergeAreaStates(this.kpiAreaStates(), this.kpiAreaStatesLoading());
      return buildHealthMetricsOverviewTiles(areaStates, insightsUrl);
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

  /**
   * One row per tile area: the live row when there is one, otherwise a neutral "no data" row — never
   * a placeholder figure, which would read as the foundation's actual metrics.
   */
  private static mergeAreaStates(live: HealthMetricsAreaState[], loading: boolean): HealthMetricsAreaState[] {
    const liveByArea = new Map<HealthMetricsOverviewArea, HealthMetricsAreaState>(live.map((state) => [state.area, state]));
    return HEALTH_METRICS_OVERVIEW_AREAS.map(({ key }) => liveByArea.get(key) ?? HealthMetricsOverviewComponent.buildNeutralKpiAreaState(key, loading));
  }

  private static buildNeutralKpiAreaState(area: HealthMetricsOverviewArea, loading: boolean): HealthMetricsAreaState {
    return {
      area,
      statValue: HEALTH_METRICS_OVERVIEW_NO_DATA_STAT_VALUE,
      statLabel: loading ? 'loading…' : 'no data this period',
      statSource: 'HEALTH_OVERVIEW_KPIS',
      classification: 'none',
      // Empty, not today's date — this area was never actually evaluated, so "as of today" would
      // claim fresh data for a tile that has none (formatHealthMetricsOverviewAsOfLabel hides it).
      evaluatedAt: '',
      // Matches the live tile: a failed read must not surface a chip the live state never shows.
      ...(HEALTH_METRICS_OVERVIEW_STATUSLESS_AREAS.has(area) && { showStatus: false }),
    };
  }

  private static toFindingViewModel(
    finding: HealthMetricsFinding,
    foundation: ProjectContext | null,
    foundationSfid: string | null
  ): HealthMetricsOverviewFindingViewModel {
    const isInsightsLink = finding.linkTarget === HEALTH_METRICS_OVERVIEW_INSIGHTS_LINK_TARGET;
    // Engagement findings link into the tab in-app and need no Salesforce id.
    const linkRoute = buildHealthMetricsOverviewEngagementRoute(finding.linkTarget);
    // PCC's `/project/{id}/...` routes are keyed by the Salesforce ID, not the LFX v2 project uid —
    // resolve through `selectedFoundationSfid` (null while resolving degrades to a hidden link).
    let linkHref: string | undefined;
    if (isInsightsLink) {
      linkHref = buildLensAwareInsightsUrl(foundation?.slug, true);
    } else if (!linkRoute) {
      linkHref = buildHealthMetricsOverviewPccUrl(environment.urls.pcc, foundationSfid ?? '', finding.linkTarget);
    }

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
      linkRoute,
      linkIsExternal: isInsightsLink,
      visual: finding.visual,
    };
  }
}
