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

/**
 * What `POST /api/campaigns/brief/persist` reports back.
 *
 * `enabled: false` is a first-class outcome, not a failure: it is what the endpoint returns
 * when `LFX_CUTOVER_CAMPAIGN_SERVICE_BRIEFS` is off, which is the default everywhere until the
 * cutover is turned on per environment. The client must distinguish it from a failure, because
 * the two want opposite treatment — a disabled flag is the expected steady state and warrants
 * no UI at all, while a failure means the user's brief is NOT durable and they should be told
 * before they spend an afternoon on it.
 *
 * `created` distinguishes a first save from an update of an existing brief for the same
 * `event_slug`. It is reported rather than inferred because the client cannot tell: the
 * find-then-create-or-update decision happens server-side against campaign-service.
 */
export interface CampaignBriefPersistResult {
  enabled: boolean;
  briefId: string;
  etag: string | null;
  created: boolean;
  /**
   * Whether the saved brief reached `approved`, the state campaign-service requires before it
   * will create campaigns or build an audience from it.
   *
   * Separate from the save's own success because the two really can differ: campaign-service
   * writes every brief as `draft` and resets an existing one to `draft` on replace, so approval
   * is a second call that can fail on its own. When it does, the brief IS durable — which is why
   * this is a field rather than an error.
   */
  approved: boolean;
  /**
   * Why the save was REFUSED, when it was. Absent means the save happened.
   *
   * `unverified-validator`: this caller owns the brief but holds no trustworthy last-seen
   * version — its previous write returned no ETag, or that write's approval outcome was
   * indeterminate. The save is refused rather than sent with a validator this request read
   * itself, which would bypass the precondition and could overwrite an intervening writer
   * silently. Distinct from `stale-brief`, where a validator WAS sent and the server rejected it.
   *
   * `superseded-after-write`: the PUT committed, but the approval that follows it was refused
   * with a 412 — the row's version moved in between, so another writer replaced the brief after
   * this save wrote it. The write is durable but may no longer be what the row HOLDS, so it must
   * not be confirmed as saved.
   *
   * `stale-brief`: the caller named the row and owns it, but another writer changed it since the
   * caller last saw it, so the replace was refused with a 412 rather than overwriting their work.
   * Distinct from `unowned-brief-exists` because the remedy differs: this caller may replace the
   * brief, it just needs to see the newer version first.
   *
   * `unowned-brief-exists`: a brief already exists for this event slug and the caller could not
   * prove it owns it — it never loaded that brief, so it holds no `briefId` matching the stored
   * row. Replacing would overwrite content the user was never shown, and a reload or a second tab
   * is enough to reach that: the page generates from scratch, the slug matches perfectly, and the
   * server's find hits a row nobody read.
   *
   * `briefId` is deliberately EMPTY on this refusal, and that is a security property rather than
   * an omission. Returning the blocking row's id would hand an unowned caller the one value the
   * ownership check asks for: read the id off the refusal, replay it with `etag_fallback`, and
   * the overwrite this conflict exists to prevent succeeds. The id is withheld at the source --
   * the ownership check runs before the fallback -- so no caller can offer to "open the blocking
   * brief" from this response, by design.
   *
   * LFXV2-3098 introduced this while persistence was write-only, where it refused EVERY
   * collision — with no read path, nothing could hand a caller an id at all. LFXV2-3108 adds the
   * read, so a restored brief now carries its own id and replaces its own row; everything else
   * still refuses.
   *
   * A discriminated field rather than a thrown error: the brief is not lost, nothing is broken,
   * and the caller's next step is a CHOICE (open the existing one, or file under a different
   * event) rather than a retry.
   */
  conflict?: 'unowned-brief-exists' | 'stale-brief' | 'superseded-after-write' | 'unverified-validator';
}

/**
 * The Implementation tab's view of whether the brief behind it is durable.
 *
 * `off` renders nothing — see `CampaignBriefPersistResult.enabled`. `error` carries a message
 * and is the reason this state exists at all: a persist failure that is swallowed leaves the
 * user believing their brief is saved when it is not, and this repo has already been bitten by
 * a graceful degradation that hid a 100% failure rate behind a clean UI.
 */
/**
 * The Implementation tab's in-progress edits, held by the PARENT so they survive a tab switch.
 *
 * `ImplementationTabComponent` lives inside a structural `@switch`, so leaving the tab destroys
 * it and everything it owns locally. LFXV2-3202 fixed that for the Plan tab by keeping the
 * planner mounted, but the same treatment is wrong here: this component fetches ad-account lists
 * in `ngOnInit`, so mounting it eagerly would issue that request on every page load for a tab the
 * user may never open. Lifting the edits out instead keeps the component cheap to destroy while
 * the user's typing survives (LFXV2-3229).
 *
 * Deliberately a SNAPSHOT of user-editable fields only, not the whole component state. Anything
 * re-derivable from the brief (event name, slug, registration URL) or from a fetch (results,
 * progress, account lists) is left to re-derive — restoring those would be restoring a cache, and
 * a stale one. What cannot be recovered is what the user typed.
 *
 * `null` means "nothing to restore", which is the state on first mount and after a reset. It is
 * NOT the same as an empty draft: an empty draft would mean the user deliberately cleared every
 * field, and replaying that over a freshly generated brief would erase it.
 */
