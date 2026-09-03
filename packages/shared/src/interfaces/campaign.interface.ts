// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CAMPAIGN_METRICS_WINDOWS } from '../constants/campaign.constants';

// ---------------------------------------------------------------------------
// Platform & Phase
// ---------------------------------------------------------------------------

export type CampaignPlatform = 'google-ads' | 'microsoft-ads' | 'linkedin-ads' | 'meta-ads' | 'reddit-ads' | 'twitter-ads';

/**
 * Any platform a campaign can dispatch to — the paid ad channels plus the email channel.
 *
 * `'hubspot'` is spelled out here rather than added to `CampaignPlatform`. Upstream the two are
 * interchangeable (`docs/api-catalog.md` records the platform enum as `"hubspot"`, and `campaigns`
 * is unique on `(brief_id, platform)`), but here they are not: `CampaignPlatform`'s members are
 * enumerated by `CAMPAIGN_PLATFORMS`, which renders the paid Ad Channels picker
 * (`planning-tab.component.ts:96`). Widening that union would offer HubSpot as an ad channel a
 * paid brief could select — email is not an ad channel, it is a different delivery type that
 * happens to dispatch through one.
 */
export type CampaignAnyPlatform = CampaignPlatform | 'hubspot';

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
  /**
   * Which delivery channel the brief is for. Absent means `paid-marketing`.
   *
   * Explicit rather than inferred from `platforms` being absent. That inference does not work:
   * the generator treats an absent platform list as the paid DEFAULT (`['google-ads']`), so
   * "no platforms" and "the caller did not say" are the same value on the wire and cannot mean
   * two different things. This field is what distinguishes them.
   */
  deliveryType?: CampaignDeliveryType;
  programType?: CampaignProgramType;
  campaignGoal?: CampaignGoal;
  targetAudience?: string;
  valueProp?: string;
  totalBudget?: number;
  refineFeedback?: string;
  previousCopy?: Record<string, unknown>;
}

/**
 * The event's terms, split by how much authority each kind carries when suggesting a template.
 *
 * Three kinds rather than one list, because they answer different questions and conflating them
 * produced two real false positives:
 *
 * - `decisive` (event name and slug) is the ONLY kind that may push a template over the
 *   suggestion threshold. These identify the event itself.
 * - `ranking` (city) orders results but can never justify a suggestion on its own. Operators do
 *   name templates by city, so the terms are worth sorting by -- but "Salt Lake City visitor
 *   guide" matched `salt`, `lake` and `city` for a KubeCon brief and cleared the threshold with
 *   no event term at all.
 * - `year` breaks ties and nothing more. Dropping it made annual editions score identically, so
 *   the server's order chose between "KubeCon NA 2025" and "KubeCon NA 2026"; counting it toward
 *   the threshold would let "Open newsletter 2028" match an "Open Source Summit 2028" brief.
 */
export interface EventTemplateTerms {
  /** Name and slug tokens. The only kind that can reach the suggestion threshold. */
  decisive: string[];
  /** City tokens. Improve ordering; never sufficient for a suggestion. */
  ranking: string[];
  /** The event's year, if it names one. A tie-break between otherwise-equal templates. */
  year: string;
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
  /**
   * Which delivery surface this brief was authored for.
   *
   * Persisted (into `targeting`, which is free-form) rather than derived, because brief storage is
   * keyed on `(project, event_slug)` with no delivery dimension: without this, an email brief and a
   * paid brief for the same event are the SAME ROW, and restoring one under the other surface hands
   * back RSA headlines and a keyword list to an email plan. `loadBrief` compares it against the
   * surface asking, so a brief authored elsewhere is reported as absent rather than mis-restored.
   *
   * Optional, and absence is meaningful: rows written before this field existed carry no delivery
   * type and are treated as paid, which is what they are — every brief predating it was authored on
   * the paid surface, the only one whose restore path was ever enabled.
   */
  deliveryType?: CampaignDeliveryType;
  selectedPlatforms?: CampaignPlatform[];
  linkedInCopy?: LinkedInBriefCopy;
  redditCopy?: RedditBriefCopy;
  metaCopy?: MetaBriefCopy;
}

/**
 * What `POST /api/campaigns/brief/persist` reports back.
 *
 * `enabled: false` is a first-class outcome, not a failure: it is what the endpoint returns
 * when `LFX_CUTOVER_CAMPAIGN_SERVICE_BRIEFS` is off. The chart enables it since #1881, but the
 * flag is read per request, so any override or un-rolled deployment still answers this way. The client must distinguish it from a failure, because
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

  /**
   * Is the stored brief APPROVED, and therefore usable for campaign creation?
   *
   * Explicit rather than inferred from `message` being non-null. campaign-service refuses a create
   * from an unapproved brief outright — `internal/service/brief.go:439` returns 400 "brief must be
   * approved before creating campaigns" — so the Implementation tab has to know, and matching on
   * banner prose to find out would break the first time the copy is edited.
   *
   * Load-bearing on `saved` AND on `off`-with-a-briefId, which is the RESTORE state. An earlier
   * version of this line said "meaningful only on `saved`; `false` elsewhere, where there is no
   * stored brief to approve" — every clause of that became false once restore began carrying the
   * stored brief's own approval through (`onRestoreSavedBrief` → `onProceedToImplementation`).
   *
   * So the two states that gate creation on it are:
   *   `saved`            — this session wrote the brief; `approved` is that write's approval.
   *   `off` + a briefId  — a brief was RESTORED; `approved` is the stored row's.
   *
   * `off` with a NULL briefId is the genuinely-not-applicable case (cutover dark, or nothing
   * saved yet), and `false` there means "no opinion", not "unapproved". The Implementation tab
   * reads it exactly that way — see `canSubmit`, which checks the brief id before the flag.
   */
  approved: boolean;
}

