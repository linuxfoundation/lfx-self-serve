// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import {
  HEALTH_METRICS_OVERVIEW_AREAS,
  HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS,
  HEALTH_METRICS_OVERVIEW_GROUP_ORDER,
  HEALTH_METRICS_OVERVIEW_INSIGHTS_LINK_TARGET,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewPccUrl, buildLensAwareInsightsUrl } from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';
import { environment } from '@environments/environment';

import { HEALTH_METRICS_OVERVIEW_FIXTURE_AREA_STATE, HEALTH_METRICS_OVERVIEW_FIXTURE_FINDINGS } from './health-metrics-overview.fixture';
import { HealthMetricsOverviewFindingItemComponent } from './health-metrics-overview-finding-item/health-metrics-overview-finding-item.component';
import { HealthMetricsOverviewTileComponent } from './health-metrics-overview-tile/health-metrics-overview-tile.component';

import type {
  HealthMetricsFinding,
  HealthMetricsOverviewFindingGroup,
  HealthMetricsOverviewFindingViewModel,
  HealthMetricsOverviewTileViewModel,
  ProjectContext,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-health-metrics-overview',
  imports: [HealthMetricsOverviewTileComponent, HealthMetricsOverviewFindingItemComponent],
  templateUrl: './health-metrics-overview.component.html',
  styleUrl: './health-metrics-overview.component.scss',
})
export class HealthMetricsOverviewComponent {
  private readonly projectContextService = inject(ProjectContextService);

  protected readonly tiles: Signal<HealthMetricsOverviewTileViewModel[]> = this.initTiles();
  protected readonly findingGroups: Signal<HealthMetricsOverviewFindingGroup[]> = this.initFindingGroups();

  protected readonly hasFindings = computed(() => this.findingGroups().length > 0);

  private static readonly areaStateByKey = new Map(HEALTH_METRICS_OVERVIEW_FIXTURE_AREA_STATE.map((state) => [state.area, state]));
  private static readonly areaNameByKey = new Map(HEALTH_METRICS_OVERVIEW_AREAS.map((areaMeta) => [areaMeta.key, areaMeta.name]));

  private initTiles(): Signal<HealthMetricsOverviewTileViewModel[]> {
    return computed(() => {
      const foundation = this.projectContextService.selectedFoundation();

      // Areas with no fixture row (e.g. Training when the foundation runs no training) are
      // omitted entirely from the strip — hidden, not shown as a grey "no data" tile.
      return HEALTH_METRICS_OVERVIEW_AREAS.map((areaMeta) => {
        const state = HealthMetricsOverviewComponent.areaStateByKey.get(areaMeta.key);
        if (!state) {
          return null;
        }

        const isCodeArea = areaMeta.key === 'code';
        const tile: HealthMetricsOverviewTileViewModel = {
          area: state.area,
          name: areaMeta.name,
          icon: areaMeta.icon,
          statValue: state.statValue,
          statLabel: state.statLabel,
          classification: state.classification,
          evaluatedAt: state.evaluatedAt,
          insightsUrl: isCodeArea ? buildLensAwareInsightsUrl(foundation?.slug, true) : undefined,
        };
        return tile;
      }).filter((tile): tile is HealthMetricsOverviewTileViewModel => tile !== null);
    });
  }

  private initFindingGroups(): Signal<HealthMetricsOverviewFindingGroup[]> {
    return computed(() => {
      const foundation = this.projectContextService.selectedFoundation();

      // Groups render in the fixed order below regardless of how many findings each has; a group
      // with no findings this period is hidden rather than rendered empty (never re-sorted).
      return HEALTH_METRICS_OVERVIEW_GROUP_ORDER.map((group) => ({
        group,
        findings: HEALTH_METRICS_OVERVIEW_FIXTURE_FINDINGS.filter((finding) => HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[finding.classification].group === group)
          .sort((a, b) => a.sortRank - b.sortRank)
          .map((finding) => HealthMetricsOverviewComponent.toFindingViewModel(finding, foundation)),
      })).filter((groupViewModel) => groupViewModel.findings.length > 0);
    });
  }

  private static toFindingViewModel(finding: HealthMetricsFinding, foundation: ProjectContext | null): HealthMetricsOverviewFindingViewModel {
    const isInsightsLink = finding.linkTarget === HEALTH_METRICS_OVERVIEW_INSIGHTS_LINK_TARGET;
    const linkHref = isInsightsLink
      ? buildLensAwareInsightsUrl(foundation?.slug, true)
      : buildHealthMetricsOverviewPccUrl(environment.urls.pcc, foundation?.uid ?? '', finding.linkTarget);

    return {
      classification: finding.classification,
      area: finding.area,
      areaLabel: HealthMetricsOverviewComponent.areaNameByKey.get(finding.area) ?? finding.area,
      title: finding.title,
      sentence: finding.sentence,
      emphasis: finding.emphasis,
      keyValue: finding.keyValue,
      keyLabel: finding.keyLabel,
      evaluatedAt: finding.evaluatedAt,
      linkHref,
      linkIsExternal: isInsightsLink,
      visual: finding.visual,
    };
  }
}
