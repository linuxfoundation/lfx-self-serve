// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_BASE_PATH } from '../constants/health-metrics-engagement.constants';
import {
  HEALTH_METRICS_OVERVIEW_AREAS,
  HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS,
  HEALTH_METRICS_OVERVIEW_ENGAGEMENT_LINK_TARGETS,
  HEALTH_METRICS_OVERVIEW_EVENTS_LINK_TARGETS,
  HEALTH_METRICS_OVERVIEW_GROUP_ORDER,
  HEALTH_METRICS_OVERVIEW_MEMBERS_LINK_TARGETS,
  HEALTH_METRICS_OVERVIEW_NON_MEMBERS_LINK_TARGETS,
  HEALTH_METRICS_OVERVIEW_REVENUE_STREAMS,
  HEALTH_METRICS_OVERVIEW_TRAINING_LINK_TARGETS,
} from '../constants/health-metrics-overview.constants';

import { formatCurrency } from './number.utils';

import type {
  HealthMetricsAreaState,
  HealthMetricsFinding,
  HealthMetricsOverviewArea,
  HealthMetricsOverviewClassification,
  HealthMetricsOverviewFindingGroupRows,
  HealthMetricsOverviewFindingRoute,
  HealthMetricsOverviewLinkTarget,
  HealthMetricsOverviewRevenue,
  HealthMetricsOverviewRevenueStreamViewModel,
  HealthMetricsOverviewTileViewModel,
} from '../interfaces/health-metrics-overview.interface';

/** `HEALTH_OVERVIEW_KPIS` status column → tile classification, per the verified taxonomy in LFXV2-3341. */
const KPI_STATUS_TO_CLASSIFICATION: Record<string, HealthMetricsOverviewClassification> = {
  healthy: 'ok',
  needs_attention: 'watch',
  needs_action: 'act',
};

/**
 * Resolves an `eng.*` `link_target` to its in-app Engagement section: the tab route, the section key
 * as the fragment, and the arrival filters. `undefined` for every other target.
 */
export function buildHealthMetricsOverviewEngagementRoute(linkTarget: HealthMetricsOverviewLinkTarget): HealthMetricsOverviewFindingRoute | undefined {
  if (!Object.hasOwn(HEALTH_METRICS_OVERVIEW_ENGAGEMENT_LINK_TARGETS, linkTarget)) {
    return undefined;
  }
  const spec = HEALTH_METRICS_OVERVIEW_ENGAGEMENT_LINK_TARGETS[linkTarget as keyof typeof HEALTH_METRICS_OVERVIEW_ENGAGEMENT_LINK_TARGETS];
  return { commands: [HEALTH_METRICS_BASE_PATH, 'engagement'], fragment: spec.section, queryParams: spec.queryParams };
}

/**
 * Resolves an `evt.*` `link_target` to its in-app Events section: the tab route, the section key as
 * the fragment, and the arrival params. `undefined` for every other target.
 */
export function buildHealthMetricsOverviewEventsRoute(linkTarget: HealthMetricsOverviewLinkTarget): HealthMetricsOverviewFindingRoute | undefined {
  if (!Object.hasOwn(HEALTH_METRICS_OVERVIEW_EVENTS_LINK_TARGETS, linkTarget)) {
    return undefined;
  }
  const spec = HEALTH_METRICS_OVERVIEW_EVENTS_LINK_TARGETS[linkTarget as keyof typeof HEALTH_METRICS_OVERVIEW_EVENTS_LINK_TARGETS];
  return { commands: [HEALTH_METRICS_BASE_PATH, 'events'], fragment: spec.section, queryParams: spec.queryParams };
}

/**
 * Resolves a `mem.*` `link_target` to its in-app Members section: the tab route, the section key as
 * the fragment, and the arrival filters. `undefined` for every other target.
 */
