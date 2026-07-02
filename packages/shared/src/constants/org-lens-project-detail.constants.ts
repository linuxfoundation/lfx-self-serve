// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  OrgLensLeaderboardMetric,
  OrgLensLeaderboardTimeRange,
  OrgLensProjectBand,
  OrgLensProjectDetailTab,
  OrgLensProjectHealth,
  TagSeverity,
} from '../interfaces';
import { lfxColors } from './colors.constants';

export const PD_DEFAULT_TAB: OrgLensProjectDetailTab = 'pd-influence';
export const PD_VALID_TABS: ReadonlySet<string> = new Set<OrgLensProjectDetailTab>(['pd-influence', 'pd-leaderboards']);

export const PD_DEFAULT_METRIC: OrgLensLeaderboardMetric = 'influence';
export const PD_VALID_METRICS: ReadonlySet<string> = new Set<OrgLensLeaderboardMetric>(['influence', 'activity']);

export const PD_DEFAULT_TIME_RANGE: OrgLensLeaderboardTimeRange = '1y';
export const PD_VALID_TIME_RANGES: ReadonlySet<string> = new Set<OrgLensLeaderboardTimeRange>(['1y', '2y', 'all']);

/** Hero health badge → lfx-tag severity (green Excellent / amber Healthy / red At Risk). */
export const PD_HEALTH_TAG: Record<OrgLensProjectHealth, { label: string; severity: TagSeverity }> = {
  excellent: { label: 'Excellent', severity: 'success' },
  healthy: { label: 'Healthy', severity: 'warn' },
  'at-risk': { label: 'At Risk', severity: 'danger' },
};

/** Leaderboard band chip → lfx-tag severity. */
export const PD_BAND_TAG: Record<OrgLensProjectBand, { label: string; severity: TagSeverity }> = {
  leading: { label: 'Leading', severity: 'success' },
  contributing: { label: 'Contributing', severity: 'info' },
  participating: { label: 'Participating', severity: 'warn' },
  'non-lf': { label: 'Non-LF', severity: 'secondary' },
};

export const BAND_SIGNAL_RANK: Record<OrgLensProjectBand, number> = {
  leading: 4,
  contributing: 3,
  participating: 2,
  'non-lf': 0,
};

export const BAND_SIGNAL_FILL: Record<OrgLensProjectBand, string> = {
  leading: 'fill-emerald-500',
  contributing: 'fill-blue-500',
  participating: 'fill-amber-500',
  'non-lf': 'fill-gray-400',
};

export const BAND_SIGNAL_FILL_LIGHT: Record<OrgLensProjectBand, string> = {
  leading: 'fill-emerald-200',
  contributing: 'fill-blue-200',
  participating: 'fill-amber-200',
  'non-lf': 'fill-gray-200',
};

export const BAND_CHIP_CLASS: Record<OrgLensProjectBand, string> = {
  leading: 'inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700',
  contributing: 'inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700',
  participating: 'inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700',
  'non-lf': 'inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600',
};

export const PD_METRIC_OPTIONS: { id: OrgLensLeaderboardMetric; label: string; icon: string }[] = [
  { id: 'influence', label: 'Calculated Influence', icon: 'fa-light fa-chart-bar' },
  { id: 'activity', label: 'Activity Count', icon: 'fa-light fa-list-ol' },
];

export const PD_TIME_RANGE_OPTIONS: { id: OrgLensLeaderboardTimeRange; label: string }[] = [
  { id: '1y', label: '1 year' },
  { id: '2y', label: '2 years' },
  { id: 'all', label: 'All time' },
];

export const PD_TIME_RANGE_MONTHS: Record<OrgLensLeaderboardTimeRange, number> = { '1y': 12, '2y': 24, all: 36 };

/** 11-slot palette for the stacked trend chart — top-10 companies + "All others". */
export const PD_STACKED_PALETTE: string[] = [
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
