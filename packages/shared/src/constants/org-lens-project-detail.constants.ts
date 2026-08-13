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
import { HEALTH_SCORE_BADGE } from './org-lens-projects.constants';

export const PD_DEFAULT_TAB: OrgLensProjectDetailTab = 'pd-influence';
export const PD_VALID_TABS: ReadonlySet<string> = new Set<OrgLensProjectDetailTab>(['pd-influence', 'pd-leaderboards']);

export const PD_DEFAULT_METRIC: OrgLensLeaderboardMetric = 'influence';
export const PD_VALID_METRICS: ReadonlySet<string> = new Set<OrgLensLeaderboardMetric>(['influence', 'activity']);

/** Max leaderboard search length the board endpoint accepts; longer input is truncated before it reaches the cache key or the `ILIKE` term. */
export const PD_MAX_SEARCH_LENGTH = 100;

export const PD_DEFAULT_TIME_RANGE: OrgLensLeaderboardTimeRange = '2y';
export const PD_VALID_TIME_RANGES: ReadonlySet<string> = new Set<OrgLensLeaderboardTimeRange>(['1y', '2y', 'all']);

export const PD_DRAWER_QUERY_PARAM = 'card';
export const PD_CONTRIBUTORS_CARD_KEY = 'contributors';
export const PD_VALID_DRAWER_CARD_KEYS: ReadonlySet<string> = new Set<string>([PD_CONTRIBUTORS_CARD_KEY]);

/** Snowflake `time_range_type` value for each UI range toggle. */
export const PD_TIME_RANGE_TYPE: Record<OrgLensLeaderboardTimeRange, string> = {
  '1y': 'last_365_days',
  '2y': 'last_2_years',
  all: 'alltime',
};

export const PD_HEALTH_TAG: Record<OrgLensProjectHealth, { label: string; bg: string; text: string }> = {
  excellent: { label: 'Excellent', ...HEALTH_SCORE_BADGE.excellent },
  healthy: { label: 'Healthy', ...HEALTH_SCORE_BADGE.healthy },
  stable: { label: 'Stable', ...HEALTH_SCORE_BADGE.stable },
  unsteady: { label: 'Unsteady', ...HEALTH_SCORE_BADGE.unsteady },
  critical: { label: 'Critical', ...HEALTH_SCORE_BADGE.critical },
};

/** Leaderboard band chip → lfx-tag severity. */
export const PD_BAND_TAG: Record<OrgLensProjectBand, { label: string; severity: TagSeverity }> = {
  leading: { label: 'Leading', severity: 'success' },
  contributing: { label: 'Contributing', severity: 'info' },
  participating: { label: 'Participating', severity: 'warn' },
  silent: { label: 'Silent', severity: 'secondary' },
};

export const BAND_SIGNAL_RANK: Record<OrgLensProjectBand, number> = {
  leading: 4,
  contributing: 3,
  participating: 2,
  silent: 1,
};

export const BAND_SIGNAL_FILL: Record<OrgLensProjectBand, string> = {
  leading: 'fill-emerald-500',
  contributing: 'fill-blue-500',
  participating: 'fill-amber-500',
  silent: 'fill-gray-400',
};

export const BAND_SIGNAL_FILL_LIGHT: Record<OrgLensProjectBand, string> = {
  leading: 'fill-emerald-200',
  contributing: 'fill-blue-200',
  participating: 'fill-amber-200',
  silent: 'fill-gray-200',
};

export const BAND_CHIP_CLASS: Record<OrgLensProjectBand, string> = {
  leading: 'inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700',
  contributing: 'inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700',
  participating: 'inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700',
  silent: 'inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600',
};

/**
 * Non-LF projects have no ecosystem influence, so instead of a band tier they render a distinct
 * marker. Reuses the neutral-gray styling that previously represented the (dropped) `non-lf` band.
 */
export const PD_NON_LF_MARKER: { label: string; severity: TagSeverity; chipClass: string; signalRank: number; signalFill: string; signalFillLight: string } = {
  label: 'Non-LF',
  severity: 'secondary',
  chipClass: 'inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600',
  signalRank: 0,
  signalFill: 'fill-gray-400',
  signalFillLight: 'fill-gray-200',
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

/**
 * Stand-in "window length" for the all-time range: not a real month count, so never do arithmetic
 * on it (`PD_ALL_TIME_WINDOW - 12` is meaningless). It exists only so a residual `slice(-months)`
 * over an all-time series is a no-op and returns the payload whole.
 */
const PD_ALL_TIME_WINDOW = Number.MAX_SAFE_INTEGER;

/**
 * Trailing monthly window per range for the recent-monthly representation. `1y`/`2y` slice the
 * trailing 12 / 24 monthly points client-side. `all` is NO LONGER a fixed length (was 36): under
 * "All time" the payload carries a variable, adaptively-bucketed series (hard cap ≤ 12 points) with
 * its own `periods[]` axis labels (see `OrgLensTrendBlock.periods`), so the client renders the
 * payload as-is instead of slicing to a fixed count.
 */
export const PD_TIME_RANGE_MONTHS: Record<OrgLensLeaderboardTimeRange, number> = { '1y': 12, '2y': 24, all: PD_ALL_TIME_WINDOW };

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
