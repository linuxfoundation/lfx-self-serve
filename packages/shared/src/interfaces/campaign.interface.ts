// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ---------------------------------------------------------------------------
// Platform & Phase
// ---------------------------------------------------------------------------

export type CampaignPlatform = 'google-ads' | 'microsoft-ads' | 'linkedin-ads' | 'meta-ads' | 'reddit-ads' | 'twitter-ads';

export type CampaignPhase = 'planning' | 'implementation' | 'insights' | 'optimization';

export type LinkedInTargetingProfile = 'cloud-native' | 'mcp' | 'custom';

export interface LinkedInTargetingProfileConfig {
  id: LinkedInTargetingProfile;
  label: string;
  skills: readonly string[];
  groups: readonly string[];
}

export type CampaignStatus = 'draft' | 'paused' | 'enabled' | 'removed' | 'limited' | 'unknown';

export type CampaignType = 'search' | 'demand-gen' | 'sponsored' | 'social';

export type DateRangeOption = 7 | 14 | 30;

export type CampaignGoal = 'conversions' | 'brand-awareness' | 'traffic' | 'lead-generation' | 'engagement';

export type CampaignProgramType = 'events' | 'education';

/** How a campaign reaches its audience — the second selector after the program type. */
export type CampaignDeliveryType = 'paid-marketing' | 'email';

export type RedditObjective = 'awareness' | 'traffic' | 'conversions' | 'video_views';

export interface RedditObjectiveParams {
  readonly redditObjective: string;
  readonly bidType: 'CPM' | 'CPC';
  /** Reserved for future manual-bid support; unused while campaign strategy is BIDLESS. */
  readonly bidValue: number;
  readonly optimizationGoal: string;
  readonly viewThroughConversionType?: string;
}

export interface CampaignDeliveryTypeOption {
  id: CampaignDeliveryType;
  label: string;
  breadcrumbLabel: string;
  /** Disabled options render but can't be selected (e.g. a channel still in build). */
  disabled?: boolean;
}

export interface CampaignProgramTypeOption {
  id: CampaignProgramType;
  label: string;
  breadcrumbLabel: string;
  urlLabel: string;
  urlPlaceholder: string;
  urlHelp: string;
  goalLabel: string;
  audiencePlaceholder: string;
  valuePropPlaceholder: string;
}

export type CampaignTab = CampaignPhase;

export interface CampaignTabOption {
  id: CampaignTab;
  label: string;
  icon: string;
}

export interface CampaignPlatformOption {
  id: CampaignPlatform;
  label: string;
  icon: string;
  disabled?: boolean;
}

export interface CampaignGoalOption {
  id: CampaignGoal;
  label: string;
}

// ---------------------------------------------------------------------------
// Campaign Name Structure
// ---------------------------------------------------------------------------

export interface ParsedCampaignName {
  program: string;
  baseName: string;
  region: string;
  objective: string;
  targeting: string;
  adFormat: string;
  project: string;
  funnelStage: string;
  dateSuffix: string;
  raw: string;
}

// ---------------------------------------------------------------------------
// Brief Pipeline (Planning Phase)
// ---------------------------------------------------------------------------

export type CampaignSSEEventType =
  | 'status'
  | 'event'
  | 'hubspot_utm'
  | 'copy_token'
  | 'copy_done'
  | 'copy_structured'
  | 'keywords'
  | 'linkedin_strategy'
  | 'error'
  | 'done'
  | 'shutdown';

export interface CampaignBriefRequest {
  url: string;
  platforms?: CampaignPlatform[];
  programType?: CampaignProgramType;
  campaignGoal?: CampaignGoal;
  targetAudience?: string;
  valueProp?: string;
  totalBudget?: number;
  refineFeedback?: string;
  previousCopy?: Record<string, unknown>;
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
  programType?: CampaignProgramType;
  selectedPlatforms?: CampaignPlatform[];
  linkedInCopy?: LinkedInBriefCopy;
  redditCopy?: RedditBriefCopy;
  metaCopy?: MetaBriefCopy;
}

// ---------------------------------------------------------------------------
// LinkedIn Ads
// ---------------------------------------------------------------------------

export interface LinkedInGeoTarget {
  label: string;
  urn: string;
}

export interface LinkedInCreativeVariant {
  introText: string;
  headline: string;
  imageUrn?: string;
}

