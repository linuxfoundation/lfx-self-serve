// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Month option for the Marketing Impact page month picker. */
export interface MarketingImpactMonthOption {
  /** Display label (e.g., "April 2026") */
  label: string;
  /** ISO-style value for API use (e.g., "2026-04") */
  value: string;
}

/** Tab option for the Marketing Impact section tabs. */
export interface MarketingImpactTabOption {
  id: MarketingImpactTab;
  label: string;
}

/** Focus program identifiers for the Marketing Impact FOCUS filter bar. */
export type MarketingImpactFocusProgram = 'all' | 'events' | 'newsletters' | 'surveys' | 'trainings';

/** Tab identifiers for the Marketing Impact section tabs. */
export type MarketingImpactTab = 'overview' | 'attribution' | 'performance-marketing' | 'email' | 'web-activity' | 'social-accounts' | 'social-listening';

/** Pre-formatted KPI card data for the Marketing Impact performance summary. */
export interface PerformanceSummaryKpi {
  id: string;
  label: string;
  icon: string;
  iconClass: string;
  value: string;
  momChange: string;
  trend: 'up' | 'down' | 'neutral';
  trendClass: string;
  previousLabel: string;
}