/**
 * The Implementation tab's in-progress edits, held by the PARENT so they survive a tab switch.
 *
 * `ImplementationTabComponent` lives inside a structural `@switch`, so leaving the tab destroys
 * it and everything it owns locally. LFXV2-3202 (PR #1437, not yet merged) proposes keeping the
 * planner mounted for the Plan tab, but the same treatment is wrong here: this component fetches
 * the LinkedIn ad-account list in `ngOnInit`, so mounting it eagerly would issue that request on
 * every page load for a tab the user may never open. Lifting the edits out instead keeps the
 * component cheap to destroy while the user's typing survives (LFXV2-3229).
 *
 * Deliberately a SNAPSHOT of the fields a user EDITS, not the whole component state. That is
 * broader than typing: it covers the dropdown, chip list and toggle the LinkedIn picks are chosen
 * through, because a choice made with the mouse is lost by a tab switch exactly as a typed one is.
 * Anything re-derived from a fetch (results, progress, the LinkedIn account LIST itself) is left
 * to re-derive — restoring those would be restoring a cache, and a stale one.
 *
 * `eventSlug` is the one carried field that is NOT restored: it is the draft's key, compared
 * against the brief on screen so one event's edits cannot replay onto another's.
 *
 * The LinkedIn ad account, geo targets and targeting profile are carried too (LFXV2-3230). They
 * were moved from component signals onto `campaignForm`, which is what makes the RESTORE work:
 * `applyDraft`'s existing `patchValue` replays them, and `valueChanges` emits on every pick with
 * no per-handler plumbing. They were form state in everything but name — three controls the user
 * picks from, whose only distinction was living in a signal.
 *
 * Moving them onto the form did NOT save this interface three members, and it is worth being
 * precise about why. `emitDraft` builds an object LITERAL rather than spreading `getRawValue()`,
 * so a control that is not named there never reaches the draft at all. The form buys the restore
 * half and the emission trigger; the snapshot still has to list what it carries. Anyone extending
 * this pays one line here either way.
 *
 * What the form DOES buy is that the value has exactly one home. A signal-backed field is written
 * in a handler, read in `submit`, seeded in `populateFromBrief` and mirrored here — four places to
 * keep in step. A form-backed one is stored once and derived everywhere else.
 *
 * The per-platform BUDGETS and the Meta controls ARE carried, by a different mechanism from the
 * form controls above: they remain component signals, so `valueChanges` cannot see them and each
 * mutation handler calls `emitDraft` itself. Two mechanisms therefore coexist in this file. The
 * form is the better target — it needs no per-handler emission and so cannot be forgotten when a
 * control is added — so unifying on it is worth doing rather than deferring again.
 *
 * Any per-platform value not named on this interface is NOT carried across a tab switch, and the
 * test for whether that is a bug is whether a USER CAN CHANGE IT:
 *
 *   - Values with no editor — the creative variants and the Reddit targeting lists, all rendered
 *     read-only for review — are correctly absent. `populateFromBrief` re-seeds them from the
 *     brief on every mount, so they re-derive identically and carrying them would only let a
 *     stale copy overwrite a fresh seed.
 *   - Values a user CAN edit and that are not carried are simply still broken.
 *
 * Membership is deliberately not enumerated here — it changes as tickets land and as controls gain
 * editors, and a list of members is exactly the kind of claim a later change falsifies with
 * nothing to catch it. The per-field docblocks below carry the current answer.
 *
 * `null` means "nothing to restore", which is the state on first mount and after a reset. It is
 * NOT the same as an empty draft: an empty draft would mean the user deliberately cleared every
 * field, and replaying that over a freshly generated brief would erase it.
 */
export interface CampaignImplementationDraft {
  /**
   * Event identity as edited. All three are plain text inputs the user types into, and
   * `registrationUrl` carries `Validators.required` — it is where the paid traffic lands, so a
   * silently reverted one sends spend at a stale scraped URL.
   */
  eventName: string;
  countryCode: string;
  registrationUrl: string;
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
   * The three LinkedIn controls the user picks rather than types (LFXV2-3230): the ad account,
   * the geo target list, and the targeting profile.
   *
   * REQUIRED, not optional, and an empty `linkedInGeoTargets` is a meaningful value rather than a
   * hole — the user removed every chip, and `canSubmit` blocks a LinkedIn campaign on exactly
   * that. Optional members would make "cleared" and "not set" indistinguishable at the restore
   * site, and the natural `?? recommendedGeoTargets` fallback would then put the AI's list back
   * over a deliberate clearance, which is the defect rather than the fix.
   *
   * `linkedInAccountId` is '' before the ad-account fetch resolves, and is carried as-is. Note the
   * restored value is NOT preserved unconditionally: the account list is refetched on every mount,
   * and `ngOnInit` reconciles the restored id against it — keeping it when the catalog still
   * offers it, replacing it with the first account otherwise, and clearing it when the catalog is
   * empty. A choice that is still valid survives; one pointing at a revoked account does not,
   * because the alternative is dispatching to an account the page cannot display.
   */
  linkedInAccountId: string;
  linkedInGeoTargets: LinkedInGeoTarget[];
  linkedInTargetingProfile: LinkedInTargetingProfile;
  /**
   * The event this draft belongs to, so a draft cannot be replayed onto a different brief.
   * Without it, generating a brief for event B and opening Implement would restore event A's
   * copy over it — the same class of bug the `(project, event)` ownership keys exist to prevent.
   */
  eventSlug: string;
  /**
   * Meta settings as edited, and the reason this snapshot is not "the form fields only".
   *
   * These live in component SIGNALS rather than in `campaignForm`, so the
   * `campaignForm.valueChanges` subscription that drives every other field here never sees them.
   * The parent destroys this component on a tab switch (`@switch`/`@case` in
   * `campaigns.component.html`), so without them a user who selects Conversions, enters a pixel,
   * turns off a placement or edits a geo chip, then glances at Insights, returns to Traffic and
   * the defaults — silently, and the eventual paid request changes with it.
   *
   * `placements` is a full object rather than a list of enabled keys: the "at least one enabled"
   * guard reads every member, and reconstructing the disabled half from an allow-list would
   * reintroduce the omission `META_SELECTABLE_PLACEMENTS` exists to prevent.
   *
   * OPTIONAL, because a draft persisted before this shipped has none of them. Absent means "this
   * draft predates Meta fields, keep the seeded values" — never "the user cleared them"; a
   * present-but-empty `pixelId` is what records a deliberate clear.
   */
  metaObjective?: MetaObjective;
  metaPlacements?: MetaPlacement;
  metaPixelId?: string;
  metaGeoTargets?: string[];
  /**
   * The Meta budget and its mode, which `submit()` sends as `budgetUsd`/`lifetimeBudget`.
   *
   * Here for the same reason as the four above — signal-backed, so `campaignForm.valueChanges`
   * never sees them — and called out separately because this pair is the one whose loss is
   * measured in money: a silent revert puts the campaign back to $500/day, which is a spend
   * decision the operator did not make and the form does not show them re-making.
   */
  metaBudgetUsd?: number;
  metaLifetimeBudget?: boolean;
  /**
   * The LinkedIn budget pair, signal-backed for the same reason as the Meta block above:
   * `campaignForm.valueChanges` never sees them, so they reach the draft only because
   * `emitDraft` names them.
   *
   * The template binds `(input)` to `onLinkedInBudgetInput` and `(change)` to
   * `onLinkedInLifetimeBudgetChange`, so this pair is genuinely editable — an operator types a
   * figure the brief never recommended. Its loss is the money-shaped half of LFXV2-3315.
   */
  linkedInBudgetUsd?: number;
  linkedInLifetimeBudget?: boolean;
  /**
   * The Reddit budget (LFXV2-3315, which named exactly this field).
   *
   * Reddit is the platform with NO field on `campaignForm` at all, so every value it dispatches
   * lives in a signal. `onRedditBudgetInput` is the one Reddit control the template binds, which
   * makes this the one Reddit value a user can actually change — and before it was carried, a tab
   * switch reset a Reddit campaign to $500.
   *
   * WHAT IS DELIBERATELY ABSENT, and why, because the obvious next edit is to add it back:
   *
   * The brief-derived arrays — Reddit's variants, subreddits, interests, keywords and geos, plus
   * `linkedInVariants` and `metaVariants` — are NOT carried. They have no user mutation path: the
   * complete set of event bindings in the implementation tab's template contains no handler that
   * writes any of them, and `populateFromBrief` is now their ONLY writer — `applyDraft` has no
   * restore arm for any of the seven, which is precisely what this change removed. A draft that
   * carried them round-tripped the brief's own recommendation back to itself.
   *
   * That single-writer fact is the reason the exclusion is safe, so do not "restore" them here on
   * the assumption that `applyDraft` still writes them: re-adding them re-creates the bug below.
   *
   * Carrying them was also actively worse than not, which is the part that has to be measured
   * rather than argued, since the argument runs the wrong way twice:
   *
   *   - `applyDraft` restores on `!== undefined`, and an empty array IS defined. Carrying them
   *     therefore let a stale copy overwrite the brief's fresh seed on every remount. With the
   *     fields absent the restore does not look, and `populateFromBrief` re-seeds them from the
   *     brief the parent still holds.
   *   - "The seed is conditional, so a brief with no `redditCopy` re-seeds nothing and an
   *     unrestored value is gone" does not survive being run: with no `redditCopy` the seed
   *     leaves those arrays EMPTY, so the draft carried `[]` and there was no value to lose.
   *
   * If a real editor is added for any of them, it belongs back here — with a test that drives the
   * new binding rather than one that writes the signal and calls `emitDraft` by hand.
   */
  redditBudgetUsd?: number;
  /**
   * Microsoft's four editable controls (LFXV2-3312): budget, the geo chip list, the keyword list
   * and the optional CPC bid.
   *
   * `microsoftKeywords` and `microsoftGeoTargets` are ARRAYS carried here, which is the exception
   * to the "brief-derived arrays are deliberately absent" rule stated above — and the exception is
   * principled rather than convenient. That rule rests on those arrays having a SINGLE writer
   * (`populateFromBrief`), so a draft could only ever replay the brief's own seed back over
   * itself. These two have a real editor: the template binds add/remove handlers for both, so an
   * operator genuinely mutates them and the value exists nowhere but this component.
   *
   * That editability is also why losing them is not merely untidy. Microsoft is the platform
   * where an empty list is a SILENT failure rather than a validation error upstream: with no
   * keywords the campaign can never serve and cannot be activated, and with no geo targets
   * Microsoft serves it everywhere. A tab switch that reverted either would hand the operator a
   * campaign that looks configured and is not.
   *
   * OPTIONAL for the same reason as the Meta block: a draft persisted before this shipped has
   * none of them, and absent means "keep the seeded values" — never "the user cleared them". A
   * present-but-empty array records a deliberate clear, and `applyDraft` replays it verbatim
   * rather than refilling from the brief.
   *
   * The two arrays then DIVERGE on what an empty list means at submit time, which is worth stating
   * because they look symmetric:
   *
   * - `microsoftKeywords` empty BLOCKS the submit. There is no fallback — a campaign with no
   *   keywords can never serve.
   * - `microsoftGeoTargets` empty does NOT block on its own: `microsoftEffectiveGeoTargets` falls
   *   back to the form's country code, and the section renders that fallback explicitly. Submit is
   *   blocked only when that fallback is empty too, i.e. nothing usable was supplied anywhere.
   */
  microsoftBudgetUsd?: number;
  microsoftGeoTargets?: string[];
  microsoftKeywords?: MicrosoftKeyword[];
  /** Empty string records "unset", which is the serve-capable default — see `cpcBid`. */
  microsoftCpcBid?: string;
}

