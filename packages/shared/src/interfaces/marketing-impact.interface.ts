// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  BrandReachResponse,
  EmailCtrResponse,
  MarketingAttributionChannel,
  MarketingAttributionResponse,
  PaidProjectPerformance,
  RevenueImpactResponse,
} from './analytics-data.interface';
import type { EventsOverviewMetric } from './dashboard-metric.interface';

/** Period option for the Marketing Impact date range picker. */
export interface MarketingImpactPeriodOption {
  label: string;
  value: string;
}

/** Resolved date range from a validated period parameter. */
export interface ResolvedPeriodRange {
  type: 'month' | 'ytd' | 'trailing';
  startDate: string;
  endDate: string;
  label: string;
}

/** Tab option for the Marketing Impact section tabs. */
export interface MarketingImpactTabOption {
  id: MarketingImpactTab;
  label: string;
}

/** Focus program identifiers for the Marketing Impact FOCUS filter bar. Values map to Snowflake LF_SUB_DOMAIN_CLASSIFICATION via FOCUS_TO_CLASSIFICATION. */
export type MarketingImpactFocusProgram = 'all' | 'lfCorporate' | 'lfEvents' | 'lfTraining';

/** Tab identifiers for the Marketing Impact section tabs. */
export type MarketingImpactTab = 'overview' | 'attribution' | 'performance-marketing' | 'email' | 'web-activity' | 'social-accounts' | 'social-listening';

/** Aggregated KPI source data fetched for the Marketing Impact overview tab. */
export interface OverviewKpiData {
  revenueImpact: RevenueImpactResponse | null;
  brandReach: BrandReachResponse | null;
  emailCtr: EmailCtrResponse | null;
  attribution: MarketingAttributionResponse | null;
}

/**
 * Foundation-wide events summary for the selected period, driving the Events Summary tile
 * row at the top of the Overview tab. Each metric carries its value plus a YoY change
 * fraction (0.52 = +52%; null when there is no prior baseline).
 */
export interface EventsOverviewSummary {
  registrations: EventsOverviewMetric;
  attendees: EventsOverviewMetric;
  events: EventsOverviewMetric;
  speakers: EventsOverviewMetric;
  organizations: EventsOverviewMetric;
  countries: EventsOverviewMetric;
  /** Aggregate sponsorship revenue in dollars for the period. */
  sponsorship: EventsOverviewMetric;
}

/** Severity tone for a needs-attention item. */
export type AttentionSeverity = 'critical' | 'warning';

/** A single actionable item in the "Needs attention" strip. */
export interface EventAttentionItem {
  /** Stable id (the event id) for tracking. */
  id: string;
  /** Short severity tag, e.g. "BEHIND GOAL". */
  tag: string;
  severity: AttentionSeverity;
  /** One-line headline, e.g. "Open Source Summit Korea is 29% to its registration goal". */
  title: string;
  /** Supporting detail line. */
  detail: string;
  /** Deep-link to act on the item (the event page); '' when unavailable. */
  actionUrl: string;
}

/** A single actual-vs-goal progress bar in an event roster row. */
export interface EventRosterBar {
  /** Formatted actual value (e.g. "206", "$45.2K"). */
  actual: string;
  /** Formatted goal value (e.g. "700", "$195K"); shown as the grey target number. */
  goal: string;
  /** Fill percentage 0–100; only meaningful when hasGoal is true. */
  percent: number;
  /** False when goal is 0/absent — the UI renders no bar (matches PCC's "no goal required"). */
  hasGoal: boolean;
  /** Health tone driving the fill color. */
  tone: 'good' | 'warn' | 'critical' | 'none';
}

/** Pre-formatted view-model for a single Event Roster table row. */
export interface EventRosterRowView {
  eventId: string;
  eventName: string;
  /** Display date (e.g. "Aug 11, 2026"). */
  dateLabel: string;
  eventUrl: string;
  country: string;
  registrations: EventRosterBar;
  sponsorshipRevenue: EventRosterBar;
  /** Whether to show the at-risk (⚠) flag — behind goal with a low comparison score. */
  atRisk: boolean;
  cfpStatus: string;
}

