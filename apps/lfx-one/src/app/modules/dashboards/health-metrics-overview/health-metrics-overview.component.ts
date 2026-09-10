// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, Signal } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_AREAS, HEALTH_METRICS_OVERVIEW_INSIGHTS_LINK_TARGET, HEALTH_METRICS_OVERVIEW_PERIODS } from '@lfx-one/shared/constants';
import {
  buildHealthMetricsOverviewPccUrl,
  buildHealthMetricsOverviewTiles,
  buildLensAwareInsightsUrl,
  groupHealthMetricsOverviewFindings,
  resolveHealthMetricsOverviewGroupMeta,
} from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';
import { environment } from '@environments/environment';

import {
  HEALTH_METRICS_OVERVIEW_FIXTURE_AREA_STATE,
  HEALTH_METRICS_OVERVIEW_FIXTURE_FINDINGS,
  HEALTH_METRICS_OVERVIEW_FIXTURE_FOUNDATION_SUMMARY,
  HEALTH_METRICS_OVERVIEW_FIXTURE_REVENUE,
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

  // Default to the temporary fixture (LFXV2-3364 will replace it); overridable via setInput so
  // specs can pin the empty/missing-area/unsorted branches the fixture itself can't exercise.
  public readonly areaStates = input<HealthMetricsAreaState[]>(HEALTH_METRICS_OVERVIEW_FIXTURE_AREA_STATE);
  public readonly findings = input<HealthMetricsFinding[]>(HEALTH_METRICS_OVERVIEW_FIXTURE_FINDINGS);
  public readonly revenue = input<HealthMetricsOverviewRevenue>(HEALTH_METRICS_OVERVIEW_FIXTURE_REVENUE);
  public readonly foundationSummary = input<HealthMetricsOverviewFoundationSummary>(HEALTH_METRICS_OVERVIEW_FIXTURE_FOUNDATION_SUMMARY);

  protected readonly periods = HEALTH_METRICS_OVERVIEW_PERIODS;
  // Non-functional for now (see HEALTH_METRICS_OVERVIEW_PERIODS doc comment) — always YTD, never reassigned.
  protected readonly selectedPeriod: (typeof HEALTH_METRICS_OVERVIEW_PERIODS)[number] = 'YTD';

  protected readonly tiles: Signal<HealthMetricsOverviewTileViewModel[]> = this.initTiles();
  protected readonly findingGroups: Signal<HealthMetricsOverviewFindingGroup[]> = this.initFindingGroups();

  protected readonly hasFindings = computed(() => this.findingGroups().length > 0);

  private static readonly areaNameByKey = new Map(HEALTH_METRICS_OVERVIEW_AREAS.map((areaMeta) => [areaMeta.key, areaMeta.name]));

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
