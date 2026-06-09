// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CampaignGoalOption,
  CampaignPlatformOption,
  CampaignStatus,
  CampaignTabOption,
  LinkedInAdAccount,
  LinkedInGeoTarget,
  LinkedInTargetingProfile,
  LinkedInTargetingProfileConfig,
  ParsedCampaignName,
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
  { id: 'meta-ads', label: 'Meta Ads', icon: 'fa-brands fa-meta', disabled: true },
  { id: 'reddit-ads', label: 'Reddit Ads', icon: 'fa-brands fa-reddit', disabled: true },
  { id: 'brave-ads', label: 'Brave Ads', icon: 'fa-light fa-shield', disabled: true },
  { id: 'feathr', label: 'Feathr', icon: 'fa-light fa-bullseye-arrow', disabled: true },
  { id: 'twitter-ads', label: 'X / Twitter Ads', icon: 'fa-brands fa-x-twitter', disabled: true },
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
 * Upper-bound thresholds for each pacing label (percentage of budget spent).
 * A campaign's pacingPct falls into the first bucket whose threshold it does not exceed:
 *   pacingPct < 50  → underspending
 *   pacingPct < 90  → normal
 *   pacingPct < 100 → constrained
 *   pacingPct ≥ 100 → overspending (130 marks severe overspending)
 */
export const CAMPAIGN_PACING_THRESHOLDS = {
  underspending: 50,
  normal: 90,
  constrained: 100,
  overspending: 130,
} as const;

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

export const LINKEDIN_AD_ACCOUNTS: readonly LinkedInAdAccount[] = [
  { accountId: '538170226', label: 'The Linux Foundation', organizationId: '208777', status: 'ACTIVE' },
  { accountId: '509430019', label: 'LF Events', organizationId: '208777', status: 'ACTIVE' },
  { accountId: '510263296', label: 'CNCF', organizationId: '12893459', status: 'ACTIVE' },
  { accountId: '510263297', label: 'LF Networking', organizationId: '208777', status: 'ACTIVE' },
  { accountId: '510263298', label: 'LF AI & Data', organizationId: '208777', status: 'ACTIVE' },
  { accountId: '510263299', label: 'LF Energy', organizationId: '208777', status: 'ACTIVE' },
] as const;

export const LINKEDIN_DEFAULT_ACCOUNT_ID = '538170226';

export const LINKEDIN_EMPLOYER_EXCLUSIONS: readonly string[] = ['urn:li:company:33275771', 'urn:li:company:12893459'] as const;

export const LINKEDIN_TARGETING_PROFILES: readonly LinkedInTargetingProfileConfig[] = [
  {
    id: 'cloud-native',
    label: 'Cloud Native / CNCF',
    skills: [
      'urn:li:skill:55158',
      'urn:li:skill:56347',
      'urn:li:skill:56319',
      'urn:li:skill:18442',
      'urn:li:skill:1500290',
      'urn:li:skill:55734',
      'urn:li:skill:55383',
      'urn:li:skill:1500358',
      'urn:li:skill:56908',
      'urn:li:skill:58498',
      'urn:li:skill:55644',
      'urn:li:skill:55102',
      'urn:li:skill:56912',
      'urn:li:skill:18443',
      'urn:li:skill:25168',
      'urn:li:skill:56320',
      'urn:li:skill:25154',
      'urn:li:skill:56580',
      'urn:li:skill:56581',
      'urn:li:skill:55385',
    ],
    groups: [
      'urn:li:group:6821178',
      'urn:li:group:9375272',
      'urn:li:group:12405624',
      'urn:li:group:12391549',
      'urn:li:group:8553150',
      'urn:li:group:13681295',
      'urn:li:group:4490628',
      'urn:li:group:2602008',
      'urn:li:group:50985',
      'urn:li:group:6585490',
      'urn:li:group:3779791',
      'urn:li:group:13799412',
    ],
  },
  {
    id: 'mcp',
    label: 'MCP / Agentic AI',
    skills: [
      'urn:li:skill:59695',
      'urn:li:skill:59040',
      'urn:li:skill:61790',
      'urn:li:skill:2407',
      'urn:li:skill:3289',
      'urn:li:skill:56912',
      'urn:li:skill:61642',
      'urn:li:skill:59698',
      'urn:li:skill:5835',
    ],
    groups: ['urn:li:group:6672014', 'urn:li:group:6608681', 'urn:li:group:6773450', 'urn:li:group:10321152', 'urn:li:group:6731624', 'urn:li:group:961087'],
  },
] as const;

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