/** Pre-formatted view-model for a single Events Summary stat tile. */
export interface EventsSummaryStat {
  id: string;
  label: string;
  icon: string;
  iconClass: string;
  /** Formatted value string, or a dash when the underlying metric is null (no data yet). */
  value: string;
  /** Formatted YoY delta (e.g. "▲ 12% YoY"), or null when there is no baseline. */
  delta: string | null;
  /** Trend direction for coloring the delta. */
  deltaTrend: 'up' | 'down' | 'neutral';
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

/** Funnel stage identifier for the performance marketing filter. */
export type FunnelStage = 'all' | 'tofu' | 'mofu' | 'bofu';

/** View-model row for the performance marketing project table. */
export interface PaidProjectRow {
  name: string;
  funnelStage: string;
  spend: string;
  revenue: string;
  roas: string;
  impressions: string;
  performance: PaidProjectPerformance;
  performanceClass: string;
  campaigns: PaidCampaignRow[];
}

/** View-model row for a nested campaign under a project. */
export interface PaidCampaignRow {
  campaignName: string;
  funnelStage: string;
  spend: string;
  revenue: string;
  roas: string;
  impressions: string;
}

/** View-model row for the email type breakdown table. */
export interface EmailTypeRow {
  emailType: string;
  campaignCount: number;
  sends: string;
  opens: string;
  openRate: string;
  ctr: string;
}

/** View-model row for the top campaigns table. */
export interface TopCampaignRow {
  name: string;
  type: string;
  sends: string;
  opens: string;
  openRate: string;
  ctr: string;
}

/** View-model row for the social accounts platform table. */
export interface SocialAccountRow {
  platform: string;
  followers: string;
  impressions: string;
  engagementRate: string;
  posts: string;
}

/** View-model row for a single month inside a social monthly platform. */
export interface SocialMonthlyRow {
  month: string;
  impressions: string;
  engagementRate: string;
  followers: string;
  newFollowers: string;
  momChange: string;
  momChangeClass: string;
}

/** View-model for an expandable social platform with monthly data. */
export interface SocialMonthlyPlatform {
  platform: string;
  expanded: boolean;
  latestFollowers: string;
  latestMomChange: string;
  latestMomChangeClass: string;
  months: SocialMonthlyRow[];
}

/** Segment data for the sentiment breakdown horizontal bar chart. */
export interface SentimentBar {
  positive: number;
  neutral: number;
  negative: number;
  positiveLabel: string;
  neutralLabel: string;
  negativeLabel: string;
}

/** View-model row for an individual domain inside a classification group. */
export interface WebActivityDomainDetailRow {
  host: string;
  sessions: string;
  pageViews: string;
  newUsers: string;
  returningUsers: string;
  sessionShare: number;
  sessionShareFormatted: string;
}

/** View-model row for the web activity domain table. */
export interface WebActivityDomainRow {
  domain: string;
  sessions: string;
  pageViews: string;
  pagesPerSession: string;
  sessionShare: number;
  sessionShareFormatted: string;
  domains: WebActivityDomainDetailRow[];
}

/** View-model row for the platform performance table. */
export interface PlatformPerformanceRow {
  platform: string;
  spend: string;
  revenue: string;
  roas: string;
  clicks: string;
  impressions: string;
  ctr: string;
  cpc: string;
  convRate: string;
  conversions: string;
  performance: PaidProjectPerformance;
  performanceClass: string;
  campaigns: PlatformCampaignRow[];
}

/** View-model row for a nested campaign under a platform. All numeric fields are pre-formatted strings. */
export interface PlatformCampaignRow {
  campaignName: string;
  /** Pre-formatted currency string, e.g. "$1,234.56" */
  spend: string;
  /** Pre-formatted currency string, e.g. "$5,678.90" */
  revenue: string;
  /** Pre-formatted ROAS multiplier string, e.g. "2.34x" */
  roas: string;
  /** Pre-formatted number string, e.g. "1,234" */
  clicks: string;
  /** Pre-formatted number string, e.g. "12,345" */
  impressions: string;
}

/** View-model row for the keyword performance table. */
export interface KeywordRow {
  keyword: string;
  matchType: string;
  clicks: string;
  spend: string;
  impressions: string;
  ctr: string;
  cpc: string;
  conversions: string;
  convRate: string;
  revenue: string;
  roas: string;
  searchTerms: SearchTermRow[];
}

/** View-model row for a nested search term under a keyword. */
export interface SearchTermRow {
  searchTerm: string;
  matchType: string;
  clicks: string;
  spend: string;
  impressions: string;
  ctr: string;
  cpc: string;
  conversions: string;
}
