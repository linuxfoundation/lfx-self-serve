// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CampaignDeliveryTypeOption,
  CampaignGoalOption,
  CampaignPlatform,
  CampaignPlatformOption,
  CampaignProgramTypeOption,
  CampaignStatus,
  CampaignTabOption,
  CampaignToggleStatus,
  LinkedInGeoTarget,
  MetaObjective,
  MetaObjectiveParams,
  MetaPlacement,
  ParsedCampaignName,
  RedditObjective,
  RedditObjectiveParams,
} from '../interfaces/campaign.interface';

/** Tab definitions for the Campaigns page tab navigation. */
export const CAMPAIGN_TABS: readonly CampaignTabOption[] = [
  { id: 'planning', label: 'Planning', icon: 'fa-light fa-clipboard-list' },
  { id: 'implementation', label: 'Implementation', icon: 'fa-light fa-rocket' },
  { id: 'insights', label: 'Insights', icon: 'fa-light fa-chart-mixed' },
  { id: 'optimization', label: 'Optimization', icon: 'fa-light fa-gauge-high' },
] as const;

export const CAMPAIGN_PLATFORMS: readonly CampaignPlatformOption[] = [
  { id: 'google-ads', label: 'Google Ads', icon: 'fa-brands fa-google' },
  { id: 'microsoft-ads', label: 'Microsoft Ads', icon: 'fa-brands fa-microsoft', disabled: true },
  { id: 'linkedin-ads', label: 'LinkedIn Ads', icon: 'fa-brands fa-linkedin' },
  { id: 'meta-ads', label: 'Meta Ads', icon: 'fa-brands fa-meta' },
  { id: 'reddit-ads', label: 'Reddit Ads', icon: 'fa-brands fa-reddit' },
  { id: 'twitter-ads', label: 'X / Twitter Ads', icon: 'fa-brands fa-x-twitter', disabled: true },
] as const;

/**
 * Delivery types — the second campaign selector (after the program type). Both are
 * selectable; the Email channel is under active parallel development.
 */
export const CAMPAIGN_DELIVERY_TYPES: readonly CampaignDeliveryTypeOption[] = [
  { id: 'paid-marketing', label: 'Paid Marketing', breadcrumbLabel: 'Paid Marketing' },
  { id: 'email', label: 'Email', breadcrumbLabel: 'Email' },
] as const;

export const CAMPAIGN_PROGRAM_TYPES: readonly CampaignProgramTypeOption[] = [
  {
    id: 'events',
    label: 'Events Campaigns',
    breadcrumbLabel: 'Events Campaigns',
    urlLabel: 'Event Page URL',
    urlPlaceholder: 'https://events.linuxfoundation.org/your-event/',
    urlHelp: 'Paste any LF event page — dates and details are scraped live, not from AI memory.',
    goalLabel: 'Conversions / Registrations',
    audiencePlaceholder: 'e.g., Cloud-native developers, DevOps engineers',
    valuePropPlaceholder: 'e.g., Free registration, 200+ sessions, hands-on labs with industry experts',
  },
  {
    id: 'education',
    label: 'Education Campaigns',
    breadcrumbLabel: 'Education Campaigns',
    urlLabel: 'Course / Training Page URL',
    urlPlaceholder: 'https://training.linuxfoundation.org/training/your-course/',
    urlHelp: 'Paste any LF Training page — course details are scraped live, not from AI memory.',
    goalLabel: 'Conversions / Enrollments',
    audiencePlaceholder: 'e.g., IT professionals seeking certifications, career changers',
    valuePropPlaceholder: 'e.g., Industry-recognized certification, self-paced learning, exam bundle discounts',
  },
] as const;

export const CAMPAIGN_GOALS: readonly CampaignGoalOption[] = [
  { id: 'conversions', label: 'Conversions / Registrations' },
  { id: 'brand-awareness', label: 'Brand Awareness' },
  { id: 'traffic', label: 'Traffic / Clicks' },
  { id: 'lead-generation', label: 'Lead Generation' },
  { id: 'engagement', label: 'Engagement' },
] as const;

