// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe, SlicePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, effect, inject, input, OnInit, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
  TouchedChangeEvent,
} from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { AutocompleteComponent } from '@components/autocomplete/autocomplete.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  CAMPAIGN_BIDDING_CREATE_PLATFORMS,
  CAMPAIGN_BIDDING_PLATFORMS,
  CAMPAIGN_BIDDING_RULES,
  CAMPAIGN_BUDGET_DEFAULTS,
  CAMPAIGN_CHAR_LIMITS,
  CAMPAIGN_JOB_POLL_INTERVAL_MS,
  CREATIVE_ASSET_MAX_BYTES,
  CREATIVE_ASSET_MIME_TYPES,
  CREATIVE_ASSET_TOO_LARGE_MESSAGE,
  CREATIVE_ASSET_WRONG_TYPE_MESSAGE,
  isCreativeAssetMimeType,
  LINKEDIN_CHAR_LIMITS,
  LINKEDIN_GEO_RESOLVE_MAP,
  LINKEDIN_IMAGE_MAX_BYTES,
  TWITTER_IMAGE_MAX_BYTES,
  TWITTER_IMAGE_TOO_LARGE_MESSAGE,
  TWITTER_MAX_BUDGET,
  TWITTER_MAX_TWEET_WEIGHTED_CHARS,
  LINKEDIN_IMAGE_TOO_LARGE_MESSAGE,
  META_CHAR_LIMITS,
  META_DEFAULT_PLACEMENTS,
  META_MESSENGER_INBOX_RETIRED_REASON,
  META_DSA_NAME_MAX_LENGTH,
  META_DSA_TERRITORIES,
  META_NUMERIC_ID_PATTERN,
  canonicalMicrosoftMatchType,
  isMicrosoftMatchType,
  MICROSOFT_CONTROL_CHAR_RE,
  MICROSOFT_IMAGE_MAX_BYTES,
  MICROSOFT_IMAGE_PIXEL_BOUNDS,
  MICROSOFT_IMAGE_TOO_LARGE_MESSAGE,
  MICROSOFT_MAX_BUDGET,
  MICROSOFT_MAX_CPC_BID,
  MICROSOFT_MAX_GEO_TARGETS,
  MICROSOFT_MAX_KEYWORDS,
  MICROSOFT_MAX_KEYWORD_TEXT_LENGTH,
  MICROSOFT_NEW_KEYWORD_MATCH_TYPE,
  MICROSOFT_MIN_CPC_BID,
  META_OBJECTIVE_LABELS,
  META_SELECTABLE_OBJECTIVES,
  META_PLACEMENT_LABELS,
  META_SELECTABLE_PLACEMENTS,
  META_INELIGIBLE_COUNTRIES,
  normalizeGeoTargets,
  normalizeMicrosoftGeoTargets,
  CAMPAIGN_PLATFORMS,
  GOOGLE_ADS_BIDDING_BOUNDS,
  GOOGLE_ADS_CONVERSION_ACTION_PATTERN,
  GOOGLE_ADS_DECIMAL_NUMBER_PATTERN,
  GOOGLE_ADS_GEO_SEARCH_BOUNDS,
  GOOGLE_ADS_GEO_SEARCH_DEBOUNCE_MS,
  GOOGLE_ADS_GEO_SEARCH_PICKER_LIMIT,
  GOOGLE_ADS_GEO_TARGET_ID_PATTERN,
  GOOGLE_ADS_GEO_TARGET_MAP,
  GOOGLE_ADS_CUSTOM_AUDIENCE_RESOURCE_PATTERN,
  GOOGLE_ADS_LANGUAGE_LABELS,
  GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS,
  GOOGLE_ADS_MAX_CALL_EXTENSIONS,
  GOOGLE_ADS_MAX_CALLOUTS,
  GOOGLE_ADS_MAX_CALLOUT_TEXT_RUNES,
  GOOGLE_ADS_MAX_CONVERSION_ACTIONS,
  GOOGLE_ADS_MAX_GEO_TARGETS,
  GOOGLE_ADS_MAX_LANGUAGES,
  GOOGLE_ADS_MAX_PRICE_EXTENSIONS,
  GOOGLE_ADS_MAX_PRICE_OFFERINGS,
  GOOGLE_ADS_MAX_PROMOTIONS,
  GOOGLE_ADS_MAX_PROXIMITY_TARGETS,
  GOOGLE_ADS_MAX_RADIUS,
  GOOGLE_ADS_MAX_SITELINKS,
  GOOGLE_ADS_MAX_FINAL_URL_BYTES,
  GOOGLE_ADS_MAX_SITELINK_DESCRIPTION_RUNES,
  GOOGLE_ADS_MAX_SITELINK_TEXT_RUNES,
  GOOGLE_ADS_MAX_SNIPPET_HEADER_RUNES,
  GOOGLE_ADS_MAX_SNIPPET_VALUE_RUNES,
  GOOGLE_ADS_MAX_SNIPPET_VALUES,
  GOOGLE_ADS_MAX_STRUCTURED_SNIPPETS,
  GOOGLE_ADS_MIN_PRICE_OFFERINGS,
  GOOGLE_ADS_MIN_SNIPPET_VALUES,
  GOOGLE_ADS_POSTAL_GEO_ID_MIN_DIGITS,
  GOOGLE_ADS_PRICE_QUALIFIERS,
  GOOGLE_ADS_PRICE_TYPES,
  GOOGLE_ADS_PRICE_UNITS,
  GOOGLE_ADS_RADIUS_UNITS,
  GOOGLE_ADS_USER_LIST_RESOURCE_PATTERN,
  GOOGLE_BIDDING_CPA_STRATEGIES,
  GOOGLE_BIDDING_DEFAULT_BY_CHANNEL,
  GOOGLE_BIDDING_ROAS_STRATEGIES,
  GOOGLE_BIDDING_TARGET_REQUIRED_STRATEGIES,
  GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL,
  GOOGLE_BIDDING_STRATEGY_LABELS,
  GOOGLE_ADS_CHANNEL_TYPE_ENUMS,
  GOOGLE_ASSET_PLAN_SLOT_CONTROLS,
  GOOGLE_CAMPAIGN_CHANNEL_LABELS,
  GOOGLE_CAMPAIGN_CHANNELS_REQUIRING_FLAG,
  GOOGLE_CAMPAIGN_NAME_TOKENS,
  GOOGLE_CHANNELS_WITH_AD_EXTENSIONS,
  GOOGLE_CHANNELS_WITH_AUDIENCE_SEGMENTS,
  GOOGLE_CHANNELS_WITH_CREATIVE,
  GOOGLE_CHANNELS_WITH_LANGUAGES,
  GOOGLE_CHANNELS_WITH_PROXIMITY,
  GOOGLE_CONVERSION_ACTION_CHANNELS,
  GOOGLE_CREATIVE_EITHER_OR_RULES,
  GOOGLE_CREATIVE_FIELD_SPECS,
  GOOGLE_CREATIVE_IMAGE_MAX_BYTES,
  GOOGLE_CREATIVE_REQUEST_KEYS,
  GOOGLE_CREATIVE_REQUIRED_NOTICE,
  GOOGLE_CREATIVE_SECTION_TITLES,
  GOOGLE_PERFORMANCE_MAX_PREFILL_NOTICE,
  GOOGLE_PERFORMANCE_MAX_SHORT_DESCRIPTION_WIDTH,
  GOOGLE_VIDEO_CREATE_SUPPORTED,
  GOOGLE_VIDEO_CREATE_UNSUPPORTED_REASON,
  DEFAULT_LINKEDIN_BUDGET_USD,
  DEFAULT_LINKEDIN_TARGETING_PROFILE,
  DEFAULT_META_BUDGET_USD,
  DEFAULT_META_OBJECTIVE,
  DEFAULT_MICROSOFT_BUDGET_USD,
  DEFAULT_REDDIT_BUDGET_USD,
  DEFAULT_REDDIT_CALL_TO_ACTION,
  DEFAULT_REDDIT_OBJECTIVE,
  REDDIT_CALL_TO_ACTIONS,
  REDDIT_MAX_BUDGET_USD,
  REDDIT_OBJECTIVE_LABELS,
  REDDIT_SELECTABLE_OBJECTIVES,
  REDDIT_VIDEO_GOAL_LABELS,
  REDDIT_VIDEO_GOALS,
  googleAdsToLower,
  googleAdsTrimSpace,
  isCanonicalGoogleAdsResourceId,
  isGoogleAdsServableUrl,
} from '@lfx-one/shared/constants';
import { CampaignService } from '@services/campaign.service';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { ProjectContextService } from '@services/project-context.service';
import { serverAuthoredMessage } from '@shared/utils/http-error.utils';
import { catchError, filter, from, map, merge, Observable, of, scan, skip, startWith, Subscription, switchMap, take, timer } from 'rxjs';

import type { Signal } from '@angular/core';
import type {
  CampaignBiddingCapabilityBlock,
  CampaignBiddingConfig,
  CampaignBiddingContext,
  CampaignBiddingControlView,
  CampaignBiddingDraft,
  CampaignBiddingDrafts,
  CampaignBiddingPlatform,
  CampaignBriefOutput,
  CampaignBriefPersistenceState,
  CampaignCapabilityReadState,
  CampaignCreateRequest,
  CampaignCreateResult,
  CampaignGoogleAudienceSegmentsBlock,
  CampaignGoogleExtensionsCapabilityBlock,
  CampaignGoogleLocationsCapabilityBlock,
  CampaignImplementationDraft,
  CampaignJobOutcome,
  CampaignKeyword,
  CampaignPlatform,
  CampaignPlatformResult,
  CampaignGoogleImageAssetBlock,
  CampaignLinkedInImageAssetBlock,
  CampaignTwitterAccountState,
  CampaignTwitterDraft,
  CampaignTwitterCreateBlock,
  CampaignTwitterImageAssetBlock,
  TwitterCampaignCreateRequest,
  CampaignMetaImageAssetBlock,
  CampaignMicrosoftImageAssetBlock,
  CampaignProximityTarget,
  CampaignProximityTargetDraft,
  CampaignRedditImageAssetBlock,
  CampaignCallExtension,
  CampaignCallExtensionDraft,
  CampaignPriceExtension,
  CampaignPriceExtensionDraft,
  CampaignPriceOfferingDraft,
  CampaignPromotion,
  CampaignPromotionDraft,
  CampaignSitelink,
  CampaignStructuredSnippet,
  CampaignStructuredSnippetDraft,
  CampaignType,
  CreativeAssetLibraryState,
  CreativeAssetUploadResult,
  CreativeAssetUploadStatus,
  CreativeSlotAssignment,
  GoogleAdsGeoTargetOption,
  GoogleAdsGeoTargetSearchState,
  GoogleAdsGeoTargetSuggestion,
  GoogleAdsRadiusUnit,
  GoogleBiddingOption,
  GoogleBiddingStrategy,
  GoogleCampaignChannel,
  GoogleCreativeChannel,
  GoogleCreativeEitherOrRule,
  GoogleCreativeFieldSpec,
  GoogleCreativeHeldImage,
  GoogleCreativeImageRef,
  GoogleCreativeImageShape,
  GoogleCreativeImageSlotView,
  GoogleCreativeSection,
  LinkedInAccount,
  LinkedInCreativeVariant,
  LinkedInGeoTarget,
  LinkedInTargetingProfile,
  MetaAdVariant,
  MetaCampaignCreateRequest,
  MetaObjective,
  MetaPlacement,
  MicrosoftKeyword,
  RedditAdVariant,
  RedditCallToAction,
  RedditObjective,
  RedditVideoGoal,
  StoredCreativeAsset,
} from '@lfx-one/shared/interfaces';
import {
  campaignBiddingError,
  campaignBiddingPayload,
  codePointLength,
  defaultCampaignBiddingDraft,
  describeCampaignDispatchFailure,
  googleAdsToUpperCode,
  googleCallExtensionRefusal,
  googleCreativeImageDrift,
  googleCreativeImageFit,
  googleCreativeImageRequirement,
  googlePriceExtensionRefusal,
  googlePromotionRefusal,
  storedCreativeAssetLabel,
  twitterComposedTweetLength,
  twitterStartDateTooSoon,
  twitterTweetTextError,
} from '@lfx-one/shared/utils';

import { CampaignBiddingControlComponent } from '../campaign-bidding-control/campaign-bidding-control.component';
import { CreativeLibraryUploadComponent } from '../creative-library-upload/creative-library-upload.component';
import { CreativeSlotGridComponent } from '../creative-slot-grid/creative-slot-grid.component';
import { GoogleCreativeImageLibraryComponent } from '../google-creative-image-library/google-creative-image-library.component';

type ImplementationStep = 'form' | 'creating' | 'results';

/**
 * One campaign-service platform result paired with the outcome the row renders, and the
 * operator-facing reading of its `error` (`describeCampaignDispatchFailure`).
 *
 * A local intersection rather than a `@lfx-one/shared` interface: it is this component's view
 * model, derived from `CampaignPlatformResult` and consumed only by this template, so it is not
 * part of any contract between the tiers. Two repo rules meet here and an intersection is the
 * only form satisfying both — AGENTS.md's "all shared constants and interfaces live in `@lfx-one/shared`" rule prohibits the local `interface Foo {}` form inside
 * `apps/lfx-one/`, while ESLint's `@typescript-eslint/consistent-type-definitions` rejects a
 * plain `type X = { … }` object literal.
 */
type PlatformResultRow = CampaignPlatformResult & {
  outcome: 'created' | 'orphaned' | 'nothing-created' | 'unconfirmed';
  displayError: string | null;
  nextStep: string | null;
};

/** See `ImplementationTabComponent.platformOutcomes` for why `ok` alone is not the test. */
function toPlatformResultRow(result: CampaignPlatformResult): PlatformResultRow {
  const failure = result.error ? describeCampaignDispatchFailure(result.error) : null;
  const displayError = failure?.message ?? result.error ?? null;
  // Pre-create rows only: an id-bearing row has a campaign upstream, and "create again" there is
  // the duplicate-spend move this panel exists to prevent.
  const nextStep = !result.ok && !result.campaignId ? (failure?.nextStep ?? null) : null;
  if (result.ok) {
    return { ...result, outcome: 'created', displayError, nextStep };
  }
  if (result.campaignId) {
    return { ...result, outcome: 'orphaned', displayError, nextStep };
  }
  return { ...result, outcome: failure?.nothingCreated ? 'nothing-created' : 'unconfirmed', displayError, nextStep };
}

@Component({
  selector: 'lfx-implementation-tab',
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    AutocompleteComponent,
    InputTextComponent,
    SelectComponent,
    TextareaComponent,
    LowerCasePipe,
    SlicePipe,
    CampaignBiddingControlComponent,
    CreativeLibraryUploadComponent,
    CreativeSlotGridComponent,
    GoogleCreativeImageLibraryComponent,
  ],
  templateUrl: './implementation-tab.component.html',
  styleUrl: './implementation-tab.component.scss',
})
export class ImplementationTabComponent implements OnInit {
  // === Services ===
  private readonly campaignService = inject(CampaignService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly briefData = input<CampaignBriefOutput | null>(null);

  /**
   * Whether the brief this tab is configuring has been saved.
   *
   * Rendered here rather than on the Planning tab because this is where the user spends the
   * next stretch of work — a "not saved" warning is only useful in front of the person about to
   * lose something. The default is the `off` state, which renders nothing at all.
   */
  public readonly briefPersistence = input<CampaignBriefPersistenceState>({ status: 'off', briefId: null, message: null, approved: false });

  /**
   * Is a brief save running right now?
   *
   * Separate from `briefPersistence` because that input drives a BANNER, and the first save of a
   * session deliberately shows none — the persistence flag lives on the server, so it is unknown
   * until that first response lands. Its status therefore reads `off` while the save is in
   * flight, which is indistinguishable from "the cutover is dark".
   *
   * The difference matters here and nowhere else: a create issued during that window carries an
   * empty brief id and is TERMINALLY refused with the cutover on. Defaults to false so the input
   * is additive.
   */
  public readonly briefSaveInFlight = input(false);

  /**
   * Edits carried over from a previous mount, or `null` on a first visit (LFXV2-3229).
   *
   * This component sits inside a structural `@switch`, so every trip to another tab destroys it
   * and everything it holds. Keeping it mounted the way LFXV2-3202 (PR #1437, pending) proposes keeping the planner mounted is
   * the wrong fix here — `ngOnInit` resolves the LinkedIn ad-account list, so an eager mount would issue that
   * request on every page load for a tab the user may never open. The parent holds the edits
   * instead, and this component is still free to be destroyed.
   */
  public readonly draft = input<CampaignImplementationDraft | null>(null);

  /**
   * The HubSpot marketing-email id chosen in the email template picker, or '' when none is.
   *
   * Threaded through so the picker's selection reaches `hubspotConfig.sourceEmailId` on create.
   * Until now `selectedEmailTemplateId` was write-only — set by the picker, read only for
   * `aria-pressed` and row styling — so the choice never left the parent component.
   *
   * **This input is not yet reachable from the email UI.** The picker lives in the parent's Email
   * container and this component renders only under Paid Marketing (`[style.display]` keyed on
   * `isEmail()`), and its own `selectedPlatforms` is typed `CampaignPlatform[]`, which by
   * construction excludes `'hubspot'` — only the wider `CampaignAnyPlatform` on the request
   * admits it. There is therefore no email create trigger anywhere in the app today. The wiring
   * below is the seam: it carries the value correctly the moment a trigger binds this input, and
   * costs nothing while nothing does.
   */
  public readonly sourceEmailId = input<string>('');

  /**
   * Whether this deployment can create a Demand Gen Google campaign — `null` while unknown.
   *
   * THREE states, not two, and the distinction is load-bearing. `false` means the server said the
   * capability is off; `null` means nothing has answered yet. Collapsing them makes the pre-load
   * state indistinguishable from an explicit refusal, and `applyDraft` below would then rewrite a
   * user's saved Demand Gen selection to `false` on a restore that merely raced the answer — a
   * destructive edit to persisted state, from a value that was never a server fact.
   *
   * The control is withheld while `null` (offering one that may not submit is worse than a brief
   * absence), but the DRAFT is preserved: hiding is reversible, and clearing is not.
   */
  public readonly demandGenEnabled = input<boolean | null>(null);

  /** Render the control only on an explicit yes. `null` (unknown) withholds it. */
  protected readonly demandGenAvailable = computed<boolean>(() => this.demandGenEnabled() === true);

  /**
   * Whether this deployment can create a Performance Max, Video or Display Google campaign —
   * `null` while unknown.
   *
   * Three states for the same reason `demandGenEnabled` has three, and handled identically: the
   * controls are withheld while `null`, and `applyDraft` clears a saved selection only on an
   * explicit `false`. The capability itself is derived differently upstream — these three channels
   * do not survive a dark cutover the way Demand Gen does — but nothing about that difference
   * reaches this component, which only ever asks "may I offer this?".
   */
  public readonly googleChannelsEnabled = input<boolean | null>(null);

  /** Render the three controls only on an explicit yes. `null` (unknown) withholds them. */
  protected readonly googleChannelsAvailable = computed<boolean>(() => this.googleChannelsEnabled() === true);

  /**
   * Whether a Google creative typed into this form will actually reach Google — `null` while
   * unknown.
   *
   * Three states again, and withheld while `null` for the usual reason. What makes this one its
   * own input rather than a reuse of `googleChannelsEnabled`: the creative objects travel on
   * `googleAdsConfig`, which only the campaign-service create path builds. With the cutover dark
   * the LEGACY creator composes a Demand Gen ad from the two copy arrays and reads no creative key
   * at all, so every image, logo and call to action typed here is discarded without a word and the
   * create still reports success. Performance Max and Display cannot be selected in that state at
   * all, so Demand Gen is the only channel that can reach the section on the losing road — which
   * is exactly why the gate cannot be `googleChannelsAvailable`, whose extra flag would also
   * withhold the section in deployments where the creative works.
   *
   * Nothing is CLEARED on a `false`: the draft keeps whatever was typed, the section is only
   * withheld. A capability answer is not a reason to destroy a user's text.
   */
  public readonly googleCreativeEnabled = input<boolean | null>(null);

  /**
   * Render the cutover-only Google controls on an explicit yes. `null` (unknown) withholds them.
   *
   * "Creative" names the capability after the first surface that needed it, but it gates EVERY
   * cutover-only section — the per-channel creative, the bidding plan and the campaign languages.
   * They share one answer because they share one cause: all three ride on `googleAdsConfig`, and
   * the legacy creator reads none of them. A second flag would be a second way to say the same
   * thing, and the two could drift.
   */
  protected readonly googleCreativeAvailable = computed<boolean>(() => this.googleCreativeEnabled() === true);

  /**
   * Whether the Google image slots may offer the brief's stored-image LIBRARY
   * (`CampaignListResult.googleAssetUploadEnabled`) — upload into it, or pick a stored image that
   * fits. Read only together with `googleCreativeAvailable()`, as `metaAssetUploadEnabled` is with
   * its sibling; the pasted image URLs stay offered whatever this answers. `null` (unknown)
   * withholds the controls, and a stored image already held then blocks Create instead of being
   * dropped (`googleImageAssetBlock`).
   */
  public readonly googleAssetUploadEnabled = input<boolean | null>(null);

  /** @see googleAssetUploadEnabled — both capabilities an explicit yes. */
  protected readonly googleAssetUploadAvailable = computed<boolean>(() => this.googleCreativeAvailable() && this.googleAssetUploadEnabled() === true);

  /**
   * Whether a Reddit post AUTHORED here will actually be created. `null` (unknown) withholds the
   * controls that depend on it; nothing typed is ever cleared.
   *
   * Post URL — promote an EXISTING post — is read by both creators, so it stays offered whatever
   * this answers; gating it would withhold a control that works today. Image URL and Call to Action
   * compose a NEW post, which both creators now do (#3432), so a deployment that answers at all
   * answers yes. The gate is kept for the `null` case: an unanswered capability still withholds
   * them rather than letting an operator type creative a creator might discard.
   */
  public readonly redditCreativeEnabled = input<boolean | null>(null);

  /** @see redditCreativeEnabled — an explicit yes, never a `null`. */
  protected readonly redditCreativeAvailable = computed<boolean>(() => this.redditCreativeEnabled() === true);

  /**
   * Whether the Reddit section may offer an image UPLOAD (`CampaignListResult.redditAssetUploadEnabled`,
   * decision D3). `null` (unknown) withholds it; nothing uploaded is ever cleared on a `false`.
   *
   * Read only together with `redditCreativeAvailable()`: an upload is one more way to supply the
   * authored post's image, so it can never be offered where the image URL is not. The pasted image
   * URL stays offered whatever this answers.
   */
  public readonly redditAssetUploadEnabled = input<boolean | null>(null);

  /** @see redditAssetUploadEnabled — both capabilities an explicit yes. */
  protected readonly redditAssetUploadAvailable = computed<boolean>(() => this.redditCreativeAvailable() && this.redditAssetUploadEnabled() === true);

  /**
   * Whether the Meta section may offer an ad image (`CampaignListResult.metaCreativeEnabled`).
   * `null` (unknown) withholds it, as for Reddit: the legacy creator reads no Meta image.
   */
  public readonly metaCreativeEnabled = input<boolean | null>(null);

  /** @see metaCreativeEnabled — an explicit yes, never a `null`. */
  protected readonly metaCreativeAvailable = computed<boolean>(() => this.metaCreativeEnabled() === true);

  /**
   * Whether the Reddit section may offer a per-campaign conversion pixel override
   * (`CampaignListResult.redditConversionPixelEnabled`, #3484). Only campaign-service reads the
   * field; the legacy creator would drop it. `null` until the parent has an answer, which withholds
   * the control.
   */
  public readonly redditConversionPixelEnabled = input<boolean | null>(null);

  /** @see redditConversionPixelEnabled — an explicit yes, never a `null`. */
  protected readonly redditConversionPixelAvailable = computed<boolean>(() => this.redditConversionPixelEnabled() === true);

  /**
   * Whether the Meta section may offer an image UPLOAD (`CampaignListResult.metaAssetUploadEnabled`).
   * Read only together with `metaCreativeAvailable()`, as `redditAssetUploadEnabled` is with its
   * sibling; the pasted image URL stays offered whatever this answers.
   */
  public readonly metaAssetUploadEnabled = input<boolean | null>(null);

  /** @see metaAssetUploadEnabled — both capabilities an explicit yes. */
  protected readonly metaAssetUploadAvailable = computed<boolean>(() => this.metaCreativeAvailable() && this.metaAssetUploadEnabled() === true);

  /**
   * Whether the LinkedIn section may offer an image UPLOAD (`CampaignListResult.linkedInAssetUploadEnabled`).
   * `null` (unknown) withholds it, as for Meta. LinkedIn has no pasted-URL path, so this one
   * capability is the whole of the image control.
   */
  public readonly linkedInAssetUploadEnabled = input<boolean | null>(null);

  /** @see linkedInAssetUploadEnabled — an explicit yes, never a `null`. */
  protected readonly linkedInAssetUploadAvailable = computed<boolean>(() => this.linkedInAssetUploadEnabled() === true);

  /**
   * Whether the Microsoft section may offer an image UPLOAD (`CampaignListResult.microsoftAssetUploadEnabled`),
   * attached to the campaign as an image ad extension. `null` (unknown) withholds it, as for Meta.
   * There is no pasted-URL path, so this one capability is the whole of the image control.
   */
  public readonly microsoftAssetUploadEnabled = input<boolean | null>(null);

  /** @see microsoftAssetUploadEnabled — an explicit yes, never a `null`. */
  protected readonly microsoftAssetUploadAvailable = computed<boolean>(() => this.microsoftAssetUploadEnabled() === true);
  /**
   * The library upload is admitted on ANY platform's asset capability, as the BFF route is: the
   * library is one pool, and a deployment that can use an image anywhere may add to it. `null`
   * while no flag says yes and one is still unanswered — unknown, not a no.
   */
  protected readonly libraryUploadAvailable = computed<boolean | null>(() => {
    const flags = [
      this.redditAssetUploadEnabled(),
      this.metaAssetUploadEnabled(),
      this.linkedInAssetUploadEnabled(),
      this.googleAssetUploadEnabled(),
      this.microsoftAssetUploadEnabled(),
      // The tweet image: the BFF route admits the upload on `canCreateTwitter()` alone.
      this.twitterCreateEnabled(),
    ];
    if (flags.some((enabled) => enabled === true)) return true;
    return flags.some((enabled) => enabled !== false) ? null : false;
  });

  /**
   * Whether this deployment can honour a per-platform Bidding choice (#3299) —
   * `CampaignListResult.biddingEnabled`, behind `LFX_CUTOVER_CAMPAIGN_SERVICE_BIDDING`. `null`
   * (unanswered) and `false` hide the control and send no `bidding` at all, which is the create
   * exactly as it was before the control existed.
   */
  public readonly biddingEnabled = input<boolean | null>(null);

  /** @see biddingEnabled — an explicit yes, never a `null`. */
  protected readonly biddingAvailable = computed<boolean>(() => this.biddingEnabled() === true);

  /**
   * Whether this deployment applies the flight dates to Microsoft Ads —
   * `CampaignListResult.microsoftScheduleEnabled`, behind
   * `LFX_CUTOVER_CAMPAIGN_SERVICE_MICROSOFT_SCHEDULE`. `null` (unanswered) and `false` send no
   * Microsoft dates and keep the "ignores the flight dates" warning, which is the create exactly as
   * it was before campaign-service could schedule a Microsoft ad group.
   */
  public readonly microsoftScheduleEnabled = input<boolean | null>(null);

  /**
   * Whether THIS caller may send Google audience segments — `CampaignListResult.googleAudienceSegmentsEnabled`.
   * Root only, until a user list can be mapped to a project: every foundation's Google Ads connection
   * points at one shared LF customer. `null` (unanswered) and `false` hide the section, and a draft
   * that still holds segments raises `googleAudienceSegmentsBlock` rather than dropping them.
   */
  public readonly googleAudienceSegmentsEnabled = input<boolean | null>(null);

  /** @see microsoftScheduleEnabled — an explicit yes, never a `null`. */
  protected readonly microsoftScheduleAvailable = computed<boolean>(() => this.microsoftScheduleEnabled() === true);

  /**
   * Whether this deployment can create X campaigns — `CampaignListResult.twitterCreateEnabled`,
   * behind `LFX_CUTOVER_CAMPAIGN_SERVICE_TWITTER_CREATE`. `CAMPAIGN_PLATFORMS` keeps X
   * `disabled: true`; this is what the tab consults instead. `null` (unanswered) and `false` render
   * no X fields and send no `twitterConfig`: a brief still holding X is blocked by
   * `twitterCreateBlock`, never created without it.
   */
  public readonly twitterCreateEnabled = input<boolean | null>(null);

  /**
   * The X fields the parent carried across a same-event proceed (`CampaignsComponent.carriedTwitterDraft`),
   * restored when there is no full `draft`. Read once per mount, like `draft`.
   */
  public readonly twitterDraft = input<CampaignTwitterDraft | null>(null);

  /** @see twitterCreateEnabled — an explicit yes, never a `null`. */
  protected readonly twitterCreateAvailable = computed<boolean>(() => this.twitterCreateEnabled() === true);

  /**
   * Whether this deployment collects the Meta Instagram account id and the EU DSA
   * beneficiary/payor — `CampaignListResult.metaInstagramDsaEnabled`, behind
   * `LFX_CUTOVER_CAMPAIGN_SERVICE_META_INSTAGRAM_DSA`. `null` (unanswered) and `false` hide the
   * three inputs and send none of the keys, which is the Meta create exactly as it was before.
   */
  public readonly metaInstagramDsaEnabled = input<boolean | null>(null);

  /** @see metaInstagramDsaEnabled — an explicit yes, never a `null`. */
  protected readonly metaInstagramDsaAvailable = computed<boolean>(() => this.metaInstagramDsaEnabled() === true);

  /**
   * Whether this deployment can SEARCH Google's geo target table for postal-code targets —
   * `CampaignListResult.googleGeoSearchEnabled`, behind `LFX_CUTOVER_CAMPAIGN_SERVICE_GOOGLE_GEO_SEARCH`.
   * `null` (unanswered) and `false` keep the typed-id box, which is the section exactly as it was
   * before campaign-service could search the table (linuxfoundation/lfx-v2-campaign-service#411).
   */
  public readonly googleGeoSearchEnabled = input<boolean | null>(null);

  /**
   * Whether the location picker replaces the typed-id box: an explicit yes from the capability AND
   * the postal-code section itself being offered (`googlePostalGeoAvailable` — the campaign-service
   * road with a Google channel selected). A picked id is sent exactly as a typed one is.
   */
  protected readonly googleGeoSearchAvailable = computed<boolean>(() => this.googleGeoSearchEnabled() === true && this.googlePostalGeoAvailable());

  /**
   * Where the create-capability read stands — what tells "still checking" from "the check failed"
   * while a capability is `null`.
   *
   * The state of the WHOLE read, not of one capability: the parent's `loadCreateCapabilitiesFor`
   * sets `biddingEnabled`, `googleCreativeEnabled` and the rest from ONE response and moves this one
   * signal for all of them. Read by `biddingCapabilityBlock` and by
   * `googleExtensionsCapabilityBlock`, and correct for any capability that joins them later.
   */
  public readonly createCapabilityRead = input<CampaignCapabilityReadState>('unknown');

  /** Asks the parent to re-read the create capabilities after a failed read. Raised by either capability block. */
  public readonly retryCreateCapabilities = output<void>();

  /**
   * Asks the parent to save the brief on screen over the stored one, after an `unowned-brief-exists`
   * refusal (#4731). Offered only on that refusal — see `canReplaceSavedBrief`.
   */
  public readonly replaceSavedBriefRequested = output<void>();

  /**
   * Emitted whenever a user-editable field changes, so the parent's copy is current at the moment
   * the tab is destroyed.
   *
   * Emitting on every change rather than on destroy is deliberate: `ngOnDestroy` runs during the
   * same change-detection pass that removes the component, and a parent signal written there
   * would be a write-after-read in the pass that is already rendering. Emitting as the user types
   * keeps the parent's copy ahead of the teardown and needs no lifecycle hook at all.
   */
  public readonly draftChange = output<CampaignImplementationDraft>();

  /**
   * Whether the save banner offers "Replace saved brief".
   *
   * Only on `unowned-brief-exists`: that is the one refusal Retry cannot clear and Restore escapes
   * only by discarding this brief. Hidden while a save is in flight, so a second click cannot queue
   * a second replace behind the first.
   */
  protected readonly canReplaceSavedBrief = computed(
    () => this.briefPersistence().status === 'error' && this.briefPersistence().conflict === 'unowned-brief-exists' && !this.briefSaveInFlight()
  );

  /**
   * Text for the always-present live region in the template.
   *
   * Kept separate from the visible banners because the announcement and the banner have
   * different lifetimes: the banner is created and destroyed by `@switch`, while the region has
   * to persist so a screen reader treats each new value as a CHANGE rather than an insertion.
   * Empty in the `off` and `error` states — `off` has nothing to say, and `error` carries its own
   * `role="alert"`, which would otherwise announce the same text twice.
   */
  protected readonly briefPersistenceAnnouncement = computed(() => {
    switch (this.briefPersistence().status) {
      case 'saving':
        return 'Saving this brief.';
      case 'saved':
        // Must carry the SAME information as the visible banner, which says where the brief is
        // after a reload. Announcing only "Brief saved." gives screen-reader users the reassurance
        // without the instruction.
        //
        // A reload keeps the event URL in the page address (`?event=`, #4756), so Planning prefills
        // it and offers the saved brief; the user no longer has to re-enter it. "Restore saved
        // brief" is that offer's button label, so the sentence names a control that is there.
        //
        // The unapproved message, when there is one, is appended rather than replacing this: the
        // brief IS saved and the reload instruction still applies, so dropping either half would
        // leave a screen-reader user with less than the visible banner shows.
        return `Brief saved. After a reload, choose Restore saved brief on the Plan tab to reopen it.${
          this.briefPersistence().message === null ? '' : ` ${this.briefPersistence().message}`
        }`;
      default:
        return '';
    }
  });

  // === Constants ===
  protected readonly charLimits = CAMPAIGN_CHAR_LIMITS;
  protected readonly linkedInCharLimits = LINKEDIN_CHAR_LIMITS;
  protected readonly metaCharLimits = META_CHAR_LIMITS;
  protected readonly metaObjectiveLabels = META_OBJECTIVE_LABELS;
  /**
   * Read from `META_SELECTABLE_OBJECTIVES`, NOT from the labels map's keys: the labels map stays
   * total over `MetaObjective` so restored objectives still render a name, and `leads` is hidden
   * from the picker only. See that constant for why.
   */
  protected readonly metaObjectiveOptions = META_SELECTABLE_OBJECTIVES;
  /**
   * True when the restored objective is one the picker no longer offers — today only `leads`.
   *
   * Without this the select does not go blank — it shows the FIRST selectable objective, which is
   * worse. The template binds `[selected]` per `<option>` rather than `[value]` on the select, and
   * Angular applies that binding before the restored option exists, so the browser falls back to
   * index 0 and displays `awareness`. The stored `leads` survives in the signal and still reaches
   * the wire, so the screen and the payload disagree: the operator sees a valid, selectable
   * objective they never chose and can submit it without noticing, and the first touch of the
   * control overwrites `leads` for good — the option they had is gone.
   *
   * Rendering it as a disabled option is what makes display and dispatch agree; disabled is what
   * keeps it visible without letting anyone newly choose it.
   *
   * The widening cast is deliberate: `META_SELECTABLE_OBJECTIVES` is narrowed to
   * `SelectableMetaObjective` so a hidden objective cannot be listed in it, which also makes
   * `.includes()` reject the very value this asks about. Widening for the membership test is
   * what keeps that narrowing — the guard against re-adding `leads` — intact.
   */
  protected readonly metaObjectiveIsUnavailable = computed(() => !(META_SELECTABLE_OBJECTIVES as readonly MetaObjective[]).includes(this.metaObjective()));
  protected readonly metaPlacementLabels = META_PLACEMENT_LABELS;
  protected readonly metaSelectablePlacements = META_SELECTABLE_PLACEMENTS;
  protected readonly metaMessengerInboxReason = META_MESSENGER_INBOX_RETIRED_REASON;
  protected readonly videoCreateUnsupportedReason = GOOGLE_VIDEO_CREATE_UNSUPPORTED_REASON;
  protected readonly googleCreativeNotice = GOOGLE_CREATIVE_REQUIRED_NOTICE;
  protected readonly performanceMaxPrefillNotice = GOOGLE_PERFORMANCE_MAX_PREFILL_NOTICE;
  protected readonly redditMaxBudget = REDDIT_MAX_BUDGET_USD;
  protected readonly redditObjectiveLabels = REDDIT_OBJECTIVE_LABELS;
  /**
   * Read from `REDDIT_SELECTABLE_OBJECTIVES`, not from the labels map's keys, for the reason
   * `metaObjectiveOptions` is: the labels map stays total over `RedditObjective` so a withheld
   * objective would still render a name. Today the list holds all four objectives.
   */
  protected readonly redditObjectiveOptions = REDDIT_SELECTABLE_OBJECTIVES;
  /** The goals offered for `video_views`, and their readable names. */
  protected readonly redditVideoGoalOptions = REDDIT_VIDEO_GOALS;
  protected readonly redditVideoGoalLabels = REDDIT_VIDEO_GOAL_LABELS;
  /**
   * The full CTA list, with no selectable/withheld split: upstream accepts every one of these,
   * resolving the value case-insensitively and rejecting anything outside the set. The empty
   * choice the template adds is not a member — it means "send nothing", which upstream answers
   * with `DEFAULT_REDDIT_CALL_TO_ACTION`.
   */
  protected readonly redditCallToActionOptions = REDDIT_CALL_TO_ACTIONS;
  /** Named in the empty option's label, so "send nothing" shows what upstream will apply. */
  protected readonly redditDefaultCallToAction = DEFAULT_REDDIT_CALL_TO_ACTION;
  /**
   * True when the current objective is one the picker does not offer. Latent today — every
   * `RedditObjective` is selectable now that `video_views` has its goal picker — and kept so an
   * objective withheld later fails safe rather than silently showing index 0.
   *
   * Exactly the Meta case, and it fails the same way if left out: the template binds `[selected]`
   * per `<option>` rather than `[value]` on the select, so with no matching option the browser
   * falls back to index 0 and shows `awareness`, while the signal keeps the stored objective and
   * still sends it. The screen and the payload then disagree, and the first touch of the control
   * overwrites the stored value for good. A disabled option is what keeps the two in step.
   *
   * The widening cast is deliberate, as it is on the Meta computed: the constant is narrowed to
   * `SelectableRedditObjective`, which would make `.includes()` reject the very value asked about.
   */
  protected readonly redditObjectiveIsUnavailable = computed(
    () => !(REDDIT_SELECTABLE_OBJECTIVES as readonly RedditObjective[]).includes(this.redditObjective())
  );
  /**
   * The same guard for the call to action, because the exposure is the same one.
   *
   * A restored CTA that is no longer in `REDDIT_CALL_TO_ACTIONS` matches no `<option>`, so the
   * browser falls back to index 0 and the control reads "Default (Learn More)" while the signal
   * still holds the stored label and still sends it — the screen and the payload disagreeing,
   * which is exactly what {@link redditObjectiveIsUnavailable} exists to prevent next door. There
   * it ends in a campaign built on the wrong objective; here it ends in an upstream refusal, since
   * `redditCTAs` rejects any label outside the set.
   *
   * Both guards are latent today: `REDDIT_SELECTABLE_OBJECTIVES` currently offers every
   * `RedditObjective`, and `REDDIT_CALL_TO_ACTIONS` is the whole upstream set, so a stale CTA only
   * becomes possible once Reddit retires a label. Guarded anyway: the failure is identical in kind
   * and the control is a sibling of the objective's, so the two should not drift.
   *
   * The empty string is NOT unavailable — it is the real "let upstream default" selection the
   * first `<option>` carries.
   */
  protected readonly redditCallToActionIsUnavailable = computed(() => {
    const cta = this.redditCallToAction();
    return cta !== '' && !(REDDIT_CALL_TO_ACTIONS as readonly string[]).includes(cta);
  });
  protected readonly allKnownGeos: LinkedInGeoTarget[] = [...new Map(Object.values(LINKEDIN_GEO_RESOLVE_MAP).map((g) => [g.urn, g])).values()];
  protected readonly todayDate = new Date().toISOString().split('T')[0];
  protected readonly defaultEndDate = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0];

  // === Forms ===
  protected readonly campaignForm = this.fb.nonNullable.group({
    eventName: ['', [Validators.required]],
    eventSlug: [''],
    countryCode: ['US'],
    registrationUrl: ['', [Validators.required]],
    budgetUsd: [500, [Validators.required, Validators.min(1)]],
    // Typed `number`, not inferred. `CAMPAIGN_BUDGET_DEFAULTS` is `as const`, so the inferred
    // control type was the literal `70` — which is wrong for a slider the user drags, and made
    // any other value a type error to patch in (LFXV2-3229).
    searchBudgetPct: [CAMPAIGN_BUDGET_DEFAULTS.searchBudgetPct as number],
    startDate: ['', [Validators.required]],
    endDate: ['', [Validators.required]],
    includeSearch: [true],
    // Search only by default. Both on is a REFUSED combination once the campaign-service cutover
    // is live: `createCampaigns` rejects a Google request carrying both `search` and `demand-gen`
    // and does NOT fall back to the legacy creator, so a user who accepted the old defaults got a
    // terminal failure on their first create rather than a campaign. Search alone and Demand Gen
    // alone are each servable; only the pair is not. Defaulting to the one that works means the
    // untouched form submits successfully, and choosing Demand Gen stays one click away.
    includeDemandGen: [false],
    // Performance Max, Video and Display. Off by default and one-at-a-time for the same
    // reason Demand Gen is: the BFF emits ONE `googleAdsConfig` with ONE `channel`, so any pair is
    // refused. These three are withheld entirely unless the deployment reports the capability.
    includePerformanceMax: [false],
    // DISABLED at construction, not merely unchecked: Google cannot create a Video campaign at
    // all, so there is no deployment and no capability answer that makes this box actionable.
    // The control itself stays — the draft round-trip, the restore and the emit all still name it,
    // so a saved selection survives untouched and flipping GOOGLE_VIDEO_CREATE_SUPPORTED is the
    // whole change the day Google ships the API.
    includeVideo: [{ value: false, disabled: !GOOGLE_VIDEO_CREATE_SUPPORTED }],
    includeDisplay: [false],
    // Required-ness lives on the ARRAY, not on each control, and is conditional on a channel that
    // actually consumes this copy being selected — see `searchCopyRequired`. The per-control
    // validator is the width bound alone.
    //
    // Before, every control carried `Validators.required` unconditionally, so an empty first
    // headline made `campaignForm.invalid` true and `canSubmit` false for EVERY Google selection.
    // A Performance Max or Display campaign — whose ad copy is its own creative object and has
    // nothing to do with these two arrays — could not be created without first filling in a
    // Search headline and description that would then be sent nowhere.
    headlines: this.fb.array([this.fb.control('', [Validators.maxLength(CAMPAIGN_CHAR_LIMITS.searchHeadline)])], {
      validators: [this.searchCopyRequired('headline')],
    }),
    descriptions: this.fb.array([this.fb.control('', [Validators.maxLength(CAMPAIGN_CHAR_LIMITS.searchDescription)])], {
      validators: [this.searchCopyRequired('description')],
    }),
    // One nested group per Google channel whose ad copy is a creative OBJECT rather than the two
    // arrays above — see `buildCreativeGroup`. Named after the key campaign-service expects
    // (`GOOGLE_CREATIVE_REQUEST_KEYS`) so the submit payload is the group's own raw value with the
    // lists split, and no name mapping sits between the form and the wire.
    //
    // Always constructed, never conditionally: a group built only when its channel is ticked would
    // be destroyed and rebuilt as the operator changes their mind, losing everything typed into it.
    //
    // Constructed ENABLED, and then enabled or disabled by the constructor effect to match the
    // sections actually on screen — a group cannot be left enabled while hidden, because its bounds
    // would hold `campaignForm.invalid` true with no visible control to fix. The effect, not this
    // line, is the live state; `getRawValue()` reports a disabled group, so the payload, the draft
    // snapshot and the restore are all indifferent to which way it currently sits.
    demandGenCreative: this.buildCreativeGroup('demand-gen'),
    performanceMaxCreative: this.buildCreativeGroup('performance-max'),
    displayCreative: this.buildCreativeGroup('display'),
    // The Google bidding plan. All five are STRINGS, including the three money/ratio fields, so
    // that "" can mean "not supplied" — which is a different answer from a typed 0, and the one
    // the wire needs, since upstream reads 0 as absent on all three.
    //
    // NO validators, for the reason the LinkedIn block below records and one more specific to this
    // section: which of these fields even applies depends on the strategy and the channel, and
    // Angular never revalidates a control because a SIBLING changed. A bounds validator here would
    // sit on a control the template has since hidden, holding a value the submit will never send,
    // and silently make `campaignForm.invalid` true for a campaign that has nothing wrong with it.
    // `googleBiddingError` carries the checking instead: it is a computed, so it re-runs on every
    // edit, and it only ever speaks about the fields currently in play.
    googleBiddingStrategy: [''],
    googleTargetCpa: [''],
    googleTargetRoas: [''],
    googleCpcBid: [''],
    googleConversionActions: [''],
    // The LinkedIn ad account, geo targets and targeting profile, on the FORM rather than in
    // signals (LFXV2-3230). All three are user-editable — a select, an add/remove chip list and a
    // two-button toggle — and all three used to be destroyed by a tab switch, then silently
    // re-stamped from the brief on remount, so the revert looked like the AI's recommendation
    // standing rather than the user's choice being lost.
    //
    // Being on the form buys the RESTORE and the emission trigger: `valueChanges` already feeds
    // `emitDraft`, so no handler emits by hand, and `applyDraft`'s existing `patchValue` replays
    // them with no extra signal writes. It does NOT save the three members on
    // `CampaignImplementationDraft` — `emitDraft` builds an object literal, so a control still has
    // to be named there to reach the draft. The saving is that the value has one home instead of
    // four (handler, `submit`, seed, snapshot).
    //
    // NO validators, deliberately. `canSubmit` already gates the LinkedIn section on a non-empty
    // geo list, and it reads the whole form's validity for GOOGLE (`campaignForm.invalid`) — a
    // required-validator here would make an empty LinkedIn geo list block a Google-only campaign
    // that has nothing to do with LinkedIn.
    linkedInAccountId: [''],
    linkedInGeoTargets: [[] as LinkedInGeoTarget[]],
    linkedInTargetingProfile: [DEFAULT_LINKEDIN_TARGETING_PROFILE as LinkedInTargetingProfile],
    // The X section's two typed fields, on the FORM so the `lfx-input-text` / `lfx-textarea`
    // wrappers can bind them and `valueChanges` drives the draft, as for the LinkedIn controls
    // above. Both RAW strings: a blank budget is "not entered", which 0 cannot say. No validators,
    // for the LinkedIn reason — `campaignForm.invalid` gates Google, and an empty X field must not
    // block a Google-only create. `twitterBudgetError` and `twitterTweetError` do the checking.
    twitterBudget: [''],
    twitterTweetText: [''],
  });

  /**
   * The call, promotion and price sub-forms, on the LFX form-control API the `lfx-input-text` and
   * `lfx-select` wrappers bind to. TRANSIENT, as the sitelink and snippet boxes are: what is typed
   * here reaches the saved draft only when an entry is ADDED, so none of these is listed in
   * `emitDraft`. Raw text throughout, numbers included, so a refused entry stays on screen as typed.
   *
   * The price table's rows are a `FormArray` held at Google's three to eight, one `FormGroup` per row,
   * so each row's boxes bind to their own group.
   */
  protected readonly googleCallExtensionForm = this.fb.nonNullable.group<CampaignCallExtensionDraft>({ countryCode: '', phoneNumber: '' });
  protected readonly googlePromotionForm = this.fb.nonNullable.group<CampaignPromotionDraft>(this.emptyGooglePromotionDraft());
  protected readonly googlePriceForm = this.fb.nonNullable.group({
    type: this.fb.nonNullable.control<string>(GOOGLE_ADS_PRICE_TYPES[0]),
    priceQualifier: '',
    languageCode: '',
    currencyCode: '',
    offerings: this.fb.nonNullable.array(Array.from({ length: GOOGLE_ADS_MIN_PRICE_OFFERINGS }, () => this.googlePriceRowGroup())),
  });
  /**
   * The postal-code box and the radius sub-form, on the same terms as the call, promotion and price
   * sub-forms above: the wrappers' form-control API, TRANSIENT (reaching the draft only when a target
   * is added, so neither is listed in `emitDraft`), raw text throughout. `radiusUnit` starts `''`,
   * not a unit — upstream supplies no default and neither does the form.
   */
  protected readonly googlePostalGeoForm = this.fb.nonNullable.group({ postalId: '' });
  /**
   * The location picker's control, used when `googleGeoSearchAvailable` replaces the typed-id box. It
   * holds the autocomplete's own value — the typed text, then the picked option — and is cleared on
   * every pick, so like the boxes above it never reaches the draft itself; the picked id does.
   */
  protected readonly googleGeoSearchForm = this.fb.group({ location: this.fb.control<GoogleAdsGeoTargetOption | string | null>(null) });
  protected readonly googleProximityForm = this.fb.nonNullable.group<CampaignProximityTargetDraft>({ latitude: '', longitude: '', radius: '', radiusUnit: '' });
  /**
   * The Meta Instagram account id and EU DSA beneficiary/payor, on the wrappers' form-control API.
   * Its own group rather than `campaignForm`, so `campaignForm.invalid` (Google's gate) never reads
   * it. NOT transient: every edit reaches the draft (`emitDraft` names all three), and raw text is
   * kept so a refused value stays on screen as typed.
   */
  protected readonly metaInstagramDsaForm = this.fb.nonNullable.group({ instagramUserId: '', dsaBeneficiary: '', dsaPayor: '' });
  private readonly metaInstagramDsaDraft = this.initFormDraft(this.metaInstagramDsaForm);

  /**
   * The Reddit per-campaign conversion pixel override (#3484), on the wrapper's form-control API.
   * Its own group for the reason `metaInstagramDsaForm` is. The raw text goes to the draft so a value
   * stays on screen as typed; the request reads the trimmed `redditConversionPixelId`, where blank
   * means "use the connection's pixel".
   */
  protected readonly redditConversionPixelForm = this.fb.nonNullable.group({ conversionPixelId: '' });
  private readonly redditConversionPixelDraft = this.initFormDraft(this.redditConversionPixelForm);
  protected readonly redditConversionPixelId = computed<string>(() => this.redditConversionPixelDraft().conversionPixelId.trim());

  // === WritableSignals ===
  protected readonly step = signal<ImplementationStep>('form');
  protected readonly creationProgress = signal<string[]>([]);
  protected readonly results = signal<CampaignCreateResult[]>([]);
  /**
   * Per-platform outcomes as lfx-v2-campaign-service reports them, used when the server is
   * serving job status from that service instead of the in-process job map. Kept separate from
   * `results` because campaign-service does not report ad-group, keyword or ad counts, and
   * folding it into `results` would mean rendering zeros for numbers nobody measured.
   */
  protected readonly platformResults = signal<CampaignPlatformResult[]>([]);

  /**
   * `platformResults` with each row's outcome resolved to four states rather than the boolean
   * the wire carries. Derived here rather than in the template because only signal reads,
   * computed values and pipes may appear there (`docs/reviews/frontend-checklist.md` §4).
   *
   * `ok` alone is NOT the test, and the orphan case is exactly why. campaign-service sets
   * `campaign_id` on one specific failure — the upstream (paid) campaign WAS created and
   * recording it into Postgres failed (`orchestrator.go`: "created upstream campaign but failed
   * to record it") — precisely so the orphaned id is not lost. Its Goa design says so on the
   * field: "Present when ok; also set on the specific failure where the upstream campaign was
   * created but recording it failed". Such a row has a real campaign running and real money
   * being spent, so calling it a plain failure is wrong in the expensive direction: the reader's
   * next move is to create it again.
   *
   * The fallback state for an id-less failure is `unconfirmed`, NOT "not created", and the
   * absence of a `campaign_id` is not evidence that nothing was created. `orchestrator.go` emits
   * `ok: false` with no id for at least four distinct situations: a genuine upstream rejection
   * (:869), a concurrent dispatch that skipped this platform (:780 — which campaign-service
   * explicitly calls a skip, not a failure), and two responses in which an upstream campaign may
   * well exist but its id did not survive — "dispatcher returned no campaign" (:879) and
   * "dispatcher returned no upstream campaign id" (:887). Rendering all four as a definite "not
   * created" tells an ED that no paid artifact exists, and their next move is to create a second
   * one that really does spend money.
   *
   * So the row states what is known — this platform's campaign could not be confirmed — and
   * leaves the reader to check. That over-warns on the genuine-rejection and skip cases, which is
   * the cheap direction: a needless look at the ad account costs a minute, a duplicate paid
   * campaign costs budget. Note the skip is NOT detected by matching its human-readable sentence;
   * the wire has no dedicated `skipped` field yet (LFXV2-2665 tracks adding one) and a message
   * reworded upstream would silently flip the UI's verdict.
   *
   * The one exception is `nothing-created`, and it is matched on text deliberately. Since
   * campaign-service #208 a failure the service PROVED happened before anything was created (the
   * claim was released) carries a fixed sentence whose ending says so —
   * `CAMPAIGN_DISPATCH_NOTHING_CREATED_SUFFIXES`, mirrored from `DispatchFailureMessage`. That
   * differs from the skip in the one way the rule above cares about: the direction of drift. A
   * reworded skip sentence would flip a row AWAY from the warning; a reworded pre-create sentence
   * simply stops matching and the row falls back to `unconfirmed`, the over-warning direction. No
   * sentence for the possibly-created case ends in those suffixes, and none of them is built from
   * upstream text, so a match cannot downgrade a real campaign to "nothing was sent". An id-bearing
   * row stays `orphaned` whatever its message says.
   */
  protected readonly platformOutcomes = computed<PlatformResultRow[]>(() => this.platformResults().map(toPlatformResultRow));

  /**
   * Whether ANY platform has a campaign upstream — an orphan counts, per the reasoning above.
   *
   * The panel used to be unconditionally green and headed "Campaigns Created", which was true
   * while only successful jobs carried per-platform rows. A failed job carries them too — that
   * is how an orphaned `campaignId` reaches the page at all — so an all-failed result would
   * otherwise be announced as a success in green.
   *
   * Drives the panel's colour and icon; the heading text is `platformResultsHeading`.
   */
  protected readonly anyPlatformCreated = computed(() => this.platformOutcomes().some((r) => r.outcome === 'created' || r.outcome === 'orphaned'));

  /**
   * The results panel heading. The negative case is "Campaign Status Unconfirmed" rather than "No
   * Campaigns Created" for the same reason the row state is named `unconfirmed`: a heading is the
   * one line a reader acts on without reading further, and it must not assert an absence nobody
   * verified. The exception is when EVERY row is a proven pre-create failure — see
   * `platformOutcomes` for what `nothing-created` is and is not.
   */
  protected readonly platformResultsHeading = computed(() => {
    if (this.anyPlatformCreated()) {
      return 'Campaigns Created';
    }
    const rows = this.platformOutcomes();
    return rows.length > 0 && rows.every((r) => r.outcome === 'nothing-created') ? 'No Campaigns Created' : 'Campaign Status Unconfirmed';
  });

  protected readonly errors = signal<string[]>([]);
  protected readonly briefKeywords = signal<CampaignKeyword[]>([]);
  protected readonly briefHsToken = signal<string | null>(null);
  protected readonly briefDriveFolderUrl = signal('');
  protected readonly selectedPlatforms = signal<CampaignPlatform[]>(['google-ads']);
  protected readonly linkedInVariants = signal<LinkedInCreativeVariant[]>([]);
  protected readonly linkedInBudgetUsd = signal(DEFAULT_LINKEDIN_BUDGET_USD);
  protected readonly linkedInLifetimeBudget = signal(false);
  protected readonly linkedInAccounts = signal<LinkedInAccount[]>([]);
  protected readonly linkedInAccountsLoading = signal(false);
  protected readonly redditVariants = signal<RedditAdVariant[]>([]);
  protected readonly redditSubreddits = signal<string[]>([]);
  protected readonly redditInterests = signal<string[]>([]);
  protected readonly redditKeywords = signal<string[]>([]);
  protected readonly redditGeoTargets = signal<string[]>([]);
  protected readonly redditBudgetUsd = signal(DEFAULT_REDDIT_BUDGET_USD);
  /**
   * Reddit campaign objective. Seeded from `DEFAULT_REDDIT_OBJECTIVE` for the reason the Meta
   * objective is seeded from upstream's: nothing has ever sent this field, so both creators have
   * been building every Reddit campaign from their own default, and starting the picker anywhere
   * else would change what an operator who touches nothing receives.
   */
  protected readonly redditObjective = signal<RedditObjective>(DEFAULT_REDDIT_OBJECTIVE);
  /**
   * The concrete video goal a `video_views` campaign optimizes for. Reddit has no bare
   * `VIDEO_VIEWS` goal, so both creators refuse that objective without one of `REDDIT_VIDEO_GOALS`.
   * Starts unset (`''`) rather than on a default, so the operator picks the view length on purpose;
   * `canSubmit` blocks a Video Views create until they do. Remembered across objective changes —
   * only the request is gated on the objective.
   */
  protected readonly redditVideoGoal = signal<RedditVideoGoal | ''>('');
  /** True when the objective needs a video goal — the condition that shows the goal picker. */
  protected readonly redditNeedsVideoGoal = computed(() => this.redditObjective() === 'video_views');
  /**
   * The video goal as the request carries it, or `null` when Video Views is chosen without a usable
   * goal. Read by the payload, by `canSubmit` and by the template's message, so all three agree.
   * Membership-checked rather than truthiness-checked because a restored draft is not type-checked
   * at runtime and both creators refuse anything outside `REDDIT_VIDEO_GOALS`.
   */
  protected readonly redditEffectiveVideoGoal = computed<RedditVideoGoal | null>(() => {
    const goal = this.redditVideoGoal();
    return (REDDIT_VIDEO_GOALS as readonly string[]).includes(goal) ? (goal as RedditVideoGoal) : null;
  });
  /** The message shown under the goal picker while Video Views has no usable goal, else `null`. */
  protected readonly redditVideoGoalError = computed(() =>
    this.redditNeedsVideoGoal() && this.redditEffectiveVideoGoal() === null ? 'Choose a video goal — Reddit needs one for a Video Views campaign.' : null
  );
  /**
   * The message shown under the Post URL while Video Views has no post, else `null`. A video-views
   * campaign has to promote an existing video post: the image-URL route authors an IMAGE post, which
   * can never earn a video view, and with neither the campaign is created with no ad at all. Neither
   * creator checks the creative against the objective, so this is the only place it is enforced.
   */
  protected readonly redditVideoPostError = computed(() =>
    this.redditNeedsVideoGoal() && !this.redditPostUrl() ? 'Video Views promotes an existing Reddit video post — enter its Post URL.' : null
  );
  /**
   * Link to an EXISTING Reddit post to promote. Ungated, because both creators read it: the
   * legacy path extracts the post id and builds the ad from it (`reddit-ads.service.ts`), exactly
   * as campaign-service does.
   *
   * Not validated here. Both creators parse the link themselves, both reject a bad one before any
   * campaign or ad group exists, and both accept shapes the other does not — a third parser on
   * this side could only refuse a link that would have worked upstream, which is the one failure
   * this control cannot afford.
   */
  protected readonly redditPostUrl = signal('');
  /**
   * The image a NEW post is composed from, and the button that post carries. Offered only while
   * `redditCreativeAvailable()`; see that input for why these two and not `redditPostUrl`.
   *
   * Both are ignored upstream once a post URL is set — an existing post already has its image and
   * its button — so the template says so rather than leaving an operator to wonder which won.
   */
  protected readonly redditImageUrl = signal('');
  protected readonly redditCallToAction = signal<RedditCallToAction | ''>('');
  /**
   * An image UPLOADED for this brief — the creative-asset id campaign-service returned and the file
   * name it was chosen as. Sent as `imageAssetId` in place of `imageUrl` while
   * `redditAssetUploadAvailable()`; see `redditImageField`.
   */
  protected readonly redditImageAssetId = signal('');
  protected readonly redditImageAssetName = signal('');
  /** The brief the asset was uploaded to; upstream refuses the id for any other brief. */
  protected readonly redditImageAssetBriefId = signal('');
  protected readonly redditImageUploadStatus = signal<CreativeAssetUploadStatus>('idle');
  /** The file name of the upload in flight, carried in the draft so a remount can resume it. */
  private readonly redditImageUploadPendingName = signal('');
  /**
   * The brief the upload in flight was started for, carried in the draft beside its name: a remount
   * resumes by THIS brief, not whichever one is current (a foundation switch clears the current).
   */
  private readonly redditImageUploadPendingBriefId = signal('');
  /** The brief a failed upload was for; empty for a pick refused before any upload started. */
  private readonly redditImageUploadFailedBriefId = signal('');
  /** The readable reason the last upload was refused; empty unless the status is `error`. */
  protected readonly redditImageUploadError = signal('');
  /** The `accept` list for the file picker — the same allowlist the BFF route enforces. */
  protected readonly creativeAssetAccept = CREATIVE_ASSET_MIME_TYPES.join(',');
  /**
   * Bumped whenever this tab adds to the brief's creative library, so the slot grid re-reads the
   * plan. The plan is derived from the stored assets, so an upload makes the last answer stale.
   */
  protected readonly creativeLibraryRevision = signal(0);
  /**
   * The file input's descriptions: hint and live status always, the refusal while there is one, so
   * returning to the input re-reads why the last file was refused. The input stays enabled during
   * an upload (disabling it would drop keyboard focus); a new pick replaces the one in flight.
   */
  protected readonly redditImageFileDescribedBy = computed(() =>
    ['reddit-image-file-hint', 'reddit-image-file-status', ...(this.redditImageUploadStatus() === 'error' ? ['reddit-image-file-error'] : [])].join(' ')
  );
  /**
   * This component's subscription to the upload in flight. Unsubscribing only detaches it (a tab
   * switch must not abort the upload); `clearRedditImageAsset` cancels the request itself.
   */
  private redditImageUploadSub: Subscription | null = null;
  /**
   * The Meta ad image, set on EVERY variant at create (see `metaVariantsForCreate`): a pasted URL,
   * or an upload made for this brief. The upload state mirrors the Reddit fields above one for one,
   * and for the same reasons; only the platform differs.
   */
  protected readonly metaImageUrl = signal('');
  protected readonly metaImageAssetId = signal('');
  protected readonly metaImageAssetName = signal('');
  protected readonly metaImageAssetBriefId = signal('');
  protected readonly metaImageUploadStatus = signal<CreativeAssetUploadStatus>('idle');
  private readonly metaImageUploadPendingName = signal('');
  private readonly metaImageUploadPendingBriefId = signal('');
  private readonly metaImageUploadFailedBriefId = signal('');
  protected readonly metaImageUploadError = signal('');
  protected readonly metaImageFileDescribedBy = computed(() =>
    ['meta-image-file-hint', 'meta-image-file-status', ...(this.metaImageUploadStatus() === 'error' ? ['meta-image-file-error'] : [])].join(' ')
  );
  private metaImageUploadSub: Subscription | null = null;
  /**
   * The stored images held in the Google image slots, keyed `<request key>.<control>`, each with
   * the brief it was stored for. Sent as `{ imageAssetId }` entries after the slot's pasted URLs
   * (see `googleImageRefsFor`). The upload state beside it mirrors the Meta image's, with the slot
   * the upload is for: ONE Google upload runs at a time across every slot, because
   * `CampaignService` keeps one per owner, so a pick in a second slot replaces the first.
   */
  protected readonly googleHeldImages = signal<Record<string, GoogleCreativeHeldImage[]>>({});
  protected readonly googleImageUploadStatus = signal<CreativeAssetUploadStatus>('idle');
  /** The slot the running or failed upload is for, or `''`. */
  private readonly googleImageUploadSlot = signal('');
  private readonly googleImageUploadPendingName = signal('');
  private readonly googleImageUploadPendingBriefId = signal('');
  private readonly googleImageUploadFailedBriefId = signal('');
  private readonly googleImageUploadError = signal('');
  private googleImageUploadSub: Subscription | null = null;
  /**
   * The LinkedIn ad image, set on EVERY variant at create (see `linkedInVariantsForCreate`): an
   * upload made for this brief, and nothing else, since LinkedIn takes no image URL. The upload
   * state mirrors the Meta fields above one for one.
   */
  protected readonly linkedInImageAssetId = signal('');
  protected readonly linkedInImageAssetName = signal('');
  protected readonly linkedInImageAssetBriefId = signal('');
  protected readonly linkedInImageUploadStatus = signal<CreativeAssetUploadStatus>('idle');
  private readonly linkedInImageUploadPendingName = signal('');
  private readonly linkedInImageUploadPendingBriefId = signal('');
  private readonly linkedInImageUploadFailedBriefId = signal('');
  protected readonly linkedInImageUploadError = signal('');
  protected readonly linkedInImageFileDescribedBy = computed(() =>
    ['linkedin-image-file-hint', 'linkedin-image-file-status', ...(this.linkedInImageUploadStatus() === 'error' ? ['linkedin-image-file-error'] : [])].join(' ')
  );
  private linkedInImageUploadSub: Subscription | null = null;
  /** The picker is offered only for a saved brief that is not mid-save, since an upload belongs to one brief. */
  protected readonly linkedInImagePickerDisabled = computed(() => !this.briefPersistence().briefId || this.briefPersistence().status === 'saving');
  /**
   * The X tweet image: an upload made for this brief, attached to the authored tweet as its image
   * (`twitterConfig.imageAssetId`). X takes no image URL here, so the upload is the whole control,
   * and its state mirrors the LinkedIn fields above one for one.
   */
  protected readonly twitterImageAssetId = signal('');
  protected readonly twitterImageAssetName = signal('');
  protected readonly twitterImageAssetBriefId = signal('');
  protected readonly twitterImageUploadStatus = signal<CreativeAssetUploadStatus>('idle');
  private readonly twitterImageUploadPendingName = signal('');
  private readonly twitterImageUploadPendingBriefId = signal('');
  private readonly twitterImageUploadFailedBriefId = signal('');
  protected readonly twitterImageUploadError = signal('');
  protected readonly twitterImageFileDescribedBy = computed(() =>
    ['twitter-image-file-hint', 'twitter-image-file-status', ...(this.twitterImageUploadStatus() === 'error' ? ['twitter-image-file-error'] : [])].join(' ')
  );
  private twitterImageUploadSub: Subscription | null = null;
  /** The picker is offered only for a saved brief that is not mid-save, since an upload belongs to one brief. */
  protected readonly twitterImagePickerDisabled = computed(() => !this.briefPersistence().briefId || this.briefPersistence().status === 'saving');
  protected readonly twitterMaxTweetChars = TWITTER_MAX_TWEET_WEIGHTED_CHARS;
  /**
   * The Microsoft image extension, sent as `microsoftConfig.imageAssetId` (see `microsoftImageSent`):
   * an upload made for this brief, and nothing else. The upload state mirrors the Meta fields above
   * one for one.
   */
  protected readonly microsoftImageAssetId = signal('');
  protected readonly microsoftImageAssetName = signal('');
  protected readonly microsoftImageAssetBriefId = signal('');
  protected readonly microsoftImageUploadStatus = signal<CreativeAssetUploadStatus>('idle');
  private readonly microsoftImageUploadPendingName = signal('');
  private readonly microsoftImageUploadPendingBriefId = signal('');
  private readonly microsoftImageUploadFailedBriefId = signal('');
  protected readonly microsoftImageUploadError = signal('');
  protected readonly microsoftImageFileDescribedBy = computed(() =>
    ['microsoft-image-file-hint', 'microsoft-image-file-status', ...(this.microsoftImageUploadStatus() === 'error' ? ['microsoft-image-file-error'] : [])].join(
      ' '
    )
  );
  private microsoftImageUploadSub: Subscription | null = null;
  /** Whether the picked Microsoft image's pixel size is being read, which holds Create like an upload does. */
  protected readonly microsoftImageChecking = signal(false);
  /** The picker is offered only for a saved brief that is not mid-save, since an upload belongs to one brief. */
  protected readonly microsoftImagePickerDisabled = computed(() => !this.briefPersistence().briefId || this.briefPersistence().status === 'saving');
  /**
   * Microsoft's four editable inputs (LFXV2-3312). Signal-backed like the Meta and Reddit blocks,
   * so `campaignForm.valueChanges` never sees them and each handler must `emitDraft()` by hand.
   *
   * `microsoftKeywords` seeds from the brief but is genuinely EDITABLE here, unlike Reddit's
   * read-only recommendation lists — with none the campaign can never serve, so the operator must
   * be able to fix an empty or bad list rather than only look at it.
   *
   * `microsoftCpcBid` is a STRING, not a number: '' is the meaningful "unset" the numeric type
   * cannot express, and unset is the serve-capable default (Microsoft applies the account-currency
   * minimum). A `number` signal would make an untouched field read 0, which `buildMicrosoftConfig`
   * drops anyway — but only after the UI had shown the operator a bid of zero they never set.
   */
  protected readonly microsoftMaxBudget = MICROSOFT_MAX_BUDGET;
  protected readonly microsoftMaxKeywords = MICROSOFT_MAX_KEYWORDS;
  protected readonly microsoftMaxKeywordTextLength = MICROSOFT_MAX_KEYWORD_TEXT_LENGTH;
  protected readonly microsoftMaxGeoTargets = MICROSOFT_MAX_GEO_TARGETS;
  protected readonly microsoftMinCpcBid = MICROSOFT_MIN_CPC_BID;
  protected readonly microsoftMaxCpcBid = MICROSOFT_MAX_CPC_BID;
  /**
   * The keyword box's in-progress text, held so the over-length warning can render live.
   *
   * NOT part of the draft: it is transient input, not a configured value, and a half-typed word
   * surviving a tab switch would be surprising rather than helpful. Cleared by
   * `onMicrosoftKeywordAdd` only when the keyword is actually ADDED, so a refused entry keeps the
   * operator's text and the warning describing it.
   */
  protected readonly microsoftKeywordDraft = signal('');
  protected readonly microsoftGeoTargets = signal<string[]>([]);
  protected readonly microsoftKeywords = signal<MicrosoftKeyword[]>([]);
  protected readonly microsoftBudgetUsd = signal(DEFAULT_MICROSOFT_BUDGET_USD);
  protected readonly microsoftCpcBid = signal('');

  /**
   * The Bidding choice per platform (#3299). A platform with no entry is on the default, automatic.
   * Kept for every platform whatever is selected, like the other per-platform fields, so
   * deselecting and reselecting a platform does not lose a typed bid.
   */
  protected readonly biddingDrafts = signal<CampaignBiddingDrafts>({});
  /**
   * Google's own geo targets, as ISO-2 country codes.
   *
   * A SEPARATE list from the form's single `countryCode`, not a replacement for it. `countryCode` is
   * read by five other things — the campaign-name region token, the Meta, Microsoft and Reddit geo
   * fallbacks, and the draft — and widening it to a list would change what every one of them
   * targets. This list is additive: empty means "use the event country", exactly as before — unless
   * a postal code or radius target will be sent, which {@link googleEffectiveGeoTargets} explains.
   */
  protected readonly googleGeoTargets = signal<string[]>([]);
  protected readonly googleMaxGeoTargets = GOOGLE_ADS_MAX_GEO_TARGETS;
  /**
   * The country codes Google Ads can actually target on this path, offered as a closed list.
   *
   * A select rather than Meta's and Microsoft's free-text box, because here the accepted set IS
   * enumerable: `validateGeoTargets` (`internal/platform/googleads/geo.go`) resolves every code
   * against a curated 30-entry map and hard-errors on a miss, and `GOOGLE_ADS_GEO_TARGET_MAP` is
   * that same map. Typing `PT` into a free-text box would be well-formed, assigned, and refused — so
   * the control that cannot express it is the kinder one.
   */
  protected readonly googleGeoOptions = Object.keys(GOOGLE_ADS_GEO_TARGET_MAP).sort();
  /**
   * Google's postal-code targets, as raw geo target constant ids.
   *
   * Ids rather than the postal codes themselves, because that is all the wire takes: upstream's
   * `resolveGeoList` (`internal/platform/googleads/geo.go`) reads a numeric `geoTargets` entry as a
   * constant id from Google's published geo-targets table, and neither campaign-service nor the BFF
   * exposes a lookup from a postal code to its id. The operator finds the id in that table. Sent in
   * the same `geoTargets` list as {@link googleGeoTargets}, after the countries — see
   * {@link googleEffectiveGeoTargets}.
   *
   * Free text rather than a select, the opposite choice from {@link googleGeoOptions}: Google's table
   * has ~100k rows and changes, so the accepted set is not enumerable here. What upstream judges
   * locally is the SHAPE — digits, canonical — and the add path mirrors exactly that.
   */
  protected readonly googlePostalGeoTargets = signal<string[]>([]);
  /**
   * The postal-code box's live text, on the same rule as {@link googleCalloutDraft}: transient,
   * reaching the saved draft only when an id is added. Derived from {@link googlePostalGeoForm},
   * which the wrapper binds to, so readers keep a signal while the form stays the source of truth.
   */
  protected readonly googlePostalGeoDraft: Signal<string> = computed(() => this.googlePostalGeoFormDraft().postalId);
  private readonly googlePostalGeoFormDraft: Signal<{ postalId: string }> = this.initFormDraft(this.googlePostalGeoForm);
  protected readonly googlePostalGeoIdMinDigits = GOOGLE_ADS_POSTAL_GEO_ID_MIN_DIGITS;
  /**
   * Display labels for picked postal-code ids, by id — Google's canonical name, recorded when an id
   * comes from the location picker. Display only: the request carries the ids, and an id with no
   * label (typed, or restored from a draft saved before labels existed) renders as itself.
   */
  protected readonly googlePostalGeoLabels = signal<Record<string, string>>({});
  /** The postal-code chips with the label each renders, so the template binds data, not a lookup. */
  protected readonly googlePostalGeoChips = computed(() => {
    const labels = this.googlePostalGeoLabels();
    return this.googlePostalGeoTargets().map((id) => ({ id, label: Object.hasOwn(labels, id) ? labels[id] : id }));
  });
  /**
   * The location picker's latest query text, trimmed; the search below is debounced off it.
   *
   * NO equality check: every completion the autocomplete asks for must reach the search, even one
   * that trims to the query already searched (`Austin` then `Austin `). PrimeNG shows its loading
   * state until suggestions are set again, so a deduplicated repeat would leave it spinning — and it
   * is also how the operator retries a search that failed.
   */
  protected readonly googleGeoSearchQuery = signal('', { equal: () => false });
  private readonly googleGeoSearchState: Signal<GoogleAdsGeoTargetSearchState> = this.initGoogleGeoSearchState();
  /** The picker's rows, an id already on the list marked `disabled` so it cannot be picked twice. */
  protected readonly googleGeoSearchOptions = computed<GoogleAdsGeoTargetOption[]>(() => {
    const added = new Set(this.googlePostalGeoTargets());
    return this.googleGeoSearchState().suggestions.map((s) => ({ ...s, disabled: added.has(s.id) }));
  });
  protected readonly googleGeoSearchFailed = computed(() => this.googleGeoSearchState().failed);
  /**
   * Whether a search is waiting on its debounce or its request: its stale rows are already cleared,
   * but nothing has answered yet, so "nothing matched" would be false.
   */
  protected readonly googleGeoSearchPending = computed(() => this.googleGeoSearchState().pending);
  /**
   * What the picker's popup says while it has no rows — searching, failed, or nothing matched.
   *
   * A custom `#empty` template, NOT a toggled `showEmptyMessage`. PrimeNG opens or closes its popup
   * only while it is `loading`, on the first suggestions update after a completion
   * (`handleSuggestionsChange`). The cleared rows a new query starts with ARE that update, so with
   * the empty message switched off they closed the popup and spent the loading cycle, and the real
   * rows then landed in a popup that never reopened. An empty template keeps the popup open through
   * that first update and lets it say which empty state it is.
   */
  protected readonly googleGeoSearchEmptyMessage = computed(() => {
    if (this.googleGeoSearchPending()) return 'Searching…';
    if (this.googleGeoSearchFailed()) return 'The location search did not come back. Try again in a moment.';
    return 'No matching locations.';
  });
  protected readonly googleGeoSearchTruncated = computed(() => this.googleGeoSearchState().truncated);
  /** What the picker's input points `aria-describedby` at: the failure line when a search failed, else the hint. */
  protected readonly googleGeoSearchDescribedBy = computed(() => (this.googleGeoSearchFailed() ? 'google-geo-search-failed' : 'google-postal-hint'));
  /**
   * Google's radius targets — "everyone within N miles of the venue" — the one location shape that
   * is not a place in Google's table.
   *
   * A point in decimal degrees, not an address: `googleAdsProximityConfig` upstream carries
   * `latitude`, `longitude`, `radius` and `radiusUnit` and nothing else, so an address has nowhere
   * to go on the wire. An entry arrives through {@link addGoogleProximityTarget} or a restored
   * draft; the BFF guard re-checks every entry against `validateProximityTargets` before dispatch.
   */
  protected readonly googleProximityTargets = signal<CampaignProximityTarget[]>([]);
  protected readonly googleMaxProximityTargets = GOOGLE_ADS_MAX_PROXIMITY_TARGETS;
  /** The unit select's options, labelled in lower case as the chips read ("25 kilometers around …"). */
  protected readonly googleRadiusUnitOptions = GOOGLE_ADS_RADIUS_UNITS.map((unit) => ({ label: unit.toLowerCase(), value: unit }));
  /**
   * The radius sub-form's live values, on the same rule as {@link googleSitelinkDraft}: transient,
   * reaching the saved draft only when a radius target is added. Derived from
   * {@link googleProximityForm} through `initFormDraft`, as the call, promotion and price drafts are.
   */
  protected readonly googleProximityDraft: Signal<CampaignProximityTargetDraft> = this.initFormDraft(this.googleProximityForm);
  /**
   * The languages the Google campaign serves in, as ISO 639-1 codes.
   *
   * Empty is a real and SAFE answer with no fallback behind it, which is the difference from
   * {@link googleGeoTargets}: upstream reads an absent language list as Google's own default, which
   * is to serve in every language. So this list only ever narrows, and leaving it alone leaves the
   * campaign exactly as it is created today.
   */
  protected readonly googleLanguages = signal<string[]>([]);
  protected readonly googleMaxLanguages = GOOGLE_ADS_MAX_LANGUAGES;
  /**
   * The languages Google Ads can target on this path, offered as a closed list.
   *
   * A select for the same reason the geo control is one: `resolveLanguageList`
   * (`internal/platform/googleads/campaign_criteria.go`) resolves every ISO 639-1 code against a
   * curated table and hard-errors on a miss, and {@link GOOGLE_ADS_LANGUAGE_MAP} is that same table.
   *
   * Sorted by the ENGLISH NAME rather than the code, unlike the geo select — the options render as
   * names here, so sorting by code would put them on screen in no order the operator can see. The
   * collation locale is pinned to `en`: left to the runtime default, the server render and the
   * browser could order the options differently and fail hydration.
   *
   * The raw numeric constant ids upstream also accepts are deliberately NOT offered: they exist for
   * languages outside the curated table, and the BFF guard accepts them without testing them
   * against that table, so the narrower control costs nothing an operator can reach from this screen.
   */
  protected readonly googleLanguageOptions = Object.entries(GOOGLE_ADS_LANGUAGE_LABELS)
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
  /**
   * Code to English name, for the chips and their remove buttons, so a chip reads as the name the
   * operator picked from the select and a screen reader announces "Remove German" rather than
   * "Remove D E". A `Map` rather than the label object indexed directly: a restored draft is the
   * other source of a code, and a plain-object index would resolve an inherited `Object.prototype`
   * key (#3504). A code outside the table falls back to the code itself.
   */
  private readonly googleLanguageNames = new Map<string, string>(Object.entries(GOOGLE_ADS_LANGUAGE_LABELS));
  /**
   * The picked languages as chips — code and display name together — so the template binds data
   * rather than calling a lookup on every change-detection pass.
   */
  protected readonly googleLanguageChips = computed(() => this.googleLanguages().map((code) => ({ code, name: this.googleLanguageNames.get(code) ?? code })));
  /**
   * Google's audience segments — existing Customer Match or remarketing user lists the Search ad
   * group targets, as full resource names (`customers/{customerId}/userLists/{id}`).
   *
   * Free text rather than a select, unlike {@link googleGeoOptions}, because there is nothing to
   * enumerate from: campaign-service creates no audiences and exposes no listing of an account's
   * user lists — its Google audience read is an age/gender/device breakdown, and the brief's
   * audience rows are HubSpot lists. The resource name is what upstream takes, so it is the input.
   * Its SHAPE is what upstream judges, and that judgement is mirrored on the add path.
   */
  protected readonly googleAudienceSegments = signal<string[]>([]);
  protected readonly googleMaxAudienceSegments = GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS;
  /**
   * The segment box's live text, so the shape warning describes what is in the box rather than
   * what was last committed. Transient: it reaches the draft only when a segment is ADDED, exactly
   * as {@link googleCalloutDraft} does.
   */
  protected readonly googleAudienceSegmentDraft = signal('');
  /**
   * Google's callout extensions — short claims appended to the Search ad, each carrying no link.
   *
   * Free text rather than a closed list, the opposite choice from {@link googleGeoOptions} and for
   * the opposite reason: a callout is ad copy the operator writes, so there is nothing to enumerate.
   * What upstream judges is its SHAPE — length, emptiness, repetition — and every one of those
   * judgements is mirrored on the add path so a refusal arrives while the text is still in the box.
   */
  protected readonly googleCallouts = signal<string[]>([]);
  /**
   * The Performance Max copy the brief seeded (#4784), kept so the section's prefill notice can tell
   * whether what is on screen is still that copy. Null when nothing was seeded; cleared by
   * `resetGoogleFields`.
   */
  private readonly performanceMaxSeed = signal<Record<string, string> | null>(null);
  protected readonly googleMaxCallouts = GOOGLE_ADS_MAX_CALLOUTS;
  protected readonly googleMaxCalloutRunes = GOOGLE_ADS_MAX_CALLOUT_TEXT_RUNES;
  /**
   * The callout box's live text, kept so the over-length warning can describe what is in the box
   * rather than what was last committed. Transient: it reaches the draft only when a callout is
   * ADDED, exactly as {@link microsoftKeywordDraft} does.
   */
  protected readonly googleCalloutDraft = signal('');
  /**
   * Google's sitelink extensions — extra links rendered under the Search ad.
   *
   * Four fields rather than the callout's one, so the draft is an OBJECT and the add guard has more
   * to say. An entry arrives through {@link addGoogleSitelink} or a restored draft; the BFF guard
   * re-checks every entry against `validateSitelinks` before anything is sent.
   */
  protected readonly googleSitelinks = signal<CampaignSitelink[]>([]);
  protected readonly googleMaxSitelinks = GOOGLE_ADS_MAX_SITELINKS;
  protected readonly googleMaxFinalUrlBytes = GOOGLE_ADS_MAX_FINAL_URL_BYTES;
  protected readonly googleMaxSitelinkRunes = GOOGLE_ADS_MAX_SITELINK_TEXT_RUNES;
  protected readonly googleMaxSitelinkDescriptionRunes = GOOGLE_ADS_MAX_SITELINK_DESCRIPTION_RUNES;
  /**
   * The sitelink sub-form's live values, on the same rule as {@link googleCalloutDraft}: transient,
   * reaching the saved draft only when a sitelink is added.
   */
  protected readonly googleSitelinkDraft = signal<CampaignSitelink>({ text: '', description1: '', description2: '', finalUrl: '' });
  /**
   * Google's structured snippets — one "Header: value, value, value" line each, enumerating what
   * the campaign offers rather than claiming anything about it.
   *
   * TYPED, not generated: unlike the callouts and sitelinks above there is no generator event for
   * these, so this list only ever grows through {@link addGoogleStructuredSnippet} or a restored
   * draft. The BFF guard re-checks every entry against `validateStructuredSnippets` before anything
   * is sent.
   */
  protected readonly googleStructuredSnippets = signal<CampaignStructuredSnippet[]>([]);
  protected readonly googleMaxStructuredSnippets = GOOGLE_ADS_MAX_STRUCTURED_SNIPPETS;
  protected readonly googleMaxSnippetHeaderRunes = GOOGLE_ADS_MAX_SNIPPET_HEADER_RUNES;
  protected readonly googleMaxSnippetValueRunes = GOOGLE_ADS_MAX_SNIPPET_VALUE_RUNES;
  protected readonly googleMinSnippetValues = GOOGLE_ADS_MIN_SNIPPET_VALUES;
  protected readonly googleMaxSnippetValues = GOOGLE_ADS_MAX_SNIPPET_VALUES;
  /**
   * The snippet sub-form's live values, on the same rule as {@link googleSitelinkDraft}: transient,
   * reaching the saved draft only when a snippet is added. `values` is the textarea's raw text —
   * see {@link CampaignStructuredSnippetDraft} for why it is not parsed here.
   */
  protected readonly googleStructuredSnippetDraft = signal<CampaignStructuredSnippetDraft>({ header: '', values: '' });
  /**
   * Google's call, promotion and price extensions — the three remaining Search extension types
   * campaign-service creates (`assets_extended.go`).
   *
   * TYPED, as the snippets are: no generator event exists for any of them, so each list grows only
   * through its add method or a restored draft. Every add is judged by the SAME functions the BFF
   * refuses by (`campaign-google-assets.utils`), which mirror upstream's validators branch for branch.
   */
  protected readonly googleCallExtensions = signal<CampaignCallExtension[]>([]);
  protected readonly googleMaxCallExtensions = GOOGLE_ADS_MAX_CALL_EXTENSIONS;
  protected readonly googlePromotions = signal<CampaignPromotion[]>([]);
  protected readonly googleMaxPromotions = GOOGLE_ADS_MAX_PROMOTIONS;
  protected readonly googlePrices = signal<CampaignPriceExtension[]>([]);
  protected readonly googleMaxPrices = GOOGLE_ADS_MAX_PRICE_EXTENSIONS;
  protected readonly googleMinPriceRows = GOOGLE_ADS_MIN_PRICE_OFFERINGS;
  protected readonly googleMaxPriceRows = GOOGLE_ADS_MAX_PRICE_OFFERINGS;
  /**
   * The price selects' options. Google's own enum names, offered as a closed list for the reason the
   * language select is one — the operator picks rather than spells — while the BFF checks only their
   * shape, so a value Google adds later is not refused there.
   */
  protected readonly googlePriceTypeOptions = GOOGLE_ADS_PRICE_TYPES.map((value) => ({ label: value, value }));
  protected readonly googlePriceQualifierOptions = [
    { label: 'No qualifier', value: '' },
    ...GOOGLE_ADS_PRICE_QUALIFIERS.map((value) => ({ label: value, value })),
  ];
  protected readonly googlePriceUnitOptions = [{ label: 'No unit', value: '' }, ...GOOGLE_ADS_PRICE_UNITS.map((value) => ({ label: value, value }))];
  /** The promotion's two oneofs, one select each, so the form cannot express both arms of either. */
  protected readonly googlePromotionDiscountOptions = [
    { label: 'Percent off', value: 'percent' },
    { label: 'Amount off', value: 'amount' },
  ];
  protected readonly googlePromotionConditionOptions = [
    { label: 'No condition', value: 'none' },
    { label: 'Promotion code', value: 'code' },
    { label: 'Orders over', value: 'ordersOver' },
  ];
  /**
   * The three sub-forms' live values as signals, so the refusal computeds below re-run as the
   * operator types — the forms are the source of truth, these are their read side.
   */
  protected readonly googleCallExtensionDraft: Signal<CampaignCallExtensionDraft> = this.initFormDraft(this.googleCallExtensionForm);
  protected readonly googlePromotionDraft: Signal<CampaignPromotionDraft> = this.initFormDraft(this.googlePromotionForm);
  protected readonly googlePriceDraft: Signal<CampaignPriceExtensionDraft> = this.initFormDraft(this.googlePriceForm);
  /**
   * The price table's row groups, for the template's `@for`. A `FormArray`'s `controls` is not a
   * signal, so the template cannot read it directly under zoneless change detection; reading
   * {@link googlePriceDraft} here re-runs this on every row pushed or removed. Tracked by the group
   * itself, which is a stable identity a typed row does not otherwise have.
   */
  protected readonly googlePriceRowForms = computed(() => {
    this.googlePriceDraft();
    return [...this.googlePriceForm.controls.offerings.controls];
  });
  protected readonly metaVariants = signal<MetaAdVariant[]>([]);
  protected readonly metaGeoTargets = signal<string[]>([]);
  protected readonly metaBudgetUsd = signal(DEFAULT_META_BUDGET_USD);
  protected readonly metaLifetimeBudget = signal(false);
  /**
   * Meta campaign objective. Defaults to `traffic`, matching what campaign-service assumes when
   * the field is absent, so turning the selector on does not silently change any existing
   * caller's campaign.
   */
  protected readonly metaObjective = signal<MetaObjective>(DEFAULT_META_OBJECTIVE);
  /**
   * Placement toggles, seeded from the shared defaults so the initial state is the one the
   * service would have applied anyway.
   *
   * Typed `MetaPlacement` (complete), not `Partial`, because the UI holds a definite answer for
   * every key it renders. Only the entries that DIFFER from the defaults are sent — placements
   * merge per-field upstream, so an override-only payload is both correct and smaller.
   */
  protected readonly metaPlacements = signal<MetaPlacement>({ ...META_DEFAULT_PLACEMENTS });
  /** Meta Pixel id. Only read — and only required — under the `conversions` objective. */
  protected readonly metaPixelId = signal('');
  /** What the last "Use suggested images" did, and for which brief, so the line never outlives a brief switch (#4825). */
  private readonly googleSuggestedApply = signal<{ briefId: string; message: string; seq: number } | null>(null);

  // === Computed Signals ===
  protected readonly activeFoundationSlug = computed(() => this.projectContextService.activeContext()?.slug ?? '');
  protected readonly showGoogleSection = computed(() => this.selectedPlatforms().includes('google-ads'));
  protected readonly showLinkedInSection = computed(() => this.selectedPlatforms().includes('linkedin-ads'));
  protected readonly showRedditSection = computed(() => this.selectedPlatforms().includes('reddit-ads'));
  /**
   * The keywords a Reddit dispatch will actually carry.
   *
   * Mirrors `submit()`'s own fallback: brief-supplied Reddit keywords when present, otherwise the
   * generic brief keywords. Showing only `redditKeywords()` would render an empty list for the
   * common case where the fallback is what ships — the section would then be hiding exactly the
   * targeting it exists to surface.
   */
  protected readonly redditEffectiveKeywords = computed<string[]>(() =>
    this.redditKeywords().length > 0 ? this.redditKeywords() : this.briefKeywords().map((k) => k.term)
  );

  /**
   * The form's country code as a SIGNAL.
   *
   * `campaignForm.controls.countryCode.value` is a plain read — not a reactive dependency — so a
   * `computed` over it memoises and never updates. An RxJS pipeline keyed on `valueChanges` has
   * the mirror-image bug: it tracks the country but NOT `redditGeoTargets()`, which
   * `populateFromBrief` assigns AFTER patching the form, so the recommended geos arrive with
   * nothing left to re-run the map. Both inputs have to be signals for the derivation to hold.
   */
  private readonly countryCodeValue = toSignal(
    this.campaignForm.controls.countryCode.valueChanges.pipe(startWith(this.campaignForm.controls.countryCode.value)),
    { initialValue: this.campaignForm.controls.countryCode.value }
  );

  /**
   * A counter that ticks on every form edit, so `canSubmit` can be a real `computed`.
   *
   * `canSubmit` reads the form DIRECTLY in a dozen places — `form.eventName.value`,
   * `campaignForm.invalid`, and `selectedGoogleChannels()`, which is `getRawValue()` underneath.
   * None of those is a reactive dependency, so the memo only ever recomputed when one of the
   * handful of SIGNALS it also reads changed: `selectedPlatforms`, the capability inputs, the
   * Meta/Reddit/Microsoft/LinkedIn signal-backed fields. Edits confined to the form itself left a
   * stale answer on screen, and the Google channel checkboxes are exactly that case — nothing
   * else moves when one is ticked, so the Create button kept whatever state it had. Flagged
   * independently by three reviewers on #3318 against the mixed-channel rule below, which is the
   * newest rule whose only inputs are those checkboxes.
   *
   * A counter rather than the form's value: `valueChanges` emits `Partial<…>` (it omits DISABLED
   * controls) while every reader here wants `getRawValue()`, so bridging the VALUE would hand
   * `canSubmit` a second, subtly different view of the form to drift against. The counter carries
   * no data — it exists only to invalidate the memo, leaving the existing reads as the one source.
   *
   * `statusChanges` is merged in for the cases where validity moves without a value emission:
   * `disable()`/`enable()` on a control, and a `setErrors` from outside the validators.
   */
  private readonly campaignFormRevision = toSignal(
    merge(this.campaignForm.valueChanges, this.campaignForm.statusChanges).pipe(
      scan((revision: number) => revision + 1, 0),
      startWith(0)
    ),
    { initialValue: 0 }
  );

  /**
   * The same counter for TOUCHED, which `campaignFormRevision` cannot see.
   *
   * Blurring a control moves `touched` without emitting on `valueChanges` or `statusChanges`, so a
   * memo that read only the revision above would hold an error message back until the operator's
   * next keystroke somewhere on the form. `events` is the stream that carries it.
   *
   * Kept separate rather than merged into the revision counter so that counter keeps meaning
   * exactly what `canSubmit` needs it to mean — a blur changes no answer there, and widening it
   * would recompute every reader for an event none of them reads.
   */
  private readonly campaignFormTouchRevision = toSignal(
    this.campaignForm.events.pipe(
      filter((event) => event instanceof TouchedChangeEvent),
      scan((revision: number) => revision + 1, 0),
      startWith(0)
    ),
    { initialValue: 0 }
  );

  /**
   * The three LinkedIn controls as SIGNALS, for the same reason `countryCodeValue` is one
   * (LFXV2-3230).
   *
   * They moved from signals onto `campaignForm` so the draft carries them, but the template,
   * `canSubmit` and `availableGeoTargets` all read them reactively. A plain
   * `controls.linkedInGeoTargets.value` read is not a reactive dependency, so a `computed` over
   * it would memoise on first read and never update — the chip list would stop re-rendering as
   * the user adds and removes geos. Bridging through `toSignal` keeps every existing reader
   * working unchanged while the value itself lives on the form.
   *
   * `startWith` seeds the current value rather than a literal, so these are correct from first
   * read rather than only after the first edit.
   */
  protected readonly linkedInAccountId = toSignal(
    this.campaignForm.controls.linkedInAccountId.valueChanges.pipe(startWith(this.campaignForm.controls.linkedInAccountId.value)),
    { initialValue: this.campaignForm.controls.linkedInAccountId.value }
  );

  /**
   * Coalesced to `[]` HERE rather than at each reader, because the readers are the whole surface:
   * `canSubmit`, `availableGeoTargets`, `submit()` and two template blocks all read this, and four
   * of the five would throw on an absent value (`.length`, `.map`, `@for`). Guarding one call site
   * leaves the other four, and the crash in `availableGeoTargets` is reached from the TEMPLATE, so
   * it takes down the tab rather than one control.
   *
   * The value can be absent even though `CampaignImplementationDraft` declares it non-optional:
   * that is a compile-time claim, and `applyDraft` hands `patchValue` whatever the draft holds
   * while `patchValue` passes `undefined` straight through. Unreachable today — `emitDraft` is the
   * only non-null producer and the draft is in-memory — but a required TYPE is not what keeps it
   * safe, so the guard belongs at the boundary the values flow through.
   */
  protected readonly linkedInGeoTargets = computed<LinkedInGeoTarget[]>(() => this.linkedInGeoTargetsRaw() ?? []);

  private readonly linkedInGeoTargetsRaw = toSignal(
    this.campaignForm.controls.linkedInGeoTargets.valueChanges.pipe(startWith(this.campaignForm.controls.linkedInGeoTargets.value)),
    { initialValue: this.campaignForm.controls.linkedInGeoTargets.value }
  );

  protected readonly linkedInTargetingProfile = toSignal(
    this.campaignForm.controls.linkedInTargetingProfile.valueChanges.pipe(startWith(this.campaignForm.controls.linkedInTargetingProfile.value)),
    { initialValue: this.campaignForm.controls.linkedInTargetingProfile.value }
  );

  /**
   * The geo targets a Reddit dispatch will actually carry.
   *
   * Mirrors `submit()`'s fallback to the form's country code, so the preview shows the value that
   * ships rather than an empty list for a request that targets somewhere specific.
   */
  protected readonly redditEffectiveGeoTargets: Signal<string[]> = computed(() => {
    // Normalise FIRST, then decide whether to fall back. Choosing the branch on the RAW
    // recommendation strands the form's country: a brief carrying an unusable ['USA'] is
    // non-empty, so it wins the branch, filters to nothing, and canSubmit blocks the section
    // permanently — with a perfectly valid US sitting unread in the form. The fallback is for
    // "the brief offers no usable geo", and non-empty is not the same test as usable.
    const recommended = this.normaliseGeoCodes(this.redditGeoTargets());
    if (recommended.length > 0) return recommended;
    return this.normaliseGeoCodes([this.countryCodeValue()]);
  });
  /**
   * Subreddit names as they will DISPATCH. A restored brief keeps whatever the generator wrote,
   * and `r/k8s` is a real stored value (campaign-service.service.spec.ts asserts it survives
   * restore verbatim). The dispatch side strips an optional `r/`, so rendering the raw value
   * under a fixed `r/` prefix previews `r/r/k8s` — a section whose entire purpose is showing
   * what will be sent must not show something else.
   */
  protected readonly redditEffectiveSubreddits: Signal<string[]> = computed(() =>
    this.redditSubreddits()
      .map((sub) => sub.trim().replace(/^\/?r\//i, ''))
      .filter((sub) => sub.length > 0)
  );

  /**
   * The geo list a Meta create would ACTUALLY send — one value for both the preview and `submit()`.
   *
   * They were derived separately, and that is what let them disagree: the preview printed
   * `countryCode` raw while `submit()` sent `[countryCode]` through the server's normaliser. With
   * `countryCode` blank (it carries no validator) the preview read "defaults to " and the request
   * carried `['']`, which the server resolved to `US` — a paid US-targeted campaign the operator
   * was never shown. Deriving both from here means the screen cannot claim one target while the
   * request buys another.
   *
   * Empty is a real answer, not a bug: it means nothing usable was supplied, and `canSubmit`
   * blocks on it rather than letting the server pick a country on the operator's behalf.
   */
  protected readonly metaEffectiveGeoTargets = computed<string[]>(() => {
    const chips = normalizeGeoTargets(this.metaGeoTargets());
    const eligibleChips = chips.filter((c) => !META_INELIGIBLE_COUNTRIES.has(c));
    if (eligibleChips.length > 0) return eligibleChips;
    return normalizeGeoTargets([this.countryCodeValue()]).filter((c) => !META_INELIGIBLE_COUNTRIES.has(c));
  });

  /**
   * The geo list a Google create would ACTUALLY send — one value for the preview and for `submit()`,
   * on the same rule as `metaEffectiveGeoTargets`: the screen must not claim one target while the
   * request buys another.
   *
   * The fallback is `[countryCode]` UNFILTERED, which is what this path sent before the chip list
   * existed. Filtering it to the supported 30 here would look tidier and be worse: an event in a
   * country Google cannot target on this path would then submit an EMPTY geo list, and an empty list
   * is not a refusal — it is a campaign with no geographic restriction at all. Passed through, the
   * BFF's own guard names the country in the error instead.
   */
  protected readonly googleEffectiveGeoTargets = computed<string[]>(() => {
    const chips = this.googleGeoTargets();
    const postal = this.googleDispatchedPostalGeoTargets();
    // Countries first, then postal-code ids, in the ONE list upstream reads both spellings from.
    if (chips.length > 0 || postal.length > 0) return [...chips, ...postal];
    // A radius-only campaign sends NO geo list. Falling back to the event country here would be
    // worse than redundant: Google serves the UNION of every location criterion, so a country beside
    // a 25-mile radius would buy the whole country and make the radius mean nothing.
    if (this.googleDispatchedProximityTargets().length > 0) return [];
    return [this.googleGeoFallbackCode()];
  });

  /**
   * Whether the request falls back to the event country — true only when the operator added no
   * country, no postal code and no radius that will be sent. The template's two fallback lines
   * read this rather than the country list alone, so they cannot claim the event country is
   * targeted while the request carries only postal codes.
   */
  protected readonly googleGeoUsesEventCountry = computed(
    () => this.googleGeoTargets().length === 0 && this.googleDispatchedPostalGeoTargets().length === 0 && this.googleDispatchedProximityTargets().length === 0
  );

  /**
   * The postal-code ids a create would carry: the list on the campaign-service road, nothing on the
   * legacy one. The in-process creator resolves `geoTargets` through the 30-country map and DROPS
   * any entry the map lacks, so a postal-code id sent there would be discarded while the campaign
   * was created targeting something else.
   */
  private readonly googleDispatchedPostalGeoTargets = computed(() => (this.googlePostalGeoAvailable() ? this.googlePostalGeoTargets() : []));

  /** The radius targets a create would carry: the list on a channel that takes them, else nothing. */
  private readonly googleDispatchedProximityTargets = computed(() => (this.googleProximityChannel() ? this.googleProximityTargets() : []));

  /**
   * Countries and postal codes count against ONE cap, because they are one list upstream:
   * `resolveGeoList` checks `maxGeoTargets` against the `geoTargets` slice as a whole.
   *
   * Only the postal ids that will be SENT are counted. Ids held on the legacy road are neither shown
   * nor sent there, so counting them would refuse countries for a reason the operator cannot see or
   * remove. The postal box itself renders only where the ids are sent, so its own cap is unaffected.
   */
  protected readonly googleGeoTargetCount = computed(() => this.googleGeoTargets().length + this.googleDispatchedPostalGeoTargets().length);
  protected readonly googleGeoTargetsFull = computed(() => this.googleGeoTargetCount() >= GOOGLE_ADS_MAX_GEO_TARGETS);
  /**
   * Whether the list a create would send is OVER the cap — reachable only when postal ids held while
   * the capability was unanswered are released by a late yes, after countries were added in the
   * meantime (the add guards cannot see held ids). Create waits rather than letting the BFF refuse it.
   */
  protected readonly googleGeoTargetsOverCap = computed(() => this.googleGeoTargetCount() > GOOGLE_ADS_MAX_GEO_TARGETS);

  /**
   * Whether the "one type per create" note under the Google type row is shown (#4755): only on the
   * campaign-service road, and only when there is more than one type to choose between.
   *
   * One signal for the note AND for the checkboxes' `aria-describedby`, so a box never points at a
   * note that is not rendered. The description is what tells a screen-reader user why ticking one
   * type unticks the others.
   */
  protected readonly googleChannelNoteShown = computed(() => this.googleCreativeAvailable() && (this.demandGenAvailable() || this.googleChannelsAvailable()));

  /**
   * Why Create waits when more than one Google campaign type is ticked on the campaign-service road
   * (#4755), or null when it does not.
   *
   * That road creates ONE type per create: `canSubmit` returns false for a pair because
   * `createCampaigns` refuses every one. `onGoogleChannelPicked` keeps a click from ticking a second
   * type once that road is known, so two routes remain: a restored draft saved with several, and a
   * pair ticked while the capability was still unanswered (`null` reads as the legacy road, where a
   * pair is allowed) that then resolves to this one. Without this the button sits disabled with
   * nothing on screen saying why. Named rather than cleared: dropping a restored choice unseen would
   * decide for the operator which campaign to make.
   */
  protected readonly googleChannelConflict = computed<string | null>(() => {
    void this.campaignFormRevision();
    // No `showGoogleSection` test: the one consumer renders inside that section's own `@if`.
    if (!this.googleCreativeAvailable()) return null;
    const channels = this.selectedGoogleChannels();
    if (channels.length < 2) return null;
    const labels = channels.map((channel) => GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel]);
    const listed = `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
    // The BFF refusal's first sentence (`createCampaigns`), and like that refusal it does NOT promise a
    // second type can then be added to the same brief: that depends on the campaign-service version
    // deployed, and a retry into a refusal after the first create has spent budget is worse than
    // saying nothing.
    return `${listed} cannot be created together. Keep one selected to create it.`;
  });

  /** The postal-code box's text as the add would judge it — trimmed with Go's rules, as the callout. */
  private readonly googlePostalGeoDraftText = computed(() => googleAdsTrimSpace(this.googlePostalGeoDraft()));

  /**
   * Whether the text in the postal-code box is not a geo target constant id at all — a postal code
   * typed as itself (`94103`, `SW1A 1AA`) is the likely case. False while the box is empty. A
   * five-digit US ZIP is digits too and is NOT caught here: it is a well-formed id that names some
   * other place, which only Google can tell, and the hint under the box says so.
   */
  protected readonly googlePostalGeoDraftNotId = computed(() => {
    const text = this.googlePostalGeoDraftText();
    return text !== '' && !GOOGLE_ADS_GEO_TARGET_ID_PATTERN.test(text);
  });

  /** Digits, but not the canonical spelling upstream requires — `02840`, `0`, a 21-digit run. */
  protected readonly googlePostalGeoDraftNotCanonical = computed(() => {
    const text = this.googlePostalGeoDraftText();
    return GOOGLE_ADS_GEO_TARGET_ID_PATTERN.test(text) && !isCanonicalGoogleAdsResourceId(text);
  });

  /** Already a chip. Upstream collapses the repeat, so refusing it here only spares a dead chip. */
  protected readonly googlePostalGeoDraftDuplicate = computed(() => {
    const text = this.googlePostalGeoDraftText();
    return text !== '' && this.googlePostalGeoTargets().includes(text);
  });

  /** The message line describing the postal-code box, or null when it is clean. */
  protected readonly googlePostalGeoDraftErrorId = computed<string | null>(() => {
    if (this.googlePostalGeoDraftNotId()) return 'google-postal-not-id';
    if (this.googlePostalGeoDraftNotCanonical()) return 'google-postal-not-canonical';
    if (this.googlePostalGeoDraftDuplicate()) return 'google-postal-duplicate';
    return null;
  });

  /**
   * A well-formed id SHORTER than any postal-code id in Google's table — most likely a ZIP typed as
   * itself (`94103`). A WARNING, not a refusal: upstream accepts the entry, which names some other
   * criterion or nothing, and an operator who really meant a region id must still be able to add it.
   * Only raised when the box is otherwise clean, so it never competes with a real error line.
   */
  protected readonly googlePostalGeoDraftLooksLikePostalCode = computed(() => {
    if (this.googlePostalGeoDraftErrorId() !== null) return false;
    const text = this.googlePostalGeoDraftText();
    return text !== '' && text.length < GOOGLE_ADS_POSTAL_GEO_ID_MIN_DIGITS;
  });

  /** What the postal-code box points `aria-describedby` at: its error, else the warning, else the hint. */
  protected readonly googlePostalGeoDraftDescribedBy = computed(() => {
    if (this.googlePostalGeoDraftErrorId()) return this.googlePostalGeoDraftErrorId();
    return this.googlePostalGeoDraftLooksLikePostalCode() ? 'google-postal-looks-like-code' : 'google-postal-hint';
  });

  /**
   * The radius sub-form's three numbers, parsed: `null` for an empty box (not filled in yet), `NaN`
   * for text that is not a number. Kept apart so the warnings below fire on what was typed, and the
   * add button's disabled state alone covers what was not.
   */
  private readonly googleProximityDraftNumbers = computed(() => {
    const draft = this.googleProximityDraft();
    return {
      latitude: this.parseGoogleProximityNumber(draft.latitude),
      longitude: this.parseGoogleProximityNumber(draft.longitude),
      radius: this.parseGoogleProximityNumber(draft.radius),
    };
  });

  /** Typed and not a finite latitude in -90..90 — `validateProximityTargets`' first two checks. */
  protected readonly googleProximityLatitudeInvalid = computed(() => {
    const { latitude } = this.googleProximityDraftNumbers();
    return latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90);
  });

  /** Typed and not a finite longitude in -180..180. */
  protected readonly googleProximityLongitudeInvalid = computed(() => {
    const { longitude } = this.googleProximityDraftNumbers();
    return longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180);
  });

  /** Typed and not a finite radius above zero. */
  protected readonly googleProximityRadiusInvalid = computed(() => {
    const { radius } = this.googleProximityDraftNumbers();
    return radius !== null && (!Number.isFinite(radius) || radius <= 0);
  });

  /**
   * The picked unit's ceiling, or null before a unit is picked. Each unit has its OWN ceiling — the
   * two are not a converted pair — so the bound cannot be shown until the unit is known.
   */
  protected readonly googleProximityMaxRadius = computed<number | null>(() => {
    const unit = this.googleProximityDraft().radiusUnit;
    return unit === '' ? null : GOOGLE_ADS_MAX_RADIUS[unit];
  });

  /** Over the picked unit's ceiling. Equal is accepted: upstream refuses only `radius > max`. */
  protected readonly googleProximityRadiusOverMax = computed(() => {
    const { radius } = this.googleProximityDraftNumbers();
    const max = this.googleProximityMaxRadius();
    return max !== null && radius !== null && Number.isFinite(radius) && radius > max;
  });

  /** The message line describing the radius box, or null when it is clean. */
  protected readonly googleProximityRadiusErrorId = computed<string | null>(() => {
    if (this.googleProximityRadiusInvalid()) return 'google-proximity-radius-invalid';
    if (this.googleProximityRadiusOverMax()) return 'google-proximity-radius-too-large';
    return null;
  });

  /** The same point, radius and unit as an entry already on the list. */
  protected readonly googleProximityDuplicate = computed(() => {
    const { latitude, longitude, radius } = this.googleProximityDraftNumbers();
    const unit = this.googleProximityDraft().radiusUnit;
    return this.googleProximityTargets().some((t) => t.latitude === latitude && t.longitude === longitude && t.radius === radius && t.radiusUnit === unit);
  });

  protected readonly googleProximityFull = computed(() => this.googleProximityTargets().length >= GOOGLE_ADS_MAX_PROXIMITY_TARGETS);

  /**
   * Whether the radius add button is withheld — {@link googleSitelinkAddDisabled}'s rule: the empty
   * boxes and the unpicked unit are "not filled in yet", and every warning above withholds it too.
   */
  protected readonly googleProximityAddDisabled = computed(() => {
    const { latitude, longitude, radius } = this.googleProximityDraftNumbers();
    if (latitude === null || longitude === null || radius === null || this.googleProximityDraft().radiusUnit === '') return true;
    return (
      this.googleProximityFull() ||
      this.googleProximityLatitudeInvalid() ||
      this.googleProximityLongitudeInvalid() ||
      this.googleProximityRadiusInvalid() ||
      this.googleProximityRadiusOverMax() ||
      this.googleProximityDuplicate()
    );
  });

  /**
   * The event country as Google would read it: trimmed and upper-cased, because the map's keys are
   * upper-case and `countryCode` is a free-text control an operator can type `de` into.
   *
   * Empty is a real answer, and it is NOT a refusal anywhere on the road: the BFF drops blank
   * entries BEFORE its shape test and omits the key on an empty result, and campaign-service accepts
   * a Google create with no geo targeting and logs that the campaign will serve wherever the ad
   * account allows. So a blank `countryCode` with no chips buys an UNRESTRICTED campaign against a
   * real budget, and the only thing standing in front of that is the alert the section renders —
   * which says exactly this, and must keep saying it. Nothing here turns it into a refusal on the
   * client either: upstream accepts the empty case, and a guard that refuses a create upstream would
   * have taken is the one failure mode worse than the warning.
   *
   * Read through a `typeof` guard rather than straight off the signal, for the same reason
   * `normalizeGeoTargets` guards each entry: `applyDraft` patches `countryCode` from the saved
   * draft, and `patchValue` writes an `undefined` key as a value — a draft persisted before the
   * field existed therefore leaves a nonNullable control holding `undefined`, and this computed is
   * evaluated by the template on every Google render. The sibling Meta path survives that only
   * because the helper it calls drops non-strings.
   */
  protected readonly googleGeoFallbackCode = computed<string>(() => {
    const code = this.countryCodeValue() as string | null | undefined;
    return typeof code === 'string' ? code.trim().toUpperCase() : '';
  });

  protected readonly showMetaSection = computed(() => this.selectedPlatforms().includes('meta-ads'));

  protected readonly showMicrosoftSection = computed(() => this.selectedPlatforms().includes('microsoft-ads'));

  /**
   * Whether the tab holds X at all. The section renders its fields only on `twitterCreateAvailable`;
   * held without it, the section is the `twitterCreateBlock` and a Remove.
   */
  protected readonly showTwitterSection = computed(() => this.selectedPlatforms().includes('twitter-ads'));

  /**
   * The geo list a Microsoft create would ACTUALLY send — one value for the preview and `submit()`,
   * on the same rule as `metaEffectiveGeoTargets`, so the screen cannot claim one target while the
   * request buys another.
   *
   * NO eligibility filter, and that difference from Meta is deliberate rather than an omission.
   * Meta has a client-side ineligible set because Meta refuses those codes at the ad set, AFTER
   * the campaign POST. Microsoft resolves every ISO-2 code against its own geographical-locations
   * file at create time and fails BEFORE anything is created, so an unresolvable code costs a
   * clear upstream error rather than a half-built campaign. Duplicating that resolution here would
   * be a second list that could only drift from Microsoft's own.
   *
   * Empty is a real answer: it means nothing usable was supplied, and `canSubmit` blocks on it
   * rather than letting Microsoft serve the campaign EVERYWHERE.
   */
  protected readonly microsoftEffectiveGeoTargets = computed<string[]>(() => {
    const chips = normalizeMicrosoftGeoTargets(this.microsoftGeoTargets());
    if (chips.length > 0) return chips;
    return normalizeMicrosoftGeoTargets([this.countryCodeValue()]);
  });

  /**
   * The keywords a Microsoft create would ACTUALLY send.
   *
   * Blank-text entries are dropped rather than counted: a whitespace-only term is not something
   * Microsoft can match a query against, so letting one satisfy the "at least one" rule would
   * produce exactly the unservable campaign the guard exists to prevent. The server applies the
   * same filter — see `buildMicrosoftConfig` — so both doors agree.
   *
   * DE-DUPED by `(matchType, case-folded text)`, first occurrence wins, mirroring the client's
   * `validateKeywords` exactly. The add-time guard alone was not enough: it can only refuse a NEW
   * row, and `onMicrosoftKeywordMatchTypeChange` can move an existing row onto another's pair
   * afterwards. The client drops such a duplicate silently (`continue`, not an error), so the
   * count, the "at least one" gate and the dispatched payload would otherwise all overstate what
   * Microsoft actually receives — the operator sees two keywords and one is created.
   *
   * De-duping HERE rather than refusing the match-type change keeps the operator's edit intact;
   * the row list still shows what they typed, while every count derived from this signal is the
   * truth about the request. `microsoftDuplicateKeywordCount` is what surfaces the difference.
   */
  protected readonly microsoftEffectiveKeywords = computed<MicrosoftKeyword[]>(() => {
    const seen = new Set<string>();
    return this.microsoftKeywords()
      .filter((k) => k.text?.trim())
      .map((k) => ({ text: k.text.trim(), matchType: k.matchType }))
      .filter((k) => {
        // Same key shape as the client: match type, NUL, case-folded text.
        const key = `${k.matchType}\u0000${k.text.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  });

  /**
   * How many keyword rows the request will DROP as duplicates, for the hint under the list.
   *
   * Counted against the blank-filtered raw list rather than the raw list itself, so a whitespace
   * row is not reported as a duplicate — it is dropped for a different reason the label above
   * already reflects.
   */
  protected readonly microsoftDuplicateKeywordCount = computed<number>(
    () => this.microsoftKeywords().filter((k) => k.text?.trim()).length - this.microsoftEffectiveKeywords().length
  );

  /**
   * The CPC bid the request will carry, or null for "unset".
   *
   * BLANK means unset, which is a valid, documented, serve-capable state — Microsoft applies the
   * account-currency minimum.
   *
   * A non-blank value that is unparseable or out of range returns null HERE, but that does NOT mean
   * "send the default": `microsoftCpcBidValid` blocks the submit for exactly that state, so the
   * operator is told rather than quietly given a bid other than the one the box shows. An earlier
   * version of this comment said such input "degrades to the safe default", which described the
   * behaviour before that guard existed and would now read as licence to remove it.
   */
  protected readonly microsoftEffectiveCpcBid = computed<number | null>(() => {
    const raw = this.microsoftCpcBid().trim();
    if (raw === '') return null;
    const parsed = Number(raw);
    // Only an IN-RANGE bid is forwarded. Out-of-range values are not silently dropped to null and
    // sent as "unset" — `microsoftCpcBidValid` blocks the submit for them, so the operator is told
    // rather than quietly given a different bid from the one the box still shows.
    if (!Number.isFinite(parsed) || parsed < MICROSOFT_MIN_CPC_BID || parsed > MICROSOFT_MAX_CPC_BID) return null;
    return parsed;
  });

  /** Rune length of the in-progress keyword — `[...s].length`, never `.length`. */
  protected readonly microsoftKeywordDraftLength = computed(() => [...this.microsoftKeywordDraft().trim()].length);

  protected readonly microsoftKeywordDraftTooLong = computed(() => this.microsoftKeywordDraftLength() > MICROSOFT_MAX_KEYWORD_TEXT_LENGTH);

  /**
   * Rune length of the in-progress callout — `[...s].length`, never `.length`, matching upstream's
   * `utf8.RuneCountInString`, after Go's trim. See {@link GOOGLE_ADS_MAX_CALLOUT_TEXT_RUNES}.
   */
  protected readonly googleCalloutDraftLength = computed(() => [...googleAdsTrimSpace(this.googleCalloutDraft())].length);

  protected readonly googleCalloutDraftTooLong = computed(() => this.googleCalloutDraftLength() > GOOGLE_ADS_MAX_CALLOUT_TEXT_RUNES);

  /**
   * Whether the text in the box repeats a callout already chipped, case-folded.
   *
   * Case-folded because upstream is: `validateCallouts` keys its duplicate check on
   * `strings.ToLower(text)` and REFUSES the create rather than de-duplicating. Warning here turns
   * that whole-create refusal into a sentence beside the box, before anything is dispatched. Keyed
   * with Go's own trim and lower-casing, which JS's built-ins do not match.
   */
  protected readonly googleCalloutDraftDuplicate = computed(() => {
    const key = googleAdsToLower(googleAdsTrimSpace(this.googleCalloutDraft()));
    if (key === '') return false;
    return this.googleCallouts().some((c) => googleAdsToLower(c) === key);
  });

  /**
   * The id of the message line currently describing the callout box, or `null` when it is clean.
   *
   * `aria-invalid` alone only marks the field wrong; it never says why. The Meta pixel field above
   * pairs it with `aria-describedby` so a screen reader reads the reason when focus lands on the
   * input, which `role="alert"` cannot do — that fires once, as the line appears. Computed rather
   * than a template ternary because the two messages are mutually exclusive and
   * `.claude/rules/styling.md` forbids nesting ternaries in a binding.
   */
  protected readonly googleCalloutDraftErrorId = computed<string | null>(() => {
    if (this.googleCalloutDraftTooLong()) return 'google-callout-too-long';
    if (this.googleCalloutDraftDuplicate()) return 'google-callout-duplicate';
    return null;
  });

  protected readonly googleCalloutsFull = computed(() => this.googleCallouts().length >= GOOGLE_ADS_MAX_CALLOUTS);

  /**
   * Why the text in the segment box would be refused, or `null` when it is blank or well formed.
   *
   * `validateAudienceSegments`' per-entry branches, after Go's trim: a custom audience is named for
   * what it is — upstream parses it and refuses it on Search — and anything else that is not a
   * `.../userLists/{id}` resource name is refused as unrecognized. A repeat is not here: upstream
   * collapses it rather than refusing, so the add simply declines to chip it twice.
   */
  protected readonly googleAudienceSegmentDraftError = computed<'custom' | 'shape' | null>(() => {
    const trimmed = googleAdsTrimSpace(this.googleAudienceSegmentDraft());
    if (trimmed === '' || GOOGLE_ADS_USER_LIST_RESOURCE_PATTERN.test(trimmed)) return null;
    return GOOGLE_ADS_CUSTOM_AUDIENCE_RESOURCE_PATTERN.test(trimmed) ? 'custom' : 'shape';
  });

  /** The id of the message line describing the segment box, for `aria-describedby`, or `null`. */
  protected readonly googleAudienceSegmentDraftErrorId = computed<string | null>(() => {
    const error = this.googleAudienceSegmentDraftError();
    return error ? `google-audience-segment-${error}` : null;
  });

  protected readonly googleAudienceSegmentsFull = computed(() => this.googleAudienceSegments().length >= GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS);

  /** Rune length of the in-progress sitelink link text. Spread, not `.length` — as the callout. */
  protected readonly googleSitelinkTextLength = computed(() => [...googleAdsTrimSpace(this.googleSitelinkDraft().text)].length);

  protected readonly googleSitelinkTextTooLong = computed(() => this.googleSitelinkTextLength() > GOOGLE_ADS_MAX_SITELINK_TEXT_RUNES);

  /**
   * Whether either description line is over its own bound.
   *
   * EACH line separately, not their total: upstream applies `maxSitelinkDescriptionRunes` to
   * `desc1` and `desc2` in turn, so a pair of 30-rune lines is fine and one 36-rune line is not.
   */
  protected readonly googleSitelinkDescriptionTooLong = computed(() => {
    const draft = this.googleSitelinkDraft();
    return [draft.description1 ?? '', draft.description2 ?? ''].some((d) => [...googleAdsTrimSpace(d)].length > GOOGLE_ADS_MAX_SITELINK_DESCRIPTION_RUNES);
  });

  /**
   * Whether exactly one description line is filled in.
   *
   * Google renders the two lines together and rejects an asset carrying only one, so upstream
   * refuses the whole create on this. Both filled or both empty are the two legal states.
   */
  protected readonly googleSitelinkDescriptionHalfFilled = computed(() => {
    const draft = this.googleSitelinkDraft();
    return (googleAdsTrimSpace(draft.description1 ?? '') === '') !== (googleAdsTrimSpace(draft.description2 ?? '') === '');
  });

  /** Case-folded with Go's rules, as the callout sibling is — upstream refuses, not de-duplicates. */
  protected readonly googleSitelinkDuplicate = computed(() => {
    const key = googleAdsToLower(googleAdsTrimSpace(this.googleSitelinkDraft().text));
    if (key === '') return false;
    return this.googleSitelinks().some((s) => googleAdsToLower(s.text) === key);
  });

  /**
   * Whether the destination in the box is one the ad platforms will refuse.
   *
   * False while the box is EMPTY: an unfilled field is not yet a mistake, and the add button's own
   * disabled state is what withholds the add until it is filled. This warns only about text that
   * is present and unservable.
   */
  protected readonly googleSitelinkUrlInvalid = computed(() => {
    const url = googleAdsTrimSpace(this.googleSitelinkDraft().finalUrl);
    if (url === '') return false;
    return !this.isServableDestination(url);
  });

  /** UTF-8 byte length of a servable destination over upstream's `maxFinalURLBytes`, else 0. */
  protected readonly googleSitelinkUrlBytesOver = computed(() => {
    const url = googleAdsTrimSpace(this.googleSitelinkDraft().finalUrl);
    if (url === '' || this.googleSitelinkUrlInvalid()) return 0;
    const bytes = new TextEncoder().encode(url).length;
    return bytes > GOOGLE_ADS_MAX_FINAL_URL_BYTES ? bytes : 0;
  });

  /** The message line describing the destination box, or null when it is clean. */
  protected readonly googleSitelinkUrlErrorId = computed<string | null>(() => {
    if (this.googleSitelinkUrlInvalid()) return 'google-sitelink-url-invalid';
    if (this.googleSitelinkUrlBytesOver() > 0) return 'google-sitelink-url-too-long';
    return null;
  });

  /**
   * Ids of the message lines currently describing the link-text box and the two description boxes,
   * or `null` when each is clean. Same reason as {@link googleCalloutDraftErrorId}: `aria-invalid`
   * marks the field wrong and `aria-describedby` is what says why once focus returns to it. One
   * computed per group rather than a template ternary, because each group's messages are mutually
   * exclusive and `.claude/rules/styling.md` forbids nesting ternaries in a binding.
   */
  protected readonly googleSitelinkTextErrorId = computed<string | null>(() => {
    if (this.googleSitelinkTextTooLong()) return 'google-sitelink-too-long';
    if (this.googleSitelinkDuplicate()) return 'google-sitelink-duplicate';
    return null;
  });

  protected readonly googleSitelinkDescriptionErrorId = computed<string | null>(() => {
    if (this.googleSitelinkDescriptionHalfFilled()) return 'google-sitelink-half-described';
    if (this.googleSitelinkDescriptionTooLong()) return 'google-sitelink-description-too-long';
    return null;
  });

  protected readonly googleSitelinksFull = computed(() => this.googleSitelinks().length >= GOOGLE_ADS_MAX_SITELINKS);

  /**
   * Whether the add button is withheld. A computed rather than an expression in the template, so
   * the button's condition and `addGoogleSitelink`'s refusals stay one list in one place.
   *
   * The two required fields are withheld as "not filled in yet" rather than warned about, which is
   * why the empty cases live here and not in {@link googleSitelinkUrlInvalid}.
   */
  protected readonly googleSitelinkAddDisabled = computed(() => {
    const draft = this.googleSitelinkDraft();
    if (googleAdsTrimSpace(draft.text) === '' || googleAdsTrimSpace(draft.finalUrl) === '') return true;
    return (
      this.googleSitelinksFull() ||
      this.googleSitelinkTextTooLong() ||
      this.googleSitelinkDuplicate() ||
      this.googleSitelinkDescriptionHalfFilled() ||
      this.googleSitelinkDescriptionTooLong() ||
      this.googleSitelinkUrlInvalid() ||
      this.googleSitelinkUrlBytesOver() > 0
    );
  });

  /**
   * The snippet box's values as a list: split on newlines, trimmed with Go's rules, blanks dropped.
   *
   * REPEATS ARE KEPT, in the order they were typed. That is what makes this the list upstream's own
   * value loop walks: it skips blanks, then checks each remaining value's rune bound, and only then
   * collapses case-folded repeats — so an over-long value that merely repeats an earlier one is
   * still refused, and a list that de-duplicated first would never see it.
   */
  protected readonly googleSnippetDraftValues = computed(() =>
    this.googleStructuredSnippetDraft()
      .values.split('\n')
      .map((value) => googleAdsTrimSpace(value))
      .filter((value) => value !== '')
  );

  /**
   * How many values the snippet would actually RENDER: the list above with case-folded repeats
   * collapsed, which is the number upstream counts against both bounds.
   *
   * Upstream's own words for why the order matters: "three values of which two are the same renders
   * as two, which is below what Google accepts".
   */
  protected readonly googleSnippetDistinctValueCount = computed(() => new Set(this.googleSnippetDraftValues().map((v) => googleAdsToLower(v))).size);

  /** Rune length of the in-progress snippet header. Spread, not `.length` — as the callout. */
  protected readonly googleSnippetHeaderLength = computed(() => [...googleAdsTrimSpace(this.googleStructuredSnippetDraft().header)].length);

  protected readonly googleSnippetHeaderTooLong = computed(() => this.googleSnippetHeaderLength() > GOOGLE_ADS_MAX_SNIPPET_HEADER_RUNES);

  /**
   * Whether the header in the box is already on the list, case-folded with Go's rules.
   *
   * Upstream REFUSES rather than merging: Google serves one line per header, so a campaign listing
   * the same header twice would silently drop the second.
   */
  protected readonly googleSnippetHeaderDuplicate = computed(() => {
    const key = googleAdsToLower(googleAdsTrimSpace(this.googleStructuredSnippetDraft().header));
    if (key === '') return false;
    return this.googleStructuredSnippets().some((s) => googleAdsToLower(s.header) === key);
  });

  /** The rune length of the first over-long value in the box, or 0 when every value fits. */
  protected readonly googleSnippetValueOverLength = computed(() => {
    const over = this.googleSnippetDraftValues().find((value) => [...value].length > GOOGLE_ADS_MAX_SNIPPET_VALUE_RUNES);
    return over === undefined ? 0 : [...over].length;
  });

  /**
   * Whether the box holds too few DISTINCT values to render.
   *
   * False while the box is EMPTY, on the rule {@link googleSitelinkUrlInvalid} follows: an unfilled
   * field is not yet a mistake, and the add button's own disabled state is what withholds the add
   * until it is filled. This warns only about values that are present and unservable as a set.
   */
  protected readonly googleSnippetTooFewValues = computed(() => {
    if (this.googleSnippetDraftValues().length === 0) return false;
    return this.googleSnippetDistinctValueCount() < GOOGLE_ADS_MIN_SNIPPET_VALUES;
  });

  protected readonly googleSnippetTooManyValues = computed(() => this.googleSnippetDistinctValueCount() > GOOGLE_ADS_MAX_SNIPPET_VALUES);

  /**
   * Ids of the message lines currently describing the header box and the values box, or `null` when
   * each is clean. Same reason as {@link googleCalloutDraftErrorId}, and the same one-computed-per-
   * group shape as the sitelink sub-form's two.
   */
  protected readonly googleSnippetHeaderErrorId = computed<string | null>(() => {
    if (this.googleSnippetHeaderTooLong()) return 'google-snippet-header-too-long';
    if (this.googleSnippetHeaderDuplicate()) return 'google-snippet-header-duplicate';
    return null;
  });

  protected readonly googleSnippetValuesErrorId = computed<string | null>(() => {
    if (this.googleSnippetValueOverLength() > 0) return 'google-snippet-value-too-long';
    if (this.googleSnippetTooFewValues()) return 'google-snippet-too-few-values';
    if (this.googleSnippetTooManyValues()) return 'google-snippet-too-many-values';
    return null;
  });

  protected readonly googleStructuredSnippetsFull = computed(() => this.googleStructuredSnippets().length >= GOOGLE_ADS_MAX_STRUCTURED_SNIPPETS);

  /**
   * The added snippets with their values pre-joined for display. A computed rather than `.join()`
   * in the `@for`: `docs/reviews/frontend-checklist.md` permits signal reads, computeds and pipes
   * in bindings but not logic-bearing calls, which here would re-run once per row on every
   * change-detection pass. Same reason as {@link microsoftEffectiveGeoLabel}, applied per row.
   *
   * `header` is carried through unchanged so the template keeps tracking by it — the add refuses a
   * case-folded duplicate, which is what makes the header a stable identity for the whole list.
   */
  protected readonly googleStructuredSnippetRows = computed(() =>
    this.googleStructuredSnippets().map((snippet) => ({ header: snippet.header, valuesLabel: snippet.values.join(', ') }))
  );

  /**
   * Whether the snippet add button is withheld — the sitelink sub-form's rule exactly, so the
   * button's condition and {@link addGoogleStructuredSnippet}'s refusals stay one list in one place.
   */
  protected readonly googleStructuredSnippetAddDisabled = computed(() => {
    if (googleAdsTrimSpace(this.googleStructuredSnippetDraft().header) === '' || this.googleSnippetDraftValues().length === 0) return true;
    return (
      this.googleStructuredSnippetsFull() ||
      this.googleSnippetHeaderTooLong() ||
      this.googleSnippetHeaderDuplicate() ||
      this.googleSnippetValueOverLength() > 0 ||
      this.googleSnippetTooFewValues() ||
      this.googleSnippetTooManyValues()
    );
  });

  /**
   * Why the call extension in the sub-form would be refused, or `null` when it would not — or when
   * either box is still EMPTY, on the rule {@link googleSitelinkUrlInvalid} follows: an unfilled field
   * is not yet a mistake, and the add button's own disabled state withholds the add until it is filled.
   *
   * One computed for the whole sub-form rather than one per refusal, because the refusals come from
   * the shared judge as sentences already; the add button and {@link addGoogleCallExtension} read the
   * same judge, so the three cannot disagree.
   */
  protected readonly googleCallExtensionDraftError = computed<string | null>(() => {
    const call = this.googleCallExtensionFromDraft(this.googleCallExtensionDraft());
    if (call.countryCode === '' || call.phoneNumber === '') return null;
    return googleCallExtensionRefusal(call, this.googleCallExtensions());
  });

  protected readonly googleCallExtensionsFull = computed(() => this.googleCallExtensions().length >= GOOGLE_ADS_MAX_CALL_EXTENSIONS);

  protected readonly googleCallExtensionAddDisabled = computed(() => {
    const call = this.googleCallExtensionFromDraft(this.googleCallExtensionDraft());
    return this.googleCallExtensionsFull() || call.countryCode === '' || call.phoneNumber === '' || this.googleCallExtensionDraftError() !== null;
  });

  /**
   * The promotion sub-form's refusal, on {@link googleCallExtensionDraftError}'s rule: silent until
   * the three boxes every promotion needs — what is on sale, the discount and the destination — are
   * filled, then the selected condition's own refusal ({@link googlePromotionConditionRefusal}), then
   * upstream's first refusal for what is in the form.
   */
  protected readonly googlePromotionDraftError = computed<string | null>(() => {
    const draft = this.googlePromotionDraft();
    if ([draft.promotionTarget, draft.discount, draft.finalUrl].some((text) => googleAdsTrimSpace(text) === '')) return null;
    return this.googlePromotionConditionRefusal(draft) ?? googlePromotionRefusal(this.googlePromotionFromDraft(draft), this.googlePromotions());
  });

  protected readonly googlePromotionsFull = computed(() => this.googlePromotions().length >= GOOGLE_ADS_MAX_PROMOTIONS);

  /** Whether the promotion form needs a currency: only when one of its two money fields is in use. */
  protected readonly googlePromotionNeedsCurrency = computed(() => {
    const draft = this.googlePromotionDraft();
    return draft.discountKind === 'amount' || draft.eligibilityKind === 'ordersOver';
  });

  protected readonly googlePromotionAddDisabled = computed(() => {
    const draft = this.googlePromotionDraft();
    if ([draft.promotionTarget, draft.discount, draft.finalUrl].some((text) => googleAdsTrimSpace(text) === '')) return true;
    return this.googlePromotionsFull() || this.googlePromotionDraftError() !== null;
  });

  /**
   * The price sub-form's refusal, on the same rule: silent until every box a price table needs is
   * filled — type, language, currency, and each row's header, description, price and destination —
   * then upstream's first refusal for the table.
   */
  protected readonly googlePriceDraftError = computed<string | null>(() => {
    const draft = this.googlePriceDraft();
    if (!this.googlePriceDraftFilled(draft)) return null;
    return googlePriceExtensionRefusal(this.googlePriceFromDraft(draft));
  });

  protected readonly googlePricesFull = computed(() => this.googlePrices().length >= GOOGLE_ADS_MAX_PRICE_EXTENSIONS);

  protected readonly googlePriceAddDisabled = computed(
    () => this.googlePricesFull() || !this.googlePriceDraftFilled(this.googlePriceDraft()) || this.googlePriceDraftError() !== null
  );

  /**
   * The added promotions and price tables as display rows, so the template binds labels rather than
   * formatting on every change-detection pass — the reason {@link googleStructuredSnippetRows} gives.
   * `key` is the identity the add guard makes unique (the case-folded target), or the list position
   * for prices, which upstream does not de-duplicate against one another.
   */
  protected readonly googlePromotionRows = computed(() =>
    this.googlePromotions().map((promotion) => ({
      key: promotion.promotionTarget,
      label: promotion.promotionTarget,
      detail: this.googlePromotionDetail(promotion),
      finalUrl: promotion.finalUrl,
    }))
  );

  protected readonly googlePriceRows = computed(() =>
    this.googlePrices().map((price, index) => ({
      key: index,
      label: [price.type, price.priceQualifier].filter(Boolean).join(' · '),
      detail: price.offerings.map((row) => `${row.header} ${row.amount} ${row.currencyCode}`).join(', '),
    }))
  );

  /**
   * The effective geo list as a display string. A computed rather than `.join()` in the template:
   * `docs/reviews/frontend-checklist.md` permits signal reads, computeds and pipes in bindings but
   * not logic-bearing calls, which re-run on every change-detection pass.
   */
  protected readonly microsoftEffectiveGeoLabel = computed(() => this.microsoftEffectiveGeoTargets().join(', '));

  /**
   * Whether the keyword and geo lists are within the bounds the Microsoft client enforces before
   * its first create call. See the constants for the verified upstream values.
   *
   * Reads the EFFECTIVE lists, so blank-text keywords and whitespace geos are excluded from the
   * counts exactly as the dispatched payload excludes them — counting the raw signals would block
   * a form whose actual request is within bounds.
   */
  protected readonly microsoftBoundsValid = computed<boolean>(() => {
    const keywords = this.microsoftEffectiveKeywords();
    if (keywords.length > MICROSOFT_MAX_KEYWORDS) return false;
    if (keywords.some((k) => [...k.text].length > MICROSOFT_MAX_KEYWORD_TEXT_LENGTH)) return false;
    // MATCH TYPE, for the same reason the caps above are here. The add handler and the `<select>`
    // can only produce the three canonical values, but `applyDraft` replays a draft VERBATIM by
    // design, so a draft can carry a value neither can produce.
    //
    // NOT a case problem: `isMicrosoftMatchType` folds case and trims, so `EXACT` and ` exact `
    // are both accepted here exactly as they are upstream. What it rejects is a value outside
    // {exact, phrase, broad} entirely — Google's `BROAD_MATCH` is the realistic one, since the
    // brief's keyword stage is shared with Google Ads and a draft written from a Google-shaped
    // brief can hold it.
    //
    // The BFF filters on the same predicate and refuses the WHOLE microsoftConfig when a keyword
    // fails it, so without this check the form reported the campaign as ready and the create came
    // back as a generic unconfigured platform. Checking it here makes the block visible instead.
    if (keywords.some((k) => !isMicrosoftMatchType(k.matchType))) return false;
    return this.microsoftEffectiveGeoTargets().length <= MICROSOFT_MAX_GEO_TARGETS;
  });

  /**
   * Whether the CPC bid box holds something dispatchable.
   *
   * BLANK is valid and means unset — Microsoft then applies the account-currency minimum, a
   * documented serve-capable floor, so an untouched box must not block anything.
   *
   * A non-blank value must parse AND fall within `[MICROSOFT_MIN_CPC_BID, MICROSOFT_MAX_CPC_BID]`.
   * The client refuses anything outside that range (`targeting.go:263-268`), and because
   * `CreateCampaigns` is asynchronous the refusal arrives as a FAILED JOB the operator has to go
   * and read — not as an error on the click they just made. Catching it here converts a dead job
   * into an inline message.
   *
   * Deliberately NOT folded into `microsoftEffectiveCpcBid` returning null: null means "send no
   * bid", and treating `1001` as unset would dispatch a campaign at the account minimum while the
   * form still displayed 1001 — a silent substitution of a spend decision the operator did make.
   */
  protected readonly microsoftCpcBidValid = computed<boolean>(() => {
    const raw = this.microsoftCpcBid().trim();
    if (raw === '') return true;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= MICROSOFT_MIN_CPC_BID && parsed <= MICROSOFT_MAX_CPC_BID;
  });

  /** Whether the pixel field applies at all — only `conversions` carries a promoted pixel object. */
  protected readonly metaRequiresPixel = computed(() => this.metaObjective() === 'conversions');

  /**
   * Whether at least one SELECTABLE placement is on.
   *
   * Mirrors campaign-service's `buildPlacementTargeting`, which refuses a request whose
   * `publisher_platforms` list comes out empty. `messengerInbox` is excluded from the count
   * because it cannot contribute a platform there either — it is rejected outright before the
   * emptiness check is even reached — so counting it would let the UI pass a config the service
   * fails twice over.
   */
  protected readonly metaHasPlacement = computed(() => {
    const placements = this.metaPlacements();
    return this.metaSelectablePlacements.some((key) => placements[key]);
  });

  /**
   * Whether the ad set runs on Instagram — Instagram Feed, Stories or Reels, the three placements
   * campaign-service maps to Instagram positions (`meta.UsesInstagram`). Only then is the Instagram
   * account id sent, and only then does Meta need it to publish.
   */
  protected readonly metaUsesInstagram = computed(() => {
    const placements = this.metaPlacements();
    return placements.instagramFeed || placements.stories || placements.reels;
  });

  /** The targeted countries that make Meta require the EU DSA disclosures, in request order. */
  protected readonly metaDsaCountries = computed<string[]>(() => this.metaEffectiveGeoTargets().filter((c) => META_DSA_TERRITORIES.has(c)));

  /**
   * Why the Instagram account id cannot be sent, or `null`. Required only when the capability is on
   * AND an Instagram placement is enabled — Meta creates the ad without it but will not publish it.
   * Numeric, as campaign-service's `numericIDRE` requires; trimmed first because upstream trims.
   */
  protected readonly metaInstagramUserIdError = computed<string | null>(() => {
    if (!this.metaInstagramDsaAvailable() || !this.metaUsesInstagram()) return null;
    const id = this.metaInstagramDsaDraft().instagramUserId.trim();
    if (id === '') return 'An Instagram account ID is required for the Instagram placements. Enter it, or turn off Instagram Feed, Stories and Reels.';
    if (!META_NUMERIC_ID_PATTERN.test(id)) return 'The Instagram account ID must be numeric.';
    return null;
  });

  /** Why the DSA beneficiary cannot be sent, or `null` — see `metaDsaFieldError`. */
  protected readonly metaDsaBeneficiaryError = computed<string | null>(() => this.metaDsaFieldError('dsaBeneficiary'));
  /** Why the DSA payor cannot be sent, or `null` — see `metaDsaFieldError`. */
  protected readonly metaDsaPayorError = computed<string | null>(() => this.metaDsaFieldError('dsaPayor'));

  /**
   * The three keys `submit` adds to `metaConfig`, or none. Off: nothing, so the create is exactly
   * the one before this shipped (and the create route refuses the keys). On: the Instagram id only
   * for an Instagram placement, and the disclosures only as a pair — `canSubmit` has already blocked
   * a one-sided or an EU-without-both state, so a lone value is never sent.
   */
  protected readonly metaInstagramDsaFields = computed<Pick<MetaCampaignCreateRequest, 'instagramUserId' | 'dsaBeneficiary' | 'dsaPayor'>>(() => {
    if (!this.metaInstagramDsaAvailable()) return {};
    const draft = this.metaInstagramDsaDraft();
    const instagramUserId = draft.instagramUserId.trim();
    const dsaBeneficiary = draft.dsaBeneficiary.trim();
    const dsaPayor = draft.dsaPayor.trim();
    return {
      ...(this.metaUsesInstagram() && instagramUserId !== '' ? { instagramUserId } : {}),
      ...(dsaBeneficiary !== '' && dsaPayor !== '' ? { dsaBeneficiary, dsaPayor } : {}),
    };
  });

  /**
   * The placement entries that DIFFER from `META_DEFAULT_PLACEMENTS`, which is all the payload
   * needs to carry: campaign-service merges the override map field-by-field over the same
   * defaults, so an omitted key and a key repeating the default are indistinguishable upstream.
   *
   * `messengerInbox` can never appear. It is `false` in the defaults and no code path sets it
   * `true`, so the difference filter drops it — the payload cannot carry the one value the
   * service rejects outright.
   */
  protected readonly metaPlacementOverrides = computed<Partial<MetaPlacement>>(() => {
    const placements = this.metaPlacements();
    const overrides: Partial<MetaPlacement> = {};
    for (const key of Object.keys(placements) as (keyof MetaPlacement)[]) {
      if (placements[key] !== META_DEFAULT_PLACEMENTS[key]) overrides[key] = placements[key];
    }
    return overrides;
  });

  /**
   * Whether the pixel id is acceptable for the CURRENT objective.
   *
   * True whenever no pixel is required, because a stale value left in the box after switching
   * away from `conversions` is not sent and cannot fail. Under `conversions` the id must be
   * non-empty AND numeric: campaign-service's `buildPromotedObject` applies exactly these two
   * checks, and it applies them BEFORE any mutating call — so catching a malformed id here
   * changes nothing about the outcome, only about whether the user waits for a round trip to
   * hear it. Trimmed first because upstream trims before both checks, so `' '` must read as
   * empty here too rather than passing a truthiness test locally and being refused there.
   */
  protected readonly metaPixelValid = computed(() => {
    if (!this.metaRequiresPixel()) return true;
    const trimmed = this.metaPixelId().trim();
    return trimmed !== '' && META_NUMERIC_ID_PATTERN.test(trimmed);
  });
  protected readonly selectedLinkedInAccount = computed(() => {
    const accounts = this.linkedInAccounts();
    return accounts.find((a) => a.accountId === this.linkedInAccountId()) ?? accounts[0];
  });

  /**
   * What each platform's Bidding control renders (#3299): the choice, and why it cannot be sent —
   * validated against the rest of that platform's config by the same shared rules
   * `biddingPayloads` applies, so the message on screen is the reason the create is blocked.
   */
  protected readonly biddingViews: Signal<Record<CampaignBiddingPlatform, CampaignBiddingControlView>> = this.initBiddingViews();

  /**
   * The `bidding` object each platform's config carries, or `null` where the choice cannot be sent.
   * `canSubmit` blocks on a `null` for a selected platform, so `submit` never has to choose between
   * dropping a refused manual bid (which would create the campaign automatic) and sending it.
   */
  protected readonly biddingPayloads: Signal<Record<CampaignBiddingPlatform, CampaignBiddingConfig | null>> = this.initBiddingPayloads();

  /**
   * Why Create is blocked for a Manual bidding choice this tab still holds but cannot send (#3299),
   * or `null`. While the capability is not an explicit yes the control is hidden and `bidding` is
   * not sent — and campaign-service reads an absent `bidding` as AUTOMATIC. So a Manual choice
   * retained in the draft (made earlier, before a tab round-trip left the capability unanswered or
   * false) must block the create rather than be dropped: pending says it is checking, failed offers
   * a Retry, and an explicit no asks the operator to switch to Automatic themselves.
   */
  protected readonly biddingCapabilityBlock: Signal<CampaignBiddingCapabilityBlock | null> = this.initBiddingCapabilityBlock();
  /** The always-mounted live region's text for `biddingCapabilityBlock`; `''` when nothing blocks. */
  protected readonly biddingCapabilityMessage = computed(() => this.biddingCapabilityBlock()?.message ?? '');

  /**
   * Why Create is blocked for an uploaded Reddit image this tab still holds but cannot send, or
   * `null`. `redditImageField` withholds the asset unless the upload capability is an explicit yes,
   * so after a tab round-trip clears the capabilities (Optimize, then back) a restored upload would
   * be silently left out of the request — creating the campaign with no image at all. The block
   * keeps the operator's choice explicit instead: pending says it is checking, failed offers a
   * Retry, and an explicit no asks them to remove the image. Not raised while a post URL is set: the
   * asset is withheld then by design, since that post already has its image.
   */
  protected readonly redditImageAssetBlock: Signal<CampaignRedditImageAssetBlock | null> = this.initRedditImageAssetBlock();
  /** Whether the draft holds an uploaded Reddit image made for the brief now open — the only one sent. */
  protected readonly redditImageAssetForThisBrief = computed(
    () => this.redditImageAssetId() !== '' && this.redditImageAssetBriefId() === (this.briefPersistence().briefId ?? '')
  );
  /** The always-mounted live region's text for `redditImageAssetBlock`; `''` when nothing blocks. */
  protected readonly redditImageAssetBlockMessage = computed(() => this.redditImageAssetBlock()?.message ?? '');
  /** The upload control's progress or success line; empty when there is nothing to report. */
  protected readonly redditImageUploadStatusMessage = computed(() => {
    if (this.redditImageUploadStatus() === 'uploading') return 'Uploading image…';
    return this.redditImageAssetForThisBrief() ? `Uploaded: ${this.redditImageAssetName() || 'image'}` : '';
  });
  /**
   * What the always-mounted live region announces: the control's status while it is shown. Kept out
   * of the control so the region is not created and destroyed as upload support settles, which
   * drops the first announcement; while the control is hidden, the asset block's region speaks.
   */
  protected readonly redditImageUploadLiveMessage = computed(() => (this.redditAssetUploadAvailable() ? this.redditImageUploadStatusMessage() : ''));

  /**
   * Why Create is blocked for an uploaded Meta image this tab still holds but cannot send, or
   * `null` — `redditImageAssetBlock`'s sibling, for the same reasons: a restored upload must never
   * be silently left out of the request.
   */
  protected readonly metaImageAssetBlock: Signal<CampaignMetaImageAssetBlock | null> = this.initMetaImageAssetBlock();
  /** Whether the draft holds an uploaded Meta image made for the brief now open — the only one sent. */
  protected readonly metaImageAssetForThisBrief = computed(
    () => this.metaImageAssetId() !== '' && this.metaImageAssetBriefId() === (this.briefPersistence().briefId ?? '')
  );
  /** An upload for the open brief (made, or still running) the request cannot carry: the upload capability is not an explicit yes. */
  private readonly metaAssetWithheld = computed(
    () => (this.metaImageAssetForThisBrief() || this.metaImageUploadStatus() === 'uploading') && !this.metaAssetUploadAvailable()
  );
  /** A pasted image URL the request cannot carry: the image capability is not an explicit yes. */
  private readonly metaImageUrlWithheld = computed(() => this.metaImageUrl() !== '' && !this.metaCreativeAvailable());
  protected readonly metaImageAssetBlockMessage = computed(() => this.metaImageAssetBlock()?.message ?? '');
  protected readonly metaImageUploadStatusMessage = computed(() => {
    if (this.metaImageUploadStatus() === 'uploading') return 'Uploading image…';
    return this.metaImageAssetForThisBrief() ? `Uploaded: ${this.metaImageAssetName() || 'image'}` : '';
  });
  protected readonly metaImageUploadLiveMessage = computed(() => (this.metaAssetUploadAvailable() ? this.metaImageUploadStatusMessage() : ''));
  /**
   * What the variant preview says about the image each ad will carry, read from the same field the
   * payload is (`metaImageField`), so the preview never promises an image the request leaves out.
   */
  protected readonly metaPreviewImageLabel = computed(() => {
    const image = this.metaImageField();
    if ('imageAssetId' in image) return `Image: ${this.metaImageAssetName() || 'uploaded image'}`;
    if ('imageUrl' in image) return `Image: ${image.imageUrl}`;
    return '';
  });

  /**
   * The brief's stored images, read while a Google image slot offers the library. Re-read on every
   * `creativeLibraryRevision` bump, so an upload here or in the Reddit and Meta sections is
   * offered as soon as it is stored.
   */
  protected readonly googleCreativeLibrary: Signal<CreativeAssetLibraryState> = this.initGoogleCreativeLibrary();
  /** Each rendered Google image slot's library controls, keyed `<request key>.<control>`. */
  protected readonly googleImageSlots: Signal<Record<string, GoogleCreativeImageSlotView>> = this.initGoogleImageSlots();
  /**
   * The asset-plan slots "Use suggested images" can fill, as `platform/CHANNEL/slot` in the plan's own
   * vocabulary: one per plan slot name that maps onto a Google image field on screen. The grid offers
   * the button only when the plan suggests an image for one of these, so it never promises a fill the
   * tab cannot make. Empty while no image field is rendered, which `googleImageSlots` already limits to
   * an explicit library yes.
   */
  protected readonly googleSuggestionTargets: Signal<string[]> = this.initGoogleSuggestionTargets();
  /** Bumped on every apply, so the grid announces a repeated result again; 0 when the last apply was for another brief. */
  protected readonly googleSuggestedApplySeq: Signal<number> = computed(() => {
    const result = this.googleSuggestedApply();
    return result !== null && result.briefId === (this.briefPersistence().briefId ?? '') ? result.seq : 0;
  });
  /** The last apply's result for the brief now open, or `''`. */
  protected readonly googleSuggestedApplyResult: Signal<string> = computed(() => {
    const result = this.googleSuggestedApply();
    return result !== null && result.briefId === (this.briefPersistence().briefId ?? '') ? result.message : '';
  });
  /**
   * Why Create is blocked for a stored Google image the request cannot carry, or that
   * campaign-service would refuse, or `null` — `metaImageAssetBlock`'s sibling.
   */
  protected readonly googleImageAssetBlock: Signal<CampaignGoogleImageAssetBlock | null> = this.initGoogleImageAssetBlock();
  protected readonly googleImageAssetBlockMessage = computed(() => this.googleImageAssetBlock()?.message ?? '');

  /**
   * Why Create is blocked for an uploaded LinkedIn image this tab still holds but cannot send, or
   * `null` — `metaImageAssetBlock`'s sibling, less the pasted URL LinkedIn does not have.
   */
  protected readonly linkedInImageAssetBlock: Signal<CampaignLinkedInImageAssetBlock | null> = this.initLinkedInImageAssetBlock();
  /** Whether the draft holds an uploaded LinkedIn image made for the brief now open — the only one sent. */
  protected readonly linkedInImageAssetForThisBrief = computed(
    () => this.linkedInImageAssetId() !== '' && this.linkedInImageAssetBriefId() === (this.briefPersistence().briefId ?? '')
  );
  /** An upload for the open brief (made, or still running) the request cannot carry: the upload capability is not an explicit yes. */
  private readonly linkedInAssetWithheld = computed(
    () => (this.linkedInImageAssetForThisBrief() || this.linkedInImageUploadStatus() === 'uploading') && !this.linkedInAssetUploadAvailable()
  );
  protected readonly linkedInImageAssetBlockMessage = computed(() => this.linkedInImageAssetBlock()?.message ?? '');
  protected readonly linkedInImageUploadStatusMessage = computed(() => {
    if (this.linkedInImageUploadStatus() === 'uploading') return 'Uploading image…';
    return this.linkedInImageAssetForThisBrief() ? `Uploaded: ${this.linkedInImageAssetName() || 'image'}` : '';
  });
  protected readonly linkedInImageUploadLiveMessage = computed(() => (this.linkedInAssetUploadAvailable() ? this.linkedInImageUploadStatusMessage() : ''));
  /**
   * What the variant preview says about the thumbnail each dark post will carry, read from the same
   * condition the payload is (`linkedInImageSent`), so the preview never promises an image the
   * request leaves out.
   */
  protected readonly linkedInPreviewImageLabel = computed(() =>
    this.linkedInImageSent() ? `Image: ${this.linkedInImageAssetName() || 'uploaded image'}` : ''
  );

  /**
   * Why Create is blocked while the tab holds X without an explicit yes from `twitterCreateEnabled`,
   * or `null`. Held, never dropped: a create that silently left X out would launch the other
   * platforms while the brief on screen still names X. Offers Remove X (`onTwitterRemove`).
   */
  protected readonly twitterCreateBlock: Signal<CampaignTwitterCreateBlock | null> = this.initTwitterCreateBlock();
  protected readonly twitterCreateBlockMessage = computed(() => this.twitterCreateBlock()?.message ?? '');

  /**
   * The X daily budget as a number, or `null` when the field is blank or not a plain decimal. Read
   * through `campaignFormRevision` because the control is not a signal. The shape is checked before
   * `Number`, which would otherwise read `1e3` as 1000 and `0x10` as 16 — a typo spent as a budget.
   */
  protected readonly twitterBudgetAmount = computed<number | null>(() => {
    void this.campaignFormRevision();
    const raw = this.campaignForm.controls.twitterBudget.value.trim();
    if (!/^\d+(\.\d+)?$/.test(raw)) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  });

  /** Why the X budget cannot be sent, or `null`: the house floor of 1 and the client's cap (`TWITTER_MAX_BUDGET`). */
  protected readonly twitterBudgetError = computed<string | null>(() => {
    const amount = this.twitterBudgetAmount();
    if (amount === null) return 'Enter a daily budget for X.';
    if (amount < 1 || amount > TWITTER_MAX_BUDGET) return `Enter a daily budget from 1 to ${TWITTER_MAX_BUDGET.toLocaleString('en-US')}.`;
    return null;
  });

  /** The authored tweet's copy as typed. */
  protected readonly twitterTweetText = computed<string>(() => {
    void this.campaignFormRevision();
    return this.campaignForm.controls.twitterTweetText.value;
  });

  /** The composed tweet's weighted length — the copy plus the registration link campaign-service appends. */
  protected readonly twitterTweetLength = computed(() => twitterComposedTweetLength(this.twitterTweetText()));

  /** Why the tweet copy cannot be sent, or `null` — the same rule the BFF applies (`twitterTweetTextError`). */
  protected readonly twitterTweetError = computed(() => twitterTweetTextError(this.twitterTweetText()));

  /**
   * Why the flight cannot be sent to X, or `null` — `twitterFlightErrorAt` at the time of the last
   * form edit. A memo cannot see the clock move, so `submit` asks again at the moment it sends.
   */
  protected readonly twitterFlightError = computed<string | null>(() => {
    void this.campaignFormRevision();
    return this.twitterFlightErrorAt(Date.now());
  });

  /** Bumped by the X account Retry; joins the read's key below, so a click re-reads. */
  private readonly twitterAccountAttempt = signal(0);

  /**
   * Which X ad account the create will use (LFXV2-3319), read while the X section is offered.
   * `twitterConfig` names no account — campaign-service creates under the connection's bound one —
   * so the section shows this rather than a choice. A derived signal over the read, not an effect:
   * `switchMap` drops an answer for a foundation or attempt the operator has moved past.
   */
  protected readonly twitterAccountState: Signal<CampaignTwitterAccountState> = this.initTwitterAccountState();

  /** The bound account's label, when the connection names one the credential also lists. */
  protected readonly twitterAccountLabel = computed(() => {
    const result = this.twitterAccountState().result;
    if (result?.connection.state !== 'connected' || !result.connection.accountId) return '';
    const listed = result.accounts.find((a) => a.key === result.connection.accountId);
    return listed ? `${listed.label} (${listed.key})` : (result.connection.label ?? result.connection.accountId);
  });

  /**
   * The registration link campaign-service appends to the tweet, as the preview shows it: the SAVED
   * brief's, not the form's. campaign-service reads the destination from the stored brief, and an
   * edit to Registration URL here is never saved to it, so the form value could name a link the
   * tweet will not carry.
   */
  protected readonly twitterDestinationUrl = computed(() => (this.briefData()?.eventDetails?.registrationUrl ?? '').trim());

  /** Why Create is blocked for an X image this tab holds but cannot send, or `null` — `linkedInImageAssetBlock`'s sibling. */
  protected readonly twitterImageAssetBlock: Signal<CampaignTwitterImageAssetBlock | null> = this.initTwitterImageAssetBlock();
  /** Whether the draft holds an uploaded X image made for the brief now open — the only one sent. */
  protected readonly twitterImageAssetForThisBrief = computed(
    () => this.twitterImageAssetId() !== '' && this.twitterImageAssetBriefId() === (this.briefPersistence().briefId ?? '')
  );
  /** An upload for the open brief (made, or still running) the request cannot carry: X creation is not an explicit yes. */
  private readonly twitterAssetWithheld = computed(
    () => (this.twitterImageAssetForThisBrief() || this.twitterImageUploadStatus() === 'uploading') && !this.twitterCreateAvailable()
  );
  protected readonly twitterImageAssetBlockMessage = computed(() => this.twitterImageAssetBlock()?.message ?? '');
  protected readonly twitterImageUploadStatusMessage = computed(() => {
    if (this.twitterImageUploadStatus() === 'uploading') return 'Uploading image…';
    return this.twitterImageAssetForThisBrief() ? `Uploaded: ${this.twitterImageAssetName() || 'image'}` : '';
  });
  protected readonly twitterImageUploadLiveMessage = computed(() => (this.twitterCreateAvailable() ? this.twitterImageUploadStatusMessage() : ''));
  /** What the tweet preview says about its image, read from the same condition the payload is (`twitterImageSent`). */
  protected readonly twitterPreviewImageLabel = computed(() => (this.twitterImageSent() ? `Image: ${this.twitterImageAssetName() || 'uploaded image'}` : ''));

  /**
   * Why Create is blocked for an uploaded Microsoft image this tab still holds but cannot send, or
   * `null` — `metaImageAssetBlock`'s sibling, less the pasted URL Microsoft does not have here.
   */
  protected readonly microsoftImageAssetBlock: Signal<CampaignMicrosoftImageAssetBlock | null> = this.initMicrosoftImageAssetBlock();
  /** Whether the draft holds an uploaded Microsoft image made for the brief now open — the only one sent. */
  protected readonly microsoftImageAssetForThisBrief = computed(
    () => this.microsoftImageAssetId() !== '' && this.microsoftImageAssetBriefId() === (this.briefPersistence().briefId ?? '')
  );
  /** An upload for the open brief (made, or still running) the request cannot carry: the upload capability is not an explicit yes. */
  private readonly microsoftAssetWithheld = computed(
    () =>
      (this.microsoftImageAssetForThisBrief() || this.microsoftImageUploadStatus() === 'uploading' || this.microsoftImageChecking()) &&
      !this.microsoftAssetUploadAvailable()
  );
  protected readonly microsoftImageAssetBlockMessage = computed(() => this.microsoftImageAssetBlock()?.message ?? '');
  protected readonly microsoftImageUploadStatusMessage = computed(() => {
    if (this.microsoftImageChecking()) return 'Checking image…';
    if (this.microsoftImageUploadStatus() === 'uploading') return 'Uploading image…';
    return this.microsoftImageAssetForThisBrief() ? `Uploaded: ${this.microsoftImageAssetName() || 'image'}` : '';
  });
  protected readonly microsoftImageUploadLiveMessage = computed(() => (this.microsoftAssetUploadAvailable() ? this.microsoftImageUploadStatusMessage() : ''));
  /** Whether the uploaded Microsoft image goes out: the upload capability is an explicit yes and the asset was made for the open brief. */
  private readonly microsoftImageSent = computed(() => this.microsoftAssetUploadAvailable() && this.microsoftImageAssetForThisBrief());

  protected readonly canSubmit = computed(() => {
    // Read FIRST and for its side effect only — see `campaignFormRevision`. Every direct form read
    // below is non-reactive, so without this dependency the memo never re-runs on a form edit.
    // First, not last, because an early `return false` must not skip registering it.
    void this.campaignFormRevision();
    const platforms = this.selectedPlatforms();
    const googleSelected = platforms.includes('google-ads');
    const linkedInSelected = platforms.includes('linkedin-ads');
    const redditSelected = platforms.includes('reddit-ads');
    const metaSelected = platforms.includes('meta-ads');
    const microsoftSelected = platforms.includes('microsoft-ads');
    const twitterSelected = platforms.includes('twitter-ads');
    if (!googleSelected && !linkedInSelected && !redditSelected && !metaSelected && !microsoftSelected && !twitterSelected) return false;

    const form = this.campaignForm.controls;
    const sharedFieldsValid = !!form.eventName.value?.trim() && !!form.registrationUrl.value?.trim() && !!form.startDate.value && !!form.endDate.value;
    if (!sharedFieldsValid) return false;

    if (googleSelected) {
      const channels = this.selectedGoogleChannels();
      if (channels.length === 0) return false;
      // Which pairs of Google channels may be submitted, and the answer differs by WHICH CREATOR
      // is going to run — because the two refuse different sets.
      //
      // Cutover owns create: `createCampaigns` refuses EVERY pair, unconditionally and with no
      // flag test (`campaign-service.service.ts`, "cannot be created together"). Search + Demand
      // Gen included. So in that state any second channel is a certain terminal refusal, and
      // stopping here turns a failed create into a disabled button.
      //
      // Cutover dark: the LEGACY in-process creator serves Search + Demand Gen perfectly well, so
      // refusing that pair here would break a working capability for the whole staged rollout —
      // the mistake the server-side guard's own comments record. Only the flag-gated channels are
      // refused, and they cannot be selected in that state anyway (`canCreateGoogleChannels`
      // requires the cutover), so the filter below is a belt on a road that already has braces.
      //
      // UNKNOWN (`null`) is treated as dark, like every other capability read on this form: a
      // client that refuses a create the server would have accepted is the costlier mistake, and
      // withholding a working pair while the capability call is in flight is exactly that.
      //
      // `googleCreativeAvailable` rather than `googleChannelsAvailable`: the question is "does the
      // campaign-service create path own this create", which is what that input answers
      // (`googleCreativeEnabled: cutoverOwnsCreate()` server-side). `googleChannelsEnabled` adds
      // the channel flag on top of it, so reading it here would miss the cutover-on deployment
      // that has not enabled the new channels — where Search + Demand Gen is still refused.
      if (channels.length > 1) {
        if (this.googleCreativeAvailable()) return false;
        // Derived from the shared constant, not an inverse literal. Both server consumers of this
        // same policy read it (`campaign.controller.ts`, `campaign-service.service.ts`); a channel
        // added to `GOOGLE_CAMPAIGN_CHANNELS` that does NOT require the flag would be misclassified
        // here while those two stayed correct.
        const flagged = channels.filter((c) => (GOOGLE_CAMPAIGN_CHANNELS_REQUIRING_FLAG as readonly string[]).includes(c));
        if (flagged.length > 0) return false;
      }
    }
    if (googleSelected && this.campaignForm.invalid) return false;
    // The bidding plan's own checking, which is a computed rather than control validators — see the
    // form declaration. Scoped to Google because the plan only exists there.
    if (googleSelected && this.googleBiddingError() !== null) return false;
    // A creative that was STARTED but is below Google's minimums, which campaign-service refuses
    // once it is non-empty. Deliberately not the empty case — that one is accepted upstream and
    // carries a warning instead ({@link googleCreativeEmptyWarning}), because blocking it would
    // refuse a create upstream makes.
    if (googleSelected && this.googleCreativeError() !== null) return false;
    // Postal-code or radius targets the request cannot carry yet. Withholding them would not shrink
    // the campaign but WIDEN it to the event country, so Create waits — see the block's own doc.
    if (googleSelected && this.googleLocationsCapabilityBlock() !== null) return false;
    // Countries and postal ids together over upstream's 60 — see `googleGeoTargetsOverCap`.
    if (googleSelected && this.googleGeoTargetsOverCap()) return false;
    if (linkedInSelected && this.linkedInBudgetUsd() < 1) return false;
    if (linkedInSelected && this.linkedInGeoTargets().length === 0) return false;
    if (linkedInSelected && this.linkedInVariants().length === 0) return false;
    // The account must be one the CATALOG confirms, not merely a non-empty string.
    //
    // `ngOnInit`'s reconciliation only runs on a successful response, so it cannot cover the two
    // windows either side of it: before the request returns, and permanently if it fails. In both
    // the restored id is still on the form while `linkedInAccounts()` is empty, so a create would
    // dispatch an account nothing has verified and the selector is not displaying — the same
    // divergence the reconciliation closes, reached where it does not run.
    //
    // Membership is the test rather than "loading finished", because a failed fetch leaves
    // loading false with an empty catalog, which is exactly when this matters most. It also
    // covers the blank id for free. The gate is scoped to LinkedIn, so a Google-only or
    // Reddit-only create is unaffected by an ad-account endpoint being down.
    if (linkedInSelected && !this.linkedInAccounts().some((a) => a.accountId === this.linkedInAccountId())) return false;
    if (metaSelected && this.metaBudgetUsd() < 1) return false;
    // No usable geo at all: every chip ineligible (or none) AND no usable countryCode. The request
    // would otherwise carry nothing and let the server default to US — spending on a country the
    // operator neither chose nor saw.
    if (metaSelected && this.metaEffectiveGeoTargets().length === 0) return false;
    // Reddit's client rejects a non-positive budget at dispatch (client.go: "invalid budget:
    // must be a positive number"), and because creation is async that surfaces as a dead job
    // rather than an error on the request. Refuse locally instead.
    //
    // Most of Reddit's other inputs are AI-recommended from the brief and rendered read-only for
    // review; the user-entered ones that can make a create fail are checked here and below (the
    // video goal). Deliberately not an enumeration — a list is a claim the next field falsifies.
    if (redditSelected && !this.redditBudgetIsUsable()) return false;
    // No usable geo at all — the brief recommended none AND the country code is blank. The
    // request would carry [''], which Reddit cannot target and the operator cannot see, because
    // the preview correctly renders nothing. countryCode has no validator, so this state is
    // reachable by clearing one optional field.
    if (redditSelected && this.redditEffectiveGeoTargets().length === 0) return false;
    // Video Views with no usable goal: both creators refuse it before anything is created, and
    // because creation is async that refusal would arrive as a dead job. The message is on screen
    // under the goal picker.
    if (redditSelected && this.redditVideoGoalError() !== null) return false;
    // Video Views without a post would build an image-post ad or no ad — never a video view.
    if (redditSelected && this.redditVideoPostError() !== null) return false;
    if (metaSelected && !this.metaVariants().some((v) => v.primaryText.trim() && v.headline.trim())) return false;
    if (metaSelected && !this.metaHasPlacement()) return false;
    if (metaSelected && !this.metaPixelValid()) return false;
    // The Instagram id and EU DSA disclosures (behind `metaInstagramDsaAvailable`; each error is
    // `null` while it is off). campaign-service refuses the same EU and one-sided states with a 400.
    if (metaSelected && (this.metaInstagramUserIdError() || this.metaDsaBeneficiaryError() || this.metaDsaPayorError())) return false;

    // Microsoft's three blocking conditions (LFXV2-3312). Each is a SILENT failure upstream rather
    // than a refusal, which is why they are caught here — the operator would otherwise learn at
    // launch, or not at all:
    //
    //   - budget: the client rejects a non-positive value mid-dispatch, and because creation is
    //     async that surfaces as a dead job rather than an error on this request.
    //   - keywords: "the campaign is created but can NEVER SERVE, and ToggleStatus refuses to
    //     activate it" — the create SUCCEEDS, so nothing fails until someone tries to launch.
    //   - geo: "Microsoft serves it EVERYWHERE once enabled" — uncontrolled spend, and the create
    //     succeeds just the same.
    //
    // `cpcBid` is deliberately NOT a gate: unset is a documented serve-capable default.
    // `Number.isFinite` rather than only `< 1`, because `NaN < 1` is FALSE — a NaN budget would
    // pass a bare comparison and reach the client, which rejects it mid-dispatch as a dead job.
    // `onMicrosoftBudgetInput`'s `|| 0` happens to prevent that today, but that is the handler's
    // incidental behaviour rather than this guard's, and the guard is what `canSubmit` promises.
    //
    // The upper bound mirrors `redditBudgetIsUsable`: the client caps the daily budget at
    // `MICROSOFT_MAX_BUDGET` and rejects anything larger DURING dispatch, so an unguarded
    // over-cap value is a dead job rather than a refused request.
    //
    // The floor of 1 is this app's, and it is deliberately stricter than the client's `> 0` —
    // Meta, LinkedIn and Reddit all gate the same way and every budget input declares `min="1"`.
    if (microsoftSelected && (!Number.isFinite(this.microsoftBudgetUsd()) || this.microsoftBudgetUsd() < 1 || this.microsoftBudgetUsd() > MICROSOFT_MAX_BUDGET))
      return false;
    if (microsoftSelected && this.microsoftEffectiveKeywords().length === 0) return false;
    if (microsoftSelected && this.microsoftEffectiveGeoTargets().length === 0) return false;
    // The legacy max CPC field is hidden — and not sent — while the Bidding control is offered, so
    // a stale value in it must not block a create the operator cannot see the reason for.
    if (microsoftSelected && this.microsoftLegacyCpcBidApplies() && !this.microsoftCpcBidValid()) return false;
    // X: held without an explicit yes, never dropped (`twitterCreateBlock`); with one, every field
    // campaign-service would refuse during dispatch — after the job exists — is caught here, each
    // with its message on screen in the X section.
    if (this.twitterCreateBlock() !== null) return false;
    if (twitterSelected && (this.twitterBudgetError() !== null || this.twitterTweetError() !== null || this.twitterFlightError() !== null)) return false;
    // A selected platform whose Bidding choice cannot be sent (#3299): its message is on screen,
    // under that platform's control.
    if (this.biddingAvailable() && CAMPAIGN_BIDDING_CREATE_PLATFORMS.some((p) => platforms.includes(p) && this.biddingPayloads()[p] === null)) return false;
    // A retained Manual choice the deployment has not (yet) confirmed it can send: never dropped.
    if (this.biddingCapabilityBlock() !== null) return false;
    // `googleExtensionsCapabilityBlock` is its sibling on the SAME capability read and is
    // deliberately NOT a gate here. The difference is what the withholding costs. A withheld Manual
    // bid changes what the campaign does — it would be created automatic and spend differently from
    // the choice on screen — so that create waits for the answer. Withheld callouts and sitelinks
    // cost only the extensions: the campaign created is still the one that was asked for, and the
    // lists stay in the brief for a later edit. Blocking a create on a stalled capability read for
    // that is the worse failure, so the create goes ahead and the block says what was left out.
    // Likewise a retained Reddit image upload: never silently left out of the request.
    if (this.redditImageAssetBlock() !== null) return false;
    if (this.metaImageAssetBlock() !== null) return false;
    if (this.googleImageAssetBlock() !== null) return false;
    if (this.linkedInImageAssetBlock() !== null) return false;
    if (this.twitterImageAssetBlock() !== null) return false;
    if (this.microsoftImageAssetBlock() !== null) return false;
    // Retained audience segments this caller may not (or may not yet be known to) send: held, never
    // dropped. Unlike the extensions they change who the campaign is aimed at, so the create waits.
    if (this.googleAudienceSegmentsBlock() !== null) return false;
    // Backstop for a state the add handlers cannot produce but a RESTORED DRAFT can: a draft
    // written before these caps existed carries whatever list it had, and `applyDraft` replays it
    // verbatim by design (an emptied list must stay emptied). Without this the form would look
    // valid and the BFF would refuse it.
    if (microsoftSelected && !this.microsoftBoundsValid()) return false;

    // Blocked while a brief save is in flight, because the create needs the id that save produces.
    //
    // The parent sets `briefId: null` for the duration of a save, so submitting during that window
    // sent an empty `brief_id` — which the cutover refuses TERMINALLY, with no fall-through to the
    // legacy path. The user would see "brief has not been saved yet" for a brief that was being
    // saved as they clicked. Disabling for the moment it takes is the honest reading; the button
    // re-enables on its own when the save lands.
    //
    // `error` splits in two, and the brief id is what tells them apart — blocking the whole
    // status was too broad, blocking none of it was too narrow.
    //
    //   error + a briefId  → the STORED row and the brief on screen are known to disagree, and
    //     that id is the stored row's. A save conflict says so outright (`stale-brief`,
    //     `unverified-validator`, `superseded-after-write`); so does a refused approval of a
    //     restored brief, and so does a restore whose cached content predates a write this
    //     session made. Creating from it would launch paid campaigns off a version the user is
    //     not reading. BLOCKED, and the id being present is what makes it dangerous.
    //
    //   error + no briefId → the save simply FAILED. Its own banner says "You can continue
    //     setting up the campaign", and with the cutover dark the legacy create needs no brief id
    //     at all. ALLOWED — blocking it would contradict the message the user is reading. If the
    //     cutover is on, `createCampaigns` refuses on the empty id with its own wording; that is
    //     a different message for a different situation, and it is the create path's to give.
    // `briefSaveInFlight` rather than `status === 'saving'`, because the status does not cover the
    // FIRST save of a session: it stays `off` until the persistence flag is known, so a fast click
    // straight after Proceed submitted an empty brief id and hit the terminal refusal. The
    // dedicated input answers "is a save running" for every save, first or not.
    if (this.briefSaveInFlight()) return false;
    // A create sent mid-upload would go out with the pasted URL (or no image) instead of the file
    // the operator just chose, and the upload would then land for a create already sent. Held here
    // while the upload control is shown, where its status and Remove live; while it is hidden,
    // `redditImageAssetBlock` holds Create instead and shows the upload's state with a Remove. Not
    // with a post URL, which `redditImageField` sends in place of any image, as the block agrees.
    if (this.showRedditSection() && this.redditAssetUploadAvailable() && !this.redditPostUrl() && this.redditImageUploadStatus() === 'uploading') return false;
    // Meta's sibling of the hold above, on the same terms.
    if (this.showMetaSection() && this.metaAssetUploadAvailable() && this.metaImageUploadStatus() === 'uploading') return false;
    // And Google's, for an upload into an image slot of a section still on screen — an upload for a
    // section the operator un-ticked would not be sent, and its Cancel has gone with the section.
    if (this.googleAssetUploadAvailable() && this.googleImageUploadStatus() === 'uploading' && this.googleImageUploadInReach()) return false;
    if (this.showLinkedInSection() && this.linkedInAssetUploadAvailable() && this.linkedInImageUploadStatus() === 'uploading') return false;
    if (this.showTwitterSection() && this.twitterCreateAvailable() && this.twitterImageUploadStatus() === 'uploading') return false;
    if (
      this.showMicrosoftSection() &&
      this.microsoftAssetUploadAvailable() &&
      (this.microsoftImageUploadStatus() === 'uploading' || this.microsoftImageChecking())
    )
      return false;

    const persistence = this.briefPersistence();
    if (persistence.status === 'saving') return false;
    if (persistence.status === 'error' && persistence.briefId !== null) return false;

    // A durable but UNAPPROVED brief cannot create campaigns: campaign-service refuses outright —
    // campaign-service's `BriefService.CreateCampaigns` (`internal/service/brief.go`) returns 400
    // "brief must be approved before creating campaigns". The state is `saved` because the write genuinely landed, and its banner already
    // says the brief is stored but not usable; leaving Create enabled invited the user to prove it
    // the hard way. Read from the explicit `approved` field rather than the banner prose, which
    // would break the first time the copy is edited.
    if (persistence.status === 'saved' && !persistence.approved) return false;

    // A RESTORED brief arrives as `off` carrying its own id, and Planning deliberately lets an
    // unapproved one be restored (the banner says to get it approved). `off` also covers the
    // cutover-dark case, where there is no brief id and none is needed — so the id is again what
    // separates them: an id present here means a restored brief, and an unapproved one cannot
    // create.
    if (persistence.status === 'off' && persistence.briefId !== null && !persistence.approved) return false;

    return true;
  });

  protected readonly availableGeoTargets = computed(() => {
    const selected = new Set(this.linkedInGeoTargets().map((g) => g.urn));
    return this.allKnownGeos.filter((g) => !selected.has(g.urn));
  });

  // === Reactive Signals (from form valueChanges) ===
  protected readonly displayBudgetPct: Signal<number> = this.initDisplayBudgetPct();
  protected readonly budgetSplitApplies: Signal<boolean> = this.initBudgetSplitApplies();
  protected readonly performanceMaxPrefillShown: Signal<boolean> = this.initPerformanceMaxPrefillShown();
  protected readonly searchCopyApplies: Signal<boolean> = this.initSearchCopyApplies();
  protected readonly googleCreativeSections: Signal<GoogleCreativeSection[]> = this.initGoogleCreativeSections();
  /**
   * The creative channels whose creative this request would carry, BEFORE the capability gate —
   * the sections' own channel rule, read by `googleImageAssetBlock` too, so a stored image held in
   * a section the capability is withholding blocks Create rather than vanishing with it.
   */
  private readonly googleCreativeChannelsInReach: Signal<GoogleCreativeChannel[]> = this.initGoogleCreativeChannelsInReach();

  /**
   * Every creative field that currently has something to say, keyed `groupName.control`.
   *
   * A map resolved once per change rather than a method the template calls per field: the method
   * form ran on every change-detection pass, for every field of every rendered section, to walk the
   * control tree and rebuild the same sentence. Keyed by a string because that is what the template
   * has — `section.groupName` is a plain string on the resolved section, for the reason
   * {@link creativeFieldError} records.
   *
   * Absent means nothing to say. The template reads it through `@if (… ; as error)`, so an entry
   * is only ever added when there is a message.
   */
  protected readonly creativeFieldErrors: Signal<Record<string, string>> = this.initCreativeFieldErrors();
  protected readonly googleBiddingChannel: Signal<GoogleCampaignChannel | null> = this.initGoogleBiddingChannel();
  protected readonly googleCalloutsAvailable: Signal<boolean> = this.initGoogleCalloutsAvailable();
  protected readonly googleCalloutsWithheldWarning: Signal<string | null> = this.initGoogleCalloutsWithheldWarning();
  protected readonly googleSitelinksWithheldWarning: Signal<string | null> = this.initGoogleSitelinksWithheldWarning();
  protected readonly googleStructuredSnippetsWithheldWarning: Signal<string | null> = this.initGoogleStructuredSnippetsWithheldWarning();
  protected readonly googleCallExtensionsWithheldWarning: Signal<string | null> = this.initGoogleAssetWithheldWarning(
    this.googleCallExtensions,
    'call extensions'
  );
  protected readonly googlePromotionsWithheldWarning: Signal<string | null> = this.initGoogleAssetWithheldWarning(this.googlePromotions, 'promotions');
  protected readonly googlePricesWithheldWarning: Signal<string | null> = this.initGoogleAssetWithheldWarning(this.googlePrices, 'price extensions');
  /**
   * Why generated callouts and sitelinks are being withheld because the CAPABILITY is not an
   * explicit yes, or `null`. The two warnings above cover the other reason — the channel takes no
   * extensions — and the two readers partition every withholding between them, so none is silent.
   *
   * Without this one the capability case had no reader at all: the section hides, both payload
   * helpers return `{}`, and `canSubmit` does not ask for the answer, so the create succeeded,
   * shipped no extensions and said nothing.
   */
  protected readonly googleExtensionsCapabilityBlock: Signal<CampaignGoogleExtensionsCapabilityBlock | null> = this.initGoogleExtensionsCapabilityBlock();
  /** The always-mounted live region's text for `googleExtensionsCapabilityBlock`; `''` when nothing is withheld. */
  protected readonly googleExtensionsCapabilityMessage = computed(() => this.googleExtensionsCapabilityBlock()?.message ?? '');
  protected readonly googleBiddingOptions: Signal<GoogleBiddingOption[]> = this.initGoogleBiddingOptions();
  protected readonly googleBiddingStrategy: Signal<GoogleBiddingStrategy | null> = this.initGoogleBiddingStrategy();
  protected readonly googleBiddingDefaultLabel: Signal<string> = this.initGoogleBiddingDefaultLabel();
  protected readonly googleTakesTargetCpa: Signal<boolean> = this.initGoogleTakesTargetCpa();
  protected readonly googleTakesTargetRoas: Signal<boolean> = this.initGoogleTakesTargetRoas();
  protected readonly googleLanguagesChannel: Signal<GoogleCampaignChannel | null> = this.initGoogleLanguagesChannel();
  protected readonly googleLanguagesWithheldOn: Signal<string | null> = this.initGoogleLanguagesWithheldOn();
  /**
   * The held-languages sentence, or `''` when nothing is held. ONE string feeds the visible notice and
   * the always-mounted live region at the top of the template, as {@link googleProximityWithheldMessage}
   * does: the notice is created by the channel switch that gives it its text, so a region mounted with
   * it would not reliably announce (#3568).
   */
  protected readonly googleLanguagesWithheldMessage = computed(() => {
    const channelLabel = this.googleLanguagesWithheldOn();
    if (channelLabel === null) return '';
    const count = this.googleLanguages().length;
    return `${channelLabel} campaigns do not take campaign languages, so the ${count} you picked will not be sent and this campaign will serve in every language. Switch the channel back to keep them.`;
  });
  protected readonly googlePostalGeoAvailable: Signal<boolean> = this.initGooglePostalGeoAvailable();
  protected readonly googleProximityChannel: Signal<GoogleCampaignChannel | null> = this.initGoogleProximityChannel();
  protected readonly googleProximityWithheldOn: Signal<string | null> = this.initGoogleProximityWithheldOn();
  /**
   * The held-radius sentence, or `''` when nothing is held. ONE string feeds the visible notice and
   * the always-mounted live region at the top of the template, the callout warnings' arrangement: the
   * notice appears with the channel switch that gives it its text, so a region mounted with it would
   * never announce.
   */
  protected readonly googleProximityWithheldMessage = computed(() => {
    const channelLabel = this.googleProximityWithheldOn();
    if (channelLabel === null) return '';
    const count = this.googleProximityTargets().length;
    return `${channelLabel} campaigns do not take radius targets, so the ${count} you added will not be sent. Switch the channel back to keep them.`;
  });
  protected readonly googleLocationsCapabilityBlock: Signal<CampaignGoogleLocationsCapabilityBlock | null> = this.initGoogleLocationsCapabilityBlock();
  /** The always-mounted live region's text for `googleLocationsCapabilityBlock`; `''` when nothing is withheld. */
  protected readonly googleLocationsCapabilityMessage = computed(() => this.googleLocationsCapabilityBlock()?.message ?? '');
  protected readonly googleAudienceSegmentsAvailable: Signal<boolean> = this.initGoogleAudienceSegmentsAvailable();
  protected readonly googleAudienceSegmentsWithheldWarning: Signal<string | null> = this.initGoogleAudienceSegmentsWithheldWarning();
  protected readonly googleAudienceSegmentsBlock: Signal<CampaignGoogleAudienceSegmentsBlock | null> = this.initGoogleAudienceSegmentsBlock();
  /** The always-mounted live region's text for `googleAudienceSegmentsBlock`; `''` when nothing blocks. */
  protected readonly googleAudienceSegmentsBlockMessage = computed(() => this.googleAudienceSegmentsBlock()?.message ?? '');
  protected readonly googleTakesCpcBid: Signal<boolean> = this.initGoogleTakesCpcBid();
  private readonly googleStrategyNeedsTarget: Signal<boolean> = this.initGoogleStrategyNeedsTarget();
  protected readonly googleTakesConversionActions: Signal<boolean> = this.initGoogleTakesConversionActions();
  protected readonly googleBiddingError: Signal<string | null> = this.initGoogleBiddingError();
  protected readonly googleCreativeError: Signal<string | null> = this.initGoogleCreativeError();
  protected readonly googleCreativeEmptyWarning: Signal<string | null> = this.initGoogleCreativeEmptyWarning();
  protected readonly redditNoAdWarning: Signal<string | null> = this.initRedditNoAdWarning();
  protected readonly campaignName: Signal<string> = this.initCampaignName();

  // === Form Array Accessors ===
  protected get headlinesArray(): FormArray {
    return this.campaignForm.controls.headlines as FormArray;
  }

  protected get descriptionsArray(): FormArray {
    return this.campaignForm.controls.descriptions as FormArray;
  }

  // === Private State ===
  private jobSubscription: Subscription | null = null;

  /**
   * True while the constructor effect is rebuilding the form from the brief and the draft.
   *
   * A plain field rather than a signal on purpose: nothing renders from it and nothing should
   * react to it — it exists only to tell `valueChanges` that the write it just saw came from
   * this component, not from the user.
   */
  private seeding = false;

  /**
   * The last value of `searchCopyApplies` the revalidation effect acted on.
   *
   * A plain field for the same reason `seeding` is one: nothing renders from it. It exists because
   * `searchCopyApplies` reads `campaignFormRevision`, so the effect that watches it wakes on every
   * keystroke; this is what keeps a revalidation to the moments the ANSWER moved. `null` rather
   * than `false` as the initial value, so the effect's very first pass always runs and settles the
   * deliberate `null` the validators returned during construction.
   */
  private lastSearchCopyApplies: boolean | null = null;

  // === Lifecycle ===

  public constructor() {
    effect(() => {
      const brief = this.briefData();
      if (!brief) return;
      // Everything between here and the emit below is the component REBUILDING itself, not the
      // user editing. `valueChanges` cannot tell those apart, so the flag does: without it the
      // seed's own patchValue emits a brief-shaped snapshot that overwrites the very draft this
      // mount is about to restore, and the user's edits die on the NEXT tab leave.
      this.seeding = true;
      // UNTRACKED, so `briefData` is the one dependency: the seed's writes run validators that read
      // signals the brief-switch resets move and `applyDraft` moves back (#4624), so tracked, the effect never settles.
      untracked(() => this.populateFromBrief(brief));
      // AFTER seeding from the brief, so a carried-over draft wins over the generated copy —
      // that is the whole point. Inside the same effect rather than a second one because the two
      // must not race: a separate effect could apply the draft first and have the brief overwrite
      // it, which is exactly the bug being fixed.
      //
      // UNTRACKED, and this is load-bearing rather than an optimisation. The draft is restore
      // state read once per mount, not a reactive dependency: tracking it closes a loop —
      // valueChanges emits -> the parent's signal updates -> this input changes -> the effect
      // re-runs -> it patches the form -> valueChanges emits again. Angular catches that as
      // NG0103 (infinite change detection) and takes the whole page down with it, which is how
      // this was found.
      untracked(() => this.applyDraft());
      this.seeding = false;
      // Emit ONCE, after the form has settled into whatever this mount should show — the draft
      // if one applied, the brief's copy otherwise. This is what keeps the parent's copy equal
      // to the form at rest, so a tab leave with no typing in between preserves rather than
      // reverts (the defect this line exists to close).
      //
      // UNTRACKED, for the same reason the `applyDraft` call above is, and it became load-bearing
      // the moment `emitDraft` started reading the platform signals. A tracked call here makes
      // every signal `emitDraft` reads an effect DEPENDENCY, and today that is the Meta block
      // (objective, placements, pixel id, geo targets, budget and its mode) plus the LinkedIn
      // budget pair and the Reddit budget.
      //
      // The failure that buys: any of those set after mount re-runs the whole effect, which
      // re-seeds from the brief and replays the draft over whatever the user has since changed.
      // A user editing the Meta budget would lose their pixel id — a silent revert of exactly the
      // kind this ticket exists to stop, in fields the triggering edit never touched.
      //
      // Found by measurement rather than review, on the wider emit an earlier revision of this
      // ticket carried: adding an ad-variant array to the emit turned three unrelated LinkedIn
      // tests red, all of them mutating a signal after mount. Those arrays are no longer emitted
      // (they have no editor), but the hazard is a property of the TRACKING, not of which fields
      // happen to be listed — so this stays regardless of what `emitDraft` reads next.
      untracked(() => this.emitDraft());
    });

    // A same-event refine restores a pending X upload while `persistBrief` has the brief id
    // cleared, so `resumeTwitterImageUpload` parks it. The save hands the same id back without a
    // remount, so the parked upload is resumed here once its brief is the open one again.
    // Observed through `toObservable` rather than an `effect()`, which this repo reserves for
    // logging: resuming subscribes to the upload and writes several signals.
    toObservable(
      computed(() => {
        const briefId = this.briefPersistence().briefId ?? '';
        const pendingName = this.twitterImageUploadPendingName();
        const pendingBriefId = this.twitterImageUploadPendingBriefId();
        if (!briefId || pendingName === '' || pendingBriefId !== briefId || this.twitterImageUploadStatus() !== 'idle') return null;
        return { pendingName, pendingBriefId };
      })
    )
      .pipe(
        filter((parked): parked is { pendingName: string; pendingBriefId: string } => parked !== null),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ pendingName, pendingBriefId }) => this.resumeTwitterImageUpload(pendingName, pendingBriefId));

    // Emit as the user edits. `valueChanges` covers everything on `campaignForm` — copy, budget,
    // flight, campaign types, and since LFXV2-3230 the three LinkedIn picks (ad account, geo
    // targets, targeting profile). Moving those three onto the form is what makes their restore
    // work: this subscription emits on every pick with no per-handler plumbing.
    //
    // Still OUTSIDE it: the platform values that remain signals — the Meta block and the two
    // budget groups. Described by shape rather than counted, since a count here is a claim the
    // next control added to the template falsifies. `emitDraft` names each of them, so the draft
    // carries them; what this subscription cannot do is NOTICE them changing. That is why each
    // mutation handler calls `emitDraft` itself, and why adding a signal-backed control means
    // touching both places rather than one.
    //
    // Excluded on purpose: `linkedInAccounts` and `linkedInAccountsLoading`, which are re-derived
    // from a fetch on every mount rather than edited. The snapshot is scoped to what a user EDITS,
    // which is broader than what they type.
    this.campaignForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.seeding) return;
      this.emitDraft();
    });
    // The Meta Instagram/DSA group is not on `campaignForm`, so it needs its own trigger.
    this.metaInstagramDsaForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.seeding) return;
      this.emitDraft();
    });
    // Nor is the Reddit pixel group.
    this.redditConversionPixelForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.seeding) return;
      this.emitDraft();
    });

    // When the Bidding control becomes available, a bid typed into the legacy Microsoft field while
    // it was not (#3299) would otherwise vanish with that field and Automatic would be sent. It is
    // carried into the control as the Manual choice it always meant upstream (a `cpcBid` without
    // `bidding` is a manual bid). Subscribed after the draft-restore effect is created, so a
    // restored legacy value is seen too.
    toObservable(this.biddingEnabled)
      .pipe(
        filter((enabled) => enabled === true),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.adoptLegacyMicrosoftCpcBid());

    // Re-run the two ad-copy array validators when the answer `searchCopyRequired` reads moves.
    //
    // Angular revalidates a control when IT changes and propagates the result upward; it never
    // revalidates a SIBLING. `searchCopyRequired` asks about the channel selection, which is a
    // sibling of the arrays it guards, so without this the gate would latch at whatever the
    // selection was the last time a headline was typed: unticking Search would leave the form
    // invalid with no visible control to fix, and ticking Search back on with the copy already
    // emptied would leave it valid and submit an ad with no text.
    //
    // Driven off `searchCopyApplies` rather than off the two checkboxes, because the checkboxes
    // are not the only thing that moves it. `showGoogleSection()` is the other half of that gate
    // and it reads `selectedPlatforms`, a SIGNAL INPUT — unticking Google in the parent changes
    // the answer without either checkbox emitting anything. And the validators run once at
    // construction, while the gate signal does not yet exist and `searchCopyRequired` returns a
    // deliberate `null`; an effect runs after construction, so its first pass is also what
    // settles that placeholder into the real answer. Neither of those was covered by the
    // `valueChanges` pair this replaces.
    //
    // `includeVideo` needs no mention: Video reads neither array, and `searchCopyApplies` does not
    // look at it. Both arrays are revalidated together rather than one per source, because
    // whatever moves the answer moves it for both.
    effect(() => {
      // Read first and unconditionally — a dependency taken inside a branch is a dependency the
      // effect stops tracking the moment the branch is not taken.
      const applies = this.searchCopyApplies();
      if (applies === this.lastSearchCopyApplies) return;
      this.lastSearchCopyApplies = applies;
      // `emitEvent: false` for the usual reason: this is a validity recompute, not an edit, and
      // letting it emit would push an identical draft to the parent on every channel tick.
      this.headlinesArray.updateValueAndValidity({ emitEvent: false });
      this.descriptionsArray.updateValueAndValidity({ emitEvent: false });
    });

    // Keep each creative group enabled exactly while its section is on screen.
    //
    // The groups are all constructed and never destroyed, which is what makes a hidden section's
    // text survive the operator changing their mind. The cost of that is validators: an enabled
    // group carries its bounds into `campaignForm.invalid` whether or not anything renders it, so
    // twenty headlines typed into Demand Gen and then hidden by ticking Search would hold
    // `canSubmit` false with no visible control to fix — the precise failure the bidding block
    // above records, arriving by a different door.
    //
    // Disabling is the whole fix and costs nothing elsewhere: `getRawValue()` reports a disabled
    // group, so `googleCreativePayload`, `googleCreativeSnapshot` and `restoreGoogleCreatives` all
    // read and write exactly as before, and nothing typed is cleared.
    effect(() => {
      const rendered = new Set(this.googleCreativeSections().map((section) => section.groupName));
      for (const channel of GOOGLE_CHANNELS_WITH_CREATIVE) {
        const group = this.campaignForm.controls[GOOGLE_CREATIVE_REQUEST_KEYS[channel]];
        const shouldBeEnabled = rendered.has(GOOGLE_CREATIVE_REQUEST_KEYS[channel]);
        if (shouldBeEnabled === group.enabled) continue;
        // `emitEvent: false` keeps this out of `valueChanges`; without it every toggle would emit
        // a draft, and the status change alone would re-enter this effect through
        // `campaignFormRevision`.
        if (shouldBeEnabled) group.enable({ emitEvent: false });
        else group.disable({ emitEvent: false });
      }
    });

    // skip(1) drops the emission toObservable fires immediately on subscribe — ngOnInit already
    // runs the initial load, so only later foundation switches should refetch the ad-account list.
    toObservable(this.activeFoundationSlug)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.loadLinkedInAccounts());
  }

  public ngOnInit(): void {
    this.loadLinkedInAccounts();
  }

  // === Public Methods ===
  public reset(): void {
    this.jobSubscription?.unsubscribe();
    this.jobSubscription = null;
    this.step.set('form');
    this.creationProgress.set([]);
    this.results.set([]);
    this.platformResults.set([]);
    this.errors.set([]);
  }

  // === Protected Methods ===

  /**
   * The Google channels this form is actually asking for, in the catalogue's order.
   *
   * Capability-gated, not a raw read of the checkboxes. The form can carry a hidden `true` for a
   * channel whose control is withheld — a draft restored before the capability answer arrived —
   * and submitting that would ask for a channel the deployment has already said it cannot create.
   * One function so the request builder, `canSubmit` and the campaign-name preview cannot drift
   * apart; the preview in particular used to re-derive this and froze the capability at mount.
   */
  protected selectedGoogleChannels(): GoogleCampaignChannel[] {
    const form = this.campaignForm.getRawValue();
    const channels: GoogleCampaignChannel[] = [];
    if (form.includeSearch) channels.push('search');
    if (this.demandGenAvailable() && form.includeDemandGen) channels.push('demand-gen');
    if (this.googleChannelsAvailable()) {
      if (form.includePerformanceMax) channels.push('performance-max');
      // The capability gate is not enough for Video, and `getRawValue()` is why: it reports
      // DISABLED controls too, so a draft saved before this box was disabled still carries a
      // `true` here and would dispatch a create Google refuses outright. The control is left
      // holding that value deliberately — see the form declaration — so this is the one place
      // that has to drop it.
      if (GOOGLE_VIDEO_CREATE_SUPPORTED && form.includeVideo) channels.push('video');
      if (form.includeDisplay) channels.push('display');
    }
    return channels;
  }

  // No `Validators.required` on the pushed control, matching the array declaration: an added box
  // the user has not reached yet must not invalidate the form, and "at least one filled" is
  // decided once on the array by `searchCopyRequired`.
  protected addHeadline(): void {
    (this.campaignForm.controls.headlines as FormArray).push(this.fb.control('', [Validators.maxLength(CAMPAIGN_CHAR_LIMITS.searchHeadline)]));
  }

  protected removeHeadline(index: number): void {
    const arr = this.campaignForm.controls.headlines as FormArray;
    if (arr.length > 1) arr.removeAt(index);
  }

  protected addDescription(): void {
    (this.campaignForm.controls.descriptions as FormArray).push(this.fb.control('', [Validators.maxLength(CAMPAIGN_CHAR_LIMITS.searchDescription)]));
  }

  protected removeDescription(index: number): void {
    const arr = this.campaignForm.controls.descriptions as FormArray;
    if (arr.length > 1) arr.removeAt(index);
  }

  // The three handlers below write to `campaignForm` rather than to a signal (LFXV2-3230). That
  // single change is what makes these edits survive a tab switch: `valueChanges` already drives
  // `emitDraft`, so the parent's copy updates on every pick with no emission added here.
  protected removeGeoTarget(index: number): void {
    const current = this.campaignForm.controls.linkedInGeoTargets.value;
    this.campaignForm.controls.linkedInGeoTargets.setValue(current.filter((_, i) => i !== index));
  }

  protected addGeoTarget(urn: string): void {
    if (!urn) return;
    const geo = this.allKnownGeos.find((g) => g.urn === urn);
    const current = this.campaignForm.controls.linkedInGeoTargets.value;
    if (geo && !current.some((g) => g.urn === urn)) {
      this.campaignForm.controls.linkedInGeoTargets.setValue([...current, geo]);
    }
  }

  protected setLinkedInTargetingProfile(profile: LinkedInTargetingProfile): void {
    this.campaignForm.controls.linkedInTargetingProfile.setValue(profile);
  }

  // `setLinkedInBudget` and `setLinkedInLifetimeBudget` were removed here (LFXV2-3230), for the
  // same reason `setLinkedInAccount` was: nothing called them. The template binds `(input)` and
  // `(change)` to `onLinkedInBudgetInput` / `onLinkedInLifetimeBudgetChange` below, and no spec
  // reached the setters either. Adding this ticket's `emitDraft()` call to a dead method would
  // have made the round-trip look covered while the LIVE handler stayed unfixed — the exact trap
  // the `setLinkedInAccount` note describes, so the tests now drive the real bindings instead.

  // `setLinkedInAccount` was removed here (LFXV2-3230). Nothing in this component's template
  // called it — only a test did, which made the test pass against a broken `(change)` binding.
  // `onLinkedInAccountChange` below is the real path and is what the round-trip test now drives.
  // The identically-named methods on monitoring-tab and optimization-tab are live and untouched.
  protected onLinkedInAccountChange(event: Event): void {
    this.campaignForm.controls.linkedInAccountId.setValue((event.target as HTMLSelectElement).value);
  }

  protected onGeoTargetChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.addGeoTarget(select.value);
    select.value = '';
  }

  // Every handler below emits, on the same rule the Meta handlers state: these signals are
  // invisible to `campaignForm.valueChanges`, so a mutation that does not call `emitDraft` never
  // reaches the parent and the edit dies at the next tab switch. Naming the field in `emitDraft`
  // is only half of it — a carried field whose handler never emits is still lost.
  protected onLinkedInBudgetInput(event: Event): void {
    this.linkedInBudgetUsd.set((event.target as HTMLInputElement).valueAsNumber || 0);
    this.emitDraft();
  }

  protected onLinkedInLifetimeBudgetChange(event: Event): void {
    this.linkedInLifetimeBudget.set((event.target as HTMLInputElement).checked);
    this.emitDraft();
  }

  protected onMetaBudgetInput(event: Event): void {
    this.metaBudgetUsd.set((event.target as HTMLInputElement).valueAsNumber || 0);
    this.emitDraft();
  }

  /**
   * Whether the Reddit budget is one the platform will accept.
   *
   * The CEILING and finiteness mirror the client's contract exactly
   * (`internal/platform/reddit/client.go`: finite, within (0, 1e9]). Creation is ASYNC, so an
   * over-cap budget is not a validation error the operator sees — it is a job that dies later and
   * has to be gone and read.
   *
   * The 1 USD FLOOR is deliberately stricter than upstream, which accepts anything rounding to at
   * least one micro-dollar. A sub-dollar Reddit campaign buys nothing, so a value in that range is
   * far more likely a typo than an intent, and the siblings use the same 1 USD floor. Stated
   * plainly rather than described as mirroring the client, because it does not.
   *
   * The siblings enforce neither bound; LFXV2-3315 covers bringing them into line.
   */
  protected redditBudgetIsUsable(): boolean {
    const budget = this.redditBudgetUsd();
    return Number.isFinite(budget) && budget >= 1 && budget <= REDDIT_MAX_BUDGET_USD;
  }

  protected onRedditBudgetInput(event: Event): void {
    this.redditBudgetUsd.set((event.target as HTMLInputElement).valueAsNumber || 0);
    // Every Reddit handler emits, because the section's values live in signals that
    // `campaignForm.valueChanges` never sees. Deliberately not enumerating which controls exist —
    // a count here is a claim the next editor added to the template falsifies.
    this.emitDraft();
  }

  protected onRedditObjectiveChange(event: Event): void {
    this.redditObjective.set((event.target as HTMLSelectElement).value as RedditObjective);
    this.emitDraft();
  }

  protected onRedditVideoGoalChange(event: Event): void {
    this.redditVideoGoal.set((event.target as HTMLSelectElement).value as RedditVideoGoal | '');
    this.emitDraft();
  }

  protected onRedditPostUrlInput(event: Event): void {
    this.redditPostUrl.set((event.target as HTMLInputElement).value.trim());
    this.emitDraft();
  }

  protected onRedditImageUrlInput(event: Event): void {
    this.redditImageUrl.set((event.target as HTMLInputElement).value.trim());
    this.emitDraft();
  }

  /**
   * Upload the chosen image for this brief and keep its asset id.
   *
   * Type and size are checked here against the same shared allowlist the BFF route enforces, so
   * the common refusals need no round trip and read the same either way. The input is cleared
   * afterwards so choosing the same file again (after a failure) fires `change` again.
   */
  protected onRedditImageFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;

    // A new pick replaces the previous upload outright, so a refusal below can never leave an older
    // image silently in place while the screen reports this one as refused. Emitted at once: the
    // parent's draft still holds the old asset, and a tab switch before any other edit would
    // restore it — and Create would send the image the operator replaced.
    this.clearRedditImageAsset();
    this.emitDraft();

    if (!isCreativeAssetMimeType(file.type)) {
      this.failRedditImageUpload(CREATIVE_ASSET_WRONG_TYPE_MESSAGE);
      return;
    }
    if (file.size > CREATIVE_ASSET_MAX_BYTES) {
      this.failRedditImageUpload(CREATIVE_ASSET_TOO_LARGE_MESSAGE);
      return;
    }
    const briefId = this.briefPersistence().briefId ?? '';
    const projectSlug = this.projectContextService.activeContext()?.slug ?? '';
    if (!briefId || !projectSlug) {
      this.failRedditImageUpload('Save the brief before uploading an image for it.');
      return;
    }

    this.followRedditImageUpload(this.campaignService.uploadCreativeAsset(file, projectSlug, briefId, 'reddit'), briefId, file.name);
    // Told to the parent at once: a tab switch now destroys this component but not the request,
    // and the remount resumes it from the draft (`resumeRedditImageUpload`).
    this.emitDraft();
  }

  /** A library upload stored a new image: re-read the slot coverage and the Google image slots' library. */
  protected onCreativeLibraryChanged(): void {
    this.creativeLibraryRevision.update((revision) => revision + 1);
  }

  /** Forget the uploaded image (the stored asset stays upstream, unused) and fall back to the image URL. */
  protected onRedditImageAssetRemove(): void {
    this.clearRedditImageAsset();
    this.emitDraft();
  }

  protected onMetaImageUrlInput(event: Event): void {
    this.metaImageUrl.set((event.target as HTMLInputElement).value.trim());
    this.emitDraft();
  }

  /** Upload the chosen Meta image for this brief — `onRedditImageFileChange`'s sibling, step for step. */
  protected onMetaImageFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;

    this.clearMetaImageAsset();
    this.emitDraft();

    if (!isCreativeAssetMimeType(file.type)) {
      this.failMetaImageUpload(CREATIVE_ASSET_WRONG_TYPE_MESSAGE);
      return;
    }
    if (file.size > CREATIVE_ASSET_MAX_BYTES) {
      this.failMetaImageUpload(CREATIVE_ASSET_TOO_LARGE_MESSAGE);
      return;
    }
    const briefId = this.briefPersistence().briefId ?? '';
    const projectSlug = this.projectContextService.activeContext()?.slug ?? '';
    if (!briefId || !projectSlug) {
      this.failMetaImageUpload('Save the brief before uploading an image for it.');
      return;
    }

    this.followMetaImageUpload(this.campaignService.uploadCreativeAsset(file, projectSlug, briefId, 'meta'), briefId, file.name);
    this.emitDraft();
  }

  /** Forget the uploaded Meta image (the stored asset stays upstream, unused) and fall back to the image URL. */
  protected onMetaImageAssetRemove(): void {
    this.clearMetaImageAsset();
    this.emitDraft();
  }

  /**
   * The block's Remove: drops only what the block is about. An upload it names (failed, made for
   * another brief, or withheld) is cleared; a pasted URL only when the URL itself is withheld, so
   * removing a refused upload never also discards a URL the request can still carry.
   */
  protected onMetaImageBlockRemove(): void {
    if (this.metaImageUrlWithheld()) this.metaImageUrl.set('');
    if (this.metaImageAssetId() !== '' || this.metaImageUploadStatus() !== 'idle' || this.metaImageUploadPendingName() !== '') {
      this.clearMetaImageAsset();
    }
    this.emitDraft();
  }
  /**
   * Upload the chosen LinkedIn image for this brief — `onMetaImageFileChange`'s sibling, step for
   * step, plus LinkedIn's own 5 MB limit: campaign-service refuses a larger image at dispatch, so it
   * is refused here before anything is stored.
   */
  protected onLinkedInImageFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;

    this.clearLinkedInImageAsset();
    this.emitDraft();

    // A refused pick is recorded against the open brief and saved, like a failed upload: the image
    // it replaced is gone, so Create stays blocked and the reason survives a tab switch.
    const briefId = this.briefPersistence().briefId ?? '';
    if (!isCreativeAssetMimeType(file.type)) {
      this.failLinkedInImageUpload(CREATIVE_ASSET_WRONG_TYPE_MESSAGE, briefId);
      this.emitDraft();
      return;
    }
    if (file.size > LINKEDIN_IMAGE_MAX_BYTES) {
      this.failLinkedInImageUpload(LINKEDIN_IMAGE_TOO_LARGE_MESSAGE, briefId);
      this.emitDraft();
      return;
    }
    const projectSlug = this.projectContextService.activeContext()?.slug ?? '';
    if (!briefId || !projectSlug) {
      this.failLinkedInImageUpload('Save the brief before uploading an image for it.');
      return;
    }

    this.followLinkedInImageUpload(this.campaignService.uploadCreativeAsset(file, projectSlug, briefId, 'linkedin'), briefId, file.name);
    this.emitDraft();
  }

  /** Forget the uploaded LinkedIn image (the stored asset stays upstream, unused). */
  protected onLinkedInImageAssetRemove(): void {
    this.clearLinkedInImageAsset();
    this.emitDraft();
  }
  /**
   * Upload the chosen Microsoft image for this brief — `onMetaImageFileChange`'s sibling, step for
   * step, plus Microsoft's own 76,800-byte limit: far below the shared upload cap, and
   * campaign-service refuses a larger image at dispatch, so it is refused here before anything is
   * stored.
   */
  protected onMicrosoftImageFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;

    this.clearMicrosoftImageAsset();
    this.emitDraft();

    // A refused pick is recorded against the open brief and saved, like a failed upload: the image
    // it replaced is gone, so Create stays blocked and the reason survives a tab switch.
    const briefId = this.briefPersistence().briefId ?? '';
    if (!isCreativeAssetMimeType(file.type)) {
      this.failMicrosoftImageUpload(CREATIVE_ASSET_WRONG_TYPE_MESSAGE, briefId);
      this.emitDraft();
      return;
    }
    if (file.size > MICROSOFT_IMAGE_MAX_BYTES) {
      this.failMicrosoftImageUpload(MICROSOFT_IMAGE_TOO_LARGE_MESSAGE, briefId);
      this.emitDraft();
      return;
    }
    const projectSlug = this.projectContextService.activeContext()?.slug ?? '';
    if (!briefId || !projectSlug) {
      this.failMicrosoftImageUpload('Save the brief before uploading an image for it.');
      return;
    }

    // The pixel bounds are read from the image itself, which is asynchronous. A size that cannot be
    // read (no decoder in this browser, or an image it cannot decode) is left to campaign-service,
    // which checks the same bounds before anything is created.
    //
    // The pick is recorded as pending, and told to the parent, BEFORE the read: a tab switch during
    // it destroys this component, and the remount then finds no upload to resume and raises the
    // interrupted-upload block rather than restoring an empty selection. The read rides the upload
    // subscription, so a clear or the component's destruction drops its answer.
    this.microsoftImageChecking.set(true);
    this.microsoftImageUploadPendingName.set(file.name);
    this.microsoftImageUploadPendingBriefId.set(briefId);
    this.emitDraft();
    this.microsoftImageUploadSub = from(this.readImageSize(file))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((size) => {
        this.microsoftImageChecking.set(false);
        this.microsoftImageUploadPendingName.set('');
        this.microsoftImageUploadPendingBriefId.set('');
        const bounds = MICROSOFT_IMAGE_PIXEL_BOUNDS;
        if (size && (size.width < bounds.minWidth || size.height < bounds.minHeight || size.width > bounds.maxWidth || size.height > bounds.maxHeight)) {
          this.failMicrosoftImageUpload(
            `Microsoft Advertising accepts images from ${bounds.minWidth}x${bounds.minHeight} to ${bounds.maxWidth}x${bounds.maxHeight} pixels; this one is ${size.width}x${size.height}.`,
            briefId
          );
          this.emitDraft();
          return;
        }
        this.followMicrosoftImageUpload(this.campaignService.uploadCreativeAsset(file, projectSlug, briefId, 'microsoft'), briefId, file.name);
        this.emitDraft();
      });
  }

  /** Forget the uploaded Microsoft image (the stored asset stays upstream, unused). */
  protected onMicrosoftImageAssetRemove(): void {
    this.clearMicrosoftImageAsset();
    this.emitDraft();
  }

  /**
   * Upload the chosen X tweet image for this brief — `onLinkedInImageFileChange`'s sibling, step for
   * step, against X's own 5 MB limit: campaign-service refuses a larger image at dispatch.
   */
  protected onTwitterImageFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;

    this.clearTwitterImageAsset();
    this.emitDraft();

    // A refused pick is recorded against the open brief and saved, as LinkedIn's is.
    const briefId = this.briefPersistence().briefId ?? '';
    if (!isCreativeAssetMimeType(file.type)) {
      this.failTwitterImageUpload(CREATIVE_ASSET_WRONG_TYPE_MESSAGE, briefId);
      this.emitDraft();
      return;
    }
    if (file.size > TWITTER_IMAGE_MAX_BYTES) {
      this.failTwitterImageUpload(TWITTER_IMAGE_TOO_LARGE_MESSAGE, briefId);
      this.emitDraft();
      return;
    }
    const projectSlug = this.projectContextService.activeContext()?.slug ?? '';
    if (!briefId || !projectSlug) {
      this.failTwitterImageUpload('Save the brief before uploading an image for it.');
      return;
    }

    this.followTwitterImageUpload(this.campaignService.uploadCreativeAsset(file, projectSlug, briefId, 'twitter'), briefId, file.name);
    this.emitDraft();
  }

  /** Re-read the X account after a failed read. */
  protected onTwitterAccountRetry(): void {
    this.twitterAccountAttempt.update((attempt) => attempt + 1);
  }

  /** Forget the uploaded X image (the stored asset stays upstream, unused). */
  protected onTwitterImageAssetRemove(): void {
    this.clearTwitterImageAsset();
    this.emitDraft();
  }

  /**
   * Take X out of this create — the `twitterCreateBlock`'s way forward when the deployment cannot
   * create there. The brief is untouched, so a remount re-seeds X from it and blocks again until the
   * capability answers yes or a new brief leaves X out.
   */
  protected onTwitterRemove(): void {
    this.selectedPlatforms.update((platforms) => platforms.filter((p) => p !== 'twitter-ads'));
  }

  /**
   * Take the asset plan's suggestions into the Google image fields (#4825): "upload once, auto-assign".
   *
   * Only EMPTY fields are filled — no held image, no pasted URL and no upload still running — so
   * whatever the operator chose stays, and pressing again after more uploads fills only what is
   * still empty. Only fields on
   * screen are touched (the plan covers every Google channel; the tab renders one), each up to its
   * own catalogued `max`, and only for the open brief. The combined marketing-image cap is not
   * re-checked here, as it is not for a manual pick: campaign-service refuses an over-cap creative
   * before anything is created.
   */
  protected onApplySuggestedGoogleImages(assignments: readonly CreativeSlotAssignment[]): void {
    const briefId = this.briefPersistence().briefId ?? '';
    if (!briefId) return;
    const slots = this.googleImageSlots();
    const held = this.googleHeldImages();
    let filled = 0;
    let kept = 0;
    for (const assignment of assignments) {
      if (assignment.platform !== 'google-ads' || assignment.assetIds.length === 0) continue;
      const channel = GOOGLE_CHANNELS_WITH_CREATIVE.find((candidate) => GOOGLE_ADS_CHANNEL_TYPE_ENUMS[candidate] === assignment.channel);
      if (!channel) continue;
      // The plan names the slot in the platform layer's vocabulary, not the request's; see the table.
      const control = GOOGLE_ASSET_PLAN_SLOT_CONTROLS[channel][assignment.slot];
      if (!control) continue;
      const groupName = GOOGLE_CREATIVE_REQUEST_KEYS[channel];
      const key = `${groupName}.${control}`;
      if (!slots[key]) continue;
      const raw = this.campaignForm.controls[groupName].getRawValue() as Record<string, string | null | undefined>;
      // An upload still running counts as filled: the file it is sending is held when it lands
      // (`followGoogleImageUpload`), and filling the field meanwhile would put it over its max.
      if (slots[key].uploading || (held[key] ?? []).length > 0 || this.splitCreativeLines(raw[control]).length > 0) {
        kept += 1;
        continue;
      }
      const fields: readonly GoogleCreativeFieldSpec[] = GOOGLE_CREATIVE_FIELD_SPECS[channel];
      const max = fields.find((field) => field.control === control)?.max ?? assignment.assetIds.length;
      for (const assetId of assignment.assetIds.slice(0, max)) {
        this.holdGoogleImage(key, { id: assetId, name: '', briefId });
      }
      filled += 1;
    }
    const slotWord = (n: number): string => (n === 1 ? 'slot' : 'slots');
    let message = 'No suggested images to apply: no Google image field on screen has a suggestion.';
    if (filled > 0) {
      message = `Filled ${filled} empty image ${slotWord(filled)} with suggested images.`;
    } else if (kept > 0) {
      message = 'Nothing to fill: every image field with a suggestion already has images.';
    }
    if (filled > 0 && kept > 0) {
      message += ` Left ${kept} ${slotWord(kept)} you had already filled as ${kept === 1 ? 'it was' : 'they were'}.`;
    }
    this.googleSuggestedApply.update((previous) => ({ briefId, message, seq: (previous?.seq ?? 0) + 1 }));
    if (filled > 0) this.emitDraft();
  }

  /** Hold a library image in a Google image slot. The picker offers only images that fit the slot. */
  protected onGoogleImagePick(slotKey: string, assetId: string): void {
    const briefId = this.briefPersistence().briefId ?? '';
    if (!briefId) return;
    this.holdGoogleImage(slotKey, { id: assetId, name: '', briefId });
    this.emitDraft();
  }

  /** Take a held image out of a Google image slot. The stored asset stays in the library. */
  protected onGoogleImageRemove(slotKey: string, assetId: string): void {
    this.googleHeldImages.update((held) => ({ ...held, [slotKey]: (held[slotKey] ?? []).filter((image) => image.id !== assetId) }));
    this.emitDraft();
  }

  /**
   * Upload the chosen file into the brief's library and hold it in the slot it was chosen for —
   * `onMetaImageFileChange`'s sibling, step for step.
   */
  protected onGoogleImageUpload(slotKey: string, file: File): void {
    this.clearGoogleImageUpload();

    // A file refused before upload is still one the operator chose for this slot, so the refusal
    // is recorded against the open brief — it blocks Create (`uploadFailed`) and survives a tab
    // switch until they remove it or choose again — rather than leaving the slot without it unsaid.
    const briefId = this.briefPersistence().briefId ?? '';
    const refuse = (message: string): void => {
      this.failGoogleImageUpload(message, briefId, slotKey);
      this.emitDraft();
    };
    if (!isCreativeAssetMimeType(file.type)) {
      refuse(CREATIVE_ASSET_WRONG_TYPE_MESSAGE);
      return;
    }
    // Google's own cap, tighter than the library's: an image stored at 6 MB would be refused at
    // dispatch, so it is refused before it is uploaded.
    if (file.size > GOOGLE_CREATIVE_IMAGE_MAX_BYTES) {
      refuse(`Google takes images of up to ${GOOGLE_CREATIVE_IMAGE_MAX_BYTES / (1024 * 1024)} MB. Choose a smaller file.`);
      return;
    }
    // `activeFoundationSlug`, the same source the library read keys on, so an upload lands in the
    // library the slot then reads.
    const projectSlug = this.activeFoundationSlug();
    if (!briefId || !projectSlug) {
      refuse('Save the brief before uploading an image for it.');
      return;
    }

    this.followGoogleImageUpload(this.campaignService.uploadCreativeAsset(file, projectSlug, briefId, 'google'), briefId, file.name, slotKey);
    this.emitDraft();
  }

  protected onGoogleImageUploadCancel(): void {
    this.clearGoogleImageUpload();
    this.emitDraft();
  }

  /**
   * The block's Remove: drops only what the block names. Images stored for another brief, a failed
   * upload, or the images that are missing or do not fit are cleared on their own; when the block
   * is about the capability, every held image the request would carry is, with any upload still
   * running. Pasted URLs are never touched — the request can carry them either way.
   */
  protected onGoogleImageBlockRemove(): void {
    const block = this.googleImageAssetBlock();
    if (block === null) return;
    const briefId = this.briefPersistence().briefId ?? '';
    const library = this.googleCreativeLibrary();
    const inReach = new Set<string>(this.googleCreativeChannelsInReach().map((channel) => GOOGLE_CREATIVE_REQUEST_KEYS[channel]));
    if (block.kind === 'uploadFailed') {
      this.clearGoogleImageUpload();
      this.emitDraft();
      return;
    }
    const drop = (slotKey: string, image: GoogleCreativeHeldImage): boolean => {
      if (!inReach.has(slotKey.split('.')[0])) return false;
      if (block.kind === 'otherBrief') return image.briefId !== briefId;
      // With no brief id every held image in reach is the block's subject.
      if (block.kind === 'unsaved' && !briefId) return true;
      if (block.kind === 'missing' || block.kind === 'misfit') {
        return this.googleHeldImageIssue(image, slotKey, library, briefId) === block.kind;
      }
      return image.briefId === briefId;
    };
    this.googleHeldImages.update((held) =>
      Object.fromEntries(Object.entries(held).map(([slotKey, images]) => [slotKey, images.filter((image) => !drop(slotKey, image))]))
    );
    if (block.kind !== 'otherBrief' && block.kind !== 'missing' && block.kind !== 'misfit') this.clearGoogleImageUpload();
    this.emitDraft();
  }

  protected onRedditCallToActionChange(event: Event): void {
    this.redditCallToAction.set((event.target as HTMLSelectElement).value as RedditCallToAction | '');
    this.emitDraft();
  }

  protected onMetaLifetimeBudgetChange(event: Event): void {
    this.metaLifetimeBudget.set((event.target as HTMLInputElement).checked);
    this.emitDraft();
  }

  protected onMetaObjectiveChange(event: Event): void {
    this.metaObjective.set((event.target as HTMLSelectElement).value as MetaObjective);
    // Every Meta mutation emits. These signals are invisible to `campaignForm.valueChanges`, so
    // without this the parent's draft never learns the edit and a tab switch reverts it.
    this.emitDraft();
  }

  /**
   * Toggle one placement.
   *
   * Refuses any key outside `META_SELECTABLE_PLACEMENTS`, which is what keeps `messengerInbox`
   * unsettable even if a future template change bound a live control to it. The template renders
   * that toggle disabled, but a disabled input is a presentation guarantee, not a state one.
   */
  protected onMetaPlacementChange(key: keyof MetaPlacement, event: Event): void {
    if (!this.metaSelectablePlacements.includes(key)) return;
    const enabled = (event.target as HTMLInputElement).checked;
    this.metaPlacements.update((placements) => ({ ...placements, [key]: enabled }));
    this.emitDraft();
  }

  protected onMetaPixelIdInput(event: Event): void {
    this.metaPixelId.set((event.target as HTMLInputElement).value);
    this.emitDraft();
  }

  protected removeMetaGeoTarget(index: number): void {
    this.metaGeoTargets.update((targets) => targets.filter((_, i) => i !== index));
    this.emitDraft();
  }

  /**
   * Add one Meta geo target, normalised through the shared `normalizeGeoTargets`.
   *
   * Runs the WHOLE list through the helper rather than just the new code, so an already-seeded
   * chip list is normalised on first add too. Both the seed path and the server's
   * `validateGeoTargets` call the same helper, so a `us` from the brief and a typed `US` collapse
   * to one chip and one wire entry no matter which door they came through.
   *
   * Shape, ISO ASSIGNMENT and Meta ELIGIBILITY are all settled here, via `acceptedMetaGeos`.
   * Eligibility is checked at every door rather than only at this one: a chip the operator can
   * SEE must be a chip the request will BUY. `metaEffectiveGeoTargets` filters ineligible codes
   * out of the dispatch, so a code displayed but not dispatched is precisely the display/dispatch
   * divergence that computed exists to prevent.
   *
   * COMPLIANCE remains the service's call — it additionally drops regulated markets via
   * `REGULATED_COUNTRIES`, and duplicating that list here would only let it drift.
   */
  protected addMetaGeoTarget(code: string): void {
    // Ineligible codes are refused at the chip rather than accepted and dropped later. `IR`, `CU`
    // and the uninhabited territories are ASSIGNED, so `normalizeGeoTargets` passes them, but Meta
    // will not target them — and on the legacy path that rejection lands at the ad set, after the
    // campaign POST. Same list the server and the Go client check, so the answer cannot depend on
    // which path runs.
    if (META_INELIGIBLE_COUNTRIES.has(code.trim().toUpperCase())) return;
    this.metaGeoTargets.update((targets) => this.acceptedMetaGeos([...targets, code]));
    this.emitDraft();
  }

  protected onMetaGeoTargetAdd(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addMetaGeoTarget(input.value);
    input.value = '';
  }

  // Microsoft handlers (LFXV2-3312). Every one emits, on the rule the Meta handlers state: these
  // signals are invisible to `campaignForm.valueChanges`, so a mutation that does not call
  // `emitDraft` never reaches the parent and the edit dies at the next tab switch.
  protected onMicrosoftBudgetInput(event: Event): void {
    this.microsoftBudgetUsd.set((event.target as HTMLInputElement).valueAsNumber || 0);
    this.emitDraft();
  }

  protected onMicrosoftCpcBidInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.microsoftCpcBid.set(value);
    // Typing a bid into the legacy field is the operator's newest choice, so it supersedes an
    // earlier explicit Automatic — otherwise the typed bid would be silently not sent
    // (`microsoftLegacyCpcBidApplies`).
    if (value.trim() !== '' && this.biddingDrafts()['microsoft-ads']?.strategy === 'automatic') {
      this.biddingDrafts.update((drafts) => {
        const next = { ...drafts };
        delete next['microsoft-ads'];
        return next;
      });
    }
    this.emitDraft();
  }

  /**
   * The explicit way out of an `unsupported` or `failed` block: the operator moves the retained
   * Manual choices of the selected platforms to Automatic. The typed amounts are kept, so turning
   * Manual back on later does not lose them.
   */
  protected switchRetainedBiddingToAutomatic(): void {
    const platforms = this.retainedManualBiddingPlatforms();
    this.biddingDrafts.update((drafts) => {
      const next = { ...drafts };
      for (const platform of platforms) {
        const draft = next[platform];
        if (draft) next[platform] = { ...draft, strategy: 'automatic' };
      }
      return next;
    });
    if (platforms.includes('microsoft-ads')) this.clearLegacyMicrosoftCpcBid();
    this.emitDraft();
  }

  protected onBiddingChange(platform: CampaignBiddingPlatform, draft: CampaignBiddingDraft): void {
    this.biddingDrafts.update((drafts) => ({ ...drafts, [platform]: { ...draft } }));
    if (platform === 'microsoft-ads' && draft.strategy === 'automatic') this.clearLegacyMicrosoftCpcBid();
    this.emitDraft();
  }

  /**
   * Add one Microsoft geo target, normalised through `normalizeMicrosoftGeoTargets` — the whole
   * list, not just the new code, so a brief-seeded list is normalised on first add too and a `us`
   * from the brief collapses with a typed `US`.
   *
   * NOT `normalizeGeoTargets`, which is Meta's: that helper gates on `ASSIGNED_COUNTRY_CODES`, and
   * the two lists genuinely diverge — `AN` is in Microsoft's table and not in ours, so routing
   * through it silently DROPPED a code Microsoft accepts, leaving the request to fall back to the
   * event country and target a different market.
   *
   * No eligibility filter here at all, for the reason given on `microsoftEffectiveGeoTargets`:
   * Microsoft resolves codes against its own table at create time and fails before creating
   * anything, so membership is its call rather than a list this app would have to keep in step.
   */
  protected addMicrosoftGeoTarget(code: string): void {
    // Same door-refusal as the keyword cap — the client bounds geo targets at 30.
    if (this.microsoftGeoTargets().length >= MICROSOFT_MAX_GEO_TARGETS) return;
    this.microsoftGeoTargets.update((targets) => normalizeMicrosoftGeoTargets([...targets, code]));
    this.emitDraft();
  }

  protected onMicrosoftGeoTargetAdd(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addMicrosoftGeoTarget(input.value);
    input.value = '';
  }

  /**
   * Add one Google geo target.
   *
   * No normaliser call, unlike Meta's and Microsoft's adds: the only source of a code here is the
   * select, whose options are the map's own keys, so the value is already canonical. The two guards
   * that remain are the ones a select cannot express — the cap, and not adding a code twice.
   */
  protected addGoogleGeoTarget(code: string): void {
    if (code === '') return;
    // The COMBINED count, because the countries and the postal-code ids are one list upstream.
    if (this.googleGeoTargetsFull()) return;
    if (this.googleGeoTargets().includes(code)) return;
    this.googleGeoTargets.update((targets) => [...targets, code]);
    this.emitDraft();
  }

  protected onGoogleGeoTargetAdd(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.addGoogleGeoTarget(select.value);
    // Back to the placeholder, so the control reads "add another" rather than naming the code it
    // just moved into a chip.
    select.value = '';
  }

  protected removeGoogleGeoTarget(index: number): void {
    this.googleGeoTargets.update((targets) => targets.filter((_, i) => i !== index));
    this.emitDraft();
  }

  /**
   * Add one postal-code target, reporting whether it was actually added.
   *
   * Boolean for the reason {@link addGoogleCallout} is: a refusal must leave the text in the box
   * beside the warning naming what to change. One refusal per check upstream's `resolveGeoEntry`
   * can make locally — digits only, canonical — plus the combined cap and the repeat. Whether the
   * id names a real postal code is NOT checked, because nothing on this road can: upstream declines
   * that lookup, and a well-formed id naming nothing is refused by Google at the criteria mutate.
   */
  protected addGooglePostalGeoTarget(text: string): boolean {
    if (this.googleGeoTargetsFull()) return false;
    const id = googleAdsTrimSpace(text);
    if (!GOOGLE_ADS_GEO_TARGET_ID_PATTERN.test(id)) return false;
    if (!isCanonicalGoogleAdsResourceId(id)) return false;
    if (this.googlePostalGeoTargets().includes(id)) return false;
    this.googlePostalGeoTargets.update((ids) => [...ids, id]);
    this.emitDraft();
    return true;
  }

  protected onGooglePostalGeoAdd(): void {
    const control = this.googlePostalGeoForm.controls.postalId;
    // Cleared ONLY on success, so a refused id stays in the box with its warning beside it. No
    // `emitDraft()` for the text itself, matching the callout box: it reaches the draft on ADD.
    if (this.addGooglePostalGeoTarget(control.value)) {
      control.setValue('');
    }
  }

  protected removeGooglePostalGeoTarget(index: number): void {
    const removed = this.googlePostalGeoTargets()[index];
    this.googlePostalGeoTargets.update((ids) => ids.filter((_, i) => i !== index));
    // Its label goes with it, so the draft never carries a label for an id it does not hold.
    if (removed !== undefined && Object.hasOwn(this.googlePostalGeoLabels(), removed)) {
      this.googlePostalGeoLabels.update((labels) => Object.fromEntries(Object.entries(labels).filter(([id]) => id !== removed)));
    }
    this.emitDraft();
  }

  /**
   * Add one location PICKED from the search, reporting whether it was added.
   *
   * Through {@link addGooglePostalGeoTarget}, so a picked id passes every check a typed one does —
   * the shared cap, the canonical shape, the repeat — and dispatches identically. The label is
   * recorded first so the draft that add emits already carries it, and withdrawn if the add refuses.
   */
  protected addGooglePickedGeoTarget(suggestion: GoogleAdsGeoTargetSuggestion): boolean {
    const previous = this.googlePostalGeoLabels();
    this.googlePostalGeoLabels.set({ ...previous, [suggestion.id]: suggestion.canonicalName || suggestion.name });
    if (this.addGooglePostalGeoTarget(suggestion.id)) return true;
    this.googlePostalGeoLabels.set(previous);
    return false;
  }

  protected onGoogleGeoSearch(event: AutoCompleteCompleteEvent): void {
    // Cut to upstream's 100 characters rather than sent long and refused; a postal code or place
    // name never needs more.
    this.googleGeoSearchQuery.set([...googleAdsTrimSpace(event.query)].slice(0, GOOGLE_ADS_GEO_SEARCH_BOUNDS.maxQueryLength).join(''));
  }

  protected onGoogleGeoSearchSelect(event: AutoCompleteSelectEvent): void {
    const option = event.value as GoogleAdsGeoTargetOption;
    if (option && !option.disabled) this.addGooglePickedGeoTarget(option);
    // Cleared whatever the outcome, so the box reads "search another" rather than naming the pick.
    this.googleGeoSearchForm.controls.location.setValue(null);
    this.googleGeoSearchQuery.set('');
  }

  protected onGoogleGeoSearchClear(): void {
    this.googleGeoSearchQuery.set('');
  }

  /**
   * Add one radius target, reporting whether it was actually added.
   *
   * Boolean for the reason {@link addGoogleSitelink} is: a refusal leaves the sub-form filled. One
   * refusal per branch of upstream's `validateProximityTargets`, in its order — the cap on the list,
   * finite coordinates in range, a finite radius above zero, a unit (no default is invented), the
   * radius against THAT unit's ceiling — then the exact repeat, which upstream would collapse and
   * this list simply does not grow by.
   */
  protected addGoogleProximityTarget(draft: CampaignProximityTargetDraft): boolean {
    if (this.googleProximityTargets().length >= GOOGLE_ADS_MAX_PROXIMITY_TARGETS) return false;
    const latitude = this.parseGoogleProximityNumber(draft.latitude);
    const longitude = this.parseGoogleProximityNumber(draft.longitude);
    const radius = this.parseGoogleProximityNumber(draft.radius);
    if (latitude === null || longitude === null || radius === null) return false;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return false;
    if (!Number.isFinite(radius) || radius <= 0) return false;
    if (!(GOOGLE_ADS_RADIUS_UNITS as readonly string[]).includes(draft.radiusUnit)) return false;
    const radiusUnit = draft.radiusUnit as GoogleAdsRadiusUnit;
    if (radius > GOOGLE_ADS_MAX_RADIUS[radiusUnit]) return false;
    const target: CampaignProximityTarget = { latitude, longitude, radius, radiusUnit };
    if (this.googleProximityTargets().some((t) => t.latitude === latitude && t.longitude === longitude && t.radius === radius && t.radiusUnit === radiusUnit)) {
      return false;
    }
    this.googleProximityTargets.update((targets) => [...targets, target]);
    this.emitDraft();
    return true;
  }

  protected onGoogleProximityAdd(): void {
    // Cleared ONLY on success, so a refused target keeps all four fields and its warning. The unit
    // resets to unpicked too — the next target picks its own, as the first one did.
    if (this.addGoogleProximityTarget(this.googleProximityDraft())) {
      this.googleProximityForm.reset();
    }
  }

  protected removeGoogleProximityTarget(index: number): void {
    this.googleProximityTargets.update((targets) => targets.filter((_, i) => i !== index));
    this.emitDraft();
  }

  /**
   * Keep a Google campaign-type tick exclusive on the campaign-service road (#4755).
   *
   * That road creates one type per create and refuses any pair, so ticking a second type unticks the
   * first instead of silently disabling Create; the note under the row says each type is created on
   * its own. Only on a tick, never an untick, and never on the legacy road, which still creates
   * Search and Demand Gen together. Video is constructed disabled and is not part of the choice.
   */
  protected onGoogleChannelPicked(channel: GoogleCampaignChannel, event: Event): void {
    if (!this.googleCreativeAvailable()) return;
    if (!(event.target instanceof HTMLInputElement) || !event.target.checked) return;
    this.campaignForm.patchValue({
      includeSearch: channel === 'search',
      includeDemandGen: channel === 'demand-gen',
      includePerformanceMax: channel === 'performance-max',
      includeDisplay: channel === 'display',
    });
  }

  /**
   * Drop every postal-code and radius target held while the capability is not an explicit yes — the
   * operator's explicit choice to create with country targeting instead, which is the only way past
   * {@link googleLocationsCapabilityBlock} short of the check succeeding. Their sections are hidden
   * on that road, so the chips cannot be removed one by one.
   */
  protected removeHeldGoogleLocationTargets(): void {
    this.googlePostalGeoTargets.set([]);
    this.googlePostalGeoLabels.set({});
    // Radius targets only when the block COUNTED them. On Demand Gen they are held by the channel,
    // not the capability, for a switch back — the banner does not name them, so it must not drop them.
    const channel = this.resolveGoogleChannel();
    if (channel !== null && (GOOGLE_CHANNELS_WITH_PROXIMITY as readonly string[]).includes(channel)) {
      this.googleProximityTargets.set([]);
    }
    this.emitDraft();
  }

  /**
   * Add one Google campaign language — the geo add's twin, on the same reasoning: the select's
   * options are {@link GOOGLE_ADS_LANGUAGE_LABELS}' own keys, so the value is already canonical and
   * the only guards left are the cap and not adding a code twice.
   */
  protected addGoogleLanguage(code: string): void {
    if (code === '') return;
    if (this.googleLanguages().length >= GOOGLE_ADS_MAX_LANGUAGES) return;
    if (this.googleLanguages().includes(code)) return;
    this.googleLanguages.update((codes) => [...codes, code]);
    this.emitDraft();
  }

  protected onGoogleLanguageAdd(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.addGoogleLanguage(select.value);
    // Back to the placeholder, exactly as the geo select does.
    select.value = '';
  }

  protected removeGoogleLanguage(index: number): void {
    this.googleLanguages.update((codes) => codes.filter((_, i) => i !== index));
    this.emitDraft();
  }

  /**
   * Add one audience segment, reporting whether it was actually added.
   *
   * Each refusal mirrors upstream's `validateAudienceSegments` (`internal/platform/googleads/
   * targeting.go`), so a segment that becomes a chip is one the create will accept:
   *   - CAP: upstream compares the RAW list length first, so the cap is the door here too.
   *   - BLANK: never chipped. Upstream refuses an empty entry, which would cost the whole create.
   *   - SHAPE: only `customers/{id}/userLists/{id}` is attached; a custom audience or any other
   *     resource name is refused upstream, so it stays in the box with its warning beside it.
   *   - REPEAT: declined quietly. Upstream collapses a repeat rather than refusing it, so a second
   *     chip would show the operator a segment the request does not carry twice.
   *
   * Trimmed with Go's rules ({@link googleAdsTrimSpace}), as the callout add is. The BOOLEAN keeps
   * the text in the box on a refusal, the same contract as {@link addGoogleCallout}.
   */
  protected addGoogleAudienceSegment(text: string): boolean {
    if (this.googleAudienceSegments().length >= GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS) return false;
    const trimmed = googleAdsTrimSpace(text);
    if (!GOOGLE_ADS_USER_LIST_RESOURCE_PATTERN.test(trimmed)) return false;
    if (this.googleAudienceSegments().includes(trimmed)) return false;
    this.googleAudienceSegments.update((segments) => [...segments, trimmed]);
    this.emitDraft();
    return true;
  }

  protected onGoogleAudienceSegmentDraftInput(event: Event): void {
    // Draft text only — no `emitDraft()`, exactly as the callout box: it reaches the draft when the
    // segment is ADDED.
    this.googleAudienceSegmentDraft.set((event.target as HTMLInputElement).value);
  }

  protected onGoogleAudienceSegmentAdd(event: Event): void {
    const input = event.target as HTMLInputElement;
    // Cleared ONLY on success, so a refused resource name stays in the box with its warning.
    if (this.addGoogleAudienceSegment(input.value)) {
      input.value = '';
      this.googleAudienceSegmentDraft.set('');
    }
  }

  protected removeGoogleAudienceSegment(index: number): void {
    this.googleAudienceSegments.update((segments) => segments.filter((_, i) => i !== index));
    this.emitDraft();
  }

  /** The block's way out: drop every retained segment, the only action that never needs the read. */
  protected onGoogleAudienceSegmentsRemoveAll(): void {
    this.googleAudienceSegments.set([]);
    this.emitDraft();
  }

  /**
   * Add one callout, reporting whether it was actually added.
   *
   * Every refusal below is one branch of upstream's `validateCallouts`
   * (`internal/platform/googleads/assets.go`), in upstream's own order, so a callout that becomes a
   * chip is one the create will accept — and none of these can over-refuse, because each mirrors a
   * rule that is already law at the other end:
   *   - CAP: upstream compares the RAW list length first, before looking at any entry, so the cap
   *     is the door here too.
   *   - BLANK: never chipped. Upstream and the BFF both refuse an empty entry, so a blank chip
   *     would cost the whole create.
   *   - RUNES: `[...trimmed].length`, matching `utf8.RuneCountInString`. `.length` counts UTF-16
   *     units and would refuse an emoji or astral-plane callout upstream accepts.
   *   - DUPLICATE: case-folded, because upstream keys on `strings.ToLower` and REFUSES the create
   *     ("callout %q is listed more than once") rather than de-duplicating.
   *
   * Trimmed and lower-cased with Go's rules ({@link googleAdsTrimSpace}, {@link googleAdsToLower}),
   * because JS's `trim` and `toLowerCase` disagree with upstream's on a few characters.
   *
   * The BOOLEAN is what lets `onGoogleCalloutAdd` keep the operator's text on a refusal — the same
   * contract and the same reason as {@link addMicrosoftKeyword}: clearing unconditionally would
   * discard the very text the over-length warning is asking them to shorten.
   */
  protected addGoogleCallout(text: string): boolean {
    if (this.googleCallouts().length >= GOOGLE_ADS_MAX_CALLOUTS) return false;
    const trimmed = googleAdsTrimSpace(text);
    if (!trimmed) return false;
    if ([...trimmed].length > GOOGLE_ADS_MAX_CALLOUT_TEXT_RUNES) return false;
    if (this.googleCallouts().some((c) => googleAdsToLower(c) === googleAdsToLower(trimmed))) return false;
    this.googleCallouts.update((callouts) => [...callouts, trimmed]);
    this.emitDraft();
    return true;
  }

  protected onGoogleCalloutDraftInput(event: Event): void {
    // Draft text only — no `emitDraft()`. Transient input, exactly as the Microsoft keyword box:
    // it reaches the draft when the callout is ADDED.
    this.googleCalloutDraft.set((event.target as HTMLInputElement).value);
  }

  protected onGoogleCalloutAdd(event: Event): void {
    const input = event.target as HTMLInputElement;
    // Cleared ONLY on success, so a refused callout stays in the box with its warning beside it.
    if (this.addGoogleCallout(input.value)) {
      input.value = '';
      this.googleCalloutDraft.set('');
    }
  }

  protected removeGoogleCallout(index: number): void {
    this.googleCallouts.update((callouts) => callouts.filter((_, i) => i !== index));
    this.emitDraft();
  }

  /**
   * Add one sitelink, reporting whether it was actually added.
   *
   * Boolean for the same reason {@link addGoogleCallout} is: a refusal must leave the sub-form
   * filled so the operator can fix the field the warning names, not retype four of them.
   *
   * One refusal per branch of upstream's `validateSitelinks`, in its order — cap on the raw list,
   * blank link text, the rune bound, the case-folded duplicate, the all-or-nothing description
   * pair, each description line's own rune bound, then the destination and its byte bound. A
   * sitelink that passes every one is one upstream accepts, short of the utm-tagging margin
   * documented on {@link GOOGLE_ADS_MAX_FINAL_URL_BYTES}.
   */
  protected addGoogleSitelink(sitelink: CampaignSitelink): boolean {
    const text = googleAdsTrimSpace(sitelink.text);
    const description1 = googleAdsTrimSpace(sitelink.description1 ?? '');
    const description2 = googleAdsTrimSpace(sitelink.description2 ?? '');
    const finalUrl = googleAdsTrimSpace(sitelink.finalUrl);

    if (this.googleSitelinks().length >= GOOGLE_ADS_MAX_SITELINKS) return false;
    if (!text) return false;
    if ([...text].length > GOOGLE_ADS_MAX_SITELINK_TEXT_RUNES) return false;
    if (this.googleSitelinks().some((s) => googleAdsToLower(s.text) === googleAdsToLower(text))) return false;
    if ((description1 === '') !== (description2 === '')) return false;
    if ([description1, description2].some((d) => [...d].length > GOOGLE_ADS_MAX_SITELINK_DESCRIPTION_RUNES)) return false;
    // Upstream treats a sitelink with no destination as UNSERVABLE, not as a lesser sitelink, and
    // refuses the whole create — so an empty URL is a refusal here, not an omitted optional field.
    if (!this.isServableDestination(finalUrl)) return false;
    if (new TextEncoder().encode(finalUrl).length > GOOGLE_ADS_MAX_FINAL_URL_BYTES) return false;

    this.googleSitelinks.update((sitelinks) => [
      ...sitelinks,
      // Descriptions omitted together when neither is filled, so the request carries absence rather
      // than two empty strings — the shape the BFF helper and upstream both expect.
      { text, ...(description1 !== '' || description2 !== '' ? { description1, description2 } : {}), finalUrl },
    ]);
    this.emitDraft();
    return true;
  }

  protected onGoogleSitelinkDraftInput(field: keyof CampaignSitelink, event: Event): void {
    // Draft only — no `emitDraft()`, matching the callout box. It reaches the draft on ADD.
    const value = (event.target as HTMLInputElement).value;
    this.googleSitelinkDraft.update((draft) => ({ ...draft, [field]: value }));
  }

  protected onGoogleSitelinkAdd(): void {
    // Cleared ONLY on success, so a refused sitelink keeps all four fields and its warning.
    if (this.addGoogleSitelink(this.googleSitelinkDraft())) {
      this.googleSitelinkDraft.set({ text: '', description1: '', description2: '', finalUrl: '' });
    }
  }

  protected removeGoogleSitelink(index: number): void {
    this.googleSitelinks.update((sitelinks) => sitelinks.filter((_, i) => i !== index));
    this.emitDraft();
  }

  /**
   * Add one structured snippet, reporting whether it was actually added.
   *
   * Boolean for the reason {@link addGoogleSitelink} is: a refusal must leave the sub-form filled,
   * so the operator can fix the field the warning names rather than retype a header and four values.
   *
   * One refusal per branch of upstream's `validateStructuredSnippets`, in its order — the cap on the
   * raw list, a blank header, the header's rune bound, the case-folded header duplicate, then the
   * values in ITS loop's order (blanks skipped, each remaining value's rune bound, case-folded
   * repeats collapsed), and finally the minimum and maximum counted on what survived that loop. A
   * snippet that passes every one is one upstream accepts.
   *
   * The values are stored AS TYPED, minus blank lines: the repeats upstream collapses are left in
   * place, because the guard above has already established that enough distinct ones remain and
   * dropping them here would make the dispatched list disagree with the one this app judged.
   */
  protected addGoogleStructuredSnippet(header: string, values: string[]): boolean {
    if (this.googleStructuredSnippets().length >= GOOGLE_ADS_MAX_STRUCTURED_SNIPPETS) return false;

    const trimmedHeader = googleAdsTrimSpace(header);
    if (!trimmedHeader) return false;
    if ([...trimmedHeader].length > GOOGLE_ADS_MAX_SNIPPET_HEADER_RUNES) return false;
    if (this.googleStructuredSnippets().some((s) => googleAdsToLower(s.header) === googleAdsToLower(trimmedHeader))) return false;

    const trimmedValues = values.map((value) => googleAdsTrimSpace(value)).filter((value) => value !== '');
    // The rune bound BEFORE the repeat is collapsed, exactly as upstream's loop checks it — so an
    // over-long value that merely repeats an earlier one is still refused.
    if (trimmedValues.some((value) => [...value].length > GOOGLE_ADS_MAX_SNIPPET_VALUE_RUNES)) return false;

    const distinct = new Set(trimmedValues.map((value) => googleAdsToLower(value))).size;
    if (distinct < GOOGLE_ADS_MIN_SNIPPET_VALUES) return false;
    if (distinct > GOOGLE_ADS_MAX_SNIPPET_VALUES) return false;

    this.googleStructuredSnippets.update((snippets) => [...snippets, { header: trimmedHeader, values: trimmedValues }]);
    this.emitDraft();
    return true;
  }

  protected onGoogleStructuredSnippetDraftInput(field: keyof CampaignStructuredSnippetDraft, event: Event): void {
    // Draft only — no `emitDraft()`, matching the callout and sitelink boxes. It reaches the draft
    // on ADD. The values box is a `<textarea>`, which is why this widens past `HTMLInputElement`.
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.googleStructuredSnippetDraft.update((draft) => ({ ...draft, [field]: value }));
  }

  protected onGoogleStructuredSnippetAdd(): void {
    const draft = this.googleStructuredSnippetDraft();
    // Cleared ONLY on success, so a refused snippet keeps its header and every value it was typed
    // with, beside the warning naming what to change.
    if (this.addGoogleStructuredSnippet(draft.header, draft.values.split('\n'))) {
      this.googleStructuredSnippetDraft.set({ header: '', values: '' });
    }
  }

  protected removeGoogleStructuredSnippet(index: number): void {
    this.googleStructuredSnippets.update((snippets) => snippets.filter((_, i) => i !== index));
    this.emitDraft();
  }

  /**
   * Add one call extension from the sub-form's raw text, reporting whether it was actually added.
   *
   * Boolean for the reason {@link addGoogleSitelink} is. The cap first, as upstream checks the raw
   * list before any entry; then every per-entry branch of `validateCallExtensions` in its order,
   * through the shared judge the BFF refuses by — so a call extension added here is one upstream
   * accepts. Stored normalised (trimmed, country upper-cased), which is what is judged and sent.
   */
  protected addGoogleCallExtension(draft: CampaignCallExtensionDraft): boolean {
    if (this.googleCallExtensions().length >= GOOGLE_ADS_MAX_CALL_EXTENSIONS) return false;
    const call = this.googleCallExtensionFromDraft(draft);
    if (googleCallExtensionRefusal(call, this.googleCallExtensions()) !== null) return false;
    this.googleCallExtensions.update((calls) => [...calls, call]);
    this.emitDraft();
    return true;
  }

  protected onGoogleCallExtensionAdd(): void {
    // Cleared ONLY on success, so a refused number keeps both boxes and its warning.
    if (this.addGoogleCallExtension(this.googleCallExtensionDraft())) {
      this.googleCallExtensionForm.reset();
    }
  }

  protected removeGoogleCallExtension(index: number): void {
    this.googleCallExtensions.update((calls) => calls.filter((_, i) => i !== index));
    this.emitDraft();
  }

  /**
   * Add one promotion from the sub-form, on {@link addGoogleCallExtension}'s contract: the cap, then
   * `validatePromotionExtensions`' branches through the shared judge, then a store of the entry
   * exactly as it will be sent — only the discount and eligibility arms the form selected, and an
   * empty optional box omitted rather than sent as `""`.
   */
  protected addGooglePromotion(draft: CampaignPromotionDraft): boolean {
    if (this.googlePromotions().length >= GOOGLE_ADS_MAX_PROMOTIONS) return false;
    if (this.googlePromotionConditionRefusal(draft) !== null) return false;
    const promotion = this.googlePromotionFromDraft(draft);
    if (googlePromotionRefusal(promotion, this.googlePromotions()) !== null) return false;
    this.googlePromotions.update((promotions) => [...promotions, promotion]);
    this.emitDraft();
    return true;
  }

  protected onGooglePromotionAdd(): void {
    // Cleared ONLY on success, as the call box is.
    if (this.addGooglePromotion(this.googlePromotionDraft())) {
      this.googlePromotionForm.reset();
    }
  }

  protected removeGooglePromotion(index: number): void {
    this.googlePromotions.update((promotions) => promotions.filter((_, i) => i !== index));
    this.emitDraft();
  }

  /**
   * Add one price table from the sub-form, on the same contract: the cap, then
   * `validatePriceExtensions`' branches through the shared judge. The table's one currency box is
   * copied onto every row, which is where the wire carries it.
   */
  protected addGooglePrice(draft: CampaignPriceExtensionDraft): boolean {
    if (this.googlePrices().length >= GOOGLE_ADS_MAX_PRICE_EXTENSIONS) return false;
    const price = this.googlePriceFromDraft(draft);
    if (googlePriceExtensionRefusal(price) !== null) return false;
    this.googlePrices.update((prices) => [...prices, price]);
    this.emitDraft();
    return true;
  }

  /** One more row, up to Google's eight. The button is hidden at the ceiling; this holds it anyway. */
  protected addGooglePriceRow(): void {
    const rows = this.googlePriceForm.controls.offerings;
    if (rows.length < GOOGLE_ADS_MAX_PRICE_OFFERINGS) rows.push(this.googlePriceRowGroup());
  }

  /** One row fewer, down to Google's three — a table below that is refused, so it cannot be built. */
  protected removeGooglePriceRow(index: number): void {
    const rows = this.googlePriceForm.controls.offerings;
    if (rows.length > GOOGLE_ADS_MIN_PRICE_OFFERINGS) rows.removeAt(index);
  }

  protected onGooglePriceAdd(): void {
    // Cleared ONLY on success, and back to Google's three empty rows.
    if (this.addGooglePrice(this.googlePriceDraft())) {
      const rows = this.googlePriceForm.controls.offerings;
      while (rows.length > GOOGLE_ADS_MIN_PRICE_OFFERINGS) rows.removeAt(rows.length - 1);
      this.googlePriceForm.reset();
    }
  }

  protected removeGooglePrice(index: number): void {
    this.googlePrices.update((prices) => prices.filter((_, i) => i !== index));
    this.emitDraft();
  }

  protected removeMicrosoftGeoTarget(index: number): void {
    this.microsoftGeoTargets.update((targets) => targets.filter((_, i) => i !== index));
    this.emitDraft();
  }

  /**
   * Add one keyword, reporting whether it was actually added.
   *
   * Blank input is ignored rather than added — an empty chip would be dropped by
   * `microsoftEffectiveKeywords` anyway, so adding one would show the operator a keyword the
   * request will not carry. New keywords start at `MICROSOFT_NEW_KEYWORD_MATCH_TYPE`; see that
   * constant for why, and for why the duplicate check below has to be scoped to it.
   *
   * The BOOLEAN is what lets the caller keep the operator's text on a rejection. Every `return
   * false` below is a refusal, and clearing the box unconditionally discarded the very text the
   * over-length warning was asking them to shorten — the field is bound to `(change)`, so simply
   * blurring it wiped the input and the warning with it. It also silently ate a duplicate or an
   * at-cap entry, leaving no trace of what the operator typed.
   */
  protected addMicrosoftKeyword(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    // Refused at the door rather than accepted and rejected later: the client caps the list at 60
    // and each term at 100 RUNES, and because dispatch is async a violation would surface as a
    // failed job. Counted with the spread, matching the client's rune count — `.length` counts
    // UTF-16 units and would reject a valid CJK or emoji keyword the client accepts.
    // Counted on the EFFECTIVE list, matching the label, the add-box gate, `microsoftBoundsValid`
    // and the payload — all five now agree on what "60 keywords" means. Counting the raw rows
    // instead let a duplicate consume cap the request never spends: after a match-type edit made
    // two rows collapse into one, the label could read 59/60 with the box open and the add still
    // refused, and a duplicate row permanently blocked ever reaching 60 unique keywords.
    if (this.microsoftEffectiveKeywords().length >= MICROSOFT_MAX_KEYWORDS) return false;
    if ([...trimmed].length > MICROSOFT_MAX_KEYWORD_TEXT_LENGTH) return false;
    // Same control-character rule the BFF and the client apply. Checked on the RAW text, not the
    // trimmed one, matching upstream's pre-trim check — a leading or trailing control char must be
    // caught too, and trimming only strips whitespace.
    if (MICROSOFT_CONTROL_CHAR_RE.test(text)) return false;
    // De-duped by (matchType, case-folded text), matching the client's `validateKeywords`:
    // Microsoft treats keyword text case-insensitively, so two chips differing only in case would
    // be one keyword upstream and the list would overstate coverage — but the SAME text under a
    // DIFFERENT match type is a genuinely distinct keyword that upstream accepts.
    //
    // Text alone was too strict in a way the operator could not work around. New rows are added at
    // `Phrase` and the match type is only changeable AFTER the row exists, so a seeded or restored
    // `kubernetes/Exact` made `kubernetes/Phrase` unreachable: the add was refused before its
    // match type could be changed, and refusing at the door gave no way to get there.
    const exists = this.microsoftKeywords().some(
      (k) => k.matchType === MICROSOFT_NEW_KEYWORD_MATCH_TYPE && k.text.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) return false;
    this.microsoftKeywords.update((keywords) => [...keywords, { text: trimmed, matchType: MICROSOFT_NEW_KEYWORD_MATCH_TYPE }]);
    this.emitDraft();
    return true;
  }

  protected onMicrosoftKeywordDraftInput(event: Event): void {
    // Draft text only — no `emitDraft()`, because this is transient input rather than a
    // configured value. It reaches the draft when the keyword is ADDED.
    this.microsoftKeywordDraft.set((event.target as HTMLInputElement).value);
  }

  protected onMicrosoftKeywordAdd(event: Event): void {
    const input = event.target as HTMLInputElement;
    // Cleared ONLY on success. On a refusal the text stays put so the operator can edit it — and
    // the live warning stays visible rather than vanishing along with the value it described.
    if (this.addMicrosoftKeyword(input.value)) {
      input.value = '';
      this.microsoftKeywordDraft.set('');
    }
  }

  protected removeMicrosoftKeyword(index: number): void {
    this.microsoftKeywords.update((keywords) => keywords.filter((_, i) => i !== index));
    this.emitDraft();
  }

  protected onMicrosoftKeywordMatchTypeChange(index: number, event: Event): void {
    const matchType = (event.target as HTMLSelectElement).value as MicrosoftKeyword['matchType'];
    this.microsoftKeywords.update((keywords) => keywords.map((k, i) => (i === index ? { ...k, matchType } : k)));
    this.emitDraft();
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    // The X start rule depends on the clock, which `canSubmit`'s memo cannot see move: a form left
    // open across midnight UTC would otherwise send a start campaign-service now refuses.
    const twitterFlightError = this.selectedPlatforms().includes('twitter-ads') ? this.twitterFlightErrorAt(Date.now()) : null;
    if (twitterFlightError !== null) {
      this.errors.set([twitterFlightError]);
      return;
    }

    const platforms = this.selectedPlatforms();
    this.step.set('creating');
    this.creationProgress.set(['Submitting campaign...']);
    this.results.set([]);
    this.platformResults.set([]);
    this.errors.set([]);

    const form = this.campaignForm.getRawValue();
    const campaignTypes: CampaignType[] = this.selectedGoogleChannels();
    const slug = form.eventSlug || form.eventName.toLowerCase().replace(/\s+/g, '-');

    const request = {
      eventName: form.eventName,
      eventSlug: slug,
      countryCode: form.countryCode,
      registrationUrl: form.registrationUrl,
      hsToken: this.briefHsToken() ?? undefined,
      campaignTypes,
      budgetUsd: form.budgetUsd,
      searchBudgetPct: form.searchBudgetPct,
      startDate: form.startDate,
      endDate: form.endDate,
      keywords: this.briefKeywords(),
      headlines: (form.headlines as string[]).filter((h) => h.trim()),
      descriptions: (form.descriptions as string[]).filter((d) => d.trim()),
      // The SAME derivation the Google section previews, for the reason `metaEffectiveGeoTargets`
      // exists: deriving the request's targets separately from the displayed ones is how a screen
      // ends up claiming one country while the request buys another.
      geoTargets: this.googleEffectiveGeoTargets(),
      // The radius targets, Google-gated for the same reason the creative is below, and already
      // withheld unless the dispatched channel is one upstream accepts proximity on.
      ...(platforms.includes('google-ads') ? this.googleProximityPayload() : {}),
      // The per-channel creative objects, present only for a selected channel that has one and
      // only when something was actually typed into it. Google-gated for the same reason the
      // section is: a LinkedIn-only create must not carry a Google creative the operator left
      // behind from an earlier selection.
      ...(platforms.includes('google-ads') ? this.googleCreativePayload() : {}),
      // The bidding plan, Google-gated for the same reason the creative is, and already narrowed
      // to the fields the effective strategy and channel actually take.
      ...(platforms.includes('google-ads') ? this.googleBiddingPayload() : {}),
      // The language narrowing, Google-gated for the same reason, and already withheld unless the
      // dispatched channel is one upstream accepts campaign languages on.
      ...(platforms.includes('google-ads') ? this.googleLanguagesPayload() : {}),
      // The audience segments, Google-gated for the same reason, and already withheld unless the
      // dispatched channel is Search, the one channel upstream attaches audience criteria on.
      ...(platforms.includes('google-ads') ? this.googleAudienceSegmentsPayload() : {}),
      // The callout extensions, Google-gated for the same reason the creative and the bidding plan
      // are, and already narrowed by `googleCalloutsAvailable` to the one channel upstream accepts
      // extensions on.
      ...(platforms.includes('google-ads') ? this.googleCalloutsPayload() : {}),
      // The sitelink extensions, on the same gate as the callouts — both are ad extensions, and
      // upstream refuses the whole create when any extension list reaches a non-Search campaign.
      ...(platforms.includes('google-ads') ? this.googleSitelinksPayload() : {}),
      ...(platforms.includes('google-ads') ? this.googleStructuredSnippetsPayload() : {}),
      // The call, promotion and price extensions, on the same gate as the three above.
      ...(platforms.includes('google-ads') ? this.googleAssetExtensionsPayload() : {}),
      driveFolderUrl: this.briefDriveFolderUrl() || undefined,
      platforms,
      ...(platforms.includes('linkedin-ads')
        ? {
            linkedInConfig: {
              eventName: form.eventName,
              eventSlug: slug,
              dates: `${form.startDate} - ${form.endDate}`,
              registrationUrl: form.registrationUrl,
              hsToken: this.briefHsToken() ?? undefined,
              budgetUsd: this.linkedInBudgetUsd(),
              lifetimeBudget: this.linkedInLifetimeBudget(),
              startDate: form.startDate,
              endDate: form.endDate,
              geoTargets: this.linkedInGeoTargets(),
              targetingProfile: this.linkedInTargetingProfile(),
              variants: this.linkedInVariantsForCreate(),
              adAccountId: this.linkedInAccountId(),
              ...this.biddingField('linkedin-ads'),
            },
          }
        : {}),
      ...(platforms.includes('reddit-ads')
        ? {
            redditConfig: {
              eventName: form.eventName,
              eventSlug: slug,
              registrationUrl: form.registrationUrl,
              hsToken: this.briefHsToken() ?? undefined,
              budgetUsd: this.redditBudgetUsd(),
              startDate: form.startDate,
              endDate: form.endDate,
              // The SAME derivation the preview renders. Reading `[form.countryCode]` here instead
              // would let the two disagree: a cleared country code previews nothing and dispatches
              // [''], which the operator cannot see and Reddit cannot use.
              geoTargets: this.redditEffectiveGeoTargets(),
              // The normalised list, matching the preview above for the same reason geoTargets
              // does: dispatch strips an optional `r/`, so sending the raw value would submit
              // something the operator was never shown.
              subreddits: this.redditEffectiveSubreddits(),
              interests: this.redditInterests(),
              keywords: this.redditKeywords().length > 0 ? this.redditKeywords() : this.briefKeywords().map((k) => k.term),
              variants: this.redditVariants(),
              // Always sent, never conditioned on differing from the default: both creators fall
              // back to the same objective when it is absent, so an explicit value is the only
              // thing that makes the payload say what the screen shows.
              //
              // Sent even when `redditObjectiveIsUnavailable()`, and that is the deliberate half:
              // omitting the field would fall back to `conversions` and quietly build a campaign the
              // operator never chose, against an objective the select is showing them as
              // "(no longer available)". Unreachable today — every objective is selectable.
              objective: this.redditObjective(),
              // Only with `video_views`: both creators require it there and ignore it elsewhere, so
              // a goal left over from an earlier Video Views choice is not sent with another
              // objective. `canSubmit` guarantees it is present whenever the objective needs it.
              ...this.redditVideoGoalPayload(),
              // Omitted when blank rather than sent empty: upstream treats an empty `postUrl` as
              // "author a post instead", and an empty `callToAction` as "use the default" — both
              // the same decision an absent key makes, so a blank string would only add a value
              // for a reader to misread.
              ...(this.redditPostUrl() ? { postUrl: this.redditPostUrl() } : {}),
              // Gated on the capability, not merely on the text, for the reason the Google
              // creative is: with the cutover dark these two reach a creator that reads neither,
              // and a create that silently discards them still reports success. The draft keeps
              // what was typed; only the request drops it.
              //
              // The image is ONE of an uploaded asset or the pasted URL — see `redditImageField`.
              ...this.redditImageField(),
              ...(this.redditCreativeAvailable() && this.redditCallToAction() ? { callToAction: this.redditCallToAction() as RedditCallToAction } : {}),
              // Omitted when blank — upstream reads empty as "use the connection's pixel", the same
              // thing an absent key means — and gated on the capability, because the legacy
              // creator never reads it and the create route refuses it there (#3484).
              ...(this.redditConversionPixelAvailable() && this.redditConversionPixelId() ? { conversionPixelId: this.redditConversionPixelId() } : {}),
              project: this.briefData()?.eventDetails?.themes?.[0] || undefined,
              ...this.biddingField('reddit-ads'),
            },
          }
        : {}),
      ...(platforms.includes('meta-ads')
        ? {
            metaConfig: {
              eventName: form.eventName,
              eventSlug: slug,
              registrationUrl: form.registrationUrl,
              hsToken: this.briefHsToken() ?? undefined,
              budgetUsd: this.metaBudgetUsd(),
              lifetimeBudget: this.metaLifetimeBudget(),
              startDate: form.startDate,
              endDate: form.endDate,
              // The SAME value the preview renders — see `metaEffectiveGeoTargets`.
              geoTargets: this.metaEffectiveGeoTargets(),
              variants: this.metaVariantsForCreate(),
              objective: this.metaObjective(),
              placements: this.metaPlacementOverrides(),
              // Sent only under `conversions`. Under every other objective the promoted object is
              // a page id or nothing at all, so an id left in the box from an earlier selection
              // would be a field the service ignores — and one a reader of the payload would
              // reasonably take as meaningful. Trimmed to match the upstream trim.
              ...(this.metaRequiresPixel() ? { pixelId: this.metaPixelId().trim() } : {}),
              ...this.metaInstagramDsaFields(),
              project: this.briefData()?.eventDetails?.themes?.[0] || undefined,
              ...this.biddingField('meta-ads'),
            },
          }
        : {}),
      ...(platforms.includes('microsoft-ads')
        ? {
            microsoftConfig: {
              eventName: form.eventName,
              eventSlug: slug,
              registrationUrl: form.registrationUrl,
              hsToken: this.briefHsToken() ?? undefined,
              budgetUsd: this.microsoftBudgetUsd(),
              // The flight dates, exactly as `metaConfig` sends them — but ONLY on an explicit yes.
              // A campaign-service without linuxfoundation/lfx-v2-campaign-service#409 discards
              // them silently, and the create route refuses them while the capability is off.
              ...(this.microsoftScheduleAvailable() ? { startDate: form.startDate, endDate: form.endDate } : {}),

              // The SAME computeds the section renders and `canSubmit` gates on, so the screen,
              // the guard and the request cannot disagree — see `microsoftEffectiveGeoTargets`.
              geoTargets: this.microsoftEffectiveGeoTargets(),
              keywords: this.microsoftEffectiveKeywords(),
              // Sent only when set. An explicit 0 would claim a bid the account does not have,
              // whereas omitting it lets Microsoft apply the account-currency minimum.
              //
              // Never beside `bidding` (#3299): the Bidding control replaces this field, and
              // campaign-service refuses an automatic `bidding` with any `cpcBid`.
              ...(this.microsoftLegacyCpcBidApplies() && this.microsoftEffectiveCpcBid() !== null ? { cpcBid: this.microsoftEffectiveCpcBid() as number } : {}),
              project: this.briefData()?.eventDetails?.themes?.[0] || undefined,
              ...this.biddingField('microsoft-ads'),
              // Sent only while `microsoftImageSent()`; `microsoftImageAssetBlock` holds Create for
              // an upload the request cannot carry, so it is never left out without a word.
              ...(this.microsoftImageSent() ? { imageAssetId: this.microsoftImageAssetId() } : {}),
            },
          }
        : {}),
      // X only on an explicit yes. `canSubmit` already refuses a held X without one
      // (`twitterCreateBlock`); the gate here is what makes the request agree with that on its own.
      ...(platforms.includes('twitter-ads') && this.twitterCreateAvailable()
        ? { twitterConfig: this.twitterConfigForCreate(form.startDate, form.endDate) }
        : {}),
      // Gated on the id, NOT on `platforms.includes('hubspot')`. `selectedPlatforms` is typed
      // `CampaignPlatform[]`, whose union has no 'hubspot' member, so a platform test here could
      // never be true and would silently drop the value the day a trigger appears.
      //
      // Trimmed before the emptiness test so a whitespace-only id is treated as absent rather
      // than sent as a present-but-blank config. The server applies the same rule
      // (`buildHubSpotConfig` trims and returns null — UNCONFIGURED — when blank), so the two
      // sides agree instead of the client sending something the server then has to reject.
      ...(this.sourceEmailId().trim() ? { hubspotConfig: { sourceEmailId: this.sourceEmailId().trim() } } : {}),
    };

    // Read once, here, and carry it into the poll rather than re-reading per request. The
    // foundation is switchable while a job runs, and `GetJob` matches the brief's project
    // EXACTLY — a poll sent under a foundation the user switched to answers `not_found`, which
    // is terminal for the poller and would be reported as a lost campaign that is in fact
    // running.
    const projectSlug = this.projectContextService.activeContext()?.slug ?? '';
    const briefId = this.briefPersistence().briefId ?? '';

    this.campaignService.createCampaign(request, projectSlug, briefId).subscribe({
      next: (response) => {
        if (response.result) {
          this.results.set(response.result.campaigns);
          this.errors.set(response.result.errors);
          this.step.set('results');
          return;
        }
        if (response.error) {
          this.errors.set([response.error]);
          this.step.set('results');
          return;
        }
        if (!response.jobId) {
          this.errors.set(['Campaign creation could not be started. The ad platform integration may not be configured. Please contact your administrator.']);
          this.step.set('form');
          return;
        }
        this.creationProgress.update((msgs) => [...msgs, `Job started: ${response.jobId}`]);
        this.pollJob(response.jobId, projectSlug);
      },
      // Surface the message the SERVER wrote, keeping the connection copy as the fallback for a
      // response that carried none. This handler took no parameter at all, so EVERY non-2xx was
      // reported as a connection failure — including the named field refusals this create path
      // deliberately emits, which arrive with a field and a stated remedy and were being replaced
      // with advice to check the network. `serverAuthoredMessage` is the shared gate for this:
      // it forwards a message a person wrote and refuses a status-derived envelope.
      error: (err) => {
        this.errors.set([serverAuthoredMessage(err, 'Unable to reach the campaign service. Please check your connection and try again.')]);
        this.step.set('form');
      },
    });
  }

  // === Private Methods ===
  /**
   * Replay edits carried over from a previous mount, over the values just seeded from the brief.
   *
   * Guarded on the event slug. A draft belongs to the brief it was typed against, and replaying
   * event A's copy onto event B's freshly generated brief would silently overwrite it — the same
   * class of bug the parent's `(project, event)` ownership keys exist to prevent. On a mismatch
   * the draft is ignored and the brief's own copy stands.
   */
  /**
   * Normalise a geo list AND drop what Meta cannot target — the single owner of that pair.
   *
   * Every path that WRITES `metaGeoTargets` routes through here: the chip add, the brief seed and
   * the draft restore. Previously only the chip add checked eligibility, so a brief recommending
   * `IR` — or a draft carrying one — rendered a chip that `metaEffectiveGeoTargets` then filtered
   * out of the request. The empty-state warning is gated on `metaGeoTargets().length === 0`, so a
   * surviving ineligible chip suppressed it, and `canSubmit` passed on the `countryCode` fallback:
   * the operator read `IR` on screen and bought a US campaign.
   *
   * Eligibility belongs on the WRITE rather than only on the read so the two cannot disagree.
   * `metaEffectiveGeoTargets` keeps its own filter regardless — it is the boundary `submit()`
   * reads, and a guard there costs nothing.
   */
  private acceptedMetaGeos(codes: readonly string[]): string[] {
    return normalizeGeoTargets(codes).filter((c) => !META_INELIGIBLE_COUNTRIES.has(c));
  }

  /**
   * Which channel a Google create would carry, resolved the way `buildGoogleAdsConfig` resolves it:
   * Search whenever Search is ticked, otherwise the first ticked channel. Null when Google is
   * unselected or no channel is ticked — there is no default channel to fall back on.
   *
   * Deliberately knows nothing about the CREATIVE capability. {@link initGoogleBiddingChannel} adds
   * that gate on top, because every field it owns rides the `googleAdsConfig` envelope the legacy
   * creator ignores. {@link initGoogleExtensionsCapabilityBlock} cannot: it exists to report on that
   * very gate, so it has to see the channel underneath it. One resolution with two readers, so the
   * two can never drift apart on which channel they mean — the rule
   * {@link initGoogleLanguagesChannel} already follows by reading the bidding channel rather than
   * re-deriving it.
   */
  private resolveGoogleChannel(): GoogleCampaignChannel | null {
    void this.campaignFormRevision();
    if (!this.showGoogleSection()) return null;
    const channels = this.selectedGoogleChannels();
    if (channels.length === 0) return null;
    return channels.includes('search') ? 'search' : channels[0];
  }

  /**
   * The Reddit image field the create request carries: the uploaded asset, else the pasted URL.
   *
   * Exactly one, because campaign-service refuses `imageAssetId` alongside `imageUrl` (or
   * `postUrl`) with a 400. The asset is withheld while a post URL is set — that post already has
   * its image, and the combination is refused rather than ignored — and while the upload
   * capability is off, where the legacy creator would drop it or campaign-service refuse it. The
   * pasted URL keeps its existing rule: sent on `redditCreativeAvailable()`, and ignored upstream
   * when a post URL is set.
   */
  private redditImageField(): { imageAssetId: string } | { imageUrl: string } | Record<string, never> {
    if (this.redditAssetUploadAvailable() && this.redditImageAssetForThisBrief() && !this.redditPostUrl()) {
      return { imageAssetId: this.redditImageAssetId() };
    }
    if (this.redditCreativeAvailable() && this.redditImageUrl()) return { imageUrl: this.redditImageUrl() };
    return {};
  }

  private initRedditImageAssetBlock(): Signal<CampaignRedditImageAssetBlock | null> {
    return computed(() => {
      if (!this.showRedditSection() || this.redditPostUrl()) return null;
      // An upload made for another brief, retained across a brief switch: `redditImageField` never
      // sends it, whatever the capability says, so it must not read as usable either.
      const briefId = this.briefPersistence().briefId;
      if (this.redditImageAssetId() !== '' && briefId && this.redditImageAssetBriefId() !== briefId) {
        return {
          kind: 'otherBrief',
          message:
            'The uploaded Reddit image was uploaded for a different brief, so it cannot be sent with this one. Remove it, then upload it again or use an image URL.',
        };
      }
      // An upload still in flight counts as the image too: resumed after a tab switch it has no
      // asset id yet, and while the upload control is hidden (support unknown, unconfirmed or off)
      // this block is the only place its state shows and the only way to remove it.
      const hasImage = this.redditImageAssetForThisBrief() || this.redditImageUploadStatus() === 'uploading';
      if (this.redditAssetUploadAvailable()) return null;
      // A failed upload's reason lives in the upload control, so while that is hidden (a resumed
      // upload that failed after a tab switch) it is shown here, holding Create until the operator
      // removes it: otherwise the campaign would go out without the image they chose, unannounced.
      // Only for an upload made for the OPEN brief: one for a brief left behind (a foundation
      // switch with the tab still open) could never have been sent with this one.
      if (this.redditImageUploadStatus() === 'error' && briefId && this.redditImageUploadFailedBriefId() === briefId) {
        return {
          kind: 'uploadFailed',
          message: `The Reddit image upload did not complete: ${this.redditImageUploadError()} Remove it to create the campaign without the image.`,
        };
      }
      if (!hasImage) return null;
      if (this.redditCreativeEnabled() === false || this.redditAssetUploadEnabled() === false) {
        return {
          kind: 'unsupported',
          message:
            'Image upload is not available on this deployment, so the uploaded Reddit image cannot be sent. Remove it to create the campaign without it.',
        };
      }
      // The same create-capability read answers this and the bidding capability, so its state says
      // whether a read is out; see `initBiddingCapabilityBlock` for why `unknown` gets a Retry.
      if (this.createCapabilityRead() === 'pending') {
        return { kind: 'pending', message: 'Checking Reddit image upload support…' };
      }
      if (!this.briefPersistence().briefId) {
        return {
          kind: 'unsaved',
          message: "Reddit image upload support can't be checked until this brief is saved. Save the brief, or remove the uploaded image.",
        };
      }
      return {
        kind: 'failed',
        message:
          'Could not confirm that Reddit image upload is supported, so the uploaded image cannot be sent yet. Retry the check, or remove the uploaded image.',
      };
    });
  }

  /**
   * Show an upload in flight and keep its answer. Unsubscribing on destroy only detaches this
   * component: the service's shared request runs on, so a tab switch does not abort the upload.
   */
  private followRedditImageUpload(upload$: Observable<CreativeAssetUploadResult>, briefId: string, fileName: string): void {
    this.redditImageUploadStatus.set('uploading');
    this.redditImageUploadError.set('');
    this.redditImageUploadPendingName.set(fileName);
    this.redditImageUploadPendingBriefId.set(briefId);
    this.redditImageUploadSub = upload$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (asset) => {
        this.campaignService.forgetCreativeAssetUpload('reddit', upload$);
        this.redditImageUploadPendingName.set('');
        this.redditImageUploadPendingBriefId.set('');
        // The brief changed while the upload was in flight: the asset belongs to the old one.
        if ((this.briefPersistence().briefId ?? '') !== briefId) {
          this.failRedditImageUpload('The brief changed during the upload. Choose the image again.', briefId);
          this.emitDraft();
          return;
        }
        this.redditImageAssetId.set(asset.id);
        this.redditImageAssetName.set(fileName);
        this.redditImageAssetBriefId.set(briefId);
        this.redditImageUploadStatus.set('idle');
        // The library this brief's slot plan is computed from just gained an asset.
        this.creativeLibraryRevision.update((revision) => revision + 1);
        this.emitDraft();
      },
      error: (err: unknown) => {
        this.campaignService.forgetCreativeAssetUpload('reddit', upload$);
        this.redditImageUploadPendingName.set('');
        this.redditImageUploadPendingBriefId.set('');
        this.failRedditImageUpload(this.creativeAssetUploadErrorMessage(err), briefId);
        this.emitDraft();
      },
    });
  }

  /**
   * Pick an upload back up after a remount. The request outlived the previous mount, so the
   * service still has it, finished or not; with none (a reload ended it) the operator is told
   * rather than left with an image that silently never arrived.
   */
  private resumeRedditImageUpload(fileName: string, uploadBriefId: string): void {
    const currentBriefId = this.briefPersistence().briefId ?? '';
    const briefId = uploadBriefId || currentBriefId;
    if (briefId !== currentBriefId) {
      // The upload belongs to a brief that is not the open one (a foundation switch clears the
      // current brief but keeps the draft). Its asset could never be sent with this brief, so
      // following it would only hold Create and then discard the answer as "brief changed". Keep it
      // parked in the draft instead, untouched in the service, so reopening that brief resumes it.
      this.redditImageUploadPendingName.set(fileName);
      this.redditImageUploadPendingBriefId.set(briefId);
      return;
    }
    const upload$ = briefId ? this.campaignService.resumeCreativeAssetUpload('reddit', briefId) : null;
    if (!upload$) {
      this.failRedditImageUpload(`The upload of ${fileName} was interrupted. Choose the image again.`, briefId);
      return;
    }
    this.followRedditImageUpload(upload$, briefId, fileName);
  }

  private clearRedditImageAsset(): void {
    this.redditImageUploadSub?.unsubscribe();
    this.redditImageUploadSub = null;
    // Aborted, not just detached: a replaced or removed upload would otherwise run on, compete
    // with the next one for campaign-service's upload budget, and store an asset nobody uses. A
    // parked upload (another brief's, kept across a foundation switch) is replaced the same way: a
    // new pick replaces the previous upload outright, so it is cancelled, not left running unowned.
    if (this.redditImageUploadStatus() === 'uploading' || this.redditImageUploadPendingName() !== '') {
      this.campaignService.cancelCreativeAssetUpload('reddit');
    }
    this.redditImageUploadPendingName.set('');
    this.redditImageUploadPendingBriefId.set('');
    this.redditImageAssetId.set('');
    this.redditImageAssetName.set('');
    this.redditImageAssetBriefId.set('');
    this.redditImageUploadStatus.set('idle');
    this.redditImageUploadError.set('');
    this.redditImageUploadFailedBriefId.set('');
  }

  private failRedditImageUpload(message: string, briefId = ''): void {
    this.redditImageUploadStatus.set('error');
    this.redditImageUploadError.set(message);
    this.redditImageUploadFailedBriefId.set(briefId);
  }

  /**
   * The Meta variants as sent: the brief's copy, each carrying the one Meta image when there is one.
   * The uploaded asset wins over a pasted URL, and is sent only while the upload capability is an
   * explicit yes and the asset was made for the open brief; the URL only while
   * `metaCreativeAvailable()`. Never both on a variant, which campaign-service refuses.
   */
  private metaVariantsForCreate(): MetaAdVariant[] {
    const image = this.metaImageField();
    return Object.keys(image).length > 0 ? this.metaVariants().map((variant) => ({ ...variant, ...image })) : this.metaVariants();
  }

  private metaImageField(): { imageAssetId: string } | { imageUrl: string } | Record<string, never> {
    if (this.metaAssetUploadAvailable() && this.metaImageAssetForThisBrief()) return { imageAssetId: this.metaImageAssetId() };
    if (this.metaCreativeAvailable() && this.metaImageUrl()) return { imageUrl: this.metaImageUrl() };
    return {};
  }

  /**
   * `initRedditImageAssetBlock`'s sibling, widened to the pasted URL and to a failed upload.
   *
   * Two departures from the Reddit block, both so a Meta image the operator chose is never left
   * out of the request without a word. A failed upload for the open brief blocks whatever the
   * capability says: with the upload control shown, its alert names the failure, but Create would
   * otherwise launch the campaign with the pasted URL or no image instead of the chosen file. And a
   * pasted URL held while `metaCreativeAvailable()` is not an explicit yes (a tab round-trip or a
   * failed capability read clears it, and hides the URL input) blocks the same way a retained
   * upload does, since `metaImageField` would withhold it.
   */
  private initMetaImageAssetBlock(): Signal<CampaignMetaImageAssetBlock | null> {
    return computed(() => {
      if (!this.showMetaSection()) return null;
      const briefId = this.briefPersistence().briefId;
      if (this.metaImageAssetId() !== '' && briefId && this.metaImageAssetBriefId() !== briefId) {
        return {
          kind: 'otherBrief',
          message:
            'The uploaded Meta image was uploaded for a different brief, so it cannot be sent with this one. Remove it, then upload it again or use an image URL.',
        };
      }
      if (this.metaImageUploadStatus() === 'error' && briefId && this.metaImageUploadFailedBriefId() === briefId) {
        return {
          kind: 'uploadFailed',
          message: `The Meta image upload did not complete: ${this.metaImageUploadError()} Remove it, or choose the image again.`,
        };
      }
      if (!this.metaAssetWithheld() && !this.metaImageUrlWithheld()) return null;
      if (this.metaCreativeEnabled() === false || (this.metaAssetWithheld() && this.metaAssetUploadEnabled() === false)) {
        return {
          kind: 'unsupported',
          message: 'Meta ad images are not available on this deployment, so the image cannot be sent. Remove it to create the campaign without it.',
        };
      }
      if (this.createCapabilityRead() === 'pending') {
        return { kind: 'pending', message: 'Checking Meta ad image support…' };
      }
      if (!this.briefPersistence().briefId) {
        return {
          kind: 'unsaved',
          message: "Meta ad image support can't be checked until this brief is saved. Save the brief, or remove the image.",
        };
      }
      return {
        kind: 'failed',
        message: 'Could not confirm that Meta ad images are supported, so the image cannot be sent yet. Retry the check, or remove the image.',
      };
    });
  }

  /** `followRedditImageUpload`'s sibling. */
  private followMetaImageUpload(upload$: Observable<CreativeAssetUploadResult>, briefId: string, fileName: string): void {
    this.metaImageUploadStatus.set('uploading');
    this.metaImageUploadError.set('');
    this.metaImageUploadPendingName.set(fileName);
    this.metaImageUploadPendingBriefId.set(briefId);
    this.metaImageUploadSub = upload$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (asset) => {
        this.campaignService.forgetCreativeAssetUpload('meta', upload$);
        this.metaImageUploadPendingName.set('');
        this.metaImageUploadPendingBriefId.set('');
        if ((this.briefPersistence().briefId ?? '') !== briefId) {
          this.failMetaImageUpload('The brief changed during the upload. Choose the image again.', briefId);
          this.emitDraft();
          return;
        }
        this.metaImageAssetId.set(asset.id);
        this.metaImageAssetName.set(fileName);
        this.metaImageAssetBriefId.set(briefId);
        this.metaImageUploadStatus.set('idle');
        this.creativeLibraryRevision.update((revision) => revision + 1);
        this.emitDraft();
      },
      error: (err: unknown) => {
        this.campaignService.forgetCreativeAssetUpload('meta', upload$);
        this.metaImageUploadPendingName.set('');
        this.metaImageUploadPendingBriefId.set('');
        this.failMetaImageUpload(this.creativeAssetUploadErrorMessage(err), briefId);
        this.emitDraft();
      },
    });
  }

  /** `resumeRedditImageUpload`'s sibling. */
  private resumeMetaImageUpload(fileName: string, uploadBriefId: string): void {
    const currentBriefId = this.briefPersistence().briefId ?? '';
    const briefId = uploadBriefId || currentBriefId;
    if (briefId !== currentBriefId) {
      this.metaImageUploadPendingName.set(fileName);
      this.metaImageUploadPendingBriefId.set(briefId);
      return;
    }
    const upload$ = briefId ? this.campaignService.resumeCreativeAssetUpload('meta', briefId) : null;
    if (!upload$) {
      this.failMetaImageUpload(`The upload of ${fileName} was interrupted. Choose the image again.`, briefId);
      return;
    }
    this.followMetaImageUpload(upload$, briefId, fileName);
  }

  private clearMetaImageAsset(): void {
    this.metaImageUploadSub?.unsubscribe();
    this.metaImageUploadSub = null;
    if (this.metaImageUploadStatus() === 'uploading' || this.metaImageUploadPendingName() !== '') {
      this.campaignService.cancelCreativeAssetUpload('meta');
    }
    this.metaImageUploadPendingName.set('');
    this.metaImageUploadPendingBriefId.set('');
    this.metaImageAssetId.set('');
    this.metaImageAssetName.set('');
    this.metaImageAssetBriefId.set('');
    this.metaImageUploadStatus.set('idle');
    this.metaImageUploadError.set('');
    this.metaImageUploadFailedBriefId.set('');
  }

  private failMetaImageUpload(message: string, briefId = ''): void {
    this.metaImageUploadStatus.set('error');
    this.metaImageUploadError.set(message);
    this.metaImageUploadFailedBriefId.set(briefId);
  }
  /**
   * The LinkedIn variants as sent: the brief's copy, each carrying the uploaded image when one is
   * sent (see `linkedInImageSent`). The asset replaces any `imageUrn` the plan named, since
   * campaign-service refuses a variant carrying both.
   */
  private linkedInVariantsForCreate(): LinkedInCreativeVariant[] {
    if (!this.linkedInImageSent()) return this.linkedInVariants();
    const imageAssetId = this.linkedInImageAssetId();
    return this.linkedInVariants().map((variant) => {
      const sent: LinkedInCreativeVariant = { ...variant, imageAssetId };
      delete sent.imageUrn;
      return sent;
    });
  }

  /** Whether the uploaded LinkedIn image goes out: the upload capability is an explicit yes and the asset was made for the open brief. */
  private linkedInImageSent(): boolean {
    return this.linkedInAssetUploadAvailable() && this.linkedInImageAssetForThisBrief();
  }

  /** `initMetaImageAssetBlock`'s sibling, for the upload alone. */
  private initLinkedInImageAssetBlock(): Signal<CampaignLinkedInImageAssetBlock | null> {
    return computed(() => {
      if (!this.showLinkedInSection()) return null;
      const briefId = this.briefPersistence().briefId;
      if (this.linkedInImageAssetId() !== '' && briefId && this.linkedInImageAssetBriefId() !== briefId) {
        return {
          kind: 'otherBrief',
          message: 'The uploaded LinkedIn image was uploaded for a different brief, so it cannot be sent with this one. Remove it, then upload it again.',
        };
      }
      if (this.linkedInImageUploadStatus() === 'error' && briefId && this.linkedInImageUploadFailedBriefId() === briefId) {
        return {
          kind: 'uploadFailed',
          message: `The LinkedIn image upload did not complete: ${this.linkedInImageUploadError()} Remove it, or choose the image again.`,
        };
      }
      if (!this.linkedInAssetWithheld()) return null;
      if (this.linkedInAssetUploadEnabled() === false) {
        return {
          kind: 'unsupported',
          message: 'LinkedIn ad images are not available on this deployment, so the image cannot be sent. Remove it to create the campaign without it.',
        };
      }
      if (this.createCapabilityRead() === 'pending') {
        return { kind: 'pending', message: 'Checking LinkedIn ad image support…' };
      }
      if (!this.briefPersistence().briefId) {
        return {
          kind: 'unsaved',
          message: "LinkedIn ad image support can't be checked until this brief is saved. Save the brief, or remove the image.",
        };
      }
      return {
        kind: 'failed',
        message: 'Could not confirm that LinkedIn ad images are supported, so the image cannot be sent yet. Retry the check, or remove the image.',
      };
    });
  }

  /** `followMetaImageUpload`'s sibling. */
  private followLinkedInImageUpload(upload$: Observable<CreativeAssetUploadResult>, briefId: string, fileName: string): void {
    this.linkedInImageUploadStatus.set('uploading');
    this.linkedInImageUploadError.set('');
    this.linkedInImageUploadPendingName.set(fileName);
    this.linkedInImageUploadPendingBriefId.set(briefId);
    this.linkedInImageUploadSub = upload$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (asset) => {
        this.campaignService.forgetCreativeAssetUpload('linkedin', upload$);
        this.linkedInImageUploadPendingName.set('');
        this.linkedInImageUploadPendingBriefId.set('');
        if ((this.briefPersistence().briefId ?? '') !== briefId) {
          this.failLinkedInImageUpload('The brief changed during the upload. Choose the image again.', briefId);
          this.emitDraft();
          return;
        }
        this.linkedInImageAssetId.set(asset.id);
        this.linkedInImageAssetName.set(fileName);
        this.linkedInImageAssetBriefId.set(briefId);
        this.linkedInImageUploadStatus.set('idle');
        this.creativeLibraryRevision.update((revision) => revision + 1);
        this.emitDraft();
      },
      error: (err: unknown) => {
        this.campaignService.forgetCreativeAssetUpload('linkedin', upload$);
        this.linkedInImageUploadPendingName.set('');
        this.linkedInImageUploadPendingBriefId.set('');
        this.failLinkedInImageUpload(this.creativeAssetUploadErrorMessage(err, false), briefId);
        this.emitDraft();
      },
    });
  }

  /** `resumeMetaImageUpload`'s sibling. */
  private resumeLinkedInImageUpload(fileName: string, uploadBriefId: string): void {
    const currentBriefId = this.briefPersistence().briefId ?? '';
    const briefId = uploadBriefId || currentBriefId;
    if (briefId !== currentBriefId) {
      this.linkedInImageUploadPendingName.set(fileName);
      this.linkedInImageUploadPendingBriefId.set(briefId);
      return;
    }
    const upload$ = briefId ? this.campaignService.resumeCreativeAssetUpload('linkedin', briefId) : null;
    if (!upload$) {
      this.failLinkedInImageUpload(`The upload of ${fileName} was interrupted. Choose the image again.`, briefId);
      return;
    }
    this.followLinkedInImageUpload(upload$, briefId, fileName);
  }

  private clearLinkedInImageAsset(): void {
    this.linkedInImageUploadSub?.unsubscribe();
    this.linkedInImageUploadSub = null;
    if (this.linkedInImageUploadStatus() === 'uploading' || this.linkedInImageUploadPendingName() !== '') {
      this.campaignService.cancelCreativeAssetUpload('linkedin');
    }
    this.linkedInImageUploadPendingName.set('');
    this.linkedInImageUploadPendingBriefId.set('');
    this.linkedInImageAssetId.set('');
    this.linkedInImageAssetName.set('');
    this.linkedInImageAssetBriefId.set('');
    this.linkedInImageUploadStatus.set('idle');
    this.linkedInImageUploadError.set('');
    this.linkedInImageUploadFailedBriefId.set('');
  }

  /**
   * The `twitterConfig` as sent: exactly the wire `TwitterCampaignCreateRequest` describes, read
   * from the same computeds the section renders and `canSubmit` gates on. The shared flight dates
   * travel as they do for Meta.
   */
  private twitterConfigForCreate(startDate: string, endDate: string): TwitterCampaignCreateRequest {
    return {
      budgetAmount: this.twitterBudgetAmount() ?? 0,
      startDate,
      endDate,
      tweetText: this.twitterTweetText().trim(),
      ...(this.twitterImageSent() ? { imageAssetId: this.twitterImageAssetId() } : {}),
      ...this.biddingField('twitter-ads'),
    };
  }

  /** Whether the uploaded X image goes out: X creation is an explicit yes and the asset was made for the open brief. */
  private twitterImageSent(): boolean {
    return this.twitterCreateAvailable() && this.twitterImageAssetForThisBrief();
  }

  /** The X account read behind `twitterAccountState`, keyed on the foundation, the offer and the Retry count. */
  private initTwitterAccountState(): Signal<CampaignTwitterAccountState> {
    const idle: CampaignTwitterAccountState = { status: 'idle', result: null };
    const key = computed(() => ({
      slug: this.activeFoundationSlug(),
      offered: this.showTwitterSection() && this.twitterCreateAvailable(),
      attempt: this.twitterAccountAttempt(),
    }));
    return toSignal(
      toObservable(key).pipe(
        switchMap(({ slug, offered }) => {
          if (!offered || slug === '') return of(idle);
          return this.campaignService.getTwitterAdsAccounts(slug).pipe(
            // A connection campaign-service could not read comes back inside a 200 as
            // `unavailable`; it is a failed read, so it gets the error state and its Retry.
            map(
              (result): CampaignTwitterAccountState =>
                result.connection?.state === 'unavailable' ? { status: 'error', result: null } : { status: 'loaded', result }
            ),
            catchError((err: unknown) =>
              of<CampaignTwitterAccountState>({ status: err instanceof HttpErrorResponse && err.status === 403 ? 'restricted' : 'error', result: null })
            ),
            startWith<CampaignTwitterAccountState>({ status: 'loading', result: null })
          );
        })
      ),
      { initialValue: idle }
    );
  }

  /**
   * Why the flight cannot be sent to X at `nowMs`, or `null`. campaign-service sends the start date
   * as UTC midnight and refuses one not more than `TWITTER_MIN_START_LEAD_MS` ahead
   * (`twitterStartDateTooSoon`), so near midnight UTC even tomorrow can be too soon. The end must be
   * after the start, as for Meta and Reddit.
   */
  private twitterFlightErrorAt(nowMs: number): string | null {
    const { startDate, endDate } = this.campaignForm.controls;
    if (!startDate.value || !endDate.value) return null;
    if (twitterStartDateTooSoon(startDate.value, nowMs)) {
      return 'X needs the start date more than five minutes ahead of now: it starts the campaign at midnight UTC on that date. Pick a later start date.';
    }
    if (endDate.value <= startDate.value) return 'X needs an end date after the start date.';
    return null;
  }

  /** `initBiddingCapabilityBlock`'s sibling for X as a whole, on the same capability read. */
  private initTwitterCreateBlock(): Signal<CampaignTwitterCreateBlock | null> {
    return computed(() => {
      if (!this.showTwitterSection() || this.twitterCreateAvailable()) return null;
      if (this.twitterCreateEnabled() === false) {
        return {
          kind: 'unsupported',
          message: 'X campaign creation is not available on this deployment, so X cannot be created with this brief. Remove X to create the other platforms.',
        };
      }
      if (this.createCapabilityRead() === 'pending') {
        return { kind: 'pending', message: 'Checking X campaign support…' };
      }
      if (!this.briefPersistence().briefId) {
        return { kind: 'unsaved', message: "X campaign support can't be checked until this brief is saved. Save the brief, or remove X." };
      }
      return {
        kind: 'failed',
        message: 'Could not confirm that X campaign creation is supported, so X cannot be created yet. Retry the check, or remove X.',
      };
    });
  }

  /** `initLinkedInImageAssetBlock`'s sibling, for the tweet image. */
  private initTwitterImageAssetBlock(): Signal<CampaignTwitterImageAssetBlock | null> {
    return computed(() => {
      if (!this.showTwitterSection()) return null;
      const briefId = this.briefPersistence().briefId;
      if (this.twitterImageAssetId() !== '' && briefId && this.twitterImageAssetBriefId() !== briefId) {
        return {
          kind: 'otherBrief',
          message: 'The uploaded X image was uploaded for a different brief, so it cannot be sent with this one. Remove it, then upload it again.',
        };
      }
      if (this.twitterImageUploadStatus() === 'error' && briefId && this.twitterImageUploadFailedBriefId() === briefId) {
        return {
          kind: 'uploadFailed',
          message: `The X image upload did not complete: ${this.twitterImageUploadError()} Remove it, or choose the image again.`,
        };
      }
      if (!this.twitterAssetWithheld()) return null;
      if (this.twitterCreateEnabled() === false) {
        return {
          kind: 'unsupported',
          message: 'X campaign creation is not available on this deployment, so the X image cannot be sent. Remove it.',
        };
      }
      if (this.createCapabilityRead() === 'pending') {
        return { kind: 'pending', message: 'Checking X campaign support…' };
      }
      if (!this.briefPersistence().briefId) {
        return {
          kind: 'unsaved',
          message: "X campaign support can't be checked until this brief is saved. Save the brief, or remove the image.",
        };
      }
      return {
        kind: 'failed',
        message: 'Could not confirm that X campaign creation is supported, so the X image cannot be sent yet. Retry the check, or remove the image.',
      };
    });
  }

  /**
   * Restore the X section from a draft, present-only: the two typed fields, then the tweet image on
   * the LinkedIn upload's terms. Shared by the full-draft restore and the same-event carry.
   */
  private applyTwitterDraft(draft: CampaignTwitterDraft): void {
    if (draft.twitterBudget !== undefined) this.campaignForm.controls.twitterBudget.setValue(draft.twitterBudget);
    if (draft.twitterTweetText !== undefined) this.campaignForm.controls.twitterTweetText.setValue(draft.twitterTweetText);
    if (draft.twitterImageAssetId !== undefined) {
      this.twitterImageAssetId.set(draft.twitterImageAssetId);
      this.twitterImageAssetName.set(draft.twitterImageAssetName ?? '');
      this.twitterImageAssetBriefId.set(draft.twitterImageAssetBriefId ?? '');
    }
    if (draft.twitterImageUploadFailedMessage && draft.twitterImageUploadFailedBriefId) {
      this.failTwitterImageUpload(draft.twitterImageUploadFailedMessage, draft.twitterImageUploadFailedBriefId);
    }
    if (draft.twitterImageUploadPendingName) {
      this.resumeTwitterImageUpload(draft.twitterImageUploadPendingName, draft.twitterImageUploadPendingBriefId ?? '');
    }
  }

  /** `followLinkedInImageUpload`'s sibling. */
  private followTwitterImageUpload(upload$: Observable<CreativeAssetUploadResult>, briefId: string, fileName: string): void {
    this.twitterImageUploadStatus.set('uploading');
    this.twitterImageUploadError.set('');
    this.twitterImageUploadPendingName.set(fileName);
    this.twitterImageUploadPendingBriefId.set(briefId);
    this.twitterImageUploadSub = upload$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (asset) => {
        this.campaignService.forgetCreativeAssetUpload('twitter', upload$);
        this.twitterImageUploadPendingName.set('');
        this.twitterImageUploadPendingBriefId.set('');
        if ((this.briefPersistence().briefId ?? '') !== briefId) {
          this.failTwitterImageUpload('The brief changed during the upload. Choose the image again.', briefId);
          this.emitDraft();
          return;
        }
        this.twitterImageAssetId.set(asset.id);
        this.twitterImageAssetName.set(fileName);
        this.twitterImageAssetBriefId.set(briefId);
        this.twitterImageUploadStatus.set('idle');
        this.creativeLibraryRevision.update((revision) => revision + 1);
        this.emitDraft();
      },
      error: (err: unknown) => {
        this.campaignService.forgetCreativeAssetUpload('twitter', upload$);
        this.twitterImageUploadPendingName.set('');
        this.twitterImageUploadPendingBriefId.set('');
        this.failTwitterImageUpload(this.creativeAssetUploadErrorMessage(err, false), briefId);
        this.emitDraft();
      },
    });
  }

  /** `resumeLinkedInImageUpload`'s sibling. */
  private resumeTwitterImageUpload(fileName: string, uploadBriefId: string): void {
    const currentBriefId = this.briefPersistence().briefId ?? '';
    const briefId = uploadBriefId || currentBriefId;
    if (briefId !== currentBriefId) {
      this.twitterImageUploadPendingName.set(fileName);
      this.twitterImageUploadPendingBriefId.set(briefId);
      return;
    }
    const upload$ = briefId ? this.campaignService.resumeCreativeAssetUpload('twitter', briefId) : null;
    if (!upload$) {
      this.failTwitterImageUpload(`The upload of ${fileName} was interrupted. Choose the image again.`, briefId);
      return;
    }
    this.followTwitterImageUpload(upload$, briefId, fileName);
  }

  private clearTwitterImageAsset(): void {
    this.twitterImageUploadSub?.unsubscribe();
    this.twitterImageUploadSub = null;
    if (this.twitterImageUploadStatus() === 'uploading' || this.twitterImageUploadPendingName() !== '') {
      this.campaignService.cancelCreativeAssetUpload('twitter');
    }
    this.twitterImageUploadPendingName.set('');
    this.twitterImageUploadPendingBriefId.set('');
    this.twitterImageAssetId.set('');
    this.twitterImageAssetName.set('');
    this.twitterImageAssetBriefId.set('');
    this.twitterImageUploadStatus.set('idle');
    this.twitterImageUploadError.set('');
    this.twitterImageUploadFailedBriefId.set('');
  }

  private failTwitterImageUpload(message: string, briefId = ''): void {
    this.twitterImageUploadStatus.set('error');
    this.twitterImageUploadError.set(message);
    this.twitterImageUploadFailedBriefId.set(briefId);
  }

  private failLinkedInImageUpload(message: string, briefId = ''): void {
    this.linkedInImageUploadStatus.set('error');
    this.linkedInImageUploadError.set(message);
    this.linkedInImageUploadFailedBriefId.set(briefId);
  }
  /** `initMetaImageAssetBlock`'s sibling, for the upload alone. */
  private initMicrosoftImageAssetBlock(): Signal<CampaignMicrosoftImageAssetBlock | null> {
    return computed(() => {
      if (!this.showMicrosoftSection()) return null;
      const briefId = this.briefPersistence().briefId;
      if (this.microsoftImageAssetId() !== '' && briefId && this.microsoftImageAssetBriefId() !== briefId) {
        return {
          kind: 'otherBrief',
          message: 'The uploaded Microsoft image was uploaded for a different brief, so it cannot be sent with this one. Remove it, then upload it again.',
        };
      }
      if (this.microsoftImageUploadStatus() === 'error' && briefId && this.microsoftImageUploadFailedBriefId() === briefId) {
        return {
          kind: 'uploadFailed',
          message: `The Microsoft image upload did not complete: ${this.microsoftImageUploadError()} Remove it, or choose the image again.`,
        };
      }
      if (!this.microsoftAssetWithheld()) return null;
      if (this.microsoftAssetUploadEnabled() === false) {
        return {
          kind: 'unsupported',
          message: 'Microsoft ad images are not available on this deployment, so the image cannot be sent. Remove it to create the campaign without it.',
        };
      }
      if (this.createCapabilityRead() === 'pending') {
        return { kind: 'pending', message: 'Checking Microsoft ad image support…' };
      }
      if (!this.briefPersistence().briefId) {
        return {
          kind: 'unsaved',
          message: "Microsoft ad image support can't be checked until this brief is saved. Save the brief, or remove the image.",
        };
      }
      return {
        kind: 'failed',
        message: 'Could not confirm that Microsoft ad images are supported, so the image cannot be sent yet. Retry the check, or remove the image.',
      };
    });
  }

  /** `followMetaImageUpload`'s sibling. */
  private followMicrosoftImageUpload(upload$: Observable<CreativeAssetUploadResult>, briefId: string, fileName: string): void {
    this.microsoftImageUploadStatus.set('uploading');
    this.microsoftImageUploadError.set('');
    this.microsoftImageUploadPendingName.set(fileName);
    this.microsoftImageUploadPendingBriefId.set(briefId);
    this.microsoftImageUploadSub = upload$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (asset) => {
        this.campaignService.forgetCreativeAssetUpload('microsoft', upload$);
        this.microsoftImageUploadPendingName.set('');
        this.microsoftImageUploadPendingBriefId.set('');
        if ((this.briefPersistence().briefId ?? '') !== briefId) {
          this.failMicrosoftImageUpload('The brief changed during the upload. Choose the image again.', briefId);
          this.emitDraft();
          return;
        }
        this.microsoftImageAssetId.set(asset.id);
        this.microsoftImageAssetName.set(fileName);
        this.microsoftImageAssetBriefId.set(briefId);
        this.microsoftImageUploadStatus.set('idle');
        this.creativeLibraryRevision.update((revision) => revision + 1);
        this.emitDraft();
      },
      error: (err: unknown) => {
        this.campaignService.forgetCreativeAssetUpload('microsoft', upload$);
        this.microsoftImageUploadPendingName.set('');
        this.microsoftImageUploadPendingBriefId.set('');
        this.failMicrosoftImageUpload(this.creativeAssetUploadErrorMessage(err, false), briefId);
        this.emitDraft();
      },
    });
  }

  /** `resumeMetaImageUpload`'s sibling. */
  private resumeMicrosoftImageUpload(fileName: string, uploadBriefId: string): void {
    const currentBriefId = this.briefPersistence().briefId ?? '';
    const briefId = uploadBriefId || currentBriefId;
    if (briefId !== currentBriefId) {
      this.microsoftImageUploadPendingName.set(fileName);
      this.microsoftImageUploadPendingBriefId.set(briefId);
      return;
    }
    const upload$ = briefId ? this.campaignService.resumeCreativeAssetUpload('microsoft', briefId) : null;
    if (!upload$) {
      this.failMicrosoftImageUpload(`The upload of ${fileName} was interrupted. Choose the image again.`, briefId);
      return;
    }
    this.followMicrosoftImageUpload(upload$, briefId, fileName);
  }

  private clearMicrosoftImageAsset(): void {
    this.microsoftImageChecking.set(false);
    this.microsoftImageUploadSub?.unsubscribe();
    this.microsoftImageUploadSub = null;
    if (this.microsoftImageUploadStatus() === 'uploading' || this.microsoftImageUploadPendingName() !== '') {
      this.campaignService.cancelCreativeAssetUpload('microsoft');
    }
    this.microsoftImageUploadPendingName.set('');
    this.microsoftImageUploadPendingBriefId.set('');
    this.microsoftImageAssetId.set('');
    this.microsoftImageAssetName.set('');
    this.microsoftImageAssetBriefId.set('');
    this.microsoftImageUploadStatus.set('idle');
    this.microsoftImageUploadError.set('');
    this.microsoftImageUploadFailedBriefId.set('');
  }

  private failMicrosoftImageUpload(message: string, briefId = ''): void {
    this.microsoftImageUploadStatus.set('error');
    this.microsoftImageUploadError.set(message);
    this.microsoftImageUploadFailedBriefId.set(briefId);
  }
  /** The image's pixel size, or `null` when this browser cannot read it. Only ever called from a file pick, so never on the server. */
  private async readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
    if (typeof createImageBitmap !== 'function') return null;
    try {
      // `imageOrientation: 'none'`: the ENCODED frame's size, which is what campaign-service's header
      // check reads. The default applies a JPEG's EXIF rotation and would swap width and height.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'none' });
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      return null;
    }
  }

  /** `followMetaImageUpload`'s sibling, holding the stored image in `slotKey` once it lands. */
  private followGoogleImageUpload(upload$: Observable<CreativeAssetUploadResult>, briefId: string, fileName: string, slotKey: string): void {
    this.googleImageUploadStatus.set('uploading');
    this.googleImageUploadError.set('');
    this.googleImageUploadSlot.set(slotKey);
    this.googleImageUploadPendingName.set(fileName);
    this.googleImageUploadPendingBriefId.set(briefId);
    this.googleImageUploadSub = upload$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (asset) => {
        this.campaignService.forgetCreativeAssetUpload('google', upload$);
        this.googleImageUploadPendingName.set('');
        this.googleImageUploadPendingBriefId.set('');
        if ((this.briefPersistence().briefId ?? '') !== briefId) {
          this.failGoogleImageUpload('The brief changed during the upload. Choose the image again.', briefId, slotKey);
          this.emitDraft();
          return;
        }
        this.holdGoogleImage(slotKey, { id: asset.id, name: fileName, briefId });
        this.googleImageUploadStatus.set('idle');
        this.googleImageUploadSlot.set('');
        this.creativeLibraryRevision.update((revision) => revision + 1);
        this.emitDraft();
      },
      error: (err: unknown) => {
        this.campaignService.forgetCreativeAssetUpload('google', upload$);
        this.googleImageUploadPendingName.set('');
        this.googleImageUploadPendingBriefId.set('');
        this.failGoogleImageUpload(this.creativeAssetUploadErrorMessage(err), briefId, slotKey);
        this.emitDraft();
      },
    });
  }

  /** `resumeMetaImageUpload`'s sibling. */
  private resumeGoogleImageUpload(fileName: string, uploadBriefId: string, slotKey: string): void {
    const currentBriefId = this.briefPersistence().briefId ?? '';
    const briefId = uploadBriefId || currentBriefId;
    if (briefId !== currentBriefId) {
      this.googleImageUploadPendingName.set(fileName);
      this.googleImageUploadPendingBriefId.set(briefId);
      this.googleImageUploadSlot.set(slotKey);
      return;
    }
    const upload$ = briefId ? this.campaignService.resumeCreativeAssetUpload('google', briefId) : null;
    if (!upload$) {
      this.failGoogleImageUpload(`The upload of ${fileName} was interrupted. Choose the image again.`, briefId, slotKey);
      return;
    }
    this.followGoogleImageUpload(upload$, briefId, fileName, slotKey);
  }

  /** Whether the running Google upload is for a slot in a channel the request would carry. */
  private googleImageUploadInReach(): boolean {
    const groupName = this.googleImageUploadSlot().split('.')[0];
    return this.googleCreativeChannelsInReach().some((channel) => GOOGLE_CREATIVE_REQUEST_KEYS[channel] === groupName);
  }

  /** Forget the Google upload — running, parked or failed. Held images are untouched. */
  private clearGoogleImageUpload(): void {
    this.googleImageUploadSub?.unsubscribe();
    this.googleImageUploadSub = null;
    if (this.googleImageUploadStatus() === 'uploading' || this.googleImageUploadPendingName() !== '') {
      this.campaignService.cancelCreativeAssetUpload('google');
    }
    this.googleImageUploadPendingName.set('');
    this.googleImageUploadPendingBriefId.set('');
    this.googleImageUploadStatus.set('idle');
    this.googleImageUploadError.set('');
    this.googleImageUploadFailedBriefId.set('');
    this.googleImageUploadSlot.set('');
  }

  private failGoogleImageUpload(message: string, briefId: string, slotKey: string): void {
    this.googleImageUploadStatus.set('error');
    this.googleImageUploadError.set(message);
    this.googleImageUploadFailedBriefId.set(briefId);
    this.googleImageUploadSlot.set(slotKey);
  }

  /**
   * Hold an image in a slot, once. An identical upload answers with the asset already stored
   * (campaign-service dedupes on checksum), so the same id can come back for a file already held.
   */
  private holdGoogleImage(slotKey: string, image: GoogleCreativeHeldImage): void {
    this.googleHeldImages.update((held) => {
      const current = held[slotKey] ?? [];
      return current.some((existing) => existing.id === image.id) ? held : { ...held, [slotKey]: [...current, image] };
    });
  }

  /**
   * The `{ imageAssetId }` entries a slot sends after its pasted URLs: its held images stored for
   * the open brief, and only while the library capability is an explicit yes. Anything held but not
   * sent here is `googleImageAssetBlock`'s to name — never dropped without a word.
   */
  private googleImageRefsFor(slotKey: string): GoogleCreativeImageRef[] {
    if (!this.googleAssetUploadAvailable()) return [];
    const briefId = this.briefPersistence().briefId ?? '';
    return (this.googleHeldImages()[slotKey] ?? []).filter((image) => image.briefId === briefId).map((image) => ({ imageAssetId: image.id }));
  }

  /**
   * What is wrong with one held image, or `null`. `missing` and `misfit` are judged only on a
   * library that was READ: a failed or pending read is not evidence that an image was deleted, and
   * campaign-service still refuses a missing or misshapen asset by name before anything is created.
   * An image whose dimensions were never recorded is let through for the same reason.
   */
  private googleHeldImageIssue(
    image: GoogleCreativeHeldImage,
    slotKey: string,
    library: CreativeAssetLibraryState,
    briefId: string
  ): 'otherBrief' | 'missing' | 'misfit' | null {
    if (image.briefId !== briefId) return 'otherBrief';
    if (library.status !== 'ready') return null;
    const asset = library.assets.find((stored) => stored.id === image.id);
    if (!asset) return 'missing';
    const shape = this.googleImageShape(slotKey);
    return shape && googleCreativeImageFit(asset, shape) === 'misfit' ? 'misfit' : null;
  }

  /** The catalogued shape of the slot `<request key>.<control>` names, or `null` for no image slot. */
  private googleImageShape(slotKey: string): GoogleCreativeImageShape | null {
    const [groupName, control] = slotKey.split('.');
    const channel = GOOGLE_CHANNELS_WITH_CREATIVE.find((candidate) => GOOGLE_CREATIVE_REQUEST_KEYS[candidate] === groupName);
    if (!channel) return null;
    const fields: readonly GoogleCreativeFieldSpec[] = GOOGLE_CREATIVE_FIELD_SPECS[channel];
    return fields.find((field) => field.control === control)?.image ?? null;
  }

  /** The line under a held image saying why it cannot be sent, or `''`. */
  private googleHeldImageProblem(
    image: GoogleCreativeHeldImage,
    slotKey: string,
    library: CreativeAssetLibraryState,
    briefId: string,
    asset: StoredCreativeAsset | undefined
  ): string {
    switch (this.googleHeldImageIssue(image, slotKey, library, briefId)) {
      case 'otherBrief':
        return 'Stored for a different brief.';
      case 'missing':
        return "No longer in the brief's library.";
      case 'misfit': {
        const shape = this.googleImageShape(slotKey);
        if (!asset || !shape) return '';
        const what =
          asset.width && asset.height
            ? `${asset.width}x${asset.height}, ${Math.ceil(asset.byteSize / 1024)} KB,`
            : `At ${Math.ceil(asset.byteSize / 1024)} KB it`;
        return `${what} does not fit. This slot needs ${googleCreativeImageRequirement(shape)}.`;
      }
      default:
        return '';
    }
  }

  /** Why a slot's picker offers nothing, or `''` when it offers something. */
  private googleImageOptionsNote(library: CreativeAssetLibraryState, optionCount: number, canAdd: boolean): string {
    if (!canAdd) return 'This slot is full.';
    if (optionCount > 0) return '';
    switch (library.status) {
      case 'loading':
        return "Loading the brief's images…";
      case 'error':
        return "Couldn't load the brief's images. You can still upload one.";
      case 'ready':
        return library.assets.length === 0 ? 'No images are stored for this brief yet.' : 'No stored image fits this slot yet.';
      default:
        return '';
    }
  }

  /** A held image's label: the file it was uploaded from, else the library's description of it. */
  private googleHeldImageLabel(image: GoogleCreativeHeldImage, asset: StoredCreativeAsset | undefined): string {
    if (image.name) return image.name;
    return asset ? storedCreativeAssetLabel(asset) : `Stored image ${image.id.slice(0, 8)}`;
  }

  /**
   * A draft's held images, kept only where they are the shape this writes. The draft is persisted
   * JSON, so an entry can be anything; one with no id would be sent as an empty ref upstream refuses.
   */
  private restoreGoogleHeldImages(saved: unknown): Record<string, GoogleCreativeHeldImage[]> {
    if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) return {};
    const out: Record<string, GoogleCreativeHeldImage[]> = {};
    for (const [slotKey, images] of Object.entries(saved as Record<string, unknown>)) {
      if (!Array.isArray(images)) continue;
      out[slotKey] = images
        .filter((image): image is GoogleCreativeHeldImage => !!image && typeof image === 'object' && typeof image.id === 'string' && image.id !== '')
        .map((image) => ({
          id: image.id,
          name: typeof image.name === 'string' ? image.name : '',
          briefId: typeof image.briefId === 'string' ? image.briefId : '',
        }));
    }
    return out;
  }

  /**
   * A readable reason for a refused upload. Size and type use the shared copy the pre-upload check
   * shows; an unreachable or overloaded service (0, 503 — campaign-service sheds concurrent uploads
   * with a 503) says to retry; any other refusal shows what the server wrote, since campaign-service
   * names the problem with the image (not decodable, too many pixels, …). `offersImageUrl` is false
   * for a control with no pasted-URL alternative (LinkedIn, Microsoft), whose fallback says to remove
   * the image.
   */
  private creativeAssetUploadErrorMessage(err: unknown, offersImageUrl = true): string {
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    const alternative = offersImageUrl ? 'paste an image URL instead' : 'remove the image to continue without it';
    if (status === 413) return CREATIVE_ASSET_TOO_LARGE_MESSAGE;
    if (status === 415) return CREATIVE_ASSET_WRONG_TYPE_MESSAGE;
    if (status === 0 || status === 503) return `The image service is unavailable right now. Try again in a moment, or ${alternative}.`;
    return serverAuthoredMessage(err, `The image could not be uploaded. Try again, or ${alternative}.`);
  }

  private loadLinkedInAccounts(): void {
    // Stamp the slug this request was made for — a foundation switch fires a new request before
    // the previous one resolves, and `takeUntilDestroyed` alone doesn't cancel it (the component
    // survives the switch, per `activeFoundationSlug`). Without this, a slower response for the
    // OLD foundation can arrive after a faster one for the new foundation and silently overwrite
    // it with the wrong account catalog.
    const requestedSlug = this.activeFoundationSlug();
    // Drop the previous foundation's catalog before firing the new request — otherwise
    // `canSubmit`'s membership check keeps passing against the OLD foundation's accounts for the
    // whole in-flight window, and a Create during that window would dispatch the NEW foundation's
    // project with the OLD foundation's LinkedIn account id. Sibling tabs clear selection/data at
    // the start of their own `loadForActiveFoundation` for the same reason (see
    // `monitoring-tab.component.ts`).
    this.linkedInAccounts.set([]);
    this.linkedInAccountsLoading.set(true);
    this.campaignService
      .getLinkedInAccounts(requestedSlug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          if (requestedSlug !== this.activeFoundationSlug()) {
            return;
          }
          this.linkedInAccounts.set(accounts);
          // Keep the restored selection only if this catalog still CONTAINS it; otherwise fall
          // back to the first account.
          //
          // A blank-only check was enough until this commit and is not any more. Persisting the id
          // (LFXV2-3230) makes a STALE one reachable for the first time: the list is refetched on
          // every mount and an account can be revoked or lose permission between them. A stale id
          // then splits the page in two — `selectedLinkedInAccount` resolves the label and
          // org/status line through `accounts.find(...) ?? accounts[0]`, and the `<select>` cannot
          // render an unmatched value either, so both show the FIRST account, while `submit()`
          // sends `linkedInAccountId()` verbatim. The operator reads one account and spends money
          // on another, with nothing on screen to say so.
          //
          // That fallback pre-dates this change but was unreachable while the id was not carried
          // on the draft, which is why closing it belongs here rather than in a follow-up.
          //
          // Correcting silently rather than prompting: the operator never chose this state, the
          // first account is what every other surface is already showing, and the alternative is a
          // modal on a path that is noisy enough. Membership also subsumes the first-visit case —
          // '' is never in the list.
          //
          // Writes through the form rather than a signal, since that is where the value now lives.
          // `emitEvent` is left ON deliberately — this assignment CHANGES what `submit()` would
          // send, so the parent's draft has to learn about it; suppressing the event would leave
          // the draft carrying a value the form and the request no longer agree with.
          // An EMPTY catalog is a real answer, not a skip. `loadLinkedInConfig` falls back to
          // `accounts: []` when the LinkedIn config is absent or malformed, so a successful
          // response can carry nothing — and a restored id would then survive with no account to
          // match it, dispatching a stale value while the selector shows an empty list. Clearing
          // is the honest result, and `canSubmit`'s membership gate then BLOCKS the create rather
          // than letting it reach LinkedIn: an empty catalog contains no id, including ''. The
          // operator sees Create disabled with an empty account list, which is the true state.
          if (!accounts.some((a) => a.accountId === this.linkedInAccountId())) {
            this.campaignForm.controls.linkedInAccountId.setValue(accounts[0]?.accountId ?? '');
          }
          this.linkedInAccountsLoading.set(false);
        },
        error: () => {
          if (requestedSlug !== this.activeFoundationSlug()) {
            return;
          }
          this.linkedInAccountsLoading.set(false);
        },
      });
  }

  private applyDraft(): void {
    const draft = this.draft();
    const currentSlug = this.campaignForm.controls.eventSlug.value ?? '';
    if (!draft) {
      // No full draft — a fresh proceed — but possibly the X fields of a same-event refine.
      const carried = this.twitterDraft();
      if (carried && carried.eventSlug === currentSlug) this.applyTwitterDraft(carried);
      return;
    }

    if (draft.eventSlug !== currentSlug) return;

    // EMITS, unlike the first version of this method, and the difference is visible to the user.
    //
    // Two displays are derived from `valueChanges` through `toSignal` — the budget-split label
    // (`displayBudgetPct`) and the campaign-name preview (`campaignName`). Patching with
    // `emitEvent: false` restored the CONTROLS but never recomputed those, so the slider thumb
    // moved to the draft value while the label beside it still read the brief's number. The
    // restore looked applied and half of it was not.
    //
    // Suppressing emission was never what prevented the draft being written back over itself —
    // `seeding` is, and it is already true for the whole of this call (see the effect that wraps
    // it, where the `valueChanges` subscription returns early while it is set). Letting the patch
    // emit therefore reaches the derived signals without reopening that loop.
    this.campaignForm.patchValue({
      eventName: draft.eventName,
      countryCode: draft.countryCode,
      registrationUrl: draft.registrationUrl,
      budgetUsd: draft.budgetUsd,
      searchBudgetPct: draft.searchBudgetPct,
      startDate: draft.startDate,
      endDate: draft.endDate,
      includeSearch: draft.includeSearch,
      // Cleared only on an EXPLICIT `false`, never on `null`. A draft saved when Demand Gen was
      // available would otherwise restore a hidden `true` and submit it into the create route's
      // refusal — hiding the control does not stop that, because this path writes the value
      // without it. But `null` means the capability answer has not arrived, and clearing on that
      // rewrites the user's saved selection to `false` permanently: the emit below carries it
      // back to the parent, so a later `true` reveals an unchecked box with the choice already
      // destroyed. Withholding the control while unknown is reversible; this is not.
      includeDemandGen: this.demandGenEnabled() === false ? false : draft.includeDemandGen,
      // The three newer channels, restored by the SAME rule, keyed on their OWN capability.
      // `googleChannelsEnabled` is a separate answer from `demandGenEnabled` and is derived by the
      // opposite rule upstream, so neither may stand in for the other here; `null` leaves the
      // saved selection alone for the reason spelled out above.
      includePerformanceMax: this.googleChannelsEnabled() === false ? false : draft.includePerformanceMax,
      includeVideo: this.googleChannelsEnabled() === false ? false : draft.includeVideo,
      includeDisplay: this.googleChannelsEnabled() === false ? false : draft.includeDisplay,
      // The three LinkedIn controls (LFXV2-3230), restored in the SAME patch as everything else —
      // which is the entire benefit of having moved them onto the form: no extra signal writes and
      // no second emission. This runs AFTER `populateFromBrief`, so it deliberately overwrites the
      // recommendation that seeded a moment ago; that ordering is what makes the restore win.
      //
      // Restored UNCONDITIONALLY, with no `|| draft.linkedInGeoTargets.length` guard. An empty
      // geo list means the user removed every chip, and replacing it with the brief's
      // recommendation would be the silent revert this ticket exists to stop; `canSubmit` already
      // blocks a LinkedIn campaign with no geos, so the empty state is visible rather than
      // dangerous.
      linkedInAccountId: draft.linkedInAccountId,
      linkedInGeoTargets: draft.linkedInGeoTargets,
      linkedInTargetingProfile: draft.linkedInTargetingProfile,
    });

    // The copy arrays stay silent: nothing derives a display from them, and rebuilding a FormArray
    // emits per control, so letting these through would fire `campaignName`'s recompute once per
    // headline for no gain. The single patch above is enough to settle every derived signal.
    this.replaceCopyArray(this.headlinesArray, draft.headlines, CAMPAIGN_CHAR_LIMITS.searchHeadline, false);
    this.replaceCopyArray(this.descriptionsArray, draft.descriptions, CAMPAIGN_CHAR_LIMITS.searchDescription, false);

    // Same present-only rule as the Meta block below. Restored BEFORE it only because these are
    // form controls rather than signals and belong with the patch above; the two do not interact.
    if (draft.googleCreatives !== undefined) {
      this.restoreGoogleCreatives(draft.googleCreatives);
    }
    // The stored images held in the Google image slots, on the Meta image's terms.
    if (draft.googleImageAssets !== undefined) {
      this.googleHeldImages.set(this.restoreGoogleHeldImages(draft.googleImageAssets));
    }
    if (draft.googleImageUploadFailedMessage && draft.googleImageUploadFailedBriefId) {
      this.failGoogleImageUpload(draft.googleImageUploadFailedMessage, draft.googleImageUploadFailedBriefId, draft.googleImageUploadFailedSlot ?? '');
    }
    if (draft.googleImageUploadPendingName) {
      this.resumeGoogleImageUpload(draft.googleImageUploadPendingName, draft.googleImageUploadPendingBriefId ?? '', draft.googleImageUploadPendingSlot ?? '');
    }
    // Copied rather than referenced, so the restored form does not share an array with the draft
    // the parent still holds — the same rule `metaGeoTargets` follows below.
    if (draft.googleGeoTargets !== undefined) {
      this.googleGeoTargets.set([...draft.googleGeoTargets]);
    }
    // Copied on the same rule, and restored whatever the capability is: the section and the request
    // both gate on `googlePostalGeoAvailable`, so a list restored on the legacy road is held, not sent.
    if (draft.googlePostalGeoTargets !== undefined) {
      this.googlePostalGeoTargets.set([...draft.googlePostalGeoTargets]);
    }
    // Copied, and only string labels kept: the draft is in-memory, but a label is display text and a
    // non-string one would render as "[object Object]". Absent leaves the labels alone, as every field does.
    if (draft.googlePostalGeoLabels !== undefined) {
      this.googlePostalGeoLabels.set(Object.fromEntries(Object.entries(draft.googlePostalGeoLabels).filter(([, label]) => typeof label === 'string')));
    }
    // Each entry copied as well as the array, for the reason the sitelinks below are: an entry is an
    // object. Restored whatever the channel is — a list saved under Search and reopened on Demand Gen
    // is held by `googleProximityChannel`, not sent, and is still there on a switch back.
    if (draft.googleProximityTargets !== undefined) {
      this.googleProximityTargets.set(draft.googleProximityTargets.map((t) => ({ ...t })));
    }
    // Copied on the same rule, and restored whatever the channel selection is: the chips section
    // and `googleLanguagesPayload` both gate on `googleLanguagesChannel`, so a list restored under
    // a channel that takes no languages is held, not sent, and is still there if the operator
    // switches back.
    if (draft.googleLanguages !== undefined) {
      this.googleLanguages.set([...draft.googleLanguages]);
    }
    // Copied on the same rule, and restored whatever the channel selection is: the section and
    // `googleAudienceSegmentsPayload` both gate on `googleAudienceSegmentsAvailable`, so a list
    // restored under a non-Search channel is held, not sent.
    if (draft.googleAudienceSegments !== undefined) {
      this.googleAudienceSegments.set([...draft.googleAudienceSegments]);
    }
    // Copied on the same rule, and restored WHATEVER channel the draft was saved under: the section
    // and the payload both gate on the dispatched channel, so a list restored under Performance Max
    // is held rather than sent, and is still there if the operator switches back to Search.
    if (draft.googleCallouts !== undefined) {
      this.googleCallouts.set([...draft.googleCallouts]);
    }
    // Each entry copied as well as the array: a sitelink is an object, so a shallow array spread
    // would still hand the draft's own entries to the signal, and a later edit here would reach
    // back into the stored draft.
    if (draft.googleSitelinks !== undefined) {
      this.googleSitelinks.set(draft.googleSitelinks.map((s) => ({ ...s })));
    }
    // `values` copied too, for the reason the entries are: it is an array inside the entry, and a
    // shallow spread of the entry would share it with the stored draft. There is no brief-restore
    // twin for this one — snippets are typed, not generated, so this draft is the only thing that
    // carries them between visits.
    if (draft.googleStructuredSnippets !== undefined) {
      this.googleStructuredSnippets.set(draft.googleStructuredSnippets.map((s) => ({ ...s, values: [...s.values] })));
    }
    // The call, promotion and price lists on the snippets' rule exactly: typed, so this draft is the
    // only thing that carries them between visits, and each entry copied — a price table's rows too.
    if (draft.googleCallExtensions !== undefined) {
      this.googleCallExtensions.set(draft.googleCallExtensions.map((c) => ({ ...c })));
    }
    if (draft.googlePromotions !== undefined) {
      this.googlePromotions.set(draft.googlePromotions.map((p) => ({ ...p })));
    }
    if (draft.googlePrices !== undefined) {
      this.googlePrices.set(this.copyGooglePrices(draft.googlePrices));
    }
    // The bidding controls, each on the same present-only rule. One `if` per field rather than a
    // single patch, because a draft saved before this section shipped carries some of these and
    // not others only as the section grows — and a blanket patch of `undefined` would clear a
    // seeded value rather than leave it.
    this.restoreGoogleBidding(draft);

    // Restored only when PRESENT. A draft persisted before these fields shipped has none of them,
    // and absence there means "this draft predates Meta fields" — the seeded values must stand.
    // Writing `?? 'traffic'` instead would let an old draft silently downgrade a Conversions
    // campaign. A present-but-empty `metaPixelId` is a real cleared value and is restored as one,
    // which is exactly the distinction `undefined` preserves and `''` would destroy.
    if (draft.metaObjective !== undefined) {
      this.metaObjective.set(draft.metaObjective);
    }
    if (draft.metaPlacements !== undefined) {
      this.metaPlacements.set({ ...draft.metaPlacements });
    }
    if (draft.metaPixelId !== undefined) {
      this.metaPixelId.set(draft.metaPixelId);
    }
    this.restoreMetaInstagramDsa(draft);
    if (draft.metaGeoTargets !== undefined) {
      this.metaGeoTargets.set(this.acceptedMetaGeos(draft.metaGeoTargets));
    }
    if (draft.metaBudgetUsd !== undefined) {
      this.metaBudgetUsd.set(draft.metaBudgetUsd);
    }
    if (draft.metaLifetimeBudget !== undefined) {
      this.metaLifetimeBudget.set(draft.metaLifetimeBudget);
    }

    // Same present-only rule, for the same reason: an older draft omits these, and absence there
    // means "keep what the brief seeded".
    //
    // Only the per-platform budgets are restored, matching what `emitDraft` now carries. The
    // brief-derived arrays are gone from both sides deliberately — see the note there. The
    // `!== undefined` test is what makes dropping them safe rather than merely tidy: a draft
    // written by an OLDER build still carries them, and this loop simply no longer looks, so the
    // brief's own seed stands instead of a stale copy being replayed over it.
    if (draft.linkedInBudgetUsd !== undefined) {
      this.linkedInBudgetUsd.set(draft.linkedInBudgetUsd);
    }
    if (draft.linkedInLifetimeBudget !== undefined) {
      this.linkedInLifetimeBudget.set(draft.linkedInLifetimeBudget);
    }
    if (draft.redditBudgetUsd !== undefined) {
      this.redditBudgetUsd.set(draft.redditBudgetUsd);
    }
    // Restored even when the picker no longer offers it: `redditObjectiveIsUnavailable` renders a
    // withheld objective as a disabled option, so the stored value stays visible and stays on the
    // wire rather than being silently replaced by whatever sits at index 0.
    if (draft.redditObjective !== undefined) {
      this.redditObjective.set(draft.redditObjective);
    }
    // Restored on the same terms, and on `!== undefined` rather than truthiness for the reason the
    // Microsoft arrays below are: an empty string is a deliberate clear, not an older draft.
    if (draft.redditPostUrl !== undefined) {
      this.redditPostUrl.set(draft.redditPostUrl);
    }
    if (draft.redditImageUrl !== undefined) {
      this.redditImageUrl.set(draft.redditImageUrl);
    }
    if (draft.redditCallToAction !== undefined) {
      this.redditCallToAction.set(draft.redditCallToAction);
    }
    // An emitting patch, as `metaInstagramDsaForm`'s restore is: `redditConversionPixelDraft` follows
    // the group's `valueChanges`, and the draft subscription honours `seeding`, so it cannot loop.
    if (typeof draft.redditConversionPixelId === 'string') {
      this.redditConversionPixelForm.patchValue({ conversionPixelId: draft.redditConversionPixelId });
    }
    if (draft.redditImageAssetId !== undefined) {
      this.redditImageAssetId.set(draft.redditImageAssetId);
      this.redditImageAssetName.set(draft.redditImageAssetName ?? '');
      this.redditImageAssetBriefId.set(draft.redditImageAssetBriefId ?? '');
    }
    if (draft.redditImageUploadFailedMessage && draft.redditImageUploadFailedBriefId) {
      this.failRedditImageUpload(draft.redditImageUploadFailedMessage, draft.redditImageUploadFailedBriefId);
    }
    if (draft.redditImageUploadPendingName) {
      this.resumeRedditImageUpload(draft.redditImageUploadPendingName, draft.redditImageUploadPendingBriefId ?? '');
    }
    if (draft.redditVideoGoal !== undefined) {
      this.redditVideoGoal.set(draft.redditVideoGoal);
    }
    // The Meta image, on the Reddit image's terms above.
    if (draft.metaImageUrl !== undefined) {
      this.metaImageUrl.set(draft.metaImageUrl);
    }
    if (draft.metaImageAssetId !== undefined) {
      this.metaImageAssetId.set(draft.metaImageAssetId);
      this.metaImageAssetName.set(draft.metaImageAssetName ?? '');
      this.metaImageAssetBriefId.set(draft.metaImageAssetBriefId ?? '');
    }
    if (draft.metaImageUploadFailedMessage && draft.metaImageUploadFailedBriefId) {
      this.failMetaImageUpload(draft.metaImageUploadFailedMessage, draft.metaImageUploadFailedBriefId);
    }
    if (draft.metaImageUploadPendingName) {
      this.resumeMetaImageUpload(draft.metaImageUploadPendingName, draft.metaImageUploadPendingBriefId ?? '');
    }
    // The LinkedIn image, on the Meta upload's terms above.
    if (draft.linkedInImageAssetId !== undefined) {
      this.linkedInImageAssetId.set(draft.linkedInImageAssetId);
      this.linkedInImageAssetName.set(draft.linkedInImageAssetName ?? '');
      this.linkedInImageAssetBriefId.set(draft.linkedInImageAssetBriefId ?? '');
    }
    if (draft.linkedInImageUploadFailedMessage && draft.linkedInImageUploadFailedBriefId) {
      this.failLinkedInImageUpload(draft.linkedInImageUploadFailedMessage, draft.linkedInImageUploadFailedBriefId);
    }
    if (draft.linkedInImageUploadPendingName) {
      this.resumeLinkedInImageUpload(draft.linkedInImageUploadPendingName, draft.linkedInImageUploadPendingBriefId ?? '');
    }
    // The X section, on the same present-only rule.
    this.applyTwitterDraft(draft);
    // The Microsoft image, on the Meta upload's terms above.
    if (draft.microsoftImageAssetId !== undefined) {
      this.microsoftImageAssetId.set(draft.microsoftImageAssetId);
      this.microsoftImageAssetName.set(draft.microsoftImageAssetName ?? '');
      this.microsoftImageAssetBriefId.set(draft.microsoftImageAssetBriefId ?? '');
    }
    if (draft.microsoftImageUploadFailedMessage && draft.microsoftImageUploadFailedBriefId) {
      this.failMicrosoftImageUpload(draft.microsoftImageUploadFailedMessage, draft.microsoftImageUploadFailedBriefId);
    }
    if (draft.microsoftImageUploadPendingName) {
      this.resumeMicrosoftImageUpload(draft.microsoftImageUploadPendingName, draft.microsoftImageUploadPendingBriefId ?? '');
    }

    // Microsoft (LFXV2-3312), on the same present-only rule. The arrays restore on `!== undefined`
    // rather than on truthiness, which is the whole point: an EMPTY list is a deliberate clear the
    // operator made, and `canSubmit` blocks on exactly that. Restoring on truthiness would silently
    // refill it from the brief's seed and hand back a campaign the operator had emptied.
    if (draft.microsoftBudgetUsd !== undefined) {
      this.microsoftBudgetUsd.set(draft.microsoftBudgetUsd);
    }
    if (draft.microsoftGeoTargets !== undefined) {
      this.microsoftGeoTargets.set([...draft.microsoftGeoTargets]);
    }
    if (draft.microsoftKeywords !== undefined) {
      this.microsoftKeywords.set(draft.microsoftKeywords.map((k) => ({ ...k })));
    }
    if (draft.microsoftCpcBid !== undefined) {
      this.microsoftCpcBid.set(draft.microsoftCpcBid);
    }
    if (draft.bidding !== undefined) {
      this.biddingDrafts.set(Object.fromEntries(Object.entries(draft.bidding).map(([platform, choice]) => [platform, { ...choice }])));
    }
  }

  /**
   * Prefill the Performance Max copy from the brief's generated copy (#4784).
   *
   * Performance Max was the one Google channel whose copy a person still had to write, although the
   * brief already holds copy of the right shape: Search headlines fit its headlines (both 30 wide),
   * Demand Gen headlines (40) fit its long headlines (90), Search and Demand Gen descriptions fit its
   * descriptions (90), and Demand Gen's business name is the business name. Images are never
   * generated, so they stay the operator's.
   *
   * Every value is held to its field's own catalogue bounds (`GOOGLE_CREATIVE_FIELD_SPECS`): trimmed,
   * measured with `codePointLength` as the field validators measure it, de-duplicated and capped at
   * the field's `max`, so the seed never puts a value on screen its own validator refuses. One
   * description short enough for Google's short slot is kept in the set whenever the brief has one.
   *
   * A brief with none of this copy leaves the group as `resetGoogleFields` left it, empty.
   */
  private seedPerformanceMaxCreative(brief: CampaignBriefOutput): void {
    const search = this.generatedCopy(brief, ['google_search']);
    // `google_display` is the Demand Gen key the generator writes, and `demand_gen` the older one;
    // `getDisplayCopy` on the Planning tab reads both, at the top level and under `platforms`.
    const demandGen = this.generatedCopy(brief, ['google_display', 'demand_gen']);
    // Typed as the shared spec, as `initGoogleCreativeSections` reads it: not every catalogue entry
    // declares `width` or `max`, and the literal tuple type would refuse the lookup.
    const specs: readonly GoogleCreativeFieldSpec[] = GOOGLE_CREATIVE_FIELD_SPECS['performance-max'];
    const fitting = (control: string, values: unknown): string[] => {
      const spec = specs.find((field) => field.control === control);
      if (spec === undefined || !Array.isArray(values)) return [];
      // A line break inside one generated value would split it into extra entries of a one-per-line
      // field, past the width and count it was checked against, so it is folded into a space.
      const unique = [
        ...new Set(values.filter((value): value is string => typeof value === 'string').map((value) => value.replace(/\s*[\r\n]+\s*/g, ' ').trim())),
      ];
      return unique.filter((value) => value !== '' && (spec.width === undefined || codePointLength(value) <= spec.width));
    };
    const capped = (control: string, values: string[]): string[] => values.slice(0, specs.find((field) => field.control === control)?.max ?? values.length);

    const headlines = capped('headlines', fitting('headlines', search?.['headlines']));
    const longHeadlines = capped('longHeadlines', fitting('longHeadlines', demandGen?.['headlines']));
    const descriptionPool = fitting('descriptions', [...this.asArray(search?.['descriptions']), ...this.asArray(demandGen?.['descriptions'])]);
    const descriptions = capped('descriptions', descriptionPool);
    const isShort = (value: string): boolean => codePointLength(value) <= GOOGLE_PERFORMANCE_MAX_SHORT_DESCRIPTION_WIDTH;
    const short = descriptionPool.find(isShort);
    if (short !== undefined && !descriptions.some(isShort)) {
      descriptions[descriptions.length - 1] = short;
    }
    const businessName = fitting('businessName', [demandGen?.['business_name']])[0] ?? '';

    if (headlines.length === 0 && longHeadlines.length === 0 && descriptions.length === 0 && businessName === '') return;
    const seeded = {
      headlines: headlines.join('\n'),
      longHeadlines: longHeadlines.join('\n'),
      descriptions: descriptions.join('\n'),
      businessName,
    };
    this.performanceMaxSeed.set(seeded);
    this.campaignForm.controls.performanceMaxCreative.patchValue(seeded);
  }

  /**
   * One platform's generated copy from the brief, by the first key present, at the top level or
   * nested under `platforms` — the shapes `getSearchCopy` and `getDisplayCopy` on the Planning tab
   * read. Shared by the Search seed and the Performance Max seed so the two cannot disagree about
   * where a brief keeps its copy.
   */
  private generatedCopy(brief: CampaignBriefOutput, keys: readonly string[]): Record<string, unknown> | undefined {
    const copy = brief.structuredCopy;
    if (!copy) return undefined;
    const nested = copy['platforms'] as Record<string, unknown> | undefined;
    for (const source of [copy, nested]) {
      for (const key of keys) {
        const found = source?.[key];
        if (found !== null && typeof found === 'object') return found as Record<string, unknown>;
      }
    }
    return undefined;
  }

  /** The value as an array when it is one, else empty: generated copy is untyped JSON. */
  private asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  /**
   * Rebuild one copy FormArray from a list, preserving the validators the field carries.
   *
   * Shared by the draft restore and the brief seed so the two cannot drift — an earlier revision
   * of the seed inlined this twice, which is how a validator ends up on one array and not the
   * other.
   */
  private replaceCopyArray(target: FormArray, values: string[], maxLength: number, emitEvent: boolean): void {
    target.clear({ emitEvent: false });
    for (const value of values) {
      // Width bound only, matching the array declaration and the two add handlers. Required-ness
      // is the array's `searchCopyRequired`, which a restore does not have to re-decide.
      target.push(this.fb.control(value, [Validators.maxLength(maxLength)]), { emitEvent: false });
    }
    // Emission is the CALLER's decision, and BOTH answers are load-bearing — an earlier revision
    // of this helper hardcoded suppression for both and made the original bug strictly worse.
    //
    // The brief seed MUST emit. `populateFromBrief`'s `patchValue` above emits while these arrays
    // still hold the form's initial empty control, so the draft the parent snapshots is `[""]`.
    // Without a second emission after the arrays are filled, nothing ever corrects it, and a user
    // who typed NOTHING lost all generated copy on a plain tab round-trip.
    //
    // The draft restore must NOT emit, or applying it re-enters `emitDraft` and writes the draft
    // back over itself mid-apply. Emitted once at the end rather than per control, so a
    // five-headline seed is one update rather than five.
    if (emitEvent) {
      target.updateValueAndValidity();
    }
  }

  /** Snapshot the user-editable fields for the parent to hold across this component's teardown. */
  private emitDraft(): void {
    const form = this.campaignForm.getRawValue();
    this.draftChange.emit({
      eventName: form.eventName,
      countryCode: form.countryCode,
      registrationUrl: form.registrationUrl,
      // No `??` fallbacks: the form is `fb.nonNullable.group`, so `getRawValue()` cannot yield
      // null here — `submit()` reads the same fields unguarded. A dead `budgetUsd ?? 0` would
      // also be an actively WRONG default, since 0 fails the control's own Validators.min(1).
      headlines: form.headlines as string[],
      descriptions: form.descriptions as string[],
      budgetUsd: form.budgetUsd,
      searchBudgetPct: form.searchBudgetPct,
      startDate: form.startDate,
      endDate: form.endDate,
      includeSearch: form.includeSearch,
      includeDemandGen: form.includeDemandGen,
      includePerformanceMax: form.includePerformanceMax,
      includeVideo: form.includeVideo,
      includeDisplay: form.includeDisplay,
      // The three LinkedIn controls (LFXV2-3230). Listed EXPLICITLY, like every field above,
      // because this emit is an object literal rather than a spread of `getRawValue()` — a
      // control added to the form does not reach the draft until it is named here. That is the
      // one step "just put it on the form" does not do for you.
      linkedInAccountId: form.linkedInAccountId,
      linkedInGeoTargets: form.linkedInGeoTargets,
      linkedInTargetingProfile: form.linkedInTargetingProfile,
      eventSlug: form.eventSlug,
      // The three creative groups, raw. Named here for the same reason every field above is: this
      // emit is an object literal, so a nested group reaches the draft only when it is listed.
      // Carried for ALL three channels regardless of which is ticked — the selection is itself a
      // draft field, and a user who tries Display, types a headline, then switches to Performance
      // Max must not lose the Display copy the moment they look away.
      googleCreatives: this.googleCreativeSnapshot(),
      // Copied per slot, so the parent holds a snapshot rather than this component's arrays.
      googleImageAssets: Object.fromEntries(
        Object.entries(this.googleHeldImages()).map(([slotKey, images]) => [slotKey, images.map((image) => ({ ...image }))])
      ),
      googleImageUploadPendingName: this.googleImageUploadPendingName(),
      googleImageUploadPendingBriefId: this.googleImageUploadPendingBriefId(),
      googleImageUploadPendingSlot: this.googleImageUploadPendingName() ? this.googleImageUploadSlot() : '',
      googleImageUploadFailedMessage: this.googleImageUploadFailedBriefId() ? this.googleImageUploadError() : '',
      googleImageUploadFailedBriefId: this.googleImageUploadFailedBriefId(),
      googleImageUploadFailedSlot: this.googleImageUploadFailedBriefId() ? this.googleImageUploadSlot() : '',
      // Spread, not referenced, for the same reason the Meta and Microsoft geo lists below are.
      googleGeoTargets: [...this.googleGeoTargets()],
      googlePostalGeoTargets: [...this.googlePostalGeoTargets()],
      // Copied, as the list is. Pruned by `removeGooglePostalGeoTarget`, so it names held ids only.
      googlePostalGeoLabels: { ...this.googlePostalGeoLabels() },
      // Entries copied too, matching the restore.
      googleProximityTargets: this.googleProximityTargets().map((t) => ({ ...t })),
      googleLanguages: [...this.googleLanguages()],
      googleAudienceSegments: [...this.googleAudienceSegments()],
      googleCallouts: [...this.googleCallouts()],
      // Entries copied too, for the reason the restore above gives in the other direction.
      googleSitelinks: this.googleSitelinks().map((s) => ({ ...s })),
      // `values` copied as its own array, matching the restore.
      googleStructuredSnippets: this.googleStructuredSnippets().map((s) => ({ ...s, values: [...s.values] })),
      googleCallExtensions: this.googleCallExtensions().map((c) => ({ ...c })),
      googlePromotions: this.googlePromotions().map((p) => ({ ...p })),
      googlePrices: this.copyGooglePrices(this.googlePrices()),
      // The bidding plan as TYPED, not as resolved: the raw strategy the operator picked, not the
      // channel default standing in for it, and the raw text of each number. A draft gives back
      // the form that was left, and resolving here would make a reopened draft claim a choice
      // nobody made.
      googleBiddingStrategy: form.googleBiddingStrategy,
      googleTargetCpa: form.googleTargetCpa,
      googleTargetRoas: form.googleTargetRoas,
      googleCpcBid: form.googleCpcBid,
      googleConversionActions: form.googleConversionActions,
      // Signal-backed, so `valueChanges` never carries them — they are snapshotted here and
      // emitted explicitly by each Meta handler. `placements` is spread rather than referenced so
      // the parent holds a value, not a live view of a signal this component is about to destroy.
      metaObjective: this.metaObjective(),
      metaPlacements: { ...this.metaPlacements() },
      metaPixelId: this.metaPixelId(),
      metaGeoTargets: [...this.metaGeoTargets()],
      // As typed, whether or not the capability is on, so a draft survives the answer arriving late.
      metaInstagramUserId: this.metaInstagramDsaDraft().instagramUserId,
      metaDsaBeneficiary: this.metaInstagramDsaDraft().dsaBeneficiary,
      metaDsaPayor: this.metaInstagramDsaDraft().dsaPayor,
      metaBudgetUsd: this.metaBudgetUsd(),
      metaLifetimeBudget: this.metaLifetimeBudget(),
      // Microsoft's four (LFXV2-3312), snapshotted rather than referenced for the same reason as
      // the Meta block: the parent must hold a value, not a live view of a signal this component
      // is about to destroy. The two ARRAYS are carried because they have a real editor here —
      // see the field docs on `CampaignImplementationDraft`.
      microsoftBudgetUsd: this.microsoftBudgetUsd(),
      microsoftGeoTargets: [...this.microsoftGeoTargets()],
      microsoftKeywords: this.microsoftKeywords().map((k) => ({ ...k })),
      microsoftCpcBid: this.microsoftCpcBid(),
      // Snapshotted whatever `biddingAvailable()` says, like the Reddit creative below: a capability
      // decides what is sent, not what the draft remembers. Entries copied so the parent holds values.
      bidding: Object.fromEntries(Object.entries(this.biddingDrafts()).map(([platform, draft]) => [platform, { ...draft }])),
      // The remaining signal-backed values, on the same terms as the Meta block above: snapshotted
      // rather than referenced, and named explicitly rather than spread.
      //
      // Scoped by asking one question per field: can a user change it?
      //
      // These can — each one is bound to a handler in this component's template, so an operator
      // sets a value the brief did not recommend and that value exists nowhere but this
      // component. Losing a budget is the money-shaped half of LFXV2-3315: the campaign silently
      // reverts to the recommended spend, a decision the operator did not make and the form does
      // not show them re-making. The Reddit objective and post fields fail the same way, buying a
      // different campaign or none at all.
      //
      // The brief-derived ARRAYS are deliberately NOT here — `metaVariants`, `linkedInVariants`,
      // `redditVariants` and the four Reddit targeting lists. They have no editor: the full set of
      // event bindings in this component's template contains no handler that writes any of them,
      // and `populateFromBrief` is now their ONLY writer — `applyDraft` no longer has a restore
      // arm for any of the seven, which is exactly what this change removed. Carrying them made
      // the draft round-trip the brief's own recommendation back to itself.
      //
      // Removing them is not a loss, and that was MEASURED rather than reasoned about, because the
      // reasoning goes the wrong way twice:
      //
      //   - `applyDraft` restores on `!== undefined`, and an empty array IS defined. So carrying
      //     these made the restore overwrite the brief's fresh seed with a stale copy. Absent,
      //     `populateFromBrief` re-seeds all seven from the brief the parent still holds.
      //   - The "a brief with no redditCopy re-seeds nothing, so an unrestored value is gone"
      //     argument does not survive being run: with no `redditCopy` the seed leaves the arrays
      //     EMPTY, so the draft carried `[]` and there was never a value to lose.
      //
      // If a real editor is ever added for one of these, it belongs back here — and it needs a
      // test that drives the new binding, not one that writes the signal and calls `emitDraft` by
      // hand. That shape passes against a handler that never emits, which is how the LinkedIn
      // budget pair stayed broken behind three green tests.
      linkedInBudgetUsd: this.linkedInBudgetUsd(),
      linkedInLifetimeBudget: this.linkedInLifetimeBudget(),
      redditBudgetUsd: this.redditBudgetUsd(),
      redditObjective: this.redditObjective(),
      // Snapshotted whatever `redditCreativeAvailable()` says — see the draft interface for why a
      // capability must not decide what the draft remembers.
      redditPostUrl: this.redditPostUrl(),
      redditImageUrl: this.redditImageUrl(),
      redditCallToAction: this.redditCallToAction(),
      redditConversionPixelId: this.redditConversionPixelDraft().conversionPixelId,
      redditImageAssetId: this.redditImageAssetId(),
      redditImageAssetName: this.redditImageAssetName(),
      redditImageAssetBriefId: this.redditImageAssetBriefId(),
      redditImageUploadPendingName: this.redditImageUploadPendingName(),
      redditImageUploadPendingBriefId: this.redditImageUploadPendingBriefId(),
      // A failed upload stays until the operator removes or replaces it, across tab switches too:
      // dropping it on remount would lift the block and let Create go out without the image.
      redditImageUploadFailedMessage: this.redditImageUploadFailedBriefId() ? this.redditImageUploadError() : '',
      redditImageUploadFailedBriefId: this.redditImageUploadFailedBriefId(),
      redditVideoGoal: this.redditVideoGoal(),
      metaImageUrl: this.metaImageUrl(),
      metaImageAssetId: this.metaImageAssetId(),
      metaImageAssetName: this.metaImageAssetName(),
      metaImageAssetBriefId: this.metaImageAssetBriefId(),
      metaImageUploadPendingName: this.metaImageUploadPendingName(),
      metaImageUploadPendingBriefId: this.metaImageUploadPendingBriefId(),
      metaImageUploadFailedMessage: this.metaImageUploadFailedBriefId() ? this.metaImageUploadError() : '',
      metaImageUploadFailedBriefId: this.metaImageUploadFailedBriefId(),
      linkedInImageAssetId: this.linkedInImageAssetId(),
      linkedInImageAssetName: this.linkedInImageAssetName(),
      linkedInImageAssetBriefId: this.linkedInImageAssetBriefId(),
      linkedInImageUploadPendingName: this.linkedInImageUploadPendingName(),
      linkedInImageUploadPendingBriefId: this.linkedInImageUploadPendingBriefId(),
      linkedInImageUploadFailedMessage: this.linkedInImageUploadFailedBriefId() ? this.linkedInImageUploadError() : '',
      linkedInImageUploadFailedBriefId: this.linkedInImageUploadFailedBriefId(),
      twitterBudget: form.twitterBudget,
      twitterTweetText: form.twitterTweetText,
      twitterImageAssetId: this.twitterImageAssetId(),
      twitterImageAssetName: this.twitterImageAssetName(),
      twitterImageAssetBriefId: this.twitterImageAssetBriefId(),
      twitterImageUploadPendingName: this.twitterImageUploadPendingName(),
      twitterImageUploadPendingBriefId: this.twitterImageUploadPendingBriefId(),
      twitterImageUploadFailedMessage: this.twitterImageUploadFailedBriefId() ? this.twitterImageUploadError() : '',
      twitterImageUploadFailedBriefId: this.twitterImageUploadFailedBriefId(),
      microsoftImageAssetId: this.microsoftImageAssetId(),
      microsoftImageAssetName: this.microsoftImageAssetName(),
      microsoftImageAssetBriefId: this.microsoftImageAssetBriefId(),
      microsoftImageUploadPendingName: this.microsoftImageUploadPendingName(),
      microsoftImageUploadPendingBriefId: this.microsoftImageUploadPendingBriefId(),
      microsoftImageUploadFailedMessage: this.microsoftImageUploadFailedBriefId() ? this.microsoftImageUploadError() : '',
      microsoftImageUploadFailedBriefId: this.microsoftImageUploadFailedBriefId(),
    });
  }

  private populateFromBrief(brief: CampaignBriefOutput): void {
    this.step.set('form');
    this.creationProgress.set([]);
    this.results.set([]);
    this.platformResults.set([]);
    this.errors.set([]);
    // Cleared here because nothing else clears it: the group is standalone, and `applyDraft` only
    // patches it when the draft holds a pixel. Without this, a brief switch on a live mount carries
    // the previous brief's pixel into the new brief's draft and create (#3484). Inside `seeding`,
    // so the reset does not emit a draft of its own.
    this.redditConversionPixelForm.reset();
    // The other Reddit values the brief does not derive, cleared for the same reason (#4589): each
    // is restored only from a draft, so with the draft cleared by a brief switch they would carry
    // the previous brief's typed post, image, button, objective, goal and budget into this one.
    // The uploaded image is left alone on purpose: it is scoped to its brief, and
    // `redditImageAssetBlock` already holds Create with a Remove for one made for another brief.
    this.redditPostUrl.set('');
    this.redditImageUrl.set('');
    this.redditCallToAction.set('');
    this.redditObjective.set(DEFAULT_REDDIT_OBJECTIVE);
    this.redditVideoGoal.set('');
    this.redditBudgetUsd.set(DEFAULT_REDDIT_BUDGET_USD);
    // The lists seeded only from Reddit copy, emptied first so a brief without any opens on none
    // rather than the previous brief's (#4648); the seed below refills them when the copy is there.
    this.redditVariants.set([]);
    this.redditSubreddits.set([]);
    this.redditInterests.set([]);
    this.redditKeywords.set([]);
    this.redditGeoTargets.set([]);
    // The other platforms on the same terms (#4624): every value the brief does not derive, or derives
    // only when present, back to its default, so the seed below is all that survives a switch.
    this.resetMetaFields();
    this.resetLinkedInFields();
    this.resetMicrosoftFields();
    this.resetGoogleFields();
    this.resetTwitterFields();
    this.biddingDrafts.set({});
    const details = brief.eventDetails;
    this.campaignForm.patchValue({
      eventName: details.name,
      eventSlug: details.slug,
      countryCode: details.countryCode || 'US',
      registrationUrl: details.registrationUrl,
      budgetUsd: brief.totalBudget ?? 500,
      startDate: this.todayDate,
      endDate: this.defaultEndDate,
      // The X fields are typed, never generated, so a new brief starts them blank. A same-event
      // refine gets them back from `twitterDraft` in `applyDraft`, which runs after this seed.
      twitterBudget: '',
      twitterTweetText: '',
    });

    if (brief.selectedPlatforms?.length) {
      // A brief saved BEFORE a platform was disabled still names it, and the Plan picker cannot
      // clear it — the tile is `[disabled]`, so the user has no way to deselect. Restoring it
      // unfiltered would submit that platform's config on brief-derived values they never saw
      // and cannot edit, which is the exact defect disabling the picker exists to prevent.
      //
      // Set the filtered list UNCONDITIONALLY, including when it is empty. Skipping the set on an
      // empty result would leave the component's own `google-ads` default standing, so a
      // Reddit-only brief would open as a GOOGLE campaign — the user's real choice silently
      // replaced by one they never made, and `submit()` builds its request from this signal.
      // campaign-service.service.ts:1505-1515 rejects exactly that substitution server-side; this
      // is the same rule applied to the platforms it does still recognise.
      //
      // Empty is the honest answer: `canSubmit()` requires at least one selected platform, so the
      // brief opens blocked rather than dispatching something unchosen.
      //
      // X is the one disabled platform KEPT. Its `disabled` is a static default the capability
      // (`twitterCreateEnabled`) overrides, and the capability may answer after this seed runs, so
      // filtering on it here would drop an X the operator chose. Kept, it is either created (an
      // explicit yes) or blocked with a Remove (`twitterCreateBlock`) — never sent unconfirmed.
      const selectable = new Set<CampaignPlatform>([...CAMPAIGN_PLATFORMS.filter((o) => !o.disabled).map((o) => o.id), 'twitter-ads']);
      this.selectedPlatforms.set(brief.selectedPlatforms.filter((p) => selectable.has(p)));
    }

    const searchCopy = this.generatedCopy(brief, ['google_search']);
    if (searchCopy) {
      const headlines = (searchCopy['headlines'] as string[]) ?? [];
      const descriptions = (searchCopy['descriptions'] as string[]) ?? [];

      this.replaceCopyArray(this.campaignForm.controls.headlines as FormArray, headlines, CAMPAIGN_CHAR_LIMITS.searchHeadline, true);
      this.replaceCopyArray(this.campaignForm.controls.descriptions as FormArray, descriptions, CAMPAIGN_CHAR_LIMITS.searchDescription, true);
    } else {
      // Back to the form's one empty box each, so a brief with no Search copy does not open on the last one's.
      this.replaceCopyArray(this.campaignForm.controls.headlines as FormArray, [''], CAMPAIGN_CHAR_LIMITS.searchHeadline, true);
      this.replaceCopyArray(this.campaignForm.controls.descriptions as FormArray, [''], CAMPAIGN_CHAR_LIMITS.searchDescription, true);
    }

    // Seeded on PRESENCE over `resetGoogleFields`' empty lists (#4624). A same-brief re-emit keeps
    // typed entries, since `applyDraft` restores the parent's live draft after this, and the edits a
    // refine carries arrive inside the brief itself (`briefWithCarriedExtensions`).
    //
    // Capped and de-duplicated server-side already; the editors' own add-guards are what hold the
    // line against everything the operator does after this point.
    //
    // Seeded regardless of the selected Google channel, deliberately, exactly as the draft restore
    // below does: `googleCalloutsPayload` and `googleSitelinksPayload` both gate on
    // `googleCalloutsAvailable`, so a list seeded under Performance Max is HELD and not sent, and
    // is still there if the operator switches to Search. `googleCalloutsWithheldWarning` is what
    // tells them that is happening — or `googleExtensionsCapabilityBlock`, when what withheld the
    // list is the unanswered capability rather than the channel.
    if (brief.googleCallouts !== undefined) {
      this.googleCallouts.set([...brief.googleCallouts]);
    }
    // Each entry copied as well as the array, for the reason the draft restore gives: a sitelink is
    // an object, and a shallow spread would leave the brief's own entries reachable from the editor.
    if (brief.googleSitelinks !== undefined) {
      this.googleSitelinks.set(brief.googleSitelinks.map((s) => ({ ...s })));
    }

    // After `resetGoogleFields` emptied the creative groups, like the Search copy above; the draft
    // restore runs after this seed, so an operator's own Performance Max copy still wins (#4784).
    this.seedPerformanceMaxCreative(brief);

    if (brief.linkedInCopy) {
      this.linkedInVariants.set(brief.linkedInCopy.variants);
      // Seeded UNCONDITIONALLY, and the ticket's premise that this needs a "only when the parent
      // holds nothing" guard does not survive contact with the call order (LFXV2-3230).
      //
      // The constructor effect runs `populateFromBrief(brief)` and THEN
      // `untracked(() => this.applyDraft())`. The restore is last, so it overwrites whatever this
      // seeds — a guard here changes nothing for any field `applyDraft` restores. This was
      // mutation-tested rather than reasoned about: with the guard replaced by `if (true)` the
      // whole suite still passed, including the round-trip tests, because the restore had already
      // done the work. Dead code that reads as load-bearing is worse than no code, so it is gone.
      //
      // The guard WOULD be needed if the two ever swapped order, or for a field this seeds but
      // `applyDraft` does not restore. Neither is true today for these two controls.
      //
      // These EMIT, and must. The three controls are read through `toSignal` bridges over
      // `valueChanges`, so a `{ emitEvent: false }` write updates the control while every reader —
      // the template's chip list, `canSubmit`, `availableGeoTargets`, `submit()` — keeps the stale
      // initial value. Suppressing here made the seed invisible: the form held the recommendation
      // and the page rendered an empty geo list.
      //
      // Emitting is safe because `seeding` is true for the whole of this call, so the
      // `valueChanges` subscription returns early rather than snapshotting a half-built form.
      this.campaignForm.controls.linkedInGeoTargets.setValue(brief.linkedInCopy.recommendedGeoTargets);
      this.campaignForm.controls.linkedInTargetingProfile.setValue(brief.linkedInCopy.recommendedTargetingProfile);
      // `budgetRecommendation` is guarded as well as `strategy`. Until LFXV2-3108 every brief
      // reaching here came straight from the generator, which always emits both; a RESTORED
      // brief is replayed from stored JSON, where `asVariantCopy` validates only the `variants`
      // discriminator and leaves the inner shape alone. A `strategy` without a
      // `budgetRecommendation` therefore reaches this line and throws on the nested read —
      // every other field in this block is assigned whole, so this is the only such reach.
      const lifetimeBudget = brief.linkedInCopy.strategy?.budgetRecommendation?.lifetimeBudgetUsd;
      if (typeof lifetimeBudget === 'number' && Number.isFinite(lifetimeBudget)) {
        this.linkedInBudgetUsd.set(lifetimeBudget);
        this.linkedInLifetimeBudget.set(true);
      }
    }

    const redditCopy = brief.structuredCopy?.['reddit_promoted'] as Record<string, unknown> | undefined;
    if (redditCopy) {
      this.redditVariants.set((redditCopy['variants'] as RedditAdVariant[]) ?? []);
      this.redditSubreddits.set((redditCopy['recommended_subreddits'] as string[]) ?? []);
      this.redditInterests.set((redditCopy['recommended_interests'] as string[]) ?? []);
      this.redditKeywords.set((redditCopy['recommended_keywords'] as string[]) ?? []);
      this.redditGeoTargets.set((redditCopy['recommended_geos'] as string[]) ?? []);
    }
    if (brief.redditCopy) {
      this.redditVariants.set(brief.redditCopy.variants);
      this.redditSubreddits.set(brief.redditCopy.recommendedSubreddits);
      this.redditInterests.set(brief.redditCopy.recommendedInterests);
      this.redditKeywords.set(brief.redditCopy.recommendedKeywords);
      this.redditGeoTargets.set(brief.redditCopy.recommendedGeos);
    }

    const metaCopy = brief.structuredCopy?.['meta_ads'] as Record<string, unknown> | undefined;
    if (metaCopy) {
      const rawVariants = metaCopy['variants'];
      const variants = Array.isArray(rawVariants) ? (rawVariants as { primary_text?: string; headline?: string; description?: string }[]) : [];
      this.metaVariants.set(
        variants.map((v) => ({
          primaryText: v.primary_text ?? '',
          headline: v.headline ?? '',
          description: v.description,
        }))
      );
      const rawGeos = metaCopy['recommended_geos'];
      this.metaGeoTargets.set(this.acceptedMetaGeos(Array.isArray(rawGeos) ? (rawGeos as string[]) : []));
    } else if (brief.metaCopy) {
      this.metaVariants.set(brief.metaCopy.variants);
      this.metaGeoTargets.set(this.acceptedMetaGeos(brief.metaCopy.recommendedGeos));
    }

    this.briefKeywords.set(brief.keywords);

    // Microsoft's seed (LFXV2-3312). The brief's own keywords feed it DIRECTLY, with no
    // translation: `CampaignKeyword.matchType` is already the PascalCase vocabulary
    // `microsoftKeywordConfig` takes ('Exact' | 'Phrase' | 'Broad'), unlike Google Ads, which
    // needs the SCREAMING_CASE rename. `term` becomes `text` — that is the only remapping.
    //
    // Seeded rather than left empty because an empty list BLOCKS the submit here (no keywords
    // means a campaign that can never serve), so shipping the section empty would make Microsoft
    // look broken on first render. The operator edits from a working starting point.
    // Filtered to what the BFF will actually ACCEPT, not merely to non-blank terms.
    //
    // `brief.keywords` is compile-time typed but runtime-arbitrary: both brief streams copy the
    // model's raw `match_type` string through (`campaign-proxy.service.ts:855`), so a generated
    // `BROAD_MATCH`, an over-length term or one carrying a control character can reach here. Seeding
    // those left Create ENABLED while `buildMicrosoftConfig` refused the whole config, and the
    // operator saw "unconfigured" with no indication which row was at fault.
    //
    // Dropping them at the seed is the honest fix: the chip list then shows exactly the keywords
    // that will dispatch, and the operator adds any others through the box, which applies the same
    // rules. The required-keywords guard still blocks submit if nothing survives.
    this.microsoftKeywords.set(
      (brief.keywords ?? [])
        .filter(
          (k) =>
            typeof k?.term === 'string' &&
            k.term.trim() !== '' &&
            [...k.term.trim()].length <= MICROSOFT_MAX_KEYWORD_TEXT_LENGTH &&
            !MICROSOFT_CONTROL_CHAR_RE.test(k.term) &&
            isMicrosoftMatchType(k.matchType)
        )
        .slice(0, MICROSOFT_MAX_KEYWORDS)
        // CANONICALISED to the PascalCase vocabulary the `<select>` offers. The filter above accepts
        // case variants because upstream does, but storing a raw `EXACT` here rendered the dropdown
        // with no option selected on a keyword that would have dispatched fine. The `?? 'Phrase'`
        // is unreachable — the filter already rejected anything `canonicalMicrosoftMatchType`
        // returns null for — and exists only to satisfy the type without a cast.
        .map((k) => ({ text: k.term.trim(), matchType: canonicalMicrosoftMatchType(k.matchType) ?? 'Phrase' }))
    );
    // Geo chips are left EMPTY here rather than seeded from the country code.
    //
    // `countryCodeValue` must not be read in this method: it is a `toSignal` over
    // `campaignForm.valueChanges`, and when this seed ran tracked, reading it made the seed's own
    // `patchValue` re-enter the effect continuously — the spec suite hung before running a single test.
    //
    // Nothing is lost by leaving it empty: `microsoftEffectiveGeoTargets` already falls back to
    // the country code, so the request still carries a target, and the template renders that
    // fallback explicitly ("defaults to XX") rather than leaving it invisible.
    this.briefHsToken.set(brief.hsUtm);
    this.briefDriveFolderUrl.set(brief.driveFolderUrl);
  }

  /*
   * The per-platform resets `populateFromBrief` runs inside `seeding` (#4624). A brief switch clears the
   * draft, so `applyDraft` restores nothing and these values would otherwise ride into the next brief.
   * Uploaded images are left alone, as Reddit's is: each is scoped to its brief, and its asset block
   * already holds Create, with a Remove, for one made for another.
   */

  /** Meta: objective, placements, pixel, Instagram/DSA, budget and its mode, image URL; geos and variants until the brief's Meta copy seeds them. */
  private resetMetaFields(): void {
    this.metaObjective.set(DEFAULT_META_OBJECTIVE);
    this.metaPlacements.set({ ...META_DEFAULT_PLACEMENTS });
    this.metaPixelId.set('');
    // Another brief's payor and beneficiary must never reach a live create.
    this.metaInstagramDsaForm.reset();
    this.metaBudgetUsd.set(DEFAULT_META_BUDGET_USD);
    this.metaLifetimeBudget.set(false);
    this.metaImageUrl.set('');
    this.metaGeoTargets.set([]);
    this.metaVariants.set([]);
  }

  /**
   * LinkedIn: budget and mode, geos, profile, variants, and the ad account — back to the catalog's first,
   * what a fresh mount settles on and the selector shows, not `''`, which no catalog contains.
   */
  private resetLinkedInFields(): void {
    this.linkedInBudgetUsd.set(DEFAULT_LINKEDIN_BUDGET_USD);
    this.linkedInLifetimeBudget.set(false);
    this.linkedInVariants.set([]);
    this.campaignForm.patchValue({
      linkedInAccountId: untracked(() => this.linkedInAccounts())[0]?.accountId ?? '',
      linkedInGeoTargets: [],
      linkedInTargetingProfile: DEFAULT_LINKEDIN_TARGETING_PROFILE,
    });
  }

  /** Microsoft: budget, CPC bid and geos. The keywords are not here: the brief re-seeds them every time. */
  private resetMicrosoftFields(): void {
    this.microsoftBudgetUsd.set(DEFAULT_MICROSOFT_BUDGET_USD);
    this.microsoftCpcBid.set('');
    this.microsoftGeoTargets.set([]);
  }

  /**
   * Google: channels and split, creatives, bidding, every targeting and extension list. Not the add
   * sub-forms: they reach neither the draft nor a create until an entry is added.
   */
  private resetGoogleFields(): void {
    this.performanceMaxSeed.set(null);
    this.campaignForm.patchValue({
      searchBudgetPct: CAMPAIGN_BUDGET_DEFAULTS.searchBudgetPct,
      includeSearch: true,
      includeDemandGen: false,
      includePerformanceMax: false,
      includeVideo: false,
      includeDisplay: false,
      googleBiddingStrategy: '',
      googleTargetCpa: '',
      googleTargetRoas: '',
      googleCpcBid: '',
      googleConversionActions: '',
    });
    for (const channel of GOOGLE_CHANNELS_WITH_CREATIVE) {
      this.campaignForm.controls[GOOGLE_CREATIVE_REQUEST_KEYS[channel]].reset();
    }
    this.googleGeoTargets.set([]);
    this.googlePostalGeoTargets.set([]);
    this.googlePostalGeoLabels.set({});
    this.googleProximityTargets.set([]);
    this.googleLanguages.set([]);
    this.googleAudienceSegments.set([]);
    this.googleCallouts.set([]);
    this.googleSitelinks.set([]);
    this.googleStructuredSnippets.set([]);
    this.googleCallExtensions.set([]);
    this.googlePromotions.set([]);
    this.googlePrices.set([]);
  }

  /** X: the budget and tweet text. */
  private resetTwitterFields(): void {
    this.campaignForm.patchValue({ twitterBudget: '', twitterTweetText: '' });
  }

  private pollJob(jobId: string, projectSlug: string): void {
    const MAX_POLL_DURATION_MS = 300_000;
    const MAX_POLLS = Math.ceil(MAX_POLL_DURATION_MS / CAMPAIGN_JOB_POLL_INTERVAL_MS);
    this.jobSubscription = this.campaignService
      .getCreateResult(jobId, projectSlug)
      .pipe(take(MAX_POLLS), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (outcome: CampaignJobOutcome | null) => {
          if (outcome) {
            this.results.set(outcome.campaigns);
            this.platformResults.set(outcome.platformResults ?? []);
            this.errors.set(outcome.errors);
            this.step.set('results');
          }
        },
        error: (error: unknown) => {
          const message =
            error instanceof Error && error.message
              ? error.message
              : 'Lost connection to the campaign creation process. Please try again or check your ad platforms directly.';
          this.errors.set([message]);
          this.step.set('results');
        },
        complete: () => {
          if (this.step() === 'creating') {
            this.errors.set(['Campaign creation is taking longer than expected. Check your ad platforms to see if campaigns were created.']);
            this.step.set('results');
          }
        },
      });
  }

  // === Private Initializers ===
  /**
   * Whether the Performance Max prefill notice is true right now (#4784): some field still holds the
   * copy the brief seeded into it.
   *
   * Derived rather than latched. A restored draft overwrites the seed after it runs, and an operator
   * may clear or rewrite the copy, so a flag set at seed time would go on saying "filled in from the
   * brief" over empty fields or over copy they wrote. A draft saved straight from the seeded state —
   * the ordinary tab round trip — restores the same values, so the notice survives that.
   */
  private initPerformanceMaxPrefillShown(): Signal<boolean> {
    return computed(() => {
      void this.campaignFormRevision();
      const seed = this.performanceMaxSeed();
      if (seed === null) return false;
      const raw = this.campaignForm.controls.performanceMaxCreative.getRawValue() as Record<string, string>;
      return Object.entries(seed).some(([field, value]) => value !== '' && raw[field] === value);
    });
  }

  /**
   * Whether the budget-split slider changes anything the user is about to create.
   *
   * It only ever has, for exactly one pair. On the LEGACY in-process road,
   * `normalizeBudgetSplit` (`campaign-proxy.service.ts`) reads the percentage only when both
   * `search` and `demand-gen` are present — a Search-only selection is forced to 100/0, a Demand
   * Gen-only selection to 0/100, and `performance-max`, `video` and `display` are not consulted at
   * all because that road never builds them. On the CUTOVER road the controller does compute
   * `budget * pct` for a multi-channel selection, but campaign-service refuses every multi-channel
   * Google create outright (one config, one channel), so no selection reaches a platform with a
   * split applied.
   *
   * So the slider is shown for Search + Demand Gen on the LEGACY road only, and withheld otherwise —
   * including that same pair on the cutover road, where it would offer a split nothing applies
   * (#4755). Previously it rendered
   * for every Google selection and labelled its second half "Display" — a channel the split has
   * never funded, next to real Display and Performance Max boxes that it does not fund either.
   * The control is left in the form regardless; hiding it must not drop a restored draft's value.
   */
  private initBudgetSplitApplies(): Signal<boolean> {
    return computed(() => {
      void this.campaignFormRevision();
      if (this.googleCreativeAvailable()) return false;
      const channels = this.selectedGoogleChannels();
      return channels.includes('search') && channels.includes('demand-gen');
    });
  }

  private initDisplayBudgetPct(): Signal<number> {
    return toSignal(
      this.campaignForm.controls.searchBudgetPct.valueChanges.pipe(
        startWith(this.campaignForm.controls.searchBudgetPct.value),
        map((v) => 100 - v)
      ),
      { initialValue: 100 - CAMPAIGN_BUDGET_DEFAULTS.searchBudgetPct }
    );
  }

  private initCampaignName(): Signal<string> {
    // A `computed` over the form stream, not a `map` inside it, because the name depends on the
    // CAPABILITY as well as the form. A signal read inside that `map` is not a reactive
    // dependency — `toSignal` re-emits only when `valueChanges` fires — so gating the preview on
    // `demandGenAvailable()` there froze it at whatever the capability was at mount: a tab that
    // mounts before the capability resolves would preview Search for ever while submit sent
    // `demand-gen`. Reading it in the outer `computed` makes it a real dependency, so the name
    // recomputes when either the form or the capability changes.
    const formValue = toSignal(this.campaignForm.valueChanges.pipe(startWith(this.campaignForm.getRawValue())), {
      initialValue: this.campaignForm.getRawValue(),
    });
    return computed(() => {
      const form = formValue();
      const name = form.eventName;
      const region = form.countryCode || 'NA';
      const startDate = form.startDate || '';
      // The SAME derivation the request builder and `canSubmit` use, rather than a second read of
      // the checkboxes — so the previewed name cannot name a channel the create will not ask for.
      // It is capability-gated inside, which is what this preview needs: the form can carry a
      // hidden `true` for a channel whose control is withheld (a draft restored before the
      // capability answer arrived), and reading it raw would preview a campaign nobody creates.
      // Calling it HERE, inside the computed, is also what keeps both capability signals real
      // dependencies — the bug this preview carried before was exactly a capability frozen at
      // mount because it was read outside.
      const channels = this.selectedGoogleChannels();
      let channel = 'Search';
      if (channels.length > 1) channel = 'Multi';
      else if (channels.length === 1) channel = GOOGLE_CAMPAIGN_NAME_TOKENS[channels[0]];
      return name ? `Events | ${name} | ${region} | Conversions | Prospecting | ${channel} | Linux Foundation | BoFU | ${startDate}` : '';
    });
  }
  /**
   * Shape only: two uppercase letters, the form campaign-service requires before it consults its
   * ISO 3166-1 set. That catches every realistic typo reachable from this form — empty,
   * lowercase, "USA", a single letter — while never rejecting a valid code.
   *
   * Deliberately NOT validated against the shared COUNTRIES constant: it holds 89 of the ~250
   * assigned codes (Iceland yes, Monaco and Liechtenstein no), so using it as an allow-list
   * would refuse real campaigns — a worse failure than the one it prevents. A well-formed but
   * unassigned code like "ZZ" still reaches dispatch and is refused there; LFXV2-3316 covers
   * porting a real ISO set into the shared package, which the whole app would use.
   */
  private normaliseGeoCodes(codes: string[]): string[] {
    return codes.map((g) => g.trim().toUpperCase()).filter((g) => /^[A-Z]{2}$/.test(g));
  }

  /**
   * Whether the Search/Demand Gen ad-copy arrays are being asked for at all.
   *
   * The two arrays are ONE ad's copy, and exactly two channels build an ad from them. `search`
   * does on both create roads. `demand-gen` does on the LEGACY road — `campaign-proxy.service.ts`
   * composes its Demand Gen ad from these same `headlines` and `descriptions` — which is why it is
   * named here rather than only `search`: gating on Search alone would have hidden and
   * un-required the copy that a cutover-dark Demand Gen create still sends, turning a working
   * campaign into an empty one.
   *
   * `performance-max`, `display` and `video` never read them on either road. Their copy is a
   * creative object with its own counts and widths ({@link GOOGLE_CREATIVE_FIELD_SPECS}), collected in
   * its own section.
   *
   * Gated on the Google platform too: with Google unselected these arrays are not on screen, and
   * a LinkedIn-only or Meta-only create must not be blocked by an empty Google headline.
   */
  private initSearchCopyApplies(): Signal<boolean> {
    return computed(() => {
      void this.campaignFormRevision();
      if (!this.showGoogleSection()) return false;
      const channels = this.selectedGoogleChannels();
      return channels.includes('search') || channels.includes('demand-gen');
    });
  }

  /**
   * Array-level "at least one non-empty entry", applied only when {@link initSearchCopyApplies}
   * says the copy is being asked for.
   *
   * On the ARRAY rather than on each control because required-ness here is a property of the SET:
   * what Google needs is an ad with copy in it, not a non-empty value in every box the user
   * happened to add. Per-control `Validators.required` also has to be re-decided on every `push`,
   * every `removeAt` and every draft restore, and each of those is a place the condition could be
   * forgotten; one validator on the array is decided once.
   *
   * Nothing re-runs a validator when a SIBLING control changes, so ticking or unticking a channel
   * box does not by itself move this array's validity — the constructor `effect` that watches
   * `searchCopyApplies` is what revalidates both arrays, and this validator is inert without it.
   * The gate is watched rather than the two checkboxes because it has a third input: unticking
   * Google in the parent moves `showGoogleSection()` without either checkbox emitting.
   *
   * The `searchCopyApplies` guard is for construction order: `fb.array(…, { validators })`
   * validates immediately, which happens while `campaignForm` itself is still being built and the
   * gate signal is several field initialisers away from existing. Testing the LATER of the two is
   * what makes one guard enough — the gate cannot be assigned before the form it reads.
   * Returning `null` there is correct as well as safe: the gate's own revalidation settles the
   * real answer as soon as anything moves.
   */
  private searchCopyRequired(label: 'headline' | 'description'): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!this.searchCopyApplies?.()) return null;
      const values = (control.value as unknown[]) ?? [];
      const filled = values.some((v) => typeof v === 'string' && v.trim() !== '');
      return filled ? null : { searchCopyRequired: { label } };
    };
  }

  /**
   * The creative sections to render, in channel order, for the channels currently selected.
   *
   * Empty whenever Google is unselected, and empty for a Search-only campaign — Search has no
   * creative object at all, its copy being the two arrays above.
   *
   * Only ONE entry can ever be non-empty in practice, because the BFF emits one `googleAdsConfig`
   * with one `channel` and campaign-service refuses a multi-channel Google create. This is written
   * as a list anyway rather than a single resolved channel: the one-at-a-time rule lives in
   * `canSubmit`, and duplicating it here as "take the first" would silently hide the second
   * section a user had already typed into, making the refusal they are about to get harder to
   * understand, not easier.
   *
   * Two further things empty it, and both are the same rule — never render a control whose value
   * cannot reach Google:
   *
   * - `googleCreativeAvailable()`. The creative objects ride on `googleAdsConfig`, which only the
   *   campaign-service create path builds; with the cutover dark the legacy creator reads no
   *   creative key at all and the create still reports success.
   * - Search being ticked. `buildGoogleAdsConfig`'s Search branch emits `headlines`/`descriptions`
   *   and never calls `googleCreative`, so a Search+Demand Gen pair discards the Demand Gen
   *   creative even with the cutover on. The pair funds Demand Gen out of the budget split — it is
   *   a real selection, not an invalid one — which is exactly why the section has to go rather than
   *   the selection.
   */
  private initGoogleCreativeSections(): Signal<GoogleCreativeSection[]> {
    return computed(() => {
      if (!this.googleCreativeAvailable()) return [];
      return this.googleCreativeChannelsInReach().map((channel) => ({
        channel,
        label: GOOGLE_CREATIVE_SECTION_TITLES[channel],
        groupName: GOOGLE_CREATIVE_REQUEST_KEYS[channel],
        // The guidance line is folded in here rather than left to a template method, so it is
        // assembled when the section resolves instead of on every change-detection pass.
        fields: GOOGLE_CREATIVE_FIELD_SPECS[channel].map((field) => ({ ...field, guidance: this.creativeFieldGuidance(field) })),
      }));
    });
  }

  /** The channel half of {@link initGoogleCreativeSections}: Google picked, and Demand Gen dropped beside Search. */
  private initGoogleCreativeChannelsInReach(): Signal<GoogleCreativeChannel[]> {
    return computed(() => {
      void this.campaignFormRevision();
      if (!this.showGoogleSection()) return [];
      const selected = this.selectedGoogleChannels();
      const reachesGoogle = selected.includes('search') ? selected.filter((channel) => channel !== 'demand-gen') : selected;
      return GOOGLE_CHANNELS_WITH_CREATIVE.filter((channel) => reachesGoogle.includes(channel));
    });
  }

  /**
   * One library read per request identity, `switchMap` dropping an answer the operator has moved
   * past — the slot grid's pattern (`CreativeSlotGridComponent.initState`).
   *
   * Read only while a Google image slot is on screen with the library offered; otherwise `idle`,
   * which nothing reads as "empty". A failure is `error`, never an empty `ready` list: an empty
   * library would tell every held image it had been deleted.
   */
  private initGoogleCreativeLibrary(): Signal<CreativeAssetLibraryState> {
    const idle: CreativeAssetLibraryState = { status: 'idle', assets: [] };
    const request = computed(
      () => ({
        projectSlug: this.activeFoundationSlug(),
        briefId: this.briefPersistence().briefId ?? '',
        revision: this.creativeLibraryRevision(),
        wanted: this.googleAssetUploadAvailable() && this.googleCreativeSections().length > 0,
      }),
      {
        equal: (a, b) => a.projectSlug === b.projectSlug && a.briefId === b.briefId && a.revision === b.revision && a.wanted === b.wanted,
      }
    );
    return toSignal(
      toObservable(request).pipe(
        switchMap((target) => {
          if (!target.wanted || target.projectSlug === '' || target.briefId === '') return of(idle);
          return this.campaignService.listCreativeAssets(target.projectSlug, target.briefId).pipe(
            map((library): CreativeAssetLibraryState => ({ status: 'ready', assets: library.assets })),
            catchError(() => of<CreativeAssetLibraryState>({ status: 'error', assets: [] })),
            startWith<CreativeAssetLibraryState>({ status: 'loading', assets: [] })
          );
        })
      ),
      { initialValue: idle }
    );
  }

  /**
   * Each rendered image slot's library controls.
   *
   * The picker offers only stored images that FIT the slot (`googleCreativeImageFit`), best fit
   * first — closest ratio, then larger area, as campaign-service's classifier ranks — and never one
   * already held there. An image with no recorded dimensions is not offered: nothing here can say
   * it fits. `canAdd` counts the slot's pasted URLs with its held images against the catalogued
   * `max`, which for a marketing shape is the channel's combined cap, the permissive direction the
   * catalogue already takes.
   */
  private initGoogleImageSlots(): Signal<Record<string, GoogleCreativeImageSlotView>> {
    return computed(() => {
      void this.campaignFormRevision();
      const views: Record<string, GoogleCreativeImageSlotView> = {};
      if (!this.googleAssetUploadAvailable()) return views;
      const library = this.googleCreativeLibrary();
      const briefId = this.briefPersistence().briefId ?? '';
      const heldBySlot = this.googleHeldImages();
      const uploadSlot = this.googleImageUploadSlot();
      for (const section of this.googleCreativeSections()) {
        const raw = this.campaignForm.controls[GOOGLE_CREATIVE_REQUEST_KEYS[section.channel]].getRawValue() as Record<string, string | null | undefined>;
        for (const field of section.fields) {
          const shape = field.image;
          if (!shape) continue;
          const key = `${section.groupName}.${field.control}`;
          const held = heldBySlot[key] ?? [];
          const heldIds = new Set(held.map((image) => image.id));
          const options = library.assets
            .filter((asset) => !heldIds.has(asset.id) && googleCreativeImageFit(asset, shape) === 'fits')
            .sort(
              (a, b) =>
                googleCreativeImageDrift(a, shape) - googleCreativeImageDrift(b, shape) || (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0)
            )
            .map((asset) => ({ label: storedCreativeAssetLabel(asset), value: asset.id }));
          const count = this.splitCreativeLines(raw[field.control]).length + held.length;
          const canAdd = field.max === undefined || count < field.max;
          views[key] = {
            key,
            label: field.label,
            requirement: googleCreativeImageRequirement(shape),
            held: held.map((image) => {
              const asset = library.assets.find((stored) => stored.id === image.id);
              return {
                id: image.id,
                label: this.googleHeldImageLabel(image, asset),
                problem: this.googleHeldImageProblem(image, key, library, briefId, asset),
              };
            }),
            options,
            optionsNote: this.googleImageOptionsNote(library, options.length, canAdd),
            canAdd,
            uploading: this.googleImageUploadStatus() === 'uploading' && uploadSlot === key,
            error: this.googleImageUploadStatus() === 'error' && uploadSlot === key ? this.googleImageUploadError() : '',
          };
        }
      }
      return views;
    });
  }

  private initGoogleSuggestionTargets(): Signal<string[]> {
    return computed(() => {
      const targets: string[] = [];
      for (const key of Object.keys(this.googleImageSlots())) {
        const [groupName, control] = key.split('.');
        const channel = GOOGLE_CHANNELS_WITH_CREATIVE.find((candidate) => GOOGLE_CREATIVE_REQUEST_KEYS[candidate] === groupName);
        if (!channel) continue;
        for (const [planSlot, mapped] of Object.entries(GOOGLE_ASSET_PLAN_SLOT_CONTROLS[channel])) {
          if (mapped === control) targets.push(`google-ads/${GOOGLE_ADS_CHANNEL_TYPE_ENUMS[channel]}/${planSlot}`);
        }
      }
      return targets;
    });
  }

  /**
   * `initMetaImageAssetBlock`'s sibling, over every stored image held in a slot the request would
   * carry, plus two kinds of its own so campaign-service never has to refuse what this tab can see
   * first: an image no longer in the brief's library (`missing`), and one whose recorded size does
   * not meet its slot (`misfit`).
   *
   * Only slots in a channel the request would carry count. An image held in a section the
   * operator un-ticked is not sent, exactly as that section's pasted URLs are not, and is kept for
   * if they tick it again. The capability withholding a section is a different case — the
   * operator did not take the image away — so the capability kinds read past that gate.
   */
  private initGoogleImageAssetBlock(): Signal<CampaignGoogleImageAssetBlock | null> {
    return computed(() => {
      if (!this.showGoogleSection()) return null;
      const briefId = this.briefPersistence().briefId;
      const inReach = new Set<string>(this.googleCreativeChannelsInReach().map((channel) => GOOGLE_CREATIVE_REQUEST_KEYS[channel]));
      const held = Object.entries(this.googleHeldImages())
        .filter(([slotKey]) => inReach.has(slotKey.split('.')[0]))
        .flatMap(([slotKey, images]) => images.map((image) => ({ slotKey, image })));
      if (briefId && held.some(({ image }) => image.briefId !== briefId)) {
        return {
          kind: 'otherBrief',
          message:
            'A Google image held in a slot was uploaded for a different brief, so it cannot be sent with this one. Remove it, then pick or upload an image for this brief.',
        };
      }
      // A failure blocks only while its slot is one the request would carry, as a held image does:
      // a failed upload in a section the operator un-ticked must not hold up the rest.
      if (
        this.googleImageUploadStatus() === 'error' &&
        briefId &&
        this.googleImageUploadFailedBriefId() === briefId &&
        inReach.has(this.googleImageUploadSlot().split('.')[0])
      ) {
        return {
          kind: 'uploadFailed',
          message: `The Google image upload did not complete: ${this.googleImageUploadError()} Remove it, or choose the image again.`,
        };
      }
      // No brief id — a save in flight, or a re-save that failed and cleared it — means no held image
      // can be matched to the brief, so none would be sent. Held, never dropped: Create waits.
      if (!briefId && held.length > 0) {
        return {
          kind: 'unsaved',
          message: "The Google images held in this campaign can't be sent until the brief is saved. Save the brief, or remove the images.",
        };
      }
      const forThisBrief = held.filter(({ image }) => image.briefId === (briefId ?? ''));
      const uploadingInReach = this.googleImageUploadStatus() === 'uploading' && inReach.has(this.googleImageUploadSlot().split('.')[0]);
      const withheld = (forThisBrief.length > 0 || uploadingInReach) && !this.googleAssetUploadAvailable();
      if (withheld) {
        if (this.googleCreativeEnabled() === false || this.googleAssetUploadEnabled() === false) {
          return {
            kind: 'unsupported',
            message:
              'Stored Google images are not available on this deployment, so the held images cannot be sent. Remove them to create the campaign without them.',
          };
        }
        if (this.createCapabilityRead() === 'pending') {
          return { kind: 'pending', message: 'Checking Google stored-image support…' };
        }
        if (!briefId) {
          return {
            kind: 'unsaved',
            message: "Google stored-image support can't be checked until this brief is saved. Save the brief, or remove the images.",
          };
        }
        return {
          kind: 'failed',
          message: 'Could not confirm that stored Google images are supported, so the held images cannot be sent yet. Retry the check, or remove them.',
        };
      }
      const library = this.googleCreativeLibrary();
      for (const kind of ['missing', 'misfit'] as const) {
        const hit = forThisBrief.find(({ slotKey, image }) => this.googleHeldImageIssue(image, slotKey, library, briefId ?? '') === kind);
        if (!hit) continue;
        return kind === 'missing'
          ? {
              kind,
              message: "A Google image held in a slot is no longer in the brief's library, so it cannot be sent. Remove it, then pick or upload another.",
            }
          : {
              kind,
              message:
                "A Google image held in a slot does not meet that slot's size or aspect ratio, and Google would refuse it. Remove it, then pick or upload one that fits.",
            };
      }
      return null;
    });
  }

  /**
   * Build the keyed error map from the sections currently rendered.
   *
   * Both revisions are read unconditionally and up front: a value edit moves the validators, a blur
   * moves `touched`, and either can be what turns a message on. Only rendered sections are walked —
   * a withheld section's group is disabled and has no error an operator could act on.
   */
  private initCreativeFieldErrors(): Signal<Record<string, string>> {
    return computed(() => {
      void this.campaignFormRevision();
      void this.campaignFormTouchRevision();
      const errors: Record<string, string> = {};
      for (const section of this.googleCreativeSections()) {
        for (const field of section.fields) {
          const message = this.creativeFieldError(section.groupName, field);
          if (message !== null) errors[`${section.groupName}.${field.control}`] = message;
        }
      }
      return errors;
    });
  }

  /**
   * The channel the bidding plan is written against — the SAME one the request will carry.
   *
   * Mirrors `buildGoogleAdsConfig`'s choice exactly, including its asymmetry: Search wins whenever
   * it is selected, because that builder emits `channel: 'search'` for a Search+Demand Gen pair
   * and funds Demand Gen out of the split. Picking Demand Gen's narrower strategy set for that
   * pair would offer the operator a bidding plan the campaign they get cannot use.
   *
   * Null whenever Google is unselected or no channel is ticked: there is no "default channel" to
   * fall back on, and a picker rendered against a guess would be offering options for a campaign
   * nobody asked for.
   *
   * Null on the legacy road as well, on the same rule as the creative sections and for the same
   * reason: every field this gates rides on the `googleAdsConfig` envelope, and the in-process
   * creator reads none of it — its Search body hard-codes `maximize_conversions` and its Demand Gen
   * body hard-codes `target_spend`. Rendering the picker there would take a Manual CPC bid from an
   * operator and create the campaign on automated bidding they did not choose, against a real
   * budget. Nulling here withholds the whole plan in one place: `googleBiddingError` and
   * `googleBiddingPayload` both open on this channel, so neither a stale value nor a stranded
   * validation error survives the gate.
   */
  private initGoogleBiddingChannel(): Signal<GoogleCampaignChannel | null> {
    return computed(() => {
      if (!this.googleCreativeAvailable()) return null;
      return this.resolveGoogleChannel();
    });
  }

  /**
   * The channel the language control is rendered against, or null when it should not be rendered.
   *
   * Resolves the channel the SAME way `buildGoogleAdsConfig` does — Search when Search is among the
   * selection, otherwise the first selected channel — so the control can never be offered against a
   * channel other than the one the request will carry. That resolution, and the first two gates
   * below, are `googleBiddingChannel`'s, read from it rather than repeated, so the two sections
   * cannot drift apart on which channel they mean.
   *
   * Three gates, and each withholds the control for a different reason:
   *
   * 1. `showGoogleSection` — no Google platform, nothing to target.
   * 2. `googleCreativeAvailable` — the LEGACY road, on the same rule as the bidding picker and for
   *    the same reason. Languages ride on the `googleAdsConfig` envelope and the in-process creator
   *    reads none of it, so a language picked there would be collected, dropped, and the campaign
   *    created serving in every language while the operator believes they narrowed it.
   * 3. {@link GOOGLE_CHANNELS_WITH_LANGUAGES} — Demand Gen. `validateCriteriaPlan` REFUSES the whole
   *    non-location criteria set there rather than dropping it, so offering the control on that
   *    channel would not produce a wider campaign, it would produce a failed create.
   *
   * Video is in that constant and still never reaches here: `GOOGLE_VIDEO_CREATE_SUPPORTED` is
   * false, so `selectedGoogleChannels` drops it and there is no Video create for a language to ride
   * on. The constant is right about upstream; this signal is narrower because the screen is.
   *
   * Nulling in one place is what keeps the collected value and the payload from disagreeing: the
   * template opens on this signal and `googleLanguagesPayload` opens on it too.
   */
  private initGoogleLanguagesChannel(): Signal<GoogleCampaignChannel | null> {
    return computed(() => {
      const channel = this.googleBiddingChannel();
      if (!channel) return null;
      return (GOOGLE_CHANNELS_WITH_LANGUAGES as readonly string[]).includes(channel) ? channel : null;
    });
  }

  /**
   * The label of the channel a picked language list is being WITHHELD on, or null when nothing is.
   *
   * Non-null only when the Google section is live on a dispatched channel (`googleBiddingChannel`)
   * that takes no languages, and the operator has picked some — in practice languages chosen under
   * Search and then left behind by a switch to Demand Gen. The list is held for a switch back, not
   * sent, so the campaign serves in every language; the template says so rather than letting the
   * section simply vanish. Off on the legacy road and with no Google channel, where
   * `googleBiddingChannel` is null and nothing about languages is on screen to explain.
   */
  private initGoogleLanguagesWithheldOn(): Signal<string | null> {
    return computed(() => {
      const channel = this.googleBiddingChannel();
      if (!channel || this.googleLanguagesChannel() || this.googleLanguages().length === 0) return null;
      return GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel];
    });
  }

  /**
   * Whether postal-code targets are offered and sent — on the campaign-service road with a Google
   * channel selected, which is exactly when `googleBiddingChannel` is non-null.
   *
   * NO channel fence beyond that, unlike {@link initGoogleProximityChannel}: `validateGeoPlan` reads
   * `geoTargets` on every channel, Demand Gen included (attached at the ad group there). The LEGACY
   * road is the one gate: the in-process creator resolves `geoTargets` through the 30-country map
   * and drops anything else, so an id sent there would vanish and the campaign target something the
   * operator did not pick.
   */
  private initGooglePostalGeoAvailable(): Signal<boolean> {
    return computed(() => this.googleBiddingChannel() !== null);
  }

  /**
   * The channel the radius control is rendered against, or null when it should not be rendered.
   *
   * {@link initGoogleLanguagesChannel}'s shape exactly — `googleBiddingChannel` for the Google
   * section and the legacy-road gate, then a channel fence — with {@link GOOGLE_CHANNELS_WITH_PROXIMITY}
   * as the fence. Demand Gen is the one channel outside it: `validateGeoPlan` REFUSES proximity there
   * before any mutate, so offering the control would offer a refusal.
   */
  private initGoogleProximityChannel(): Signal<GoogleCampaignChannel | null> {
    return computed(() => {
      const channel = this.googleBiddingChannel();
      if (!channel) return null;
      return (GOOGLE_CHANNELS_WITH_PROXIMITY as readonly string[]).includes(channel) ? channel : null;
    });
  }

  /**
   * The label of the channel a radius list is being WITHHELD on, or null when nothing is. The list is
   * held for a switch back, not sent, and the template says so rather than letting the control vanish.
   *
   * Asks {@link resolveGoogleChannel}, NOT `googleBiddingChannel` — the callouts warning's rule and
   * for its reason. This sentence is about the CHANNEL alone, and `googleBiddingChannel` is null
   * whenever the create capability is not an explicit yes, which would mute it on Demand Gen exactly
   * when {@link googleLocationsCapabilityBlock} leaves Demand Gen radii to it. Then a held radius list
   * would be dropped with nothing on screen, while the request fell back to the event country.
   */
  private initGoogleProximityWithheldOn(): Signal<string | null> {
    return computed(() => {
      const channel = this.resolveGoogleChannel();
      if (channel === null || this.googleProximityTargets().length === 0) return null;
      if ((GOOGLE_CHANNELS_WITH_PROXIMITY as readonly string[]).includes(channel)) return null;
      return GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel];
    });
  }

  /**
   * Why Create is blocked for postal-code or radius targets the capability does not let this request
   * carry, or null when nothing is held for that reason.
   *
   * The extensions block's shape — {@link initGoogleExtensionsCapabilityBlock}: the same kinds, the
   * same reads, `resolveGoogleChannel` rather than `googleBiddingChannel` because the latter's
   * capability gate is the thing being reported on — with ONE difference: this block gates Create.
   * A withheld extension list ships a campaign without extensions; a withheld location list ships a
   * campaign that falls back to the event country, so a radius around the venue would become the
   * whole country. Retry the check, or remove the targets explicitly.
   *
   * Radius targets on a channel that refuses them (Demand Gen) are NOT counted: they are withheld
   * whatever the capability answers, and {@link googleProximityWithheldOn} already says so.
   */
  private initGoogleLocationsCapabilityBlock(): Signal<CampaignGoogleLocationsCapabilityBlock | null> {
    return computed(() => {
      if (this.googleCreativeAvailable()) return null;
      const channel = this.resolveGoogleChannel();
      if (channel === null) return null;

      const postal = this.googlePostalGeoTargets().length;
      const radius = (GOOGLE_CHANNELS_WITH_PROXIMITY as readonly string[]).includes(channel) ? this.googleProximityTargets().length : 0;
      if (postal + radius === 0) return null;

      const parts: string[] = [];
      if (postal > 0) parts.push(`${postal} postal-code target${postal === 1 ? '' : 's'}`);
      if (radius > 0) parts.push(`${radius} radius target${radius === 1 ? '' : 's'}`);
      const held = parts.join(' and ');

      if (this.googleCreativeEnabled() === false) {
        return {
          kind: 'unsupported',
          message: `Postal-code and radius targeting is not available on this deployment, so the ${held} on this brief cannot be sent. Remove them to create the campaign with country targeting instead.`,
        };
      }
      if (this.createCapabilityRead() === 'pending') {
        return {
          kind: 'pending',
          message: `Checking whether the ${held} on this brief can be sent. Create waits for the check, because without them this campaign would target the whole event country.`,
        };
      }
      if (!this.briefPersistence().briefId) {
        return {
          kind: 'unsaved',
          message: `Postal-code and radius support can't be checked until this brief is saved, so the ${held} on it cannot be sent yet. Save the brief, or remove them to create with country targeting.`,
        };
      }
      return {
        kind: 'failed',
        message: `Could not confirm that the ${held} on this brief can be sent. Retry the check, or remove them to create with country targeting.`,
      };
    });
  }

  /**
   * Whether the request will carry audience segments: the dispatched channel is one in
   * {@link GOOGLE_CHANNELS_WITH_AUDIENCE_SEGMENTS}, which is Search alone.
   *
   * Built on `googleBiddingChannel` for the reason {@link initGoogleLanguagesChannel} is — it is
   * already the channel the REQUEST will carry, null on the legacy road, whose in-process creator
   * reads nothing on `googleAdsConfig`. Upstream REFUSES audience segments off Search rather than
   * dropping them, so the section and `googleAudienceSegmentsPayload` both open on this one signal.
   */
  private initGoogleAudienceSegmentsAvailable(): Signal<boolean> {
    return computed(() => {
      // Root only: the per-caller capability must be an explicit yes, never a `null`.
      if (this.googleAudienceSegmentsEnabled() !== true) return false;
      const channel = this.googleBiddingChannel();
      return channel !== null && (GOOGLE_CHANNELS_WITH_AUDIENCE_SEGMENTS as readonly string[]).includes(channel);
    });
  }

  /**
   * Why Create is held for audience segments the draft still holds but the request cannot carry, or
   * `null` — the {@link initRedditImageAssetBlock} pattern, on the same capability read.
   *
   * Speaks only on a channel that takes segments: anywhere else the channel is the reason, and
   * {@link initGoogleAudienceSegmentsWithheldWarning} says so whatever the capability answers.
   * `restricted` is the root-only rule — the caller is not a root writer or root campaign manager,
   * so the create route would answer 403. It HOLDS Create rather than dropping the list, because
   * segments change who the campaign is aimed at; Remove is offered in every state.
   */
  private initGoogleAudienceSegmentsBlock(): Signal<CampaignGoogleAudienceSegmentsBlock | null> {
    return computed(() => {
      const channel = this.resolveGoogleChannel();
      if (channel === null || !(GOOGLE_CHANNELS_WITH_AUDIENCE_SEGMENTS as readonly string[]).includes(channel)) return null;
      const count = this.googleAudienceSegments().length;
      if (count === 0 || this.googleAudienceSegmentsAvailable()) return null;
      const held = `${count} audience segment${count === 1 ? '' : 's'}`;

      if (this.googleCreativeEnabled() === false) {
        return {
          kind: 'unsupported',
          message: `Google audience segments are not available on this deployment, so the ${held} on this brief cannot be sent. Remove them to create the campaign.`,
        };
      }
      if (this.googleAudienceSegmentsEnabled() === false) {
        return {
          kind: 'restricted',
          message: `Only LF administrators can add Google audience segments, because every foundation shares one Google Ads account. Remove the ${held} on this brief to create the campaign.`,
        };
      }
      // `unknown` is treated like a failure, as the bidding block records: nothing else starts the read.
      if (this.createCapabilityRead() === 'pending') {
        return {
          kind: 'pending',
          message: `Checking whether you can send Google audience segments. Create waits for the answer so the ${held} on this brief are not dropped.`,
        };
      }
      if (!this.briefPersistence().briefId) {
        return {
          kind: 'unsaved',
          message: `Google audience segment access can't be checked until this brief is saved. Save the brief, or remove the ${held} on it.`,
        };
      }
      return {
        kind: 'failed',
        message: `Could not confirm that you can send Google audience segments, so Create waits rather than dropping the ${held} on this brief. Retry the check, or remove them.`,
      };
    });
  }

  /**
   * The sentence saying an entered segment list is being WITHHELD because of the CHANNEL, or null
   * when it is not — the audience twin of {@link initGoogleCalloutsWithheldWarning}, on the same
   * terms and for the same reason: it asks {@link resolveGoogleChannel} and tests the channel
   * directly, so it neither goes quiet on Demand Gen while a capability read is unanswered nor claims
   * Search takes no segments. The capability reason, root-only rule included, belongs to
   * {@link initGoogleAudienceSegmentsBlock}. One string feeds both the visible notice and its live
   * region.
   */
  private initGoogleAudienceSegmentsWithheldWarning(): Signal<string | null> {
    return computed(() => {
      const channel = this.resolveGoogleChannel();
      const count = this.googleAudienceSegments().length;
      if (!channel || (GOOGLE_CHANNELS_WITH_AUDIENCE_SEGMENTS as readonly string[]).includes(channel) || count === 0) return null;
      return `${GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel]} campaigns do not take audience segments, so the ${count} you added will not be sent. Switch back to Search to keep them.`;
    });
  }

  /**
   * The sentence saying callouts are held back, or null when none are. Set when the channel a
   * create would carry takes no callouts and the operator added some — in practice callouts typed
   * under Search and left behind by a switch to another channel. Held is not silent: the section
   * disappears with the switch, so without this the operator would not know the campaign is created
   * without them. One string feeds both the visible notice and its live region.
   *
   * Asks {@link resolveGoogleChannel}, NOT `googleBiddingChannel`, and tests the channel directly
   * rather than reading `googleCalloutsAvailable`. Both changes say the same thing: this sentence is
   * about the CHANNEL alone. `googleBiddingChannel` is null whenever the create capability is
   * unanswered, which would mute this warning on a Demand Gen create merely because a capability
   * read had not come back — and `googleCalloutsAvailable` is false for either reason, which on
   * Search with an unanswered capability would put the words "Search campaigns do not take callouts"
   * on screen. Read the channel, state the channel's truth, and leave the capability reason to
   * {@link initGoogleExtensionsCapabilityBlock}. Between them no withholding is now silent.
   */
  private initGoogleCalloutsWithheldWarning(): Signal<string | null> {
    return computed(() => {
      const channel = this.resolveGoogleChannel();
      const count = this.googleCallouts().length;
      if (!channel || (GOOGLE_CHANNELS_WITH_AD_EXTENSIONS as readonly string[]).includes(channel) || count === 0) return null;
      return `${GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel]} campaigns do not take callouts, so the ${count} you added will not be sent. Switch back to Search to keep them.`;
    });
  }
  /** The sitelink twin of {@link initGoogleCalloutsWithheldWarning}, on the same channel gate. */
  private initGoogleSitelinksWithheldWarning(): Signal<string | null> {
    return computed(() => {
      const channel = this.resolveGoogleChannel();
      const count = this.googleSitelinks().length;
      if (!channel || (GOOGLE_CHANNELS_WITH_AD_EXTENSIONS as readonly string[]).includes(channel) || count === 0) return null;
      return `${GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel]} campaigns do not take sitelinks, so the ${count} you added will not be sent. Switch back to Search to keep them.`;
    });
  }
  /** The structured-snippet twin of {@link initGoogleCalloutsWithheldWarning}, on the same gate. */
  private initGoogleStructuredSnippetsWithheldWarning(): Signal<string | null> {
    return computed(() => {
      const channel = this.resolveGoogleChannel();
      const count = this.googleStructuredSnippets().length;
      if (!channel || (GOOGLE_CHANNELS_WITH_AD_EXTENSIONS as readonly string[]).includes(channel) || count === 0) return null;
      return `${GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel]} campaigns do not take structured snippets, so the ${count} you added will not be sent. Switch back to Search to keep them.`;
    });
  }
  /**
   * The call, promotion and price twins of {@link initGoogleCalloutsWithheldWarning}, on the same
   * channel gate and in the same words. One initializer for the three because they differ only in
   * the list they count and the noun they name.
   */
  private initGoogleAssetWithheldWarning(list: Signal<readonly unknown[]>, noun: string): Signal<string | null> {
    return computed(() => {
      const channel = this.resolveGoogleChannel();
      const count = list().length;
      if (!channel || (GOOGLE_CHANNELS_WITH_AD_EXTENSIONS as readonly string[]).includes(channel) || count === 0) return null;
      return `${GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel]} campaigns do not take ${noun}, so the ${count} you added will not be sent. Switch back to Search to keep them.`;
    });
  }

  /**
   * Why the callouts, sitelinks and structured snippets on this brief are being withheld for want of
   * a capability answer.
   *
   * The sibling of {@link initBiddingCapabilityBlock}, on the SAME read — `loadCreateCapabilitiesFor`
   * sets `googleCreativeEnabled` and `biddingEnabled` from one response, so `createCapabilityRead`
   * is that whole read's state and either block may report on it.
   *
   * It differs from that sibling in one way on purpose: it does not block Create. A withheld manual
   * bid would create the campaign automatic, spending differently from the choice on screen, so
   * that one waits. Withheld extensions cost only the extensions, and holding a demo's create
   * hostage to a stalled capability read is worse than creating and saying what was left out.
   *
   * Says nothing about the CHANNEL reason — {@link initGoogleCalloutsWithheldWarning} and its
   * sitelink twin own that, on every channel that takes no extensions and whatever the capability
   * says. The two divide the ground exactly: this block speaks only where an answer could change
   * the outcome, which is only on a channel that takes extensions, and those warnings speak
   * everywhere else. Nothing is withheld in silence and nothing is explained twice.
   */
  private initGoogleExtensionsCapabilityBlock(): Signal<CampaignGoogleExtensionsCapabilityBlock | null> {
    return computed(() => {
      if (this.googleCreativeAvailable()) return null;

      // `resolveGoogleChannel`, not `googleBiddingChannel`: the latter's capability gate is the very
      // thing being reported on here, so reading it would always give null.
      //
      // The channel matters because the capability is not the only reason a list is withheld. On a
      // channel that takes no extensions the list is not going anywhere whatever the capability
      // answers, so "Retry the check to send them" would be a promise this code cannot keep. Stay
      // silent there instead: nothing is lost that the answer could recover, and
      // `googleCalloutsWithheldWarning` is already saying the true reason — it reads the same
      // resolved channel, so it does not wait for the capability either.
      const channel = this.resolveGoogleChannel();
      if (channel === null || !(GOOGLE_CHANNELS_WITH_AD_EXTENSIONS as readonly string[]).includes(channel)) return null;

      // "N callouts, M sitelinks and K structured snippets", dropping whichever parts are empty. The
      // counts are the point: they are what the operator is about to lose, and they are the only way
      // to tell this notice from a generic capability warning.
      const counted: [number, string][] = [
        [this.googleCallouts().length, 'callout'],
        [this.googleSitelinks().length, 'sitelink'],
        [this.googleStructuredSnippets().length, 'structured snippet'],
        [this.googleCallExtensions().length, 'call extension'],
        [this.googlePromotions().length, 'promotion'],
        [this.googlePrices().length, 'price extension'],
      ];
      const parts = counted.filter(([count]) => count > 0).map(([count, noun]) => `${count} ${noun}${count === 1 ? '' : 's'}`);
      if (parts.length === 0) return null;
      // Oxford-free list: "a", "a and b", "a, b and c" — the same shape the two-part version read as.
      const lost = parts.length > 2 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join(' and ');

      if (this.googleCreativeEnabled() === false) {
        return {
          kind: 'unsupported',
          message: `Google ad extensions are not available on this deployment, so the ${lost} on this brief will not be sent. The campaign is created without them.`,
        };
      }
      // Only an IN-FLIGHT read is "checking". `unknown` — no read out and none answered, as after a
      // foundation switch — is treated like a failure, for the reason the bidding block records:
      // nothing else will start the read.
      //
      // This one names the counts too, for a reason specific to it: unlike the bidding block, this
      // one does not gate Create. A create started while the check is in flight is allowed, and it
      // ships no extensions — so "checking…" on its own would be the only message in this set that
      // lets the operator lose the lists without having been told. Waiting costs nothing; creating
      // now costs the lists, and the sentence has to say which.
      if (this.createCapabilityRead() === 'pending') {
        return {
          kind: 'pending',
          message: `Checking whether Google ad extensions can be sent. Creating the campaign before the check finishes sends it without the ${lost} on this brief.`,
        };
      }
      if (!this.briefPersistence().briefId) {
        return {
          kind: 'unsaved',
          message: `Google ad extension support can't be checked until this brief is saved, so the ${lost} on it will not be sent. Save the brief to send them.`,
        };
      }
      return {
        kind: 'failed',
        message: `Could not confirm that Google ad extensions can be sent, so the ${lost} on this brief will not be sent. Retry the check to send them.`,
      };
    });
  }

  /**
   * Whether the campaign this form will dispatch can carry ad extensions at all.
   *
   * Built on {@link googleBiddingChannel} rather than re-deriving the channel, because the question
   * is about the channel the REQUEST will carry and that signal is already exactly that — the same
   * `buildGoogleAdsConfig` mirror, including its Search-wins asymmetry and its null on the legacy
   * road. Re-deriving it here would be a second copy of one upstream contract, free to drift.
   *
   * False is a withholding, not a refusal. Upstream's `validateAssetPlan` refuses the whole
   * extension set on any channel but Search ("supported on Search campaigns only, not on %s") at
   * preflight, BEFORE the budget mutate — so a callout sent on a Performance Max create yields no
   * campaign at all. The section hides and the payload holds the list rather than forwarding it;
   * the operator's typed callouts survive in the draft and come back if they re-tick Search.
   *
   * False for TWO reasons, not one: the channel takes no extensions, or `googleBiddingChannel` is
   * null because the create capability is not an explicit yes. Because this signal cannot tell which,
   * nothing that has to NAME the reason may read it. Each reason has its own reader, and each asks
   * the question it can answer: {@link initGoogleCalloutsWithheldWarning} and its sitelink twin read
   * the resolved channel and speak for the channel reason;
   * {@link initGoogleExtensionsCapabilityBlock} reads the capability and speaks for that one. The
   * two are mutually exclusive by construction — the block stays silent on a channel that takes no
   * extensions — so exactly one of them speaks whenever a list is withheld.
   */
  private initGoogleCalloutsAvailable(): Signal<boolean> {
    return computed(() => {
      const channel = this.googleBiddingChannel();
      return channel !== null && (GOOGLE_CHANNELS_WITH_AD_EXTENSIONS as readonly string[]).includes(channel);
    });
  }

  /**
   * The strategies the selected channel accepts, labelled for the picker.
   *
   * Straight from the shared catalogue, which reproduces campaign-service's five per-channel sets.
   * Nothing is added here and nothing is filtered out — a strategy missing from a channel's list
   * is missing because the dispatcher refuses it there, and one that appears is one it takes.
   */
  private initGoogleBiddingOptions(): Signal<GoogleBiddingOption[]> {
    return computed(() => {
      const channel = this.googleBiddingChannel();
      if (!channel) return [];
      return GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL[channel].map((value) => ({ value, label: GOOGLE_BIDDING_STRATEGY_LABELS[value] }));
    });
  }

  /**
   * The strategy actually in force: the operator's pick, or the channel's default when they have
   * picked nothing.
   *
   * A pick that is NOT in the current channel's set resolves to the default too, and that case is
   * reachable by ordinary use rather than by tampering: choose Target ROAS on Display, then switch
   * the campaign to Video, and the control still holds a value Video refuses. Resolving it away
   * here is what keeps the dependent fields — and the payload — honest about what will be sent.
   *
   * Null only when there is no channel at all.
   */
  private initGoogleBiddingStrategy(): Signal<GoogleBiddingStrategy | null> {
    return computed(() => {
      void this.campaignFormRevision();
      const channel = this.googleBiddingChannel();
      if (!channel) return null;
      const chosen = this.campaignForm.controls.googleBiddingStrategy.value.trim();
      const accepted = GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL[channel] as readonly GoogleBiddingStrategy[];
      return accepted.find((strategy) => strategy === chosen) ?? GOOGLE_BIDDING_DEFAULT_BY_CHANNEL[channel];
    });
  }

  /** What the picker's empty option names, so "channel default" says WHICH strategy that is. */
  private initGoogleBiddingDefaultLabel(): Signal<string> {
    return computed(() => {
      const channel = this.googleBiddingChannel();
      if (!channel) return '';
      return GOOGLE_BIDDING_STRATEGY_LABELS[GOOGLE_BIDDING_DEFAULT_BY_CHANNEL[channel]];
    });
  }

  /**
   * Whether the effective strategy carries a target CPA / target ROAS / manual bid.
   *
   * These gate the template, and through `googleBiddingPayload` the request as well. Upstream
   * REFUSES a target on a strategy that cannot carry it, and refuses a CPC bid under anything but
   * manual CPC, rather than dropping either — so a value left behind in a hidden control has to be
   * withheld at submit, not merely hidden on screen.
   */
  private initGoogleTakesTargetCpa(): Signal<boolean> {
    return computed(() => {
      const strategy = this.googleBiddingStrategy();
      return strategy !== null && (GOOGLE_BIDDING_CPA_STRATEGIES as readonly string[]).includes(strategy);
    });
  }

  private initGoogleTakesTargetRoas(): Signal<boolean> {
    return computed(() => {
      const strategy = this.googleBiddingStrategy();
      return strategy !== null && (GOOGLE_BIDDING_ROAS_STRATEGIES as readonly string[]).includes(strategy);
    });
  }

  private initBiddingCapabilityBlock(): Signal<CampaignBiddingCapabilityBlock | null> {
    return computed(() => {
      if (this.biddingAvailable()) return null;
      const platforms = this.retainedManualBiddingPlatforms();
      if (platforms.length === 0) return null;
      const names = platforms.map((p) => CAMPAIGN_BIDDING_RULES[p].label).join(', ');
      if (this.biddingEnabled() === false) {
        return {
          kind: 'unsupported',
          message: `Manual bidding is not available on this deployment, so the manual max CPC bid chosen for ${names} cannot be sent. Switch to Automatic to create the campaign.`,
        };
      }
      // Only an IN-FLIGHT read is "checking". `unknown` — no read out and none answered, as after a
      // foundation switch — is treated like a failure: it gets a Retry, because nothing else will
      // start the read the block is waiting for.
      if (this.createCapabilityRead() === 'pending') {
        return { kind: 'pending', message: 'Checking bidding support…' };
      }
      // No read out and no brief id to read against (none saved yet, or a save in flight): a Retry
      // would be a no-op, since the parent's read needs a brief id. Saving the brief starts the read
      // itself — the parent's persist success arm calls `loadCreateCapabilitiesFor` with the new
      // id — so that is what the message asks for, and Retry is offered only when it can read.
      if (!this.briefPersistence().briefId) {
        return { kind: 'unsaved', message: "Bidding support can't be checked until this brief is saved. Save the brief, or switch to Automatic." };
      }
      return {
        kind: 'failed',
        message: `Could not confirm that manual bidding is supported, so the manual max CPC bid chosen for ${names} cannot be sent yet. Retry the check, or switch to Automatic.`,
      };
    });
  }

  /**
   * Whether the legacy Microsoft max CPC field still speaks for the operator. Not while the Bidding
   * control is offered (it replaces the field), and not once the operator has explicitly chosen
   * Automatic for Microsoft: campaign-service reads a `cpcBid` without `bidding` as a MANUAL bid, so
   * sending it then would create the campaign manual against the choice on screen.
   */
  private microsoftLegacyCpcBidApplies(): boolean {
    return !this.biddingAvailable() && this.biddingDrafts()['microsoft-ads']?.strategy !== 'automatic';
  }

  /**
   * Moves a legacy Microsoft max CPC into the Bidding control as a Manual choice, then clears the
   * legacy field so the bid cannot be sent twice. Only when there is a value and no explicit
   * Microsoft choice yet — an explicit choice is newer than the legacy field and wins.
   */
  private adoptLegacyMicrosoftCpcBid(): void {
    const raw = this.microsoftCpcBid().trim();
    if (raw === '' || this.biddingDrafts()['microsoft-ads'] !== undefined) return;
    const amount = Number(raw);
    this.biddingDrafts.update((drafts) => ({ ...drafts, 'microsoft-ads': { strategy: 'manual', bidAmount: Number.isFinite(amount) ? amount : null } }));
    this.clearLegacyMicrosoftCpcBid();
    this.emitDraft();
  }

  /** Choosing Automatic for Microsoft retires the legacy max CPC value, so it cannot resurface as a manual bid. */
  private clearLegacyMicrosoftCpcBid(): void {
    this.microsoftCpcBid.set('');
  }

  /** The selected bidding platforms whose retained choice is Manual. */
  private retainedManualBiddingPlatforms(): CampaignBiddingPlatform[] {
    const drafts = this.biddingDrafts();
    const selected = this.selectedPlatforms();
    return CAMPAIGN_BIDDING_CREATE_PLATFORMS.filter((p) => selected.includes(p) && drafts[p]?.strategy === 'manual');
  }

  private initBiddingViews(): Signal<Record<CampaignBiddingPlatform, CampaignBiddingControlView>> {
    return computed(() => {
      const drafts = this.biddingDrafts();
      const views = {} as Record<CampaignBiddingPlatform, CampaignBiddingControlView>;
      for (const platform of CAMPAIGN_BIDDING_PLATFORMS) {
        const value = drafts[platform] ?? defaultCampaignBiddingDraft();
        views[platform] = { platform, value, error: campaignBiddingError(platform, value, this.biddingContext(platform)) };
      }
      return views;
    });
  }

  private initBiddingPayloads(): Signal<Record<CampaignBiddingPlatform, CampaignBiddingConfig | null>> {
    return computed(() => {
      const views = this.biddingViews();
      const payloads = {} as Record<CampaignBiddingPlatform, CampaignBiddingConfig | null>;
      for (const platform of CAMPAIGN_BIDDING_PLATFORMS) {
        payloads[platform] = campaignBiddingPayload(platform, views[platform].value, this.biddingContext(platform));
      }
      return payloads;
    });
  }

  private initGoogleTakesCpcBid(): Signal<boolean> {
    return computed(() => this.googleBiddingStrategy() === 'manual-cpc');
  }

  /**
   * Whether the chosen strategy REQUIRES its target rather than merely accepting one.
   *
   * Read inside the CPA and the ROAS branches alike, which is safe because the two strategy sets
   * are disjoint: within `googleTakesTargetCpa()` the only member that needs a target is
   * `target-cpa`, and within `googleTakesTargetRoas()` it is `target-roas`. One signal rather than
   * two literals so that a future strategy added to the shared set starts being enforced here
   * instead of silently going unchecked.
   */
  private initGoogleStrategyNeedsTarget(): Signal<boolean> {
    return computed(() => {
      const strategy = this.googleBiddingStrategy();
      return strategy !== null && (GOOGLE_BIDDING_TARGET_REQUIRED_STRATEGIES as readonly string[]).includes(strategy);
    });
  }

  /**
   * Whether this channel can name its conversion actions at create time.
   *
   * A CHANNEL question, not a strategy one: `campaign.selective_optimization` is defined for
   * Search, Display and Video, so those three accept the list under any strategy. Demand Gen and
   * Performance Max select conversions through a resource that cannot be written until the
   * campaign exists, and campaign-service refuses the list there rather than dropping it.
   */
  private initGoogleTakesConversionActions(): Signal<boolean> {
    return computed(() => {
      const channel = this.googleBiddingChannel();
      return channel !== null && (GOOGLE_CONVERSION_ACTION_CHANNELS as readonly string[]).includes(channel);
    });
  }

  /**
   * What is wrong with the bidding plan as typed, in one sentence, or null when nothing is.
   *
   * This exists INSTEAD of control validators — see the form declaration — and it speaks only
   * about fields that are currently in play, so a stale value in a hidden control can never block
   * a create. `canSubmit` reads it, and the template prints it.
   *
   * Every bound here is campaign-service's own, equal and never tighter: the point is to put the
   * refusal in front of the operator while the form is open rather than after a round trip, not to
   * refuse anything upstream would have taken.
   */
  private initGoogleBiddingError(): Signal<string | null> {
    return computed(() => {
      void this.campaignFormRevision();
      if (!this.googleBiddingChannel()) return null;
      const form = this.campaignForm.controls;

      if (this.googleTakesCpcBid()) {
        const error = this.googleBidAmountError(form.googleCpcBid.value, 'Max CPC bid', GOOGLE_ADS_BIDDING_BOUNDS.cpcBid);
        if (error) return error;
      }
      if (this.googleTakesTargetCpa()) {
        const error = this.googleBidAmountError(form.googleTargetCpa.value, 'Target CPA', GOOGLE_ADS_BIDDING_BOUNDS.targetCpa);
        if (error) return error;
        if (this.googleStrategyNeedsTarget() && form.googleTargetCpa.value.trim() === '') {
          return 'Target CPA strategy needs a target CPA.';
        }
      }
      if (this.googleTakesTargetRoas()) {
        const error = this.googleBidAmountError(form.googleTargetRoas.value, 'Target ROAS', GOOGLE_ADS_BIDDING_BOUNDS.targetRoas);
        if (error) return error;
        if (this.googleStrategyNeedsTarget() && form.googleTargetRoas.value.trim() === '') {
          return 'Target ROAS strategy needs a target ROAS.';
        }
      }
      if (this.googleTakesConversionActions()) {
        const actions = this.splitCreativeLines(form.googleConversionActions.value);
        if (actions.length > GOOGLE_ADS_MAX_CONVERSION_ACTIONS) {
          return `Google accepts at most ${GOOGLE_ADS_MAX_CONVERSION_ACTIONS} conversion actions.`;
        }
        const malformed = actions.find((action) => !GOOGLE_ADS_CONVERSION_ACTION_PATTERN.test(action));
        if (malformed !== undefined) {
          return `"${malformed}" is not a conversion action id or resource name.`;
        }
      }
      return null;
    });
  }

  /**
   * One bidding number checked against its bounds, as a sentence or null.
   *
   * Blank is NOT an error here — it is the normal way to leave a bid or an optional target unset,
   * and the two strategies that genuinely require their target say so themselves in
   * `googleBiddingError`. Only text that cannot be a number, or a number outside Google's range,
   * is reported.
   */
  private googleBidAmountError(raw: string, label: string, bounds: { min: number; max: number }): string | null {
    const text = raw.trim();
    if (text === '') return null;
    const value = Number(text);
    if (!Number.isFinite(value)) return `${label} must be a number.`;
    if (value < bounds.min || value > bounds.max) return `${label} must be between ${bounds.min} and ${bounds.max}.`;
    return null;
  }

  /**
   * What a STARTED creative is still missing, in one sentence, or null when none is.
   *
   * The companion to {@link googleCreativeEmptyWarning}, and the two split on exactly the line
   * campaign-service splits on. Each of the three creative validators opens with an `empty()` gate
   * that ACCEPTS the creative and only then enforces its minimums (`demandgen_creative.go:277`,
   * `pmax_creative.go:247`, `display_creative.go:169`). So a creative that has nothing in it is a
   * create upstream makes — blocking it here would be the over-refusal this whole road forbids, and
   * it gets the warning instead. A creative with something in it but below a minimum is a create
   * upstream REFUSES, and surfacing that refusal before the round trip can never refuse more than
   * upstream would.
   *
   * Judged on {@link googleCreativePayload} rather than on the controls, so "empty" means exactly
   * what the wire means: the payload builder omits a field that trims to nothing and omits a
   * channel whose whole creative is empty, which is the same shape `empty()` tests. Reading the
   * controls instead would need a second definition of empty to drift against this one.
   *
   * A computed rather than control validators, for the reason {@link initGoogleBiddingError}
   * records: it walks only the sections currently rendered, so a stale value in a withheld channel
   * can never block a create. `canSubmit` reads it and the template prints it.
   */
  private initGoogleCreativeError(): Signal<string | null> {
    return computed(() => {
      void this.campaignFormRevision();
      const payload = this.googleCreativePayload();
      for (const section of this.googleCreativeSections()) {
        const creative = payload[section.groupName];
        // Absent is the wholly-empty case, which upstream accepts — the warning's business, not this.
        if (creative === undefined) continue;
        const missing = this.googleCreativeShortfall(section.channel, creative);
        if (missing !== null) return `${section.label} creative ${missing}`;
      }
      return null;
    });
  }

  /**
   * The first minimum a non-empty creative fails, as a clause, or null when it meets them all.
   *
   * Three rule kinds, every one of them campaign-service's own and none of them tighter: the
   * catalogued `min` on a list, the `requiredOnce` scalars Google marks required, and the
   * either-or pairs no per-field bound can state ({@link GOOGLE_CREATIVE_EITHER_OR_RULES}).
   * Catalogue order is report order, so the message names the field highest in the section the
   * operator is looking at.
   */
  private googleCreativeShortfall(channel: GoogleCreativeChannel, creative: Record<string, string | GoogleCreativeImageRef[]>): string | null {
    // Widened to the interface, as every other reader of the catalogue does: the constant's
    // `as const` gives each entry a literal type carrying only the keys that entry happens to set,
    // so `field.min` and `field.requiredOnce` are not readable across the union without this.
    const fields: readonly GoogleCreativeFieldSpec[] = GOOGLE_CREATIVE_FIELD_SPECS[channel];
    for (const field of fields) {
      const value = creative[field.control];
      if (field.kind === 'text') {
        // The payload omits a scalar that trims to nothing, so presence IS non-emptiness here.
        if (field.requiredOnce === true && value === undefined) return `needs a ${field.label.toLowerCase()}.`;
        continue;
      }
      const count = Array.isArray(value) ? value.length : 0;
      // The cap on an IMAGE slot is checked here, over pasted URLs AND held images together, because
      // the per-control validator sees only the textarea: a picked image followed by five pasted
      // URLs would otherwise reach upstream as six. `max` on a marketing shape is the channel's
      // combined cap, so a single field over it is over the combined cap too — never tighter.
      if (field.image && field.max !== undefined && count > field.max) {
        return `has ${count} entries in ${field.label} (pasted URLs and stored images together) — ${count - field.max} over the cap of ${field.max}.`;
      }
      if (field.min === undefined) continue;
      if (count < field.min) {
        const entries = field.min === 1 ? 'entry' : 'entries';
        return `needs at least ${field.min} ${entries} in ${field.label} — ${count} given.`;
      }
    }
    const rules: readonly GoogleCreativeEitherOrRule[] = GOOGLE_CREATIVE_EITHER_OR_RULES[channel];
    for (const rule of rules) {
      const satisfied = rule.controls.some((control) => {
        const value = creative[control];
        return Array.isArray(value) && value.length > 0;
      });
      if (!satisfied) return rule.message;
    }
    return null;
  }

  /**
   * Which rendered channels would be created with NO creative at all, as one sentence, or null.
   *
   * Non-blocking on purpose, and that is the whole point of it. campaign-service accepts this
   * shape deliberately — `pmax_creative.go`'s `empty()` docblock records why: a campaign with no
   * asset group is still a real, reconcilable campaign an operator can finish in the Google Ads
   * UI, and refusing it would also refuse ADOPTION of a campaign that already exists upstream with
   * its assets built by hand. Demand Gen adds that every campaign created before the feature
   * existed was that shape. So a guard that blocked here would refuse creates upstream makes.
   *
   * But nothing else ever tells the operator at create time, and the create is not the end of it:
   * on EVERY one of the three channels the refusal simply arrives later, at activation. An empty
   * creative leaves `AdID` blank (`demandgen.go:326`, `display.go:298`), `googleAdsToggleTargets`
   * then yields no targets for a campaign with no ad group list, and the activation gate refuses
   * with `ErrCampaignNotProvisioned` (`internal/dispatch/googleads.go:2561`, `:2687`). Performance
   * Max reaches the same refusal by its own route, through the asset-group check in `ToggleStatus`
   * (`internal/platform/googleads/pmax.go`). So the campaign and its budget are created, the call
   * returns success, and the status toggle will later reject it — a warning beneath the creative
   * sections is the only place that fact fits.
   *
   * Reads the same {@link googleCreativePayload} the blocking check does, so the two agree on what
   * empty means and no channel can be both empty and short of a minimum.
   */
  private initGoogleCreativeEmptyWarning(): Signal<string | null> {
    return computed(() => {
      void this.campaignFormRevision();
      const payload = this.googleCreativePayload();
      const empty = this.googleCreativeSections().filter((section) => payload[section.groupName] === undefined);
      if (empty.length === 0) return null;
      const names = empty.map((section) => section.label).join(' and ');
      const verb = empty.length === 1 ? 'has' : 'have';
      const sentence = `${names} ${verb} no creative. The campaign and its budget are still created, but it cannot serve until the assets are added AND the campaign is enabled in Google Ads.`;
      // Claimed unconditionally because it is true of every empty channel, not just Performance
      // Max: the activation gate refuses a campaign whose ad never got created just as it refuses
      // one whose asset group never did.
      //
      // "Enabled in Google Ads" rather than "then activate here", because the refusal never
      // lifts. Both gate inputs come from the persisted `Result` blob — `googleAdsToggleTargets`
      // (`internal/dispatch/googleads.go:2687`) and `googleAdsToggleAssetGroup` (`:2614`) return
      // early on an empty `Result`, and the call site states it (`:2083-2089`). Nothing re-reads
      // Google, so creative added by hand upstream is never discovered here.
      return `${sentence} Activating it from LFX stays refused even after that, so launch it in Google Ads.`;
    });
  }

  /** `{ videoGoal }` for a Video Views campaign with a usable goal, otherwise `{}`. */
  private redditVideoGoalPayload(): { videoGoal?: RedditVideoGoal } {
    const goal = this.redditEffectiveVideoGoal();
    return this.redditNeedsVideoGoal() && goal ? { videoGoal: goal } : {};
  }

  /**
   * That a Reddit create is about to make a campaign with no ad in it, or null when it is not.
   *
   * The pre-submit half of a sentence this product only ever said afterwards. The created-campaigns
   * list already carries `implementation-reddit-no-ad-notice` once `adCount` comes back 0, which is
   * after the campaign, its ad group and its budget exist and the operator has nothing left to
   * change. This says the same thing while a post URL can still be typed.
   *
   * A warning and not a block, for the reason {@link initGoogleCreativeEmptyWarning} is one: both
   * creators ACCEPT this shape and report success, so refusing it here would refuse a create the
   * platform makes. The legacy creator's no-post branch is a documented workflow in its own right —
   * it writes the variant headlines into `steps` for an operator to paste into Reddit Ads Manager
   * (`reddit-ads.service.ts`) — and `canSubmit` deliberately does not read this.
   *
   * Judged on the two gates the payload itself uses, so the warning can never disagree with what is
   * sent. `postUrl` goes on both arms and creates the ad on either (`reddit-ads.service.ts`,
   * `CreateCampaign` in `internal/platform/reddit/client.go`). `imageUrl` authors a post on either too since
   * #3432, and on both only when no post URL is set — so a typed image now averts this warning,
   * where before it was withheld and withheld meant no ad. It is still read through
   * `redditCreativeAvailable()` rather than on its own: with the capability UNANSWERED the payload
   * drops the image, and a warning that ignored that would promise an ad the request never asks for.
   */
  private initRedditNoAdWarning(): Signal<string | null> {
    return computed(() => {
      if (!this.showRedditSection()) return null;
      if (this.redditPostUrl()) return null;
      if (Object.keys(this.redditImageField()).length > 0) return null;
      // Names only the fields the operator can actually see: with the authored-post controls
      // withheld, an image URL is not a remedy and telling them to supply one would be advice they
      // cannot take.
      const missing = this.redditCreativeAvailable() ? 'No post URL and no image URL' : 'No post URL';
      // "Will not change that" rather than "stays refused", for the reason the post-submit sibling
      // was corrected to the same wording in #3451: the clause has to hold on BOTH arms and the
      // refusal is campaign-service's alone. There activation needs both child ids
      // (`RedditDispatcher.ToggleStatus` in `internal/dispatch/reddit.go`), taken from
      // `redditChildIDs` in the same file, which
      // reads only the persisted Result blob — nothing re-reads Reddit, so an ad attached by hand
      // is never discovered and the refusal never lifts. The legacy toggle has no ad-existence
      // guard at all (`campaign-proxy.service.ts`) and goes through to a campaign with nothing to
      // serve. Either way activating accomplishes nothing, which is what the operator needs to know.
      return `${missing}, so this campaign is created with no ad: the campaign and its ad group are made and the create reports success, but nothing serves. Activating it from LFX will not change that, so either supply a post above or build and launch the campaign in Reddit Ads Manager.`;
    });
  }

  /**
   * The bidding plan as the request carries it, or `{}` when there is nothing to send.
   *
   * Gated by the SAME computeds the template renders, so what the operator can see is exactly what
   * is sent: a target typed under one strategy and then abandoned under another is withheld rather
   * than forwarded into a refusal. The strategy itself is sent only when the operator chose one the
   * channel accepts — leaving it out is how the channel default is reached, the same absent-key
   * route `geoTargets` and the flight window take.
   */
  private googleBiddingPayload(): Partial<CampaignCreateRequest> {
    const channel = this.googleBiddingChannel();
    if (!channel) return {};
    const form = this.campaignForm.controls;
    const payload: Partial<CampaignCreateRequest> = {};

    const chosen = form.googleBiddingStrategy.value.trim();
    const accepted = GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL[channel] as readonly GoogleBiddingStrategy[];
    const strategy = accepted.find((candidate) => candidate === chosen);
    if (strategy) payload.biddingStrategy = strategy;

    if (this.googleTakesCpcBid()) {
      const cpcBid = this.googleBidAmount(form.googleCpcBid.value);
      if (cpcBid !== undefined) payload.cpcBid = cpcBid;
    }
    if (this.googleTakesTargetCpa()) {
      const targetCpa = this.googleBidAmount(form.googleTargetCpa.value);
      if (targetCpa !== undefined) payload.targetCpa = targetCpa;
    }
    if (this.googleTakesTargetRoas()) {
      const targetRoas = this.googleBidAmount(form.googleTargetRoas.value);
      if (targetRoas !== undefined) payload.targetRoas = targetRoas;
    }
    if (this.googleTakesConversionActions()) {
      const actions = this.splitCreativeLines(form.googleConversionActions.value);
      if (actions.length > 0) payload.conversionActions = actions;
    }
    return payload;
  }

  /**
   * The language narrowing as the request carries it, or `{}` when there is nothing to send.
   *
   * Gated by `googleLanguagesChannel`, the SAME computed the template's chips section opens on, so
   * a list picked under one channel and then abandoned under another is withheld rather than
   * forwarded into a refusal. An empty list is withheld too, by the absent-key route `geoTargets`
   * and the flight window take: upstream reads an absent `languages` as Google's own default of
   * every language, so sending `[]` would be a narrowing the operator never asked for.
   */
  private googleLanguagesPayload(): Partial<CampaignCreateRequest> {
    if (!this.googleLanguagesChannel()) return {};
    const languages = this.googleLanguages();
    return languages.length > 0 ? { languages: [...languages] } : {};
  }

  /**
   * The radius targets as the request carries them, or `{}` when there is nothing to send.
   *
   * Gate and omit-when-empty are {@link googleLanguagesPayload}'s, through
   * `googleDispatchedProximityTargets` — the SAME list {@link googleEffectiveGeoTargets} reads to
   * decide whether the event-country fallback applies, so the two halves of the location plan cannot
   * disagree about whether a radius is being sent. Entries copied, as the sitelinks are.
   */
  private googleProximityPayload(): Partial<CampaignCreateRequest> {
    const targets = this.googleDispatchedProximityTargets();
    return targets.length > 0 ? { proximityTargets: targets.map((t) => ({ ...t })) } : {};
  }

  /**
   * The location picker's search, debounced off {@link googleGeoSearchQuery} and answered as a state
   * rather than a bare list, so the template can tell "nothing matched" from "the search failed".
   *
   * The delay sits INSIDE the outer `switchMap`, not before it. Every new query therefore cancels the
   * request still in flight for the previous one and clears its rows at once (`startWith`), and only
   * then waits out the debounce. With `debounceTime` in front instead, the old request stayed
   * subscribed for the whole pause and its answer — for text the operator had already changed — could
   * land as pickable rows. A blank query, no active project, or the picker not being offered answers
   * the empty state without a request, the last because a query typed before the capability flipped
   * off must not reach a 404 route.
   */
  private initGoogleGeoSearchState(): Signal<GoogleAdsGeoTargetSearchState> {
    // A FRESH object every time, never one shared constant: `toSignal` drops an update equal by
    // reference to the last, so a second blank completion would set no new suggestions and leave
    // PrimeNG in its loading state with no request out.
    const idle = (): GoogleAdsGeoTargetSearchState => ({ suggestions: [], truncated: false, failed: false, pending: false });
    // The project and the picker's availability are read INSIDE the trigger, not at search time, so a
    // foundation switch or the capability going away cancels a search mid-debounce and clears its
    // answer, rather than finishing it for the previous project and showing that on the next open.
    const trigger = computed(() => ({
      query: this.googleGeoSearchQuery(),
      projectSlug: this.activeFoundationSlug(),
      available: this.googleGeoSearchAvailable(),
    }));
    return toSignal(
      toObservable(trigger).pipe(
        switchMap(({ query, projectSlug, available }) => {
          if (query === '' || projectSlug === '' || !available) return of(idle());
          return timer(GOOGLE_ADS_GEO_SEARCH_DEBOUNCE_MS).pipe(
            switchMap(() =>
              this.campaignService.searchGoogleAdsGeoTargets(projectSlug, query, { limit: GOOGLE_ADS_GEO_SEARCH_PICKER_LIMIT }).pipe(
                map(
                  (result): GoogleAdsGeoTargetSearchState => ({ suggestions: result.suggestions, truncated: result.truncated, failed: false, pending: false })
                ),
                catchError(() => of<GoogleAdsGeoTargetSearchState>({ suggestions: [], truncated: false, failed: true, pending: false }))
              )
            ),
            startWith<GoogleAdsGeoTargetSearchState>({ suggestions: [], truncated: false, failed: false, pending: true })
          );
        })
      ),
      { initialValue: idle() }
    );
  }

  /**
   * One radius sub-form box as a number: `null` when it is empty (not filled in yet), `NaN` when it
   * is not a plain decimal. The shape is checked BEFORE `Number()`, which would also accept `0x1A`,
   * `0b11` and `1e2` and put a value on the chip the operator never typed.
   */
  private parseGoogleProximityNumber(text: string): number | null {
    const trimmed = googleAdsTrimSpace(text);
    if (trimmed === '') return null;
    return GOOGLE_ADS_DECIMAL_NUMBER_PATTERN.test(trimmed) ? Number(trimmed) : Number.NaN;
  }

  /**
   * The audience segments as the request carries them, or `{}` when there is nothing to send.
   *
   * Gated by `googleAudienceSegmentsAvailable`, the SAME computed the section opens on, so a list
   * entered under Search and then left behind by a channel switch is withheld rather than forwarded
   * into a refusal. Omitted rather than sent empty, by the absent-key route every caller predating
   * the field takes.
   */
  private googleAudienceSegmentsPayload(): Partial<CampaignCreateRequest> {
    if (!this.googleAudienceSegmentsAvailable()) return {};
    const segments = this.googleAudienceSegments();
    return segments.length > 0 ? { audienceSegments: [...segments] } : {};
  }

  /**
   * The callout extensions as the request carries them, or `{}` when there is nothing to send.
   *
   * Gated by {@link googleCalloutsAvailable} — the same computed the section renders on — so what
   * the operator can see is exactly what is sent. A list typed under Search and then abandoned by
   * unticking it is WITHHELD, not forwarded: upstream's `validateAssetPlan` refuses the whole
   * extension set on any other channel at preflight, before the budget mutate, so forwarding it
   * would turn a servable create into no campaign at all.
   *
   * Omitted rather than sent empty when the list is empty, so the upstream default is reached by
   * the absent-key route every caller predating this field takes — the same rule as `geoTargets`
   * and the flight window.
   */
  private googleCalloutsPayload(): Partial<CampaignCreateRequest> {
    if (!this.googleCalloutsAvailable()) return {};
    const callouts = this.googleCallouts();
    return callouts.length > 0 ? { callouts: [...callouts] } : {};
  }

  /**
   * The sitelink extensions as the request carries them, or `{}` when there is nothing to send.
   *
   * Gate, withholding and omit-when-empty are {@link googleCalloutsPayload}'s exactly. The entries
   * are COPIED rather than passed by reference, so a later chip edit cannot reach a request that
   * has already been built.
   */
  private googleSitelinksPayload(): Partial<CampaignCreateRequest> {
    if (!this.googleCalloutsAvailable()) return {};
    const sitelinks = this.googleSitelinks();
    return sitelinks.length > 0 ? { sitelinks: sitelinks.map((s) => ({ ...s })) } : {};
  }

  /**
   * The structured snippets as the request carries them, or `{}` when there is nothing to send.
   *
   * Gate, withholding and omit-when-empty are {@link googleCalloutsPayload}'s exactly. `values` is
   * copied as its own array, not just the entry around it — a shallow spread would hand the request
   * the very array the chip list is still holding.
   */
  private googleStructuredSnippetsPayload(): Partial<CampaignCreateRequest> {
    if (!this.googleCalloutsAvailable()) return {};
    const snippets = this.googleStructuredSnippets();
    return snippets.length > 0 ? { structuredSnippets: snippets.map((s) => ({ ...s, values: [...s.values] })) } : {};
  }

  /**
   * The call, promotion and price extensions as the request carries them, each key omitted when its
   * list is empty.
   *
   * Gate, withholding and omit-when-empty are {@link googleCalloutsPayload}'s exactly. Every entry is
   * COPIED, and a price table's rows with it — the rows are an array inside the entry, as a
   * snippet's values are.
   */
  private googleAssetExtensionsPayload(): Partial<CampaignCreateRequest> {
    if (!this.googleCalloutsAvailable()) return {};
    const calls = this.googleCallExtensions();
    const promotions = this.googlePromotions();
    const prices = this.googlePrices();
    return {
      ...(calls.length > 0 ? { callExtensions: calls.map((c) => ({ ...c })) } : {}),
      ...(promotions.length > 0 ? { promotions: promotions.map((p) => ({ ...p })) } : {}),
      ...(prices.length > 0 ? { prices: this.copyGooglePrices(prices) } : {}),
    };
  }

  /**
   * Whether a destination URL is one the ad platforms will serve.
   *
   * The accept set itself is {@link isGoogleAdsServableUrl}, which the brief-restore path
   * (`asSitelinks` in `campaign-service.service.ts`) also calls. The controller's dispatch refusal,
   * `googleSitelinkUrlRefusal`, does NOT: it goes through its own `describeDestinationUrl`, which
   * judges brief destinations for all five platforms and reports WHICH refusal a URL hits so the
   * error message can name it. That second copy of the accept set is kept in step BY HAND, and this
   * tier must never be the stricter of the two — a URL this guard refuses and that one would accept
   * is refused with no explanation at all, because the message that would have named the reason
   * only exists on the path that never runs.
   *
   * The trim stays at this tier rather than moving into the shared predicate: the trimmed value is
   * what {@link addGoogleSitelink} goes on to STORE, so this must judge exactly the string it keeps.
   */
  private isServableDestination(raw: string): boolean {
    return isGoogleAdsServableUrl(googleAdsTrimSpace(raw));
  }

  /** The call sub-form's text as upstream normalises it: both boxes trimmed, the country upper-cased. */
  private googleCallExtensionFromDraft(draft: CampaignCallExtensionDraft): CampaignCallExtension {
    return { countryCode: googleAdsToUpperCode(googleAdsTrimSpace(draft.countryCode)), phoneNumber: googleAdsTrimSpace(draft.phoneNumber) };
  }

  /**
   * One typed amount: `undefined` for an empty box, otherwise `Number` of the trimmed text — NaN
   * included, so a box holding "ten" reaches the shared judge and is refused by name rather than
   * read as "not filled in".
   */
  private googleAssetAmount(raw: string): number | undefined {
    const text = googleAdsTrimSpace(raw);
    return text === '' ? undefined : Number(text);
  }

  /**
   * The promotion sub-form as the entry it would add. Only the arm of each oneof the form selected
   * is read, so text left in a box the operator switched away from is never sent; a zero amount is
   * left off, as upstream reads zero as unset; and the currency is carried only when a money field
   * uses it, the one case upstream reads it.
   */
  private googlePromotionFromDraft(draft: CampaignPromotionDraft): CampaignPromotion {
    const promotion: CampaignPromotion = { promotionTarget: googleAdsTrimSpace(draft.promotionTarget), finalUrl: googleAdsTrimSpace(draft.finalUrl) };
    const discount = this.googleAssetAmount(draft.discount);
    if (discount !== undefined && discount !== 0) promotion[draft.discountKind === 'percent' ? 'discountPercent' : 'discountAmount'] = discount;
    if (draft.eligibilityKind === 'code') {
      const code = googleAdsTrimSpace(draft.promotionCode);
      if (code !== '') promotion.promotionCode = code;
    }
    if (draft.eligibilityKind === 'ordersOver') {
      const ordersOver = this.googleAssetAmount(draft.ordersOverAmount);
      if (ordersOver !== undefined && ordersOver !== 0) promotion.ordersOverAmount = ordersOver;
    }
    if (promotion.discountAmount !== undefined || promotion.ordersOverAmount !== undefined) {
      const currency = googleAdsToUpperCode(googleAdsTrimSpace(draft.currencyCode));
      if (currency !== '') promotion.currencyCode = currency;
    }
    for (const field of ['occasion', 'languageCode', 'startDate', 'endDate', 'redemptionStartDate', 'redemptionEndDate'] as const) {
      const value = googleAdsTrimSpace(draft[field]);
      if (value !== '') promotion[field] = value;
    }
    return promotion;
  }

  /**
   * Why the condition the promotion form SELECTED is unusable, or `null`. Upstream treats both
   * conditions as optional, so an empty code box or a zero minimum order would pass its check — by
   * being dropped, and the ad would then advertise an unconditional offer while the select still
   * names a condition. Only the explicit "No condition" choice may produce one.
   */
  private googlePromotionConditionRefusal(draft: CampaignPromotionDraft): string | null {
    if (draft.eligibilityKind === 'code' && googleAdsTrimSpace(draft.promotionCode) === '') return 'Enter the promotion code, or choose No condition.';
    if (draft.eligibilityKind === 'ordersOver') {
      const ordersOver = this.googleAssetAmount(draft.ordersOverAmount);
      if (ordersOver === undefined || ordersOver === 0) return 'Enter a minimum order amount greater than 0, or choose No condition.';
    }
    return null;
  }

  /** The price sub-form as the entry it would add, the table's currency copied onto every row. */
  private googlePriceFromDraft(draft: CampaignPriceExtensionDraft): CampaignPriceExtension {
    const currencyCode = googleAdsToUpperCode(googleAdsTrimSpace(draft.currencyCode));
    const qualifier = googleAdsTrimSpace(draft.priceQualifier);
    return {
      type: googleAdsTrimSpace(draft.type),
      ...(qualifier !== '' ? { priceQualifier: qualifier } : {}),
      languageCode: googleAdsTrimSpace(draft.languageCode),
      offerings: draft.offerings.map((row) => {
        const unit = googleAdsTrimSpace(row.unit);
        return {
          header: googleAdsTrimSpace(row.header),
          description: googleAdsTrimSpace(row.description),
          // An empty box is already withheld by `googlePriceDraftFilled`; NaN here only for text.
          amount: this.googleAssetAmount(row.amount) ?? Number.NaN,
          currencyCode,
          ...(unit !== '' ? { unit } : {}),
          finalUrl: googleAdsTrimSpace(row.finalUrl),
        };
      }),
    };
  }

  /** Whether every box a price table requires holds something — not yet whether it is valid. */
  private googlePriceDraftFilled(draft: CampaignPriceExtensionDraft): boolean {
    if ([draft.type, draft.languageCode, draft.currencyCode].some((text) => googleAdsTrimSpace(text) === '')) return false;
    return draft.offerings.every((row) => [row.header, row.description, row.amount, row.finalUrl].every((text) => googleAdsTrimSpace(text) !== ''));
  }

  /** "25% off · code SPRING" — the discount and its condition, as a promotion row reads on screen. */
  private googlePromotionDetail(promotion: CampaignPromotion): string {
    const discount =
      promotion.discountPercent !== undefined ? `${promotion.discountPercent}% off` : `${promotion.discountAmount} ${promotion.currencyCode ?? ''} off`.trim();
    const parts = [discount];
    if (promotion.promotionCode) parts.push(`code ${promotion.promotionCode}`);
    if (promotion.ordersOverAmount !== undefined) parts.push(`orders over ${promotion.ordersOverAmount} ${promotion.currencyCode ?? ''}`.trim());
    if (promotion.occasion) parts.push(promotion.occasion);
    return parts.join(' · ');
  }

  /** Price tables copied with their rows, so no list shares a row array with another. */
  private copyGooglePrices(prices: readonly CampaignPriceExtension[]): CampaignPriceExtension[] {
    return prices.map((price) => ({ ...price, offerings: price.offerings.map((row) => ({ ...row })) }));
  }

  private emptyGooglePromotionDraft(): CampaignPromotionDraft {
    return {
      promotionTarget: '',
      discountKind: 'percent',
      discount: '',
      eligibilityKind: 'none',
      promotionCode: '',
      ordersOverAmount: '',
      currencyCode: '',
      occasion: '',
      languageCode: '',
      startDate: '',
      endDate: '',
      redemptionStartDate: '',
      redemptionEndDate: '',
      finalUrl: '',
    };
  }

  /** One empty price row's controls. */
  private googlePriceRowGroup(): FormGroup<{ [K in keyof CampaignPriceOfferingDraft]: FormControl<string> }> {
    return this.fb.nonNullable.group<CampaignPriceOfferingDraft>({ header: '', description: '', amount: '', unit: '', finalUrl: '' });
  }

  /**
   * A sub-form's raw value as a signal, re-read on every change — including a row pushed onto or
   * removed from the price table's `FormArray`, which `valueChanges` also reports.
   */
  private initFormDraft<T>(form: { valueChanges: Observable<unknown>; getRawValue(): T }): Signal<T> {
    return toSignal(form.valueChanges.pipe(map(() => form.getRawValue())), { initialValue: form.getRawValue() });
  }

  /** One typed bidding number, or `undefined` when the field is blank or cannot be a number. */
  private googleBidAmount(raw: string): number | undefined {
    const text = raw.trim();
    if (text === '') return undefined;
    const value = Number(text);
    return Number.isFinite(value) && value !== 0 ? value : undefined;
  }

  /**
   * One nested form group for a channel's creative, one control per catalogued field.
   *
   * Every control is a STRING, including the list fields, which hold one entry per line. The
   * alternative — a `FormArray` with add/remove rows per list — was rejected on size: Performance
   * Max alone has seven list fields with caps up to twenty, and a row UI across all three channels
   * runs to thousands of lines of template for a form whose list entries are mostly pasted image
   * URLs. `splitCreativeLines` is the single place that turns the text back into the array the
   * wire carries.
   */
  private buildCreativeGroup(channel: (typeof GOOGLE_CHANNELS_WITH_CREATIVE)[number]): FormGroup<Record<string, FormControl<string>>> {
    const controls: Record<string, FormControl<string>> = {};
    for (const field of GOOGLE_CREATIVE_FIELD_SPECS[channel]) {
      controls[field.control] = this.fb.nonNullable.control('', this.creativeFieldValidators(field));
    }
    return new FormGroup(controls);
  }

  /**
   * The bounds a creative field is validated against — `max` and `width`, never `min`.
   *
   * `min` is deliberately absent, and so is `requiredOnce`. campaign-service ACCEPTS a channel with
   * no creative at all, and a validator carrying either one would refuse a create that upstream
   * would have made: an operator who wants the campaign and budget now, and the assets later, is
   * doing something the platform supports. A control validator cannot tell the two cases apart —
   * it sees one control and never the group — which is exactly why the floor is enforced at submit
   * by {@link googleCreativeError}, where the whole creative is in view and the empty one can be
   * let through.
   *
   * `max` and `width` are the other direction: both are hard upstream bounds, so enforcing them
   * refuses only what Google would have refused anyway — after the campaign already exists, which
   * is the expensive place to find out.
   */
  private creativeFieldValidators(field: GoogleCreativeFieldSpec): ValidatorFn[] {
    if (field.kind === 'text') {
      return field.width === undefined ? [] : [this.creativeTextBounds(field.width)];
    }
    return [this.creativeListBounds(field)];
  }

  /**
   * The guidance line under a creative field: its bounds, then anything its catalogue entry adds.
   *
   * Assembled here rather than in the template because the sentence depends on which bounds the
   * field actually has — a `@if` ladder over four combinations in the template would say the same
   * thing in four places, and the repo forbids the nested ternary that would otherwise compress it.
   *
   * Called from {@link initGoogleCreativeSections} and never from the template: every input is the
   * static catalogue entry, so the answer cannot change between two change-detection passes and a
   * method on the render path would be re-deriving a constant.
   *
   * `min` is stated here as guidance, and enforced elsewhere: no control validator carries it
   * ({@link creativeFieldValidators} explains why), but {@link googleCreativeError} refuses a
   * half-filled creative at submit. This line is what tells the operator the floor exists BEFORE
   * they run into it — the message beneath the creative sections names one field at a time, and
   * only after the creative has been started.
   */
  private creativeFieldGuidance(field: GoogleCreativeFieldSpec): string {
    const parts: string[] = [];
    if (field.kind === 'text') {
      if (field.width !== undefined) parts.push(`Up to ${field.width} characters.`);
    } else {
      if (field.min !== undefined && field.max !== undefined) parts.push(`${field.min}–${field.max} entries, one per line.`);
      else if (field.max !== undefined) parts.push(`Up to ${field.max} entries, one per line.`);
      else if (field.min !== undefined) parts.push(`At least ${field.min} entries, one per line.`);
      else parts.push('One entry per line.');
      if (field.width !== undefined) parts.push(`Up to ${field.width} characters each.`);
    }
    if (field.hint !== undefined) parts.push(field.hint);
    return parts.join(' ');
  }

  /**
   * The error to show beneath a creative field, or null when there is nothing to say.
   *
   * Addressed by path rather than by the typed control tree: `groupName` arrives from a resolved
   * {@link GoogleCreativeSection} as a plain string, so `get([group, control])` is the lookup that
   * survives a channel being added to the catalogue without a change here.
   *
   * Only shown once the field has been touched — every one of these controls starts empty and valid,
   * and an untouched field has no error to report anyway.
   */
  private creativeFieldError(groupName: string, field: GoogleCreativeFieldSpec): string | null {
    const control = this.campaignForm.get([groupName, field.control]);
    if (!control?.touched) return null;
    const errors = control.errors;
    if (!errors) return null;
    if (errors['creativeListMax']) return `At most ${errors['creativeListMax'].max} entries — ${errors['creativeListMax'].actual} given.`;
    if (errors['creativeListWidth']) return `Each entry must be ${errors['creativeListWidth'].width} characters or fewer.`;
    if (errors['maxlength']) return `Must be ${errors['maxlength'].requiredLength} characters or fewer.`;
    return null;
  }

  /**
   * The width bound for a scalar text field, measured on the TRIMMED value.
   *
   * `Validators.maxLength` would measure the raw control value, and the payload builder
   * ({@link googleCreativePayload}) trims before it sends — so a value at exactly the width with a
   * trailing space would be refused here while the string that would actually have gone upstream
   * was inside the bound. That is a client refusing a create campaign-service would have accepted,
   * which is the one thing no guard on this road may do. The list validator has always measured
   * trimmed entries ({@link splitCreativeLines} trims each line); this makes the scalar fields
   * agree with it and with the wire.
   *
   * Measured in CODE POINTS, not UTF-16 units, because `String.length` disagrees with BOTH of the
   * regimes campaign-service measures these widths in on every non-BMP character. Upstream counts
   * `assetGroupName` and `callToActionText` with `utf8.RuneCountInString` — a straight rune count —
   * and every other scalar with `textWeight` (`demandgen_creative.go:406`), which sums
   * `googleAdsCharWeight` per rune and so charges a wide character 2. The two are not the same
   * number, and this validator matches neither exactly; it does not have to. Every rune weighs at
   * least 1, so the code-point count is a LOWER BOUND on the display weight and never exceeds the
   * rune count, which puts this bound on the permissive side of both — it can fail to catch a
   * refusal upstream will make, which costs a round trip, but it can never refuse a create upstream
   * would have accepted. `String.length` has no such guarantee: at a width of 30, a 16-emoji
   * headline is 32 UTF-16 units and 16 runes, so measuring it the JS way refuses a value upstream
   * counts as 16 and accepts. (15 emoji is exactly 30 units and squeaks through the old check —
   * the over-refusal starts at the first emoji past half the width.) Same over-refusal the
   * trimming above exists to avoid, one layer down.
   * {@link codePointLength} is the shared helper for this and is documented as `len([]rune(s))`;
   * the Microsoft keyword box documents the same hazard.
   *
   * Local rather than the shared `maxCodePointsValidator`, which trims and counts code points
   * identically, for one reason: that validator reports its own `maxCodePoints` error key, and
   * every message in {@link creativeFieldError} reads Angular's `maxlength` shape. Keeping
   * `{ requiredLength, actualLength }` is what lets the width change without touching the error
   * rendering at all. `actualLength` reports the trimmed code-point count, which is the number the
   * bound was actually applied to.
   */
  private creativeTextBounds(width: number): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const text = typeof control.value === 'string' ? control.value.trim() : '';
      const length = codePointLength(text);
      if (length <= width) return null;
      return { maxlength: { requiredLength: width, actualLength: length } };
    };
  }

  /**
   * Per-line bounds for a list field, which `Validators.maxLength` cannot express: the control
   * holds one multi-line string, so its own length is the sum of every entry plus the newlines,
   * and bounding that would refuse five short headlines for being long together.
   */
  private creativeListBounds(field: GoogleCreativeFieldSpec): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const lines = this.splitCreativeLines(control.value as string);
      if (field.max !== undefined && lines.length > field.max) {
        return { creativeListMax: { label: field.label, max: field.max, actual: lines.length } };
      }
      if (field.width !== undefined && lines.some((line) => codePointLength(line) > (field.width as number))) {
        return { creativeListWidth: { label: field.label, width: field.width } };
      }
      return null;
    };
  }

  /**
   * The creative objects for the submit payload, built from the nested groups.
   *
   * Shape-never-content, matching the BFF normalizer it feeds: a field that trims to nothing is
   * OMITTED rather than sent as `''` or `[]`, and a channel whose whole creative is empty emits no
   * key at all — because an empty array is a positive statement ("no images") where absence means
   * "none asked for", and upstream treats the two differently on the reciprocal image fields.
   *
   * Which channels it walks comes from `googleCreativeSections()` — the SAME signal the template
   * renders — rather than from a second reading of the ticked channels. The two conditions had
   * already diverged: the sections withhold everything on the legacy road and drop Demand Gen
   * beside Search, while a `channels.includes(...)` test knows neither rule and would put a
   * creative on the wire that the operator was never shown. Reading the rendered set makes "we
   * send only what could be seen" true by construction instead of by two gates agreeing.
   */
  private googleCreativePayload(): Record<string, Record<string, string | GoogleCreativeImageRef[]>> {
    const payload: Record<string, Record<string, string | GoogleCreativeImageRef[]>> = {};
    for (const { channel } of this.googleCreativeSections()) {
      const groupName = GOOGLE_CREATIVE_REQUEST_KEYS[channel];
      const raw = this.campaignForm.controls[groupName].getRawValue() as Record<string, string | null | undefined>;
      const creative: Record<string, string | GoogleCreativeImageRef[]> = {};
      // Widened for `image`, which only the image entries of the `as const` catalogue carry.
      const fields: readonly GoogleCreativeFieldSpec[] = GOOGLE_CREATIVE_FIELD_SPECS[channel];
      for (const field of fields) {
        const value = raw[field.control] ?? '';
        if (field.kind === 'list') {
          // An image slot's stored images ride AFTER its pasted URLs, in the same array — the wire
          // shape campaign-service decodes (`googleAdsImageRef`) — so the minimums and the empty
          // check below count them like any other entry.
          const entries: GoogleCreativeImageRef[] = [
            ...this.splitCreativeLines(value),
            ...(field.image ? this.googleImageRefsFor(`${groupName}.${field.control}`) : []),
          ];
          if (entries.length > 0) creative[field.control] = entries;
          continue;
        }
        const trimmed = value.trim();
        if (trimmed !== '') creative[field.control] = trimmed;
      }
      if (Object.keys(creative).length > 0) payload[groupName] = creative;
    }
    return payload;
  }

  /**
   * All three creative groups' raw text, for the draft.
   *
   * A fresh object per group rather than the group's own value, so the parent holds a snapshot and
   * not a live view of a form this component is about to destroy — the same rule the Meta and
   * Microsoft blocks in `emitDraft` follow.
   */
  private googleCreativeSnapshot(): Record<string, Record<string, string>> {
    const snapshot: Record<string, Record<string, string>> = {};
    for (const channel of GOOGLE_CHANNELS_WITH_CREATIVE) {
      snapshot[GOOGLE_CREATIVE_REQUEST_KEYS[channel]] = { ...this.campaignForm.controls[GOOGLE_CREATIVE_REQUEST_KEYS[channel]].getRawValue() };
    }
    return snapshot;
  }

  /**
   * Replay a draft's creative text into the three groups.
   *
   * Field-by-field rather than `patchValue` on the whole record, because the draft is persisted
   * JSON: it can name a group or a field that no longer exists (a field removed from the catalogue
   * since the draft was saved), and Angular throws on a patch naming a control that is not there.
   * Skipping the unknown ones restores everything that still exists instead of losing the whole
   * restore to one stale key.
   *
   * `emitEvent: false` matches the copy-array restore just above: nothing derives a display from
   * these controls, and letting a dozen patches through would recompute the campaign-name preview
   * once per field for no gain.
   */
  private restoreGoogleCreatives(saved: Record<string, Record<string, string>>): void {
    for (const channel of GOOGLE_CHANNELS_WITH_CREATIVE) {
      const groupName = GOOGLE_CREATIVE_REQUEST_KEYS[channel];
      const values = saved[groupName];
      if (!values) continue;
      const group = this.campaignForm.controls[groupName];
      for (const field of GOOGLE_CREATIVE_FIELD_SPECS[channel]) {
        const value = values[field.control];
        if (typeof value !== 'string') continue;
        group.controls[field.control].setValue(value, { emitEvent: false });
      }
    }
  }

  /**
   * The rest of a platform's config its bidding rules read: Meta's objective and DAILY budget (a
   * lifetime budget has no 5× rule), Reddit's objective. The same signals `submit` sends, so the
   * check and the request cannot disagree.
   */
  private biddingContext(platform: CampaignBiddingPlatform): CampaignBiddingContext {
    switch (platform) {
      case 'meta-ads':
        return { objective: this.metaObjective(), dailyBudget: this.metaLifetimeBudget() ? null : this.metaBudgetUsd() };
      case 'reddit-ads':
        return { objective: this.redditObjective() };
      // X's manual bid may not exceed the daily budget (`twitterBidPlan`).
      case 'twitter-ads':
        return { dailyBudget: this.twitterBudgetAmount() };
      default:
        return {};
    }
  }

  /**
   * The `bidding` key for one platform's config (#3299): nothing at all while the control is not
   * offered, otherwise ALWAYS an explicit object — `{"strategy":"automatic"}` or
   * `{"strategy":"manual","bidAmount":N}`. campaign-service treats an explicit automatic exactly as
   * an omitted `bidding`, so the explicit form costs nothing and makes the request say what the
   * screen shows. It also keeps the Microsoft request unambiguous: without `bidding`, a legacy
   * `cpcBid` there means manual. Never `null` and never `''`, which campaign-service refuses.
   */
  private biddingField(platform: CampaignBiddingPlatform): { bidding?: CampaignBiddingConfig } {
    if (!this.biddingAvailable()) return {};
    const bidding = this.biddingPayloads()[platform];
    return bidding === null ? {} : { bidding };
  }

  /**
   * Restores the Meta Instagram id and DSA disclosures, each only when present and a string — the
   * same present-only rule as `restoreGoogleBidding`.
   */
  private restoreMetaInstagramDsa(draft: CampaignImplementationDraft): void {
    const fields = [
      ['metaInstagramUserId', 'instagramUserId'],
      ['metaDsaBeneficiary', 'dsaBeneficiary'],
      ['metaDsaPayor', 'dsaPayor'],
    ] as const;
    const patch: Partial<Record<(typeof fields)[number][1], string>> = {};
    for (const [draftKey, control] of fields) {
      const value = draft[draftKey];
      if (typeof value === 'string') patch[control] = value;
    }
    // ONE emitting patch, unlike `restoreGoogleBidding`: `metaInstagramDsaDraft` (what validation,
    // `submit` and `emitDraft` read) follows this group's `valueChanges`, so a silent write would
    // leave the inputs showing the restored text while every check still saw blanks (PR #4483
    // review). The emit cannot loop: `applyDraft` runs only while `seeding`, which the group's
    // draft subscription honours.
    if (Object.keys(patch).length > 0) this.metaInstagramDsaForm.patchValue(patch);
  }

  /**
   * Why one EU DSA disclosure cannot be sent, or `null` while the capability is off. Mirrors
   * campaign-service's `CheckPublishIdentity`: at most `META_DSA_NAME_MAX_LENGTH` characters
   * (counted as code points, as Go counts runes — which is why the inputs carry no native
   * `maxlength`: the browser counts UTF-16 units and would cut a valid astral-plane name short), no C0/C1 control, Unicode line/paragraph separator
   * or bidi control (its `isLineBreakingOrControl`), and present whenever the
   * other one is OR an EU country is targeted. Trimmed first, as upstream trims.
   */
  private metaDsaFieldError(field: 'dsaBeneficiary' | 'dsaPayor'): string | null {
    if (!this.metaInstagramDsaAvailable()) return null;
    const draft = this.metaInstagramDsaDraft();
    const value = draft[field].trim();
    const other = (field === 'dsaBeneficiary' ? draft.dsaPayor : draft.dsaBeneficiary).trim();
    if ([...value].length > META_DSA_NAME_MAX_LENGTH) return `Enter at most ${META_DSA_NAME_MAX_LENGTH} characters.`;
    // eslint-disable-next-line no-control-regex -- matching control characters is the point.
    if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(value))
      return 'Enter the name on one line, without tabs, line breaks or invisible formatting characters.';
    if (value !== '') return null;
    const eu = this.metaDsaCountries();
    if (eu.length > 0) return `Required when targeting the EU/EEA (${eu.join(', ')}).`;
    if (other !== '') return 'Enter both the beneficiary and the payor, or neither.';
    return null;
  }

  /**
   * Replay a draft's bidding text into the five controls.
   *
   * Only strings are restored, and only keys the draft actually carries. The draft is persisted
   * JSON, so a field can be missing (saved before this section shipped) or the wrong type
   * (hand-edited, or written by an older shape) — and `setValue` on a non-nullable control with a
   * non-string would put a value in the form that every reader here assumes cannot be there.
   *
   * No validation of the STRATEGY name: an unknown or wrong-channel value is restored as typed and
   * resolved away by `googleBiddingStrategy`, so the operator sees what they left rather than a
   * silently blanked picker.
   *
   * `emitEvent: false` matches `restoreGoogleCreatives`: `applyDraft` is replaying a draft, not
   * recording an edit, and five separate change events would re-emit it five times.
   */
  private restoreGoogleBidding(draft: CampaignImplementationDraft): void {
    const fields = ['googleBiddingStrategy', 'googleTargetCpa', 'googleTargetRoas', 'googleCpcBid', 'googleConversionActions'] as const;
    for (const field of fields) {
      const value = draft[field];
      if (typeof value !== 'string') continue;
      this.campaignForm.controls[field].setValue(value, { emitEvent: false });
    }
  }

  /**
   * A one-entry-per-line textarea's value as the entries it stands for.
   *
   * Splits on either newline convention, trims each entry and drops the empties, so a trailing
   * newline or a blank separator line does not become an entry that counts against the cap or
   * reaches the wire as an empty image URL.
   *
   * Shared by the creative list fields and the conversion-action list, which have the same shape
   * on screen and the same shape on the wire.
   */
  private splitCreativeLines(value: string | null | undefined): string[] {
    if (typeof value !== 'string') return [];
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '');
  }
}
