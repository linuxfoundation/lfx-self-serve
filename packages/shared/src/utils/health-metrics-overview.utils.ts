// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_OVERVIEW_AREAS,
  HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS,
  HEALTH_METRICS_OVERVIEW_GROUP_ORDER,
  HEALTH_METRICS_OVERVIEW_LINK_TARGETS,
  HEALTH_METRICS_OVERVIEW_REVENUE_STREAMS,
} from '../constants/health-metrics-overview.constants';

import { formatIsoDateLabel } from './date-time.utils';
import { formatCurrency } from './number.utils';

import type {
  HealthMetricsAreaState,
  HealthMetricsFinding,
  HealthMetricsOverviewFindingGroupRows,
  HealthMetricsOverviewLinkTarget,
  HealthMetricsOverviewRevenue,
  HealthMetricsOverviewRevenueStreamViewModel,
  HealthMetricsOverviewTileViewModel,
} from '../interfaces/health-metrics-overview.interface';

/**
 * Resolves an `hm_findings.link_target` key to a full PCC URL: `{pccBaseUrl}/project/{pccProjectId}
 * /reports/health-metrics{anchor}`. `pccBaseUrl` is passed in by the caller (e.g. `environment.urls.pcc`)
 * so this package stays environment-agnostic. Returns `undefined` for `code.insights` (which opens
 * externally via `buildLensAwareInsightsUrl` instead) or a missing `pccProjectId`, so a caller never
 * renders a broken link.
 */
export function buildHealthMetricsOverviewPccUrl(pccBaseUrl: string, pccProjectId: string, linkTarget: HealthMetricsOverviewLinkTarget): string | undefined {
  const anchor = Object.hasOwn(HEALTH_METRICS_OVERVIEW_LINK_TARGETS, linkTarget)
    ? HEALTH_METRICS_OVERVIEW_LINK_TARGETS[linkTarget as keyof typeof HEALTH_METRICS_OVERVIEW_LINK_TARGETS]
    : undefined;
  if (!anchor || !pccProjectId) {
    return undefined;
  }
  const base = pccBaseUrl.endsWith('/') ? pccBaseUrl.slice(0, -1) : pccBaseUrl;
  return `${base}/project/${encodeURIComponent(pccProjectId)}/reports/health-metrics${anchor}`;
}

/**
 * Maps `hm_area_state` rows onto the fixed 6-area tile order. Defensive only: `hm_area_state`
 * promises one row per area per foundation per period, and a foundation with no data still gets a
 * 'none' row (e.g. a Training tile reading "no data this period") — an area whose row is somehow
 * absent is omitted rather than rendered as an empty tile. `insightsUrl` is attached to the `code`
 * tile only.
 */
export function buildHealthMetricsOverviewTiles(areaStates: HealthMetricsAreaState[], insightsUrl: string | undefined): HealthMetricsOverviewTileViewModel[] {
  const areaStateByKey = new Map(areaStates.map((state) => [state.area, state]));
  return HEALTH_METRICS_OVERVIEW_AREAS.map((areaMeta) => {
    const state = areaStateByKey.get(areaMeta.key);
    if (!state) {
      return null;
    }
    const tile: HealthMetricsOverviewTileViewModel = {
      area: state.area,
      name: areaMeta.name,
      icon: areaMeta.icon,
      statValue: state.statValue,
      statLabel: state.statLabel,
      classification: state.classification,
      evaluatedAt: state.evaluatedAt,
      insightsUrl: areaMeta.key === 'code' ? insightsUrl : undefined,
    };
    return tile;
  }).filter((tile): tile is HealthMetricsOverviewTileViewModel => tile !== null);
}

/**
 * Buckets `hm_findings` rows into the fixed 5-group render order, sorted by `sortRank` within each
 * group; a group with no findings this period is hidden rather than rendered empty. An
 * out-of-contract classification degrades to the neutral 'none' group instead of throwing.
 */
export function groupHealthMetricsOverviewFindings(findings: HealthMetricsFinding[]): HealthMetricsOverviewFindingGroupRows[] {
  const resolvedClassification = (finding: HealthMetricsFinding): keyof typeof HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS =>
    HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[finding.classification] ? finding.classification : 'none';

  return HEALTH_METRICS_OVERVIEW_GROUP_ORDER.map((classification) => ({
    group: HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[classification].group,
    classification,
    findings: findings.filter((finding) => resolvedClassification(finding) === classification).sort((a, b) => a.sortRank - b.sortRank),
  })).filter((groupRows) => groupRows.findings.length > 0);
}

/** Shared `as of <date>` label for the overview tile strip and finding rows, so the copy never drifts between the two components. */
export function formatHealthMetricsOverviewAsOfLabel(evaluatedAt: string): string {
  return `as of ${formatIsoDateLabel(evaluatedAt)}`;
}

/** Resolves a findings-list group's classification key to its tone/icon, for the group heading. */
export function resolveHealthMetricsOverviewGroupMeta(classification: keyof typeof HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS): {
  textClass: string;
  icon: string;
} {
  const meta = HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[classification] ?? HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS.none;
  return { textClass: meta.textClass, icon: meta.icon };
}

/** Fallback legend metadata for a `stream.key` outside the fixed 3-stream set, so a degraded upstream row still renders instead of throwing. */
const UNKNOWN_REVENUE_STREAM_META = { label: 'Other', dotClass: 'bg-gray-400' } as const;

/** Builds the rail's "Foundation Revenue" legend rows — percent share and formatted total per stream. */
export function buildHealthMetricsOverviewRevenueStreams(revenue: HealthMetricsOverviewRevenue): HealthMetricsOverviewRevenueStreamViewModel[] {
  return revenue.streams.map((stream) => {
    const meta = HEALTH_METRICS_OVERVIEW_REVENUE_STREAMS[stream.key] ?? UNKNOWN_REVENUE_STREAM_META;
    return {
      label: meta.label,
      dotClass: meta.dotClass,
      percent: revenue.total > 0 ? Math.round((stream.value / revenue.total) * 100) : 0,
      valueLabel: formatCurrency(stream.value),
    };
  });
}