export interface CampaignImplementationDraft {
  /** Search ad copy as edited. Empty arrays are meaningful — the user removed every entry. */
  headlines: string[];
  descriptions: string[];
  /** Budget and flight, which the brief seeds but the user routinely overrides. */
  budgetUsd: number;
  searchBudgetPct: number;
  startDate: string;
  endDate: string;
  includeSearch: boolean;
  includeDemandGen: boolean;
  /**
   * The event this draft belongs to, so a draft cannot be replayed onto a different brief.
   * Without it, generating a brief for event B and opening Implement would restore event A's
   * copy over it — the same class of bug the `(project, event)` ownership keys exist to prevent.
   */
  eventSlug: string;
}

export interface CampaignBriefPersistenceState {
  status: 'off' | 'saving' | 'saved' | 'error';
  briefId: string | null;
  /**
   * The banner text, or `null` when the state needs none.
   *
   * Set on `error`, and also on `saved` when the write landed but the APPROVAL did not — a
   * durable row that campaign creation and audience building both refuse, because they gate on
   * `approved`. That case stays `saved` rather than becoming `error`: describing a write that
   * really did land as failed would be its own falsehood, and the honest report is that the
   * brief is stored but not yet usable.
   */
  message: string | null;
}

/**
 * What `GET /api/campaigns/brief` reports back — the read half of brief persistence.
 *
 * The outcome is a single `status` rather than the `enabled` + payload pair
 * `CampaignBriefPersistResult` uses, because there are FOUR outcomes here and only two of them
 * are "no brief". Collapsing them loses the distinction that matters:
 *
 * - `off` — the cutover flag is not set. Nothing was looked up. This is the default in every
 *   environment and warrants no UI.
 * - `none` — campaign-service was asked and has no brief for this event slug. The ordinary
 *   first-time case; the user generates one.
 * - `loaded` — a brief was found and reconstructed. `brief` is non-null.
 * - `unreadable` — a row EXISTS for this slug but this build cannot reconstruct a
 *   `CampaignBriefOutput` from it. Reporting that as `none` would be a lie with consequences:
 *   the user would generate a replacement, and the save path is find-then-UPDATE, so the
 *   unreadable brief would be silently overwritten rather than repaired or reported. Kept
 *   distinct so the UI can say "a saved brief exists but could not be opened" and the id is
 *   available to whoever investigates.
 *
 * `briefId` is populated for `loaded` and `unreadable` alike, and null for the other two.
 */
export interface CampaignBriefLoadResult {
  status: 'off' | 'none' | 'loaded' | 'unreadable';
  briefId: string | null;
  brief: CampaignBriefOutput | null;
  /**
   * Whether the STORED row is already approved.
   *
   * campaign-service creates every brief as `draft` and approval is a second call, so a save
   * whose approve step failed leaves an approved-looking brief sitting in `draft`. Restoring it
   * suppresses the next save (the content is already stored), and without this flag the row
   * would never reach `approved` — while `build-audience` and campaign creation both gate on
   * `status = 'approved'`. Surfaced so the restore path can re-approve instead of assuming a
   * stored brief is a finished one.
   *
   * `false` whenever the status could not be read, so the fallback is to re-approve rather than
   * to assume approval.
   */
  approved: boolean;
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

/**
 * One platform's outcome as lfx-v2-campaign-service reports it.
 *
 * Deliberately NOT a `CampaignCreateResult`. That interface carries `type`, `campaignName`,
 * `adGroupCount`, `keywordCount`, `adCount`, `campaignUrl` and `steps`, and campaign-service's
 * `platform-result` carries none of them — it knows the platform, whether the create
 * succeeded, the upstream campaign id, and the failure reason. Widening this into a
 * `CampaignCreateResult` with zeros and empty strings would make the implementation tab
 * render "0 ad groups · 0 keywords · 0 ads" and an empty link for a campaign that really has
 * them, which reports a successful create as an empty one. A separate, smaller type keeps the
 * absent fields absent, so nothing can render a number nobody measured.
 */
export interface CampaignPlatformResult {
  platform: string;
  ok: boolean;
  /** Upstream platform campaign id. Present when ok, and also when the create succeeded but recording it did not — so the orphaned id is not lost. */
  campaignId?: string;
  error?: string;
}

/**
 * What a finished creation job left behind, normalised across both sources.
 *
 * `campaigns` is populated by the vendor-direct path and `platformResults` by the
 * campaign-service path — never both. Neither is a guarantee of content: the vendor-direct path
 * calls `completeJob` unconditionally (`campaign-proxy.service.ts`), so a run in which every
 * platform failed finishes as `done` with an empty `campaigns` and a populated `errors`. Read
 * `errors` and each result's own flag; do not treat "the job is over" as "a campaign exists".
 *
 * Kept as one type so the caller has a single "the job is over, here is what happened" value
 * rather than a nullable `CampaignCreateResponse` that reads as "nothing happened" on the
 * campaign-service path.
 */
export interface CampaignJobOutcome {
  campaigns: CampaignCreateResult[];
  errors: string[];
  platformResults?: CampaignPlatformResult[];
}

export interface CampaignJobStatus {
  status: 'running' | 'done' | 'error' | 'not_found';
  /** Populated by the in-process (vendor-direct) path only. */
  result?: CampaignCreateResponse;
  /** Populated by the campaign-service path only. See `CampaignPlatformResult` for why the two differ. */
  platformResults?: CampaignPlatformResult[];
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