export function buildHealthMetricsOverviewMembersRoute(linkTarget: HealthMetricsOverviewLinkTarget): HealthMetricsOverviewFindingRoute | undefined {
  if (!Object.hasOwn(HEALTH_METRICS_OVERVIEW_MEMBERS_LINK_TARGETS, linkTarget)) {
    return undefined;
  }
  const spec = HEALTH_METRICS_OVERVIEW_MEMBERS_LINK_TARGETS[linkTarget as keyof typeof HEALTH_METRICS_OVERVIEW_MEMBERS_LINK_TARGETS];
  return { commands: [HEALTH_METRICS_BASE_PATH, 'members'], fragment: spec.section, queryParams: spec.queryParams };
}

/**
 * Resolves a `non.*` `link_target` to its in-app Non-Members section: the tab route, the section key
 * as the fragment, and the arrival filters. `undefined` for every other target.
 */
export function buildHealthMetricsOverviewNonMembersRoute(linkTarget: HealthMetricsOverviewLinkTarget): HealthMetricsOverviewFindingRoute | undefined {
  if (!Object.hasOwn(HEALTH_METRICS_OVERVIEW_NON_MEMBERS_LINK_TARGETS, linkTarget)) {
    return undefined;
  }
  const spec = HEALTH_METRICS_OVERVIEW_NON_MEMBERS_LINK_TARGETS[linkTarget as keyof typeof HEALTH_METRICS_OVERVIEW_NON_MEMBERS_LINK_TARGETS];
  return { commands: [HEALTH_METRICS_BASE_PATH, 'non-members'], fragment: spec.section, queryParams: spec.queryParams };
}

/**
 * Resolves a `trn.*` `link_target` to its in-app Training section: the tab route, the section key as
 * the fragment, and the arrival params. `undefined` for every other target.
 */
export function buildHealthMetricsOverviewTrainingRoute(linkTarget: HealthMetricsOverviewLinkTarget): HealthMetricsOverviewFindingRoute | undefined {
  if (!Object.hasOwn(HEALTH_METRICS_OVERVIEW_TRAINING_LINK_TARGETS, linkTarget)) {
    return undefined;
  }
  const spec = HEALTH_METRICS_OVERVIEW_TRAINING_LINK_TARGETS[linkTarget as keyof typeof HEALTH_METRICS_OVERVIEW_TRAINING_LINK_TARGETS];
  return { commands: [HEALTH_METRICS_BASE_PATH, 'training'], fragment: spec.section, queryParams: spec.queryParams };
}

/** Resolves a `link_target` to its in-app Level 2 route, Engagement, Events, Members, Non-Members then Training; `undefined` for the Insights target. */
export function buildHealthMetricsOverviewTabRoute(linkTarget: HealthMetricsOverviewLinkTarget): HealthMetricsOverviewFindingRoute | undefined {
  return (
    buildHealthMetricsOverviewEngagementRoute(linkTarget) ??
    buildHealthMetricsOverviewEventsRoute(linkTarget) ??
    buildHealthMetricsOverviewMembersRoute(linkTarget) ??
    buildHealthMetricsOverviewNonMembersRoute(linkTarget) ??
    buildHealthMetricsOverviewTrainingRoute(linkTarget)
  );
}

/** The top of an area's Level 2 tab, as `routerLink` commands; `undefined` for an area with no tab (`code`). */
export function buildHealthMetricsOverviewAreaTabRoute(area: HealthMetricsOverviewArea): readonly string[] | undefined {
  const tab = HEALTH_METRICS_OVERVIEW_AREAS.find((areaMeta) => areaMeta.key === area)?.tab;
  return tab ? [HEALTH_METRICS_BASE_PATH, tab] : undefined;
}

