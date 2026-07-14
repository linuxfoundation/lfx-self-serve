// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { lfxColors } from './colors.constants';
import type { FoundationHealthScore, HealthStatusFilterOption } from '../interfaces';

export const PROJECT_HEALTH_SCORES_DRAWER_ITEMS_PER_PAGE = 10;

// Ordered health buckets (low → high), matching the distribution chart's bar order.
export const PROJECT_HEALTH_SCORE_CATEGORIES: readonly FoundationHealthScore[] = ['critical', 'unsteady', 'stable', 'healthy', 'excellent'];

// Display label per health category (table badge + chart axis / tooltip title).
export const PROJECT_HEALTH_CATEGORY_LABEL: Record<FoundationHealthScore, string> = {
  critical: 'Critical',
  unsteady: 'Unsteady',
  stable: 'Stable',
  healthy: 'Healthy',
  excellent: 'Excellent',
};

// Badge bg/text per health category, sourced from the same lfxColors scales the
// chart legend uses (100/700 for a lighter pill) — single source of truth for
// category color across bars and badges.
export const PROJECT_HEALTH_CATEGORY_BADGE: Record<FoundationHealthScore, { bg: string; text: string }> = {
  critical: { bg: lfxColors.red[100], text: lfxColors.red[700] },
  unsteady: { bg: lfxColors.amber[100], text: lfxColors.amber[700] },
  stable: { bg: lfxColors.violet[100], text: lfxColors.violet[700] },
  healthy: { bg: lfxColors.blue[100], text: lfxColors.blue[700] },
  excellent: { bg: lfxColors.emerald[100], text: lfxColors.emerald[700] },
};

// Distribution-chart bar / legend swatch color per health category (500-scale).
// Single source of truth for the chart bar fill shared by the foundation-health
// distribution chart and the drawer's chart + legend.
export const PROJECT_HEALTH_CATEGORY_CHART_COLOR: Record<FoundationHealthScore, string> = {
  critical: lfxColors.red[500],
  unsteady: lfxColors.amber[400],
  stable: lfxColors.violet[500],
  healthy: lfxColors.blue[500],
  excellent: lfxColors.emerald[500],
};

// Neutral badge for unscored project rows (null healthScoreCategory), reusing the
// gray scale the Unscored filter pill uses so the row status matches the filter.
export const PROJECT_HEALTH_UNSCORED_BADGE: { bg: string; text: string; label: string } = {
  bg: lfxColors.gray[100],
  text: lfxColors.gray[600],
  label: 'Unscored',
};

// Drawer table status-filter pills: the 5 scored categories plus an "Unscored" bucket
// for projects whose per-project health score hasn't been emitted yet (null category).
export const PROJECT_HEALTH_STATUS_FILTER_OPTIONS: readonly HealthStatusFilterOption[] = [
  ...PROJECT_HEALTH_SCORE_CATEGORIES.map((value) => ({
    value,
    label: PROJECT_HEALTH_CATEGORY_LABEL[value],
    ...PROJECT_HEALTH_CATEGORY_BADGE[value],
  })),
  { value: 'unscored', label: 'Unscored', bg: lfxColors.gray[100], text: lfxColors.gray[600] },
];