export interface LinkedInTargetingStrategy {
  targetingProfile: LinkedInTargetingProfile;
  targetingRationale: string;
  recommendedSkills: string[];
  recommendedGroups: string[];
  recommendedJobFunctions: string[];
  geoTargets: { name: string; rationale: string }[];
  budgetRecommendation: {
    dailyBudgetUsd: number;
    lifetimeBudgetUsd: number;
    rationale: string;
  };
  audienceEstimate: string;
  campaignStructureNotes: string;
}

export interface LinkedInBriefCopy {
  variants: LinkedInCreativeVariant[];
  recommendedGeoTargets: LinkedInGeoTarget[];
  recommendedTargetingProfile: LinkedInTargetingProfile;
  strategy?: LinkedInTargetingStrategy;
}

/**
 * One ad account / org pairing in the runtime LinkedIn config.
 *
 * Values (accountId, orgId, label, status) are loaded server-side from the
 * mounted ConfigMap and never embedded in the client bundle. The type itself
 * lives in the shared package because the client consumes it as the response
 * shape of `GET /api/campaigns/linkedin/accounts` (see CampaignService.
 * getLinkedInAccounts and the campaigns dashboard tabs).
 *
 * `status` is optional to preserve graceful degradation if the ConfigMap
 * omits it; production ConfigMaps always supply it.
 */
export interface LinkedInAccount {
  accountId: string;
  label: string;
  orgId: string;
  status?: 'ACTIVE' | 'BILLING_HOLD';
}

/**
 * Shape of /etc/lfx-self-serve/linkedin/linkedin.json (configurable via the
 * LINKEDIN_CONFIG_PATH env var). Mounted by the chart's `staticConfigMaps`
 * hook; populated from the private GitOps repo.
 */
export interface LinkedInRuntimeConfig {
  defaultAccountId: string;
  defaultOrgId: string;
  accounts: readonly LinkedInAccount[];
  employerExclusions: readonly string[];
  targetingProfiles: readonly LinkedInTargetingProfileConfig[];
}

// ---------------------------------------------------------------------------
// Campaign Creation (Implementation Phase)
// ---------------------------------------------------------------------------

export interface LinkedInCampaignCreateRequest {
  eventName: string;
  eventSlug: string;
  dates: string;
  registrationUrl: string;
  hsToken?: string;
  budgetUsd: number;
  lifetimeBudget: boolean;
  startDate: string;
  endDate: string;
  geoTargets: LinkedInGeoTarget[];
  targetingProfile: LinkedInTargetingProfile;
  variants: LinkedInCreativeVariant[];
  project?: string;
  driveFolderUrl?: string;
  adAccountId?: string;
}

export interface LinkedInCampaignCreateResult {
  platform: 'linkedin-ads';
  campaignGroupName: string;
  campaignGroupId: string;
  campaignName: string;
  campaignId: string;
  creativeCount: number;
  linkedInUrl: string;
  steps: string[];
}

// ---------------------------------------------------------------------------
// Reddit Ads — Campaign Creation
// ---------------------------------------------------------------------------

export interface RedditAdVariant {
  headline: string;
  body?: string;
}

export interface RedditBriefCopy {
  variants: RedditAdVariant[];
  recommendedSubreddits: string[];
  recommendedInterests: string[];
  recommendedKeywords: string[];
  recommendedGeos: string[];
}

export interface RedditCampaignCreateRequest {
  eventName: string;
  eventSlug: string;
  registrationUrl: string;
  hsToken?: string;
  budgetUsd: number;
  startDate: string;
  endDate: string;
  geoTargets: string[];
  subreddits: string[];
  interests: string[];
  keywords: string[];
  variants: RedditAdVariant[];
  project?: string;
  objective?: RedditObjective;
  postUrl?: string;
}

export interface RedditCampaignCreateResult {
  platform: 'reddit-ads';
  campaignName: string;
  campaignId: string;
  adGroupName: string;
  adGroupId: string;
  adCount: number;
  adId?: string;
  redditUrl: string;
  steps: string[];
}

// ---------------------------------------------------------------------------
// Meta Ads — Campaign Creation
// ---------------------------------------------------------------------------

export interface MetaAdVariant {
  primaryText: string;
  headline: string;
  description?: string;
}

export interface MetaBriefCopy {
  variants: MetaAdVariant[];
  recommendedGeos: string[];
}

export type MetaObjective = 'awareness' | 'traffic' | 'engagement' | 'leads' | 'conversions';

export interface MetaPlacement {
  facebookFeed: boolean;
  instagramFeed: boolean;
  stories: boolean;
  reels: boolean;
  audienceNetwork: boolean;
  messengerInbox: boolean;
}