/**
 * Maps `hm_area_state` rows onto the fixed 6-area tile order. Defensive only: `hm_area_state`
 * promises one row per area per foundation per period, and a foundation with no data still gets a
 * 'none' row (e.g. a Training tile reading "no data this period") — an area whose row is somehow
 * absent is omitted rather than rendered as an empty tile. `insightsUrl` is attached to the `code`
 * tile only; every other tile links to the top of its tab, even with no figure.
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
      name: areaMeta.tileName,
      icon: areaMeta.icon,
      statValue: state.statValue,
      statLabel: state.statLabel,
      classification: state.classification,
      evaluatedAt: state.evaluatedAt,
      insightsUrl: areaMeta.key === 'code' ? insightsUrl : undefined,
      showStatus: state.showStatus,
      tabRoute: buildHealthMetricsOverviewAreaTabRoute(areaMeta.key),
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
    Object.hasOwn(HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS, finding.classification) ? finding.classification : 'none';

  return HEALTH_METRICS_OVERVIEW_GROUP_ORDER.map((classification) => ({
    group: HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[classification].group,
    classification,
    findings: findings.filter((finding) => resolvedClassification(finding) === classification).sort((a, b) => a.sortRank - b.sortRank),
  })).filter((groupRows) => groupRows.findings.length > 0);
}

/**
 * Maps a `HEALTH_OVERVIEW_KPIS` status column value (`healthy` / `needs_attention` / `needs_action`)
 * to the tile classification. This table's contract only ever emits those three values — `opp` and
 * `none` aren't part of it — but an unrecognized or missing value still degrades to `'none'` rather
 * than throwing.
 */
export function resolveHealthMetricsOverviewKpiClassification(status: string | null | undefined): HealthMetricsOverviewClassification {
  const normalized = status?.trim().toLowerCase();
  return normalized && Object.hasOwn(KPI_STATUS_TO_CLASSIFICATION, normalized) ? KPI_STATUS_TO_CLASSIFICATION[normalized] : 'none';
}

/** Resolves a findings-list group's classification key to its tone/icon, for the group heading. */
export function resolveHealthMetricsOverviewGroupMeta(classification: keyof typeof HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS): {
  textClass: string;
  icon: string;
} {
  const meta = Object.hasOwn(HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS, classification)
    ? HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[classification]
    : HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS.none;
  return { textClass: meta.textClass, icon: meta.icon };
}

/** Fallback legend metadata for a `stream.key` outside the fixed 3-stream set, so a degraded upstream row still renders instead of throwing. */
const UNKNOWN_REVENUE_STREAM_META = { label: 'Other', dotClass: 'bg-gray-400' } as const;

/** Builds the rail's "Foundation Revenue" legend rows — the model's percent share and formatted total per stream. */
export function buildHealthMetricsOverviewRevenueStreams(revenue: HealthMetricsOverviewRevenue): HealthMetricsOverviewRevenueStreamViewModel[] {
  return revenue.streams.map((stream) => {
    const streamMeta = HEALTH_METRICS_OVERVIEW_REVENUE_STREAMS as Record<string, { label: string; dotClass: string }>;
    const meta = Object.hasOwn(streamMeta, stream.key) ? streamMeta[stream.key] : UNKNOWN_REVENUE_STREAM_META;
    // A null stream is unmeasured — show "—" rather than a fabricated "$0 / 0%".
    if (stream.value === null) {
      return { key: stream.key, label: meta.label, dotClass: meta.dotClass, percentLabel: '—', widthPercent: 0, valueLabel: '—' };
    }
    // Legend and bar both read the model's share, so they can't disagree; an unmeasured share draws no segment.
    const widthPercent = stream.share === null ? 0 : Math.min(100, Math.max(0, stream.share));
    return {
      key: stream.key,
      label: meta.label,
      dotClass: meta.dotClass,
      percentLabel: stream.share === null ? '—' : `${Math.round(stream.share)}%`,
      widthPercent,
      valueLabel: formatCurrency(stream.value),
    };
  });
}

/** The page header's year-to-date span, e.g. "Jan 1 – Oct 22, 2026", shown beside the YTD period. */
export function buildHealthMetricsYtdRangeLabel(today: Date): string {
  const end = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `Jan 1 – ${end}, ${today.getFullYear()}`;
}
