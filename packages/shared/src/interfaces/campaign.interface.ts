// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ---------------------------------------------------------------------------
// Platform & Phase
// ---------------------------------------------------------------------------

export type CampaignPlatform = 'google-ads' | 'microsoft-ads' | 'linkedin-ads' | 'meta-ads' | 'reddit-ads' | 'brave-ads' | 'feathr' | 'twitter-ads';

export type CampaignPhase = 'planning' | 'implementation' | 'monitoring' | 'optimization';

export type CampaignStatus = 'draft' | 'paused' | 'enabled' | 'removed' | 'limited';

export type CampaignType = 'search' | 'demand-gen';

export type CampaignGoal = 'conversions' | 'brand-awareness' | 'traffic' | 'lead-generation' | 'engagement';

export type CampaignTab = CampaignPhase;

export interface CampaignTabOption {
  id: CampaignTab;
  label: string;
  icon: string;
}

// ---------------------------------------------------------------------------
// Brief Pipeline (Planning Phase)
// ---------------------------------------------------------------------------

export type CampaignSSEEventType = 'status' | 'event' | 'hubspot_utm' | 'copy_token' | 'copy_done' | 'copy_structured' | 'keywords' | 'error' | 'done';

export interface CampaignBriefRequest {
  url: string;
  platforms?: CampaignPlatform[];
  campaignGoal?: CampaignGoal;
  targetAudience?: string;
  valueProp?: string;
  totalBudget?: number;
}

export interface CampaignEventDetails {
  name: string;
  dates: string;
  city: string;
  countryCode: string;
  audience: string;
  themes: string[];
  registrationUrl: string;
  speakers: string[];
  slug: string;
  formatNotes: string;
}

export interface CampaignKeyword {
  term: string;
  matchType: 'Exact' | 'Phrase' | 'Broad';
  intentLevel: 'High' | 'Medium' | 'Low';
  notes: string;
}

export interface CampaignBriefOutput {
  eventDetails: CampaignEventDetails;
  structuredCopy: Record<string, unknown> | null;
  keywords: CampaignKeyword[];
  hsUtm: string | null;
  totalBudget: number | null;
  driveFolderUrl: string;
  campaignGoal: CampaignGoal | null;
}

// ---------------------------------------------------------------------------
// Campaign Creation (Implementation Phase)
// ---------------------------------------------------------------------------

export interface CampaignCreateRequest {
  eventName: string;
  eventSlug: string;
  countryCode: string;
  registrationUrl: string;
  hsToken?: string;
  campaignTypes: CampaignType[];
  budgetUsd: number;
  searchBudgetPct: number;
  startDate: string;
  endDate: string;
  keywords: CampaignKeyword[];
  headlines: string[];
  descriptions: string[];
  displayHeadlines?: string[];
  displayDescriptions?: string[];
  displayBusinessName?: string;
  displayCallToAction?: string;
  geoTargets: string[];
  project?: string;
  driveFolderUrl?: string;
}

export interface CampaignCreateResult {
  type: CampaignType;
  campaignName: string;
  campaignId: string;
  adGroupCount: number;
  keywordCount: number;
  adCount: number;
  googleAdsUrl: string;
  steps: string[];
}

export interface CampaignCreateResponse {
  success: boolean;
  campaigns: CampaignCreateResult[];
  errors: string[];
}

export interface CampaignJobStatus {
  status: 'running' | 'done' | 'not_found';
  result?: CampaignCreateResponse;
}

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

export type PacingLabel = 'underspending' | 'normal' | 'constrained' | 'overspending';

export type ActionPriority = 'HIGH' | 'MED' | 'LOW';

export interface CampaignMetrics {
  name: string;
  shortName: string;
  eventName: string;
  adFormat: string;
  targeting: string;
  status: CampaignStatus;
  budgetDay: number;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  avgCpc: number;
  conversions: number;
  pacingPct: number;
  pacingLabel: PacingLabel;
  actionRules: CampaignActionItem[];
}

export interface CampaignActionItem {
  campaign: string;
  priority: ActionPriority;
  issue: string;
  action: string;
  owner: string;
}

export interface CampaignAccountTotals {
  budgetDay: number;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface CampaignMonitorResponse {
  pulledAt: string;
  dateRange: { mode: string };
  campaigns: CampaignMetrics[];
  accountTotals: CampaignAccountTotals;
  actionItems: CampaignActionItem[];
  message?: string;
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

export interface KeywordMetrics {
  keyword: string;
  matchType: string;
  qualityScore: number | null;
  status: string;
  adGroup: string;
  campaign: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avgCpc: number;
  spend: number;
  conversions: number;
}

export interface KeywordTotals {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  avgCtr: number;
}

export interface KeywordMetricsResponse {
  pulledAt: string;
  days: number;
  totalKeywords: number;
  totals: KeywordTotals;
  keywords: KeywordMetrics[];
}

// ---------------------------------------------------------------------------
// Audience Demographics
// ---------------------------------------------------------------------------

export interface AudienceBucket {
  label: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
  conversions: number;
}

export interface AudienceDemographics {
  pulledAt: string;
  days: number;
  age: AudienceBucket[];
  gender: AudienceBucket[];
  device: AudienceBucket[];
}

// ---------------------------------------------------------------------------
// HubSpot UTM
// ---------------------------------------------------------------------------

export interface HubSpotUtmLookupResult {
  found: boolean;
  hs_utm: string | null;
  campaign_name: string;
  all_matches: { name: string; hs_utm: string }[];
}

export interface HubSpotUtmCreateResult {
  created: boolean;
  hs_utm: string | null;
  campaign_name: string;
}
