// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { BrandReachResponse, EmailCtrResponse, MarketingAttributionChannel, RevenueImpactResponse } from './analytics-data.interface';

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

/** Aggregated KPI source data fetched for the Marketing Impact overview tab. */
export interface OverviewKpiData {
  revenueImpact: RevenueImpactResponse | null;
  brandReach: BrandReachResponse | null;
  emailCtr: EmailCtrResponse | null;
}

/** Pre-formatted KPI card data for the Marketing Impact performance summary. */
export interface PerformanceSummaryKpi {
  id: string;
  label: string;
  icon: string;
  iconClass: string;
  value: string;
  momChange: string | null;
  momTrend: 'up' | 'down' | 'neutral';
  momTrendClass: string;
  yoyChange: string | null;
  yoyTrend: 'up' | 'down' | 'neutral';
  yoyTrendClass: string;
  comparisonLine?: string;
  /** Optional badge text (e.g., "Needs review") shown when metric requires attention. */
  badge?: string;
}

/** Attribution model identifier for the model selector dropdown. */
export type AttributionModel = 'linear' | 'firstTouch' | 'lastTouch' | 'timeDecay';

/** Option shape for the attribution model dropdown. */
export interface AttributionModelOption {
  label: string;
  value: AttributionModel;
}

/** View-model row for the attribution channel table. */
export interface AttributionChannelRow {
  channel: string;
  revenue: number;
  revenueFormatted: string;
  sharePercent: number;
  sessions: number;
  sessionsFormatted: string;
  raw: MarketingAttributionChannel;
}