export interface MetaObjectiveParams {
  readonly campaignObjective: string;
  readonly optimizationGoal: string;
  readonly promotedObjectType: 'page_id' | 'pixel_id' | 'none';
}

export interface MetaCampaignCreateRequest {
  eventName: string;
  eventSlug: string;
  registrationUrl: string;
  hsToken?: string;
  budgetUsd: number;
  lifetimeBudget: boolean;
  startDate: string;
  endDate: string;
  geoTargets: string[];
  variants: MetaAdVariant[];
  project?: string;
  objective?: MetaObjective;
  placements?: Partial<MetaPlacement>;
  pixelId?: string;
}

export interface MetaCampaignCreateResult {
  platform: 'meta-ads';
  campaignName: string;
  campaignId: string;
  adSetName: string;
  adSetId: string;
  adCount: number;
  metaUrl: string;
  steps: string[];
}

// ---------------------------------------------------------------------------
// Meta Ads Monitoring
// ---------------------------------------------------------------------------

export type MetaPacingLabel = 'underspending' | 'normal' | 'constrained' | 'overspending';

export type MetaActionPriority = 'HIGH' | 'MED' | 'LOW';

export interface MetaCampaignMetrics {
  campaignId: string;
  campaignName: string;
  status: string;
  totalBudget: number;
  dailyBudget: number;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  pacingPct: number;
  pacingLabel: MetaPacingLabel;
  startDate: string;
  endDate: string;
}

export interface MetaAccountTotals {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  campaignCount: number;
}

export interface MetaActionItem {
  priority: MetaActionPriority;
  campaignName: string;
  issue: string;
  action: string;
}

export interface MetaAccountOption {
  key: string;
  label: string;
}

export interface MetaMonitorResponse {
  accountLabel: string;
  pulledAt: string;
  dateRange: { mode: string };
  campaigns: MetaCampaignMetrics[];
  accountTotals: MetaAccountTotals;
  actionItems: MetaActionItem[];
}

export interface CampaignBriefRefineRequest {
  currentCopy: Record<string, unknown>;
  currentKeywords: CampaignKeyword[];
  feedback: string;
  eventDetails?: CampaignEventDetails | null;
  platforms?: CampaignPlatform[];
  programType?: CampaignProgramType;
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
  platforms?: CampaignPlatform[];
  linkedInConfig?: LinkedInCampaignCreateRequest;
  redditConfig?: RedditCampaignCreateRequest;
  metaConfig?: MetaCampaignCreateRequest;
}

export interface CampaignCreateResult {
  platform: CampaignPlatform;
  type: CampaignType;
  campaignName: string;
  campaignId: string;
  adGroupCount: number;
  keywordCount: number;
  adCount: number;
  campaignUrl: string;
  steps: string[];
}

export interface CampaignCreateResponse {
  success: boolean;
  campaigns: CampaignCreateResult[];
  errors: string[];
}

export interface CampaignJobStatus {
  status: 'running' | 'done' | 'error' | 'not_found';
  result?: CampaignCreateResponse;
  error?: string;
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
  startDate: string;
  endDate: string;
  budgetDay: number;
  totalBudget: number;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  avgCpc: number;
  conversions: number;
  pacingPct: number;
  pacingLabel: PacingLabel;
  campaignId: string;
  googleAdsUrl: string;
}