export const CAMPAIGN_JOB_POLL_INTERVAL_MS = 2000;

/**
 * Pacing thresholds (percentage of budget spent).
 *   pacingPct < 50  → underspending
 *   pacingPct <= 90 → normal
 *   pacingPct <= 100 → constrained
 *   pacingPct > 100 → overspending (130 marks severe)
 */
export const CAMPAIGN_PACING_THRESHOLDS = {
  underspending: 50,
  normal: 90,
  constrained: 100,
  overspending: 130,
} as const;

/** Official vendor brand colors — external to the LFX design system (not in lfxColors). */
export const PLATFORM_BRAND_COLORS: Readonly<Record<CampaignPlatform, string>> = {
  'google-ads': '#4285F4',
  'linkedin-ads': '#0077B5',
  'reddit-ads': '#FF4500',
  'meta-ads': '#1877F2',
  'microsoft-ads': '#00A4EF',
  'twitter-ads': '#000000',
};

export const PLATFORM_DEFAULT_COLOR = '#6B7280';

export const CAMPAIGN_CHAR_LIMITS = {
  searchHeadline: 30,
  searchDescription: 90,
  displayHeadline: 40,
  displayDescription: 90,
  displayBusinessName: 25,
  sitelinkHeadline: 25,
  sitelinkDescription: 35,
} as const;

export const CAMPAIGN_BUDGET_DEFAULTS = {
  searchBudgetPct: 70,
  displayBudgetPct: 30,
} as const;

export const VALID_CAMPAIGN_STATUSES: ReadonlySet<CampaignStatus> = new Set<CampaignStatus>(['enabled', 'paused', 'removed', 'limited', 'draft']);

export const GADS_STATUS_ENUM: Partial<Record<number, CampaignStatus>> = {
  2: 'enabled',
  3: 'paused',
  4: 'removed',
};

// ---------------------------------------------------------------------------
// Campaign Name Convention
// ---------------------------------------------------------------------------
// Format: "Program | Base Name | Region | Objective | Targeting | Ad Format | Project | Funnel | Date"
// Example: "Events | KubeCon NA 2025 | EMEA | Conversions | Intent | Search | CNCF | MoFU | 2025-06-01"

export const CAMPAIGN_NAME_FIELDS = ['program', 'baseName', 'region', 'objective', 'targeting', 'adFormat', 'project', 'funnelStage', 'dateSuffix'] as const;

export const CAMPAIGN_NAME_DELIMITER = ' | ';

export function parseCampaignName(raw: string): ParsedCampaignName {
  const parts = raw.split(CAMPAIGN_NAME_DELIMITER);
  return {
    program: parts[0] || '',
    baseName: parts[1] || '',
    region: parts[2] || '',
    objective: parts[3] || '',
    targeting: parts[4] || '',
    adFormat: parts[5] || '',
    project: parts[6] || '',
    funnelStage: parts[7] || '',
    dateSuffix: parts[8] || '',
    raw,
  };
}

// ---------------------------------------------------------------------------
// LinkedIn Ads Constants
// ---------------------------------------------------------------------------

export const LINKEDIN_API_VERSION = '202602';

export const LINKEDIN_CHAR_LIMITS = {
  introText: 600,
  headline: 200,
} as const;

export const META_CHAR_LIMITS = {
  primaryText: 125,
  headline: 40,
  description: 30,
} as const;