/**
 * What `GET /api/campaigns/brief` reports back — the read half of brief persistence.
 *
 * The outcome is a single `status` rather than the `enabled` + payload pair
 * `CampaignBriefPersistResult` uses, because there are FOUR outcomes here and only two of them
 * are "no brief". Collapsing them loses the distinction that matters:
 *
 * - `off` — the cutover flag is not set. Nothing was looked up. An ordinary deployment state,
 *   not a fault, and warrants no UI.
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
   * The ETag of the row this read observed, carried so a save can send it as `If-Match`.
   *
   * This is the LAST-SEEN validator, and carrying it is the whole point: `replaceBrief` prefers
   * a caller-supplied ETag over the one its own find reads, so a validator from here produces a
   * 412 when another writer moved the row since this page loaded it. Re-reading at save time
   * cannot do that -- the find runs inside the save, so its validator always matches.
   *
   * Guaranteed `null` on `off` and `none` — nothing was read, so there is no validator to
   * report. `loaded` and `unreadable` both carry whatever the read observed, which may itself
   * be `null` when the response had no ETag header. `unreadable` carries one deliberately: the
   * row exists and was observed, it simply could not be mapped back, so its validator is as
   * real as a loaded one.
   *
   * Null is NOT permission to overwrite: it is an absent validator, and what a caller may do
   * without one is decided by the `absence` it records alongside, never by the null itself.
   */
  etag: string | null;
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

/**
 * The audience build's lifecycle, closed because upstream declares it closed:
 * `Enum("building", "built", "failed")` in campaign-service's `design/audience.go`.
 *
 * A union rather than `string` because six sites branch on these literals across two files, and
 * `canStageEmail` admits ONLY `built` -- a typo in any branch would silently mean "not built" and
 * disable staging with no error.
 */
export type CampaignAudienceStatus = 'building' | 'built' | 'failed';

/**
 * A brief's built send audience, as campaign-service returns it.
 *
 * The email channel CANNOT dispatch until this exists: `HubSpotDispatcher` resolves the brief's
 * built audience by `brief.ID` (`hubspot.go:293`) rather than reading anything off the create
 * request. That is why the audience is not part of `hubspotConfig`.
 *
 * `inclusionSummary` is human-readable provenance ("how this audience was built") — what an
 * operator checks before sending to a list they did not assemble by hand.
 */
export interface CampaignAudience {
  id: string;
  projectId: string;
  briefId: string;
  platform: string;
  platformMasterListId?: string;
  suppressionListIds?: string[];
  inclusionSummary?: string;
  status: CampaignAudienceStatus;
  version: number;
  etag?: string;
}

/** Result of asking campaign-service to build a brief's audience. */
export interface BuildAudienceResult {
  enabled: boolean;
  audience?: CampaignAudience;
  error?: string;
}

/**
 * AI-generated email copy for a brief, as campaign-service returns it.
 *
 * Mirrors the upstream `email-copy` type exactly (subject / preheader / body / cta) rather than
 * reshaping it here: the BFF is a thin proxy, and a divergent local shape would have to be kept
 * in step with a contract this layer does not own.
 *
 * `body` is a single HTML string, not a section list — upstream generates it that way. The UI
 * renders it as one block.
 */