export interface CampaignActionItem {
  eventName: string;
  campaigns: string[];
  campaignUrls: Record<string, string>;
  priority: ActionPriority;
  issue: string;
  action: string;
  metrics: {
    spend: number;
    budget: number;
    pacingPct: number;
    impressions: number;
    clicks: number;
    conversions: number;
  };
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
  adGroupId: string;
  criterionId: string;
  campaign: string;
  campaignId: string;
  googleAdsUrl: string;
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
// Optimization Insights
// ---------------------------------------------------------------------------

// Reserved for the Optimization tab (PR 9 in the Campaigns epic)
export interface ImpressionShareMetrics {
  campaignName: string;
  eventName: string;
  campaignId: string;
  googleAdsUrl: string;
  impressionShare: number | null;
  budgetLostShare: number | null;
  rankLostShare: number | null;
  impressions: number;
  clicks: number;
}

// ---------------------------------------------------------------------------
// Optimization Actions
// ---------------------------------------------------------------------------

export type KeywordActionType = 'pause' | 'remove';

export interface KeywordActionRequest {
  campaignId: string;
  adGroupId: string;
  criterionId: string;
  action: KeywordActionType;
}

export interface KeywordActionResponse {
  success: boolean;
  action: KeywordActionType;
  keyword: string;
  message: string;
}

export interface BulkKeywordActionRequest {
  keywords: KeywordActionRequest[];
  action: KeywordActionType;
}

export interface BulkKeywordActionResponse {
  success: boolean;
  total: number;
  succeeded: number;
  failed: number;
  results: KeywordActionResponse[];
}

export interface SearchTermMetrics {
  searchTerm: string;
  campaignName: string;
  eventName: string;
  campaignId: string;
  googleAdsUrl: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avgCpc: number;
  spend: number;
  conversions: number;
}

export interface QualityScoreInsight {
  keyword: string;
  matchType: string;
  qualityScore: number | null;
  expectedCtr: string;
  adRelevance: string;
  landingPage: string;
  campaignName: string;
  eventName: string;
  campaignId: string;
  googleAdsUrl: string;
  impressions: number;
  clicks: number;
  spend: number;
}

export interface GeoPerformance {
  country: string;
  countryCode: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
  conversions: number;
}

export interface DayOfWeekPerformance {
  day: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
  conversions: number;
}

export interface OptimizationInsightsResponse {
  pulledAt: string;
  days: number;
  impressionShare: ImpressionShareMetrics[];
  searchTerms: SearchTermMetrics[];
  qualityScores: QualityScoreInsight[];
  geoPerformance: GeoPerformance[];
  dayOfWeek: DayOfWeekPerformance[];
}

// ---------------------------------------------------------------------------
// LinkedIn Ads Monitoring
// ---------------------------------------------------------------------------

export type LinkedInPacingLabel = 'underspending' | 'normal' | 'constrained' | 'overspending';
export type LinkedInActionPriority = 'HIGH' | 'MED' | 'LOW';

export interface LinkedInCreativeMetrics {
  creativeId: string;
  creativeName: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
  conversions: number;
  status: string;
}

export interface LinkedInCampaignMetrics {
  campaignId: string;
  campaignName: string;
  eventName: string;
  status: string;
  totalBudget: number;
  dailyBudget: number;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  pacingPct: number;
  pacingLabel: LinkedInPacingLabel;
  creatives: LinkedInCreativeMetrics[];
  startDate: string;
  endDate: string;
}

export interface LinkedInAccountTotals {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  campaignCount: number;
}

export interface LinkedInActionItem {
  priority: LinkedInActionPriority;
  campaignName: string;
  issue: string;
  action: string;
}

export interface LinkedInMonitorResponse {
  accountLabel: string;
  pulledAt: string;
  dateRange: { mode: string };
  campaigns: LinkedInCampaignMetrics[];
  accountTotals: LinkedInAccountTotals;
  actionItems: LinkedInActionItem[];
}

// ---------------------------------------------------------------------------
// Reddit Ads Monitoring
// ---------------------------------------------------------------------------

export type RedditPacingLabel = 'underspending' | 'normal' | 'constrained' | 'overspending';
export type RedditActionPriority = 'HIGH' | 'MED' | 'LOW';

export interface RedditCampaignMetrics {
  campaignId: string;
  campaignName: string;
  status: string;
  totalBudget: number;
  dailyBudget: number;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  pacingPct: number;
  pacingLabel: RedditPacingLabel;
  startDate: string;
  endDate: string;
}

export interface RedditAccountTotals {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  campaignCount: number;
}

export interface RedditActionItem {
  priority: RedditActionPriority;
  campaignName: string;
  issue: string;
  action: string;
}

export interface RedditAccountOption {
  key: string;
  label: string;
}

export interface RedditMonitorResponse {
  accountLabel: string;
  pulledAt: string;
  dateRange: { mode: string };
  campaigns: RedditCampaignMetrics[];
  accountTotals: RedditAccountTotals;
  actionItems: RedditActionItem[];
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

// ---------------------------------------------------------------------------
// Campaign Status Toggle
// ---------------------------------------------------------------------------

/** Supported statuses for the campaign status toggle endpoint. */
export type CampaignToggleStatus = 'ACTIVE' | 'PAUSED';

export interface CampaignStatusUpdateRequest {
  platform: CampaignPlatform;
  status: CampaignToggleStatus;
  accountId?: string;
}

export interface CampaignStatusUpdateResult {
  platform: CampaignPlatform;
  campaignId: string;
  previousStatus: string;
  newStatus: CampaignToggleStatus;
  success: boolean;
}