/** Maps internal objective identifiers to Meta Marketing API campaign objective, optimization goal, and promoted object type. */
export const META_OBJECTIVE_PARAMS: Readonly<Record<MetaObjective, MetaObjectiveParams>> = {
  awareness: { campaignObjective: 'OUTCOME_AWARENESS', optimizationGoal: 'REACH', promotedObjectType: 'none' },
  traffic: { campaignObjective: 'OUTCOME_TRAFFIC', optimizationGoal: 'LINK_CLICKS', promotedObjectType: 'none' },
  engagement: { campaignObjective: 'OUTCOME_ENGAGEMENT', optimizationGoal: 'POST_ENGAGEMENT', promotedObjectType: 'page_id' },
  leads: { campaignObjective: 'OUTCOME_LEADS', optimizationGoal: 'LEAD_GENERATION', promotedObjectType: 'page_id' },
  conversions: { campaignObjective: 'OUTCOME_SALES', optimizationGoal: 'OFFSITE_CONVERSIONS', promotedObjectType: 'pixel_id' },
} as const;

/** Default Meta ad placement toggles — Facebook and Instagram feeds enabled, all others off. */
export const META_DEFAULT_PLACEMENTS: Readonly<MetaPlacement> = {
  facebookFeed: true,
  instagramFeed: true,
  stories: false,
  reels: false,
  audienceNetwork: false,
  messengerInbox: false,
} as const;

/** Valid statuses for the campaign status toggle endpoint. */
export const VALID_CAMPAIGN_TOGGLE_STATUSES: ReadonlySet<CampaignToggleStatus> = new Set<CampaignToggleStatus>(['ACTIVE', 'PAUSED']);

// NOTE: LinkedIn ad accounts, default account/org IDs, employer exclusions, and
// targeting profile URN lists are loaded at runtime from a mounted ConfigMap
// (see apps/lfx-one/src/server/services/linkedin-ads.service.ts → loadLinkedInConfig).
// They are kept out of source control entirely so vendor IDs never ship in the
// client bundle or the public chart repo.

export const LINKEDIN_GEO_RESOLVE_MAP: Readonly<Record<string, LinkedInGeoTarget>> = {
  japan: { label: 'Japan', urn: 'urn:li:geo:101355337' },
  india: { label: 'India', urn: 'urn:li:geo:102713980' },
  singapore: { label: 'Singapore', urn: 'urn:li:geo:102454443' },
  'south korea': { label: 'South Korea', urn: 'urn:li:geo:105149562' },
  australia: { label: 'Australia', urn: 'urn:li:geo:101452733' },
  taiwan: { label: 'Taiwan', urn: 'urn:li:geo:104441761' },
  'hong kong': { label: 'Hong Kong', urn: 'urn:li:geo:103291313' },
  'united states': { label: 'United States', urn: 'urn:li:geo:103644278' },
  usa: { label: 'United States', urn: 'urn:li:geo:103644278' },
  germany: { label: 'Germany', urn: 'urn:li:geo:101165590' },
  'united kingdom': { label: 'United Kingdom', urn: 'urn:li:geo:106693272' },
} as const;

// ---------------------------------------------------------------------------
// Reddit Ads — Objective Parameters
// ---------------------------------------------------------------------------

export const REDDIT_OBJECTIVE_PARAMS: Readonly<Record<RedditObjective, RedditObjectiveParams>> = {
  awareness: { redditObjective: 'IMPRESSIONS', bidType: 'CPM', bidValue: 3_000_000, optimizationGoal: 'IMPRESSIONS' },
  traffic: { redditObjective: 'CLICKS', bidType: 'CPC', bidValue: 500_000, optimizationGoal: 'CLICKS' },
  conversions: {
    redditObjective: 'CONVERSIONS',
    bidType: 'CPM',
    bidValue: 3_000_000,
    optimizationGoal: 'PURCHASE',
    viewThroughConversionType: 'SEVEN_DAY_CLICKS_ONE_DAY_VIEW',
  },
  video_views: { redditObjective: 'VIDEO_VIEWABLE_IMPRESSIONS', bidType: 'CPM', bidValue: 3_000_000, optimizationGoal: 'VIDEO_VIEWS' },
} as const;

export const REDDIT_OBJECTIVE_LABELS: Readonly<Record<RedditObjective, string>> = {
  awareness: 'Awareness',
  traffic: 'Traffic',
  conversions: 'Conversions',
  video_views: 'Video Views',
} as const;