export interface EmailBriefCopy {
  subject: string;
  preheader: string;
  body: string;
  cta: string;
}

/**
 * Result of asking campaign-service to generate email copy.
 *
 * `enabled: false` mirrors the other campaign-service reads: the cutover flag being off is a
 * steady state, not a failure. `error` carries the upstream refusal — notably the 503 when no AI
 * model is configured, which is a deployment state rather than a bug.
 */
export interface GenerateEmailCopyResult {
  enabled: boolean;
  copy?: EmailBriefCopy;
  error?: string;
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

/**
 * Objectives deliberately withheld from the campaign objective selector.
 *
 * `leads` dispatches as a website-traffic campaign (see `META_OBJECTIVE_PARAMS`), so offering it
 * would label a traffic campaign "Leads". LFXV2-2665 builds instant-form support and removes it
 * from this union.
 *
 * Declared as a type so `SelectableMetaObjective` can be DERIVED rather than restated: a new member
 * of `MetaObjective` is then a compile error in `META_SELECTABLE_OBJECTIVES` unless it is named
 * here, instead of silently never rendering.
 */
export type HiddenMetaObjective = 'leads';

/** The objectives the selector may offer — every `MetaObjective` that is not deliberately hidden. */
export type SelectableMetaObjective = Exclude<MetaObjective, HiddenMetaObjective>;

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
// Microsoft Ads — Campaign Creation
// ---------------------------------------------------------------------------

/**
 * One positive Search keyword attached to the created ad group.
 *
 * `matchType` reuses the SAME PascalCase vocabulary as `CampaignKeyword.matchType`
 * ('Exact' | 'Phrase' | 'Broad') rather than Google's SCREAMING_CASE, matching
 * `microsoftKeywordConfig` upstream (`internal/dispatch/microsoft.go`). That is what lets the
 * brief's generated keywords feed this config without a translation step.
 */
export interface MicrosoftKeyword {
  text: string;
  matchType: CampaignKeyword['matchType'];
}

/**
 * Microsoft's per-platform config, typed to the FIVE fields `microsoftConfig` actually reads
 * (`internal/dispatch/microsoft.go:57-83`).
 *
 * Two of the five are load-bearing in the dispatcher's own words, and both failures are silent
 * at create time — which is why the UI blocks the submit rather than letting the campaign be
 * created and discovered broken later:
 *
 * - `keywords` — "Left empty, the campaign is created but can NEVER SERVE, and ToggleStatus
 *   refuses to activate it". Activation returns `ErrCampaignNotProvisioned` LOCALLY, without
 *   calling Microsoft, so the operator only finds out at launch.
 * - `geoTargets` — "Left EMPTY … Microsoft serves it EVERYWHERE once enabled". Uncontrolled
 *   spend, the same hazard Meta's section already guards.
 *
 * `budgetUsd` carries the legacy request's name here and is renamed to the `budget` key the
 * dispatcher reads by `buildMicrosoftConfig` — the same translation `buildMetaConfig` performs,
 * and for the same reason: passing it through unchanged leaves `budget` at its zero value, which
 * the client rejects during dispatch.
 *
 * KNOWN GAP (LFXV2-3251, shared with Google Ads and Meta): the budget is whole units of the ad
 * ACCOUNT's currency with no FX conversion, and it is a DAILY budget with no lifetime
 * alternative — unlike Meta and LinkedIn, which is why there is no `lifetimeBudget` here.
 */
export interface MicrosoftCampaignCreateRequest {
  eventName: string;
  eventSlug: string;
  registrationUrl: string;
  hsToken?: string;
  /** Daily budget, whole units of the account currency. Must be finite and > 0. */
  budgetUsd: number;
  // NO `startDate` / `endDate`, and their absence is deliberate rather than an oversight.
  //
  // `microsoftConfig` (`internal/dispatch/microsoft.go:57-83`) declares no scheduling fields, and
  // neither does the client's `CampaignInput` — unlike `metaConfig`, which carries and applies
  // both. A Microsoft campaign is therefore created with NO flight, and sending dates here would
  // put fields on the wire that `unmarshalPlatformConfig` silently discards, implying a schedule
  // the operator never gets.
  //
  // The campaign is created PAUSED, so nothing spends until a human enables it — but there is no
  // automatic stop, which is why the UI states this rather than hiding it. Upstream scheduling is
  // the fix; see the note on the implementation tab's Microsoft section.
  /** ISO 3166-1 alpha-2 codes. REQUIRED, >= 1 — see the interface note on uncontrolled spend. */
  geoTargets: string[];
  /** REQUIRED, >= 1 — see the interface note on unservable campaigns. */
  keywords: MicrosoftKeyword[];
  project?: string;
  /**
   * OPTIONAL ad-group max cost-per-click, whole units of the account currency. Omitted or zero
   * means unset, and Microsoft then applies the account-currency minimum — a documented,
   * serve-capable floor, so omitting it is safe.
   */
  cpcBid?: number;
  /**
   * OPTIONAL Microsoft `Campaign.TimeZone` enum value. Microsoft marks it deprecated but still
   * requires it on Add; the client supplies its default when empty.
   */
  timeZone?: string;
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
  /** See `CampaignBriefRequest.deliveryType`. Refine re-runs the same generators. */
  deliveryType?: CampaignDeliveryType;
  programType?: CampaignProgramType;
}

// ---------------------------------------------------------------------------
// Campaign Creation (Implementation Phase)
// ---------------------------------------------------------------------------

/**
 * The email channel's per-platform config, typed to what campaign-service's `hubspotConfig`
 * actually reads (`internal/dispatch/hubspot.go:47-56`) rather than to the legacy request shape
 * the ad platforms carry.
 *
 * The send list is deliberately NOT here: the dispatcher resolves the brief's BUILT audience by
 * `brief.ID` (`hubspot.go:293`), so passing one would be a second, divergent source of truth for
 * something the service already owns.
 */
export interface HubSpotCampaignCreateRequest {
  /**
   * The HubSpot marketing-email id to clone. REQUIRED upstream — there is no default template,
   * and `hubspot.go:281-283` refuses the dispatch when it is blank. Sourced from the template
   * picker that `searchHubSpotEmails` feeds.
   */
  sourceEmailId: string;
  /**
   * Optional override for the `utm_campaign` applied to the email's links. When unset the service
   * derives one from the deterministic email name, so links stay attributable either way — set it
   * only to roll several briefs' emails up to one campaign in reporting.
   */
  utmCampaign?: string;
  /**
   * Generated subject line to write onto the cloned draft (LFXV2-2775). Unset leaves the
   * template's own subject, which is what every campaign did before that shipped.
   */
  subject?: string;
  /**
   * Generated body HTML to write onto the cloned draft (LFXV2-2775).
   *
   * Applied upstream ONLY when the draft has exactly one rich-text widget — a template with
   * several (header blurb, body, footer note) is left alone rather than guessed at, because
   * writing the wrong widget destroys content the operator did not choose to replace. So sending
   * this is a request, not a guarantee; the dispatcher logs and moves on either way.
   *
   * There is no preheader counterpart: Marketing Emails v3 exposes no preheader property, so a
   * field here would report success while HubSpot ignored it.
   */
  bodyHtml?: string;
}

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
  /**
   * Widened to `CampaignAnyPlatform` — this is the ONE request where the email channel is a legal
   * platform, because it is the only one that dispatches. The planning/refine requests keep the
   * narrow `CampaignPlatform[]`: those drive ad-copy and keyword generation, which email does not
   * use, so accepting `hubspot` there would type-check a request the generators cannot serve.
   */
  platforms?: CampaignAnyPlatform[];
  linkedInConfig?: LinkedInCampaignCreateRequest;
  redditConfig?: RedditCampaignCreateRequest;
  metaConfig?: MetaCampaignCreateRequest;
  microsoftConfig?: MicrosoftCampaignCreateRequest;
  hubspotConfig?: HubSpotCampaignCreateRequest;
}

/**
 * The INTERNAL result of `CampaignServiceClient.createCampaigns` — not a wire shape.
 *
 * `POST /api/campaigns/create` never sends this. The controller translates it: `{ jobId }` on
 * success, `{ jobId: '', error }` on refusal, and on `enabled: false` it falls through to the
 * legacy path and answers with that path's response instead. `enabled` is a routing signal
 * between these two layers and is stripped before anything reaches the client, so a client coded
 * against it would read `undefined` forever.
 *
 * Deliberately NOT the legacy `{ jobId, result?, error? }` shape. The legacy path inline-waits up
 * to 45s and can return a finished `result`; campaign-service answers 202 with a job id and
 * nothing else, because dispatch is genuinely asynchronous there — the platforms are called by a
 * dispatcher the request does not wait for.
 *
 * `enabled: false` is a first-class outcome, not a failure: it is the steady state everywhere the
 * cutover is dark, and the caller must fall through to the legacy path rather than showing an
 * error.
 */
export interface CampaignServiceCreateResult {
  enabled: boolean;
  /** The campaign-service job id (a UUID). Poll it through the existing job-status route. */
  jobId: string | null;
  /**
   * Why the cutover could not be used for this request, when `enabled` is true but `jobId` is
   * null. Never a raw upstream error — the caller renders this.
   */
  error: string | null;
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
// HubSpot Email Templates
// ---------------------------------------------------------------------------

/**
 * One HubSpot marketing email, as the template picker lists it.
 *
 * `id` is the only field campaign-service guarantees, and it is the one that matters: it is what
 * `hubspotConfig.sourceEmailId` takes, and that field is REQUIRED with no default — staging an
 * email clones a template, so without a choice here the email channel cannot dispatch at all.
 *
 * `state` is worth rendering. A template can be a DRAFT, and cloning one is legitimate but worth
 * seeing first. Note it can never say ARCHIVED: HubSpot models archival as a separate flag rather
 * than a lifecycle state, and this search does not request archived rows, so they are absent from
 * the result entirely rather than present with a different `state`.
 *
 * `updatedAt` earns its place because two templates routinely share a name — the date is what
 * tells them apart. The service already returns the list most-recently-updated first.
 */
export interface HubSpotMarketingEmail {
  /**
   * Never empty in practice — the service declares it Required — but a row that somehow arrives
   * without one is not selectable, because this is the value `sourceEmailId` takes. Callers
   * should drop such a row rather than render it as a choice that cannot be made.
   */
  id: string;
  name?: string;
  subject?: string;
  state?: string;
  updatedAt?: string;
}

/**
 * What the template search returns.
 *
 * `enabled: false` is a first-class outcome rather than a failure, matching the other
 * campaign-service reads: it means **no HubSpot connection resolved for this project id**, which
 * is the steady state until someone connects one. The picker renders a "connect HubSpot" empty
 * state for it, not an error.
 *
 * It does NOT isolate "not connected yet". campaign-service reaches that typed 404 whenever the
 * connection row is absent, and a project id that does not exist has no row either — so a
 * mistyped slug produces the same answer as an unconfigured project. The empty state should name
 * the project it queried, so a typo is visible rather than reported as a missing integration.
 * A bad or undecryptable credential is a DIFFERENT status (400/500/503) and is not swallowed
 * here.
 *
 * **An empty query returns a BOUNDED first screen, not the whole portal.** campaign-service caps
 * an unfiltered listing at 500 because an empty needle matches every row, and it takes the first
 * N in SERVER order before sorting them — so the screen is "recent emails to pick from", NOT a
 * guarantee of the newest in the portal. `possiblyTruncated` says when that cap may have bitten,
 * because the wire result carries no pagination field and a capped 500 is byte-identical to a
 * complete 500.
 *
 * A FILTERED search is exempt from that 500-row cap — truncating one would report an email that
 * exists as absent — but it is NOT unbounded, which an earlier version of this comment claimed.
 * campaign-service walks at most `maxListPages = 200` and returns an error on exhausting them
 * rather than a partial list, so a filtered search is COMPLETE-OR-ERROR: it either matched across
 * every page or it failed. That is why `possiblyTruncated` is always false for one.
 *
 * The cost is latency: `q` never reaches HubSpot — its list endpoint cannot be queried by name or
 * subject — so campaign-service walks the pages and matches name-or-subject case-insensitively
 * in-process. On a large portal a typed query is a slow call, which is why the picker must
 * debounce rather than search per keystroke, and why callers should not assume unlimited
 * traversal time.
 */
export interface HubSpotEmailSearchResult {
  enabled: boolean;
  emails: HubSpotMarketingEmail[];
  /**
   * Whether this list may have been cut off by the unfiltered cap.
   *
   * True only for an EMPTY query that came back exactly at the cap — the one case where a
   * complete portal listing and a truncated first screen are indistinguishable on the wire.
   *
   * A filtered search is COMPLETE-OR-ERROR rather than truncatable: campaign-service's walk is
   * capped at 200 pages and returns an error on exhausting it, never a partial list. So this is
   * always false for a filtered search — not because the walk is unbounded, but because a partial
   * one fails instead of answering.
   *
   * The picker should say "showing the first 500 — type to search the rest" rather than
   * presenting the list as everything. NOT "the 500 most recent": the service takes the first 500
   * rows in server order and sorts them AFTER truncating, so the set is not the portal's newest
   * 500 and telling the user otherwise would be a second falsehood on top of the first.
   */
  possiblyTruncated: boolean;

  /** Why the search could not run, when `enabled` is true but the list is empty for a reason. */
  error: string | null;
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
// Campaign List (Query Service)
// ---------------------------------------------------------------------------

/**
 * A campaign as the platform's Query Service indexes it.
 *
 * Mirrors campaign-service's `CampaignDoc` (`internal/infrastructure/indexer/contract.go`)
 * field for field, in the SNAKE_CASE the index stores — this is a wire shape, not a UI model,
 * and renaming here would hide drift rather than absorb it.
 *
 * Read from Query Service rather than campaign-service deliberately: `docs/architecture.md` D5
 * and `docs/api-catalog.md` rule 3 give Query Service ownership of lists, and campaign-service
 * has no list endpoint by DESIGN. An earlier attempt to add one (campaign-service PR #117) was
 * withdrawn for exactly this reason — the absent route is a decision, not a gap.
 *
 * `platform_campaign_id` is optional because it is absent until the ad platform confirms the
 * create; a campaign row exists before its upstream id does.
 */
export interface CampaignIndexDoc {
  id: string;
  project_id: string;
  brief_id: string;
  platform: string;
  platform_campaign_id?: string;
  campaign_name: string;
  status: string;
  version: number;
  /**
   * The `If-Match` validator for a write against this campaign, DERIVED from `version`.
   *
   * Not an indexed field — the index stores `version` alone. campaign-service's ETag is exactly
   * `"<version>"`, quotes included (`briefETag`), so the server derives it once here rather than
   * leaving every caller to re-derive a wire format they would have to read Go source to learn.
   * A caller that quoted it differently would get a 412 that looks like a concurrent edit.
   */
  etag?: string;
}

/**
 * One campaign as the Optimize tab's row renders it: the indexed document plus what the UI has
 * CONFIRMED about it this session.
 *
 * `status` is not `campaign.status`. The index is asynchronous, so a row re-read moments after a
 * pause still reports the old status; showing that back to whoever just paused a campaign reads as
 * the pause having failed. The overlay wins when present, and it is only ever set from a confirmed
 * response.
 */
export interface CampaignRow {
  campaign: CampaignIndexDoc;
  /** What the row displays: this session's confirmed status, else the indexed one. */
  status: string;
  /**
   * What the row's button offers, derived from `status` via `campaignToggleAction`.
   *
   * Three states, not a boolean. A boolean can only say "Pause or Resume", and upstream has a
   * third answer: `pending`, `group_created` and `unconfirmed` are all refused by
   * `model.CampaignStatusToggleable`, so a two-state row files them under Resume and offers an
   * action that is guaranteed to 409. `unavailable` is that third answer, and any status this UI
   * has not seen falls into it rather than into a doomed button.
   */
  action: CampaignToggleAction;
  /**
   * Why the toggle is disabled — set for `unavailable` rows only, empty otherwise.
   *
   * Carried on the row rather than looked up in the template, so the reason is rendered from the
   * same `status` the action was derived from and the two cannot disagree.
   */
  unavailableReason: string;
  /**
   * Whether a 412 refused this row's validator and no re-read has yet proved it advanced.
   *
   * Distinct from `unavailable`, which is about what the row IS — its status, platform, or the
   * deployment's capability. This is about what this session KNOWS: the exact `If-Match` the next
   * click would send has already been rejected, so the click is a round trip to a certain 412
   * while the conflict banner is telling the operator to refresh first. It clears when a delivered
   * list shows this row's indexed etag has moved, per row rather than for the list.
   */
  conflicted: boolean;
  /**
   * The button's visible word, and the verb inside its accessible name.
   *
   * One field for both so speech input ("click Pause") keeps matching the visible text — the
   * accessible name CONTAINS this word rather than replacing it. Carried on the row rather than
   * ternaried in the template because there are now three cases, and a nested ternary in a
   * template is exactly the construct this repo forbids.
   */
  toggleLabel: string;
  /**
   * The button's `aria-describedby` value, or `null` when there is nothing to point at.
   *
   * Carried on the row rather than computed by a template method: templates may only read
   * signals, computed values and pipes (`docs/reviews/frontend-checklist.md` §4), and the method
   * form re-ran for every row on every change detection pass. Space-separated because
   * `aria-describedby` takes a LIST and a row can hold both an error and an unavailable reason.
   */
  describedBy: string | null;
}

/**
 * What a campaign row's toggle offers.
 *
 * `unavailable` is not "we do not know" — it is a positive statement that campaign-service will
 * refuse a run-state change for this status, which is why the row disables the button and states
 * a reason instead of hiding it.
 */
export type CampaignToggleAction = 'pause' | 'resume' | 'unavailable';

/**
 * What `GET /api/campaigns/list` reports back.
 *
 * `campaigns` is what the index currently holds for the brief. That is NOT the same as what
 * exists: indexing is asynchronous, so a campaign created seconds ago may not appear yet. The
 * caller must not read an empty list as "no campaigns were created" — the create job's own
 * per-platform results are the authority immediately after a create, and this read is for
 * later sessions. `possiblyStale` marks the window where the two can disagree.
 */
export interface CampaignListResult {
  campaigns: CampaignIndexDoc[];
  /**
   * True when the list may not yet reflect a very recent create.
   *
   * Set when the query succeeded but returned nothing, which is indistinguishable at this layer
   * from "indexed and genuinely empty". Reported rather than resolved because the caller knows
   * something this layer does not — whether it just created campaigns.
   */
  possiblyStale: boolean;
  /**
   * Whether THIS deployment can actually service a pause/resume.
   *
   * Returned with the list because the two routes are gated differently and the client cannot
   * infer it: `/list` is ungated (it reads the Query Service index), while the toggle route
   * refuses every UUID unless `LFX_CUTOVER_CAMPAIGN_SERVICE_STATUS_TOGGLE` is on. The chart now
   * ships that flag `"true"`, but the field is not therefore redundant: the flag is read per
   * request from the environment, so any deployment that overrides it — a values override, a
   * chart that has not rolled yet, local dev — still turns the toggle off underneath a client
   * that cannot see the change. Without this field such a deployment renders a row of buttons
   * whose every click fails, which reads to an operator as the campaign refusing to stop rather
   * than as a capability that was never switched on.
   *
   * A server fact, so it is reported by the server rather than mirrored into a client-side flag
   * that would drift from the deployment it describes.
   */
  statusToggleEnabled: boolean;
  /**
   * Whether THIS deployment can actually create a Demand Gen Google campaign.
   *
   * Same reasoning as `statusToggleEnabled`, for a different capability. Nothing in the create
   * request tells the client in advance, so without this field the Implementation tab offers a
   * Demand Gen checkbox whose every submission is refused.
   *
   * NOT the `LFX_CUTOVER_CAMPAIGN_SERVICE_DEMAND_GEN` flag, and the difference matters. That flag
   * gates the campaign-service create path only; while the CREATE/BRIEFS/JOBS cutover is dark the
   * legacy creator owns creation and makes Demand Gen campaigns regardless of it. So this is
   * `true` across the whole staged CREATE-off rollout, and `false` only in the narrow window
   * where campaign-service owns creation and has not been told it understands
   * `googleAdsConfig.channel`. See `canCreateDemandGen` in `campaign-service.service.ts`, which
   * is the authoritative computation — simplifying this back to the raw flag would hide a
   * working legacy option for the entire rollout.
   *
   * Worse than a plain dead end, because the two refusals disagree: selecting Search AND Demand
   * Gen is refused with "deselect one and create it", and following that advice lands on the
   * capability refusal saying Demand Gen is not available at all. The first message walks the
   * user into the second.
   *
   * Always present on a successful read, and never a fallback: an error produces no
   * `CampaignListResult` at all, so there is no arm of this type that means "we could not tell".
   * The client models that separately — it holds the capability as `boolean | null` and uses
   * `null` for unanswered or failed, because a false negative there would clear a user's saved
   * Demand Gen selection rather than merely withhold a control. Do not read this field's type as
   * licence to treat `false` as a safe default for "unknown"; `false` is a server statement that
   * the capability is off.
   */
  demandGenEnabled: boolean;
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
  /**
   * Parent brief, required by campaign-service's toggle route
   * (`PATCH /projects/{p}/briefs/{brief_id}/campaigns/{c}/status`).
   *
   * Optional on this type only because the legacy Meta/Reddit path did not need it. A request
   * without it cannot address the campaign-service endpoint at all, so the controller refuses it
   * rather than defaulting — see `updateCampaignStatus`.
   */
  briefId?: string;
  /**
   * The campaign row's current ETag, sent as `If-Match`.
   *
   * campaign-service answers a missing header with 428, so this is required in practice. It is
   * what makes a pause safe against a concurrent editor: a 412 means the row moved since the
   * caller read it, and the toggle is refused rather than dispatched to an ad platform on the
   * strength of a stale view.
   */
  etag?: string;
}

/**
 * Everything needed to address and authorize one status toggle.
 *
 * Named rather than inline because it is an app-facing contract: campaign-service addresses a
 * campaign by `(project, brief, campaign)` and gates the write on `If-Match`, so a caller that
 * gets any one of these wrong gets a 404, a 428 or a 412 rather than a type error. Every field
 * is required — there is nothing safe to default, which is the point.
 */
export interface CampaignStatusToggleParams {
  projectSlug: string;
  briefId: string;
  campaignId: string;
  platform: CampaignPlatform;
  status: CampaignToggleStatus;
  /** The etag read WITH the campaign, not one cached from an earlier render. */
  etag: string;
}

/**
 * A campaign row as campaign-service returns it.
 *
 * Mirrors the `Campaign` schema in the service's generated OpenAPI contract; `etag` mirrors
 * `version` and is what a subsequent toggle must send back as `If-Match`.
 */
export interface CampaignServiceCampaign {
  id: string;
  brief_id: string;
  project_id: string;
  platform: string;
  campaign_name: string;
  /** Absent until the ad platform confirms the create, so optional per the contract. */
  platform_campaign_id?: string;
  status: string;
  version: number;
  etag?: string;
}

export interface CampaignStatusUpdateResult {
  platform: CampaignPlatform;
  campaignId: string;
  /**
   * The status the campaign held BEFORE this toggle, as OBSERVED — never inferred.
   *
   * Present only on the legacy per-platform path, which issues a read before the write and can
   * therefore report a fact. campaign-service's toggle returns the post-toggle row alone, so on
   * that path there is nothing to observe and the field is OMITTED rather than guessed. Inferring
   * it as "the opposite of what was requested" would be wrong exactly where it matters most: a
   * `created_degraded` campaign is pausable, and its true prior status is `created_degraded`, not
   * `ACTIVE`. A caller wanting the prior state on that path must read the row before toggling.
   */
  previousStatus?: string;
  newStatus: CampaignToggleStatus;
  success: boolean;
  /**
   * The campaign row's NEW ETag, for chaining a follow-up toggle.
   *
   * Without it, pause-then-resume is impossible: the second call needs a fresh `If-Match`, and
   * the caller's own etag went stale the moment the first toggle committed. Absent on the legacy
   * per-platform path, which has no row and no version.
   */
  etag?: string;
  /**
   * The status the SERVICE reports after the toggle, which is not always the one requested.
   *
   * Pausing a `created_degraded` campaign pauses it upstream and deliberately leaves the row's
   * status unchanged, so `newStatus` — an echo of the request — would claim a transition the
   * service declined to record. Read this field to render actual state; read `newStatus` only as
   * "what was asked for". Absent on the legacy path, whose SDK calls return no row.
   */
  serviceStatus?: string;
}

/**
 * The reporting windows campaign-service accepts. Mirrors `metricsWindowEnum` in
 * `design/brief.go` — the seven values of `model.MetricsWindow`.
 *
 * An explicit window always wins, for EVERY row. Omit it and campaign-service picks the default
 * per row, per platform — `last_7_days` for X Ads, whose stats endpoint caps a query at 7 days,
 * and `last_30_days` for everything else.
 *
 * That fallback applies ONLY to an omitted window. An explicit window a platform cannot serve is
 * not silently narrowed: on the single-campaign read it is a 400, and on the brief-wide read it
 * comes back as that row's `status: 'unsupported'` while the other rows still report.
 */
export type CampaignMetricsWindow = (typeof CAMPAIGN_METRICS_WINDOWS)[number];

/**
 * Whether a row in a brief-wide metrics read carries a measurement. ONLY `ok` does.
 *
 * Mirrors `briefMetricsRowStatusEnum`. The values are the failure modes the single-campaign
 * endpoint expresses as distinct HTTP responses, which an aggregate cannot do — one campaign's
 * 409 must not fail the other five:
 *
 * - `ok` — the read succeeded.
 * - `unsupported` — no metrics dispatcher for the platform, or the window is unservable there.
 *   Retrying is pointless; a narrower window may help.
 * - `not_ready` — no platform campaign id yet, or no data for the window. Common and benign: a
 *   staged email draft reads this way until a human sends it. NOT a failure to surface as one.
 * - `connection_problem` — the connection cannot serve this campaign. An operator repairs it;
 *   retrying never helps.
 * - `failed` — the platform read itself failed. Transient; retrying may succeed.
 */
export type BriefMetricsRowStatus = 'ok' | 'unsupported' | 'not_ready' | 'connection_problem' | 'failed';

/**
 * The pacing band `pct` falls into. `unknown` means no pacing could be derived — NOT "on plan".
 *
 * `CampaignService*` prefixed, matching its siblings here, because it is the ONLY five-member
 * variant: `PacingLabel`, `MetaPacingLabel`, `LinkedInPacingLabel` and `RedditPacingLabel` are
 * all four-member BFF types with no `unknown`. Under the generic `Campaign` name this is the one
 * a reader grabs by mistake, and `unknown` is precisely the member whose absence causes a
 * non-computable pacing to be rendered as a number.
 */
export type CampaignServicePacingLabel = 'underspending' | 'normal' | 'constrained' | 'overspending' | 'unknown';

/** Email-channel counters. Present only for the email channel (HubSpot); absent for ad platforms. */
export interface CampaignServiceEmailMetrics {
  sent: number;
  delivered: number;
  opens: number;
  clicks: number;
  bounces: number;
  unsubscribes: number;
}

/** One campaign's measurement, as campaign-service reports it. */
export interface CampaignServiceCampaignMetrics {
  campaign_id: string;
  platform_campaign_id: string;
  window: CampaignMetricsWindow;
  /** Impressions over the window on an ad platform; opens to date on the email channel. */
  impressions: number;
  clicks: number;
  /**
   * Cost in MICRO-UNITS of the platform's OWN native currency — USD for LinkedIn/Reddit, X's
   * billing unit for Twitter. campaign-service performs no FX conversion, so these must never be
   * summed across platforms: the result would carry no currency and no meaning. Always 0 on the
   * email channel, which bills no per-send cost; do not blend that 0 into a cross-channel CPA.
   */
  cost_micros: number;
  /** Clicks/Impressions, 0 when impressions is 0. */
  ctr: number;
  /**
   * Conversions attributed to this campaign over the window.
   *
   * FRACTIONAL, and deliberately not an integer: Google Ads and Microsoft both type this as a
   * double and credit PARTIAL conversions under data-driven, position-based and offline
   * attribution, so 0.4 of a conversion is a real value. Do not round it, and in particular do
   * not treat a value below 1 as zero.
   *
   * ABSENT means "not measured here", which is NOT a measured 0. Meta, X, Reddit and the email
   * channel never report a campaign-level conversion count, and Microsoft omits it whenever the
   * ConversionsQualified column is missing or any row's cell is blank — that column is only
   * populated for accounts wired for Universal Event Tracking, and a partial column summed as
   * though it were complete would understate the campaign. So a consumer must not render an
   * absent value as zero or fold it into a conversion total.
   */
  conversions?: number;
  email?: CampaignServiceEmailMetrics;
}

/** Spend against the flight-prorated plan, for ONE campaign. Never total or average across rows. */
export interface CampaignServicePacing {
  /**
   * Spend as a percentage of what this campaign should have spent BY NOW.
   *
   * ABSENT when pacing is not computable — never zero-filled, because 0% is a claim about spend.
   * Read `label === 'unknown'` for that case rather than defaulting this to 0.
   */
  pct?: number;
  label: CampaignServicePacingLabel;
}

/**
 * One campaign's slot in a brief-wide metrics read.
 *
 * Every campaign on the brief gets a row, INCLUDING ones that could not be read — that is the
 * point of the type. `metrics` is present if and only if `status === 'ok'`, and absent otherwise
 * rather than zero-filled, so a consumer can tell "measured zero" from "could not measure". A
 * zero-filled row is the exact substitution that turns a failed read into a performance result.
 */
export interface BriefMetricsRow {
  campaign_id: string;
  /**
   * `string`, not `CampaignPlatform`: upstream's platform enum includes `hubspot` (the email
   * channel) alongside the six ad channels, and `CampaignPlatform` has no member for it. The
   * union would be wrong here rather than merely loose.
   */
  platform: string;
  status: BriefMetricsRowStatus;
  /** Present if and ONLY if `status` is `ok`. Never zero-filled — a zero is a claim. */
  metrics?: CampaignServiceCampaignMetrics;
  /** Why this row carries no measurement, in consumer-safe wording. Absent when `status` is `ok`. */
  reason?: string;
  /** Absent unless `status` is `ok`. On an `ok` row it is always present. */
  pacing?: CampaignServicePacing;
}

/**
 * How urgently an action item wants attention.
 *
 * Deliberately TWO members where the four BFF siblings (`ActionPriority`, `MetaActionPriority`,
 * `LinkedInActionPriority`, `RedditActionPriority`) carry three: campaign-service emits only
 * HIGH and MED, so a `'LOW'` here would declare a value the endpoint cannot return. Named rather
 * than inlined so the narrowing reads as intentional instead of as an omission.
 */
export type BriefMetricsActionPriority = 'HIGH' | 'MED';

/**
 * One thing an operator should look at, derived by campaign-service from the readable rows.
 *
 * `rule` is a STABLE TOKEN — group, filter or link on it. `issue` and `action` are for humans and
 * may be reworded, so keying on that prose would break silently when it is.
 *
 * Distinct from the BFF's own `CampaignActionItem`, which four platform services derive
 * independently and which disagree with each other and with this one on CTR thresholds,
 * impression floors and how paused campaigns are treated. This is the single-source version.
 */
export interface BriefMetricsActionItem {
  rule: 'zero_delivery' | 'underspending' | 'budget_constrained' | 'low_ctr' | 'no_conversions';
  priority: BriefMetricsActionPriority;
  campaign_id: string;
  /** `string` for the same reason as `BriefMetricsRow.platform` — `hubspot` is in scope. */
  platform: string;
  issue: string;
  action: string;
}

/**
 * A brief-wide metrics read: `GET /projects/{projectId}/briefs/{briefId}/metrics`.
 *
 * There is deliberately NO cross-channel cost total — see `cost_micros`. Impressions and clicks
 * are unitless and could be summed, but campaign-service leaves that to the consumer alongside
 * `ok_count` rather than presenting a whole-brief figure the row set may not support.
 */
export interface BriefMetrics {
  brief_id: string;
  /**
   * The window REQUESTED for this read. Per-platform defaults still apply when it is omitted, so
   * an individual row may cover a NARROWER window than this — each row's own `metrics.window`
   * records what that row actually covers.
   */
  window: CampaignMetricsWindow;
  /** One row per campaign on the brief, in a stable order. Includes rows that could not be read. */
  rows: BriefMetricsRow[];
  /**
   * How many rows carry a measurement. Compare against `rows.length` before presenting ANY
   * cross-campaign total — a total over 2 of 6 campaigns is not the brief's performance.
   */
  ok_count: number;
  /**
   * What an operator should look at, derived from the READABLE rows.
   *
   * Empty means nothing was flagged among those rows. It is NOT a claim that every row was
   * readable — unreadable rows raise no items — so check `ok_count` against `rows.length` before
   * rendering an empty list as an all-clear.
   */
  action_items: BriefMetricsActionItem[];
}

/**
 * The event-lifecycle stage an email belongs to, as campaign-service enumerates it.
 *
 * Closed because upstream's `generate-email-copy` declares it closed: an unrecognised value is
 * refused with a 400 naming the valid ones, so a typo cannot quietly become registration copy.
 */
export type CampaignEmailStage = 'CFP Launch' | 'Schedule Announcement' | 'Registration Push' | 'Discount Offer' | 'Final Countdown' | 'Post-Event';

/**
 * One selectable email type.
 *
 * The TYPE is what an operator recognises ("Thank You + Survey"); the STAGE is what
 * campaign-service generates from. Several types map to one stage -- a CFP launch and a
 * co-located CFP reminder are both CFP Launch -- which is why these are two fields rather than
 * one. `keywords` rank clone templates (#1942); they live here so the taxonomy has a single home.
 */
export interface CampaignEmailTypeOption {
  id: string;
  label: string;
  stage: CampaignEmailStage;
  keywords: readonly string[];
}
