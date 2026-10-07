// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SlicePipe } from '@angular/common';
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
} from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import {
  CAMPAIGN_BUDGET_DEFAULTS,
  CAMPAIGN_CHAR_LIMITS,
  CAMPAIGN_JOB_POLL_INTERVAL_MS,
  LINKEDIN_CHAR_LIMITS,
  LINKEDIN_GEO_RESOLVE_MAP,
  META_CHAR_LIMITS,
  META_DEFAULT_PLACEMENTS,
  META_MESSENGER_INBOX_RETIRED_REASON,
  META_NUMERIC_ID_PATTERN,
  canonicalMicrosoftMatchType,
  isMicrosoftMatchType,
  MICROSOFT_CONTROL_CHAR_RE,
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
  GOOGLE_ADS_GEO_TARGET_MAP,
  GOOGLE_ADS_MAX_CONVERSION_ACTIONS,
  GOOGLE_ADS_MAX_GEO_TARGETS,
  GOOGLE_BIDDING_CPA_STRATEGIES,
  GOOGLE_BIDDING_DEFAULT_BY_CHANNEL,
  GOOGLE_BIDDING_ROAS_STRATEGIES,
  GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL,
  GOOGLE_BIDDING_STRATEGY_LABELS,
  GOOGLE_CAMPAIGN_CHANNELS_REQUIRING_FLAG,
  GOOGLE_CAMPAIGN_NAME_TOKENS,
  GOOGLE_CHANNELS_WITH_CREATIVE,
  GOOGLE_CONVERSION_ACTION_CHANNELS,
  GOOGLE_CREATIVE_FIELD_SPECS,
  GOOGLE_CREATIVE_REQUEST_KEYS,
  GOOGLE_CREATIVE_REQUIRED_NOTICE,
  GOOGLE_CREATIVE_SECTION_TITLES,
  GOOGLE_VIDEO_CREATE_SUPPORTED,
  GOOGLE_VIDEO_CREATE_UNSUPPORTED_REASON,
  REDDIT_MAX_BUDGET_USD,
} from '@lfx-one/shared/constants';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { serverAuthoredMessage } from '@shared/utils/http-error.utils';
import { map, merge, scan, skip, startWith, Subscription, take } from 'rxjs';

import type { Signal } from '@angular/core';
import type {
  CampaignBriefOutput,
  CampaignBriefPersistenceState,
  CampaignCreateRequest,
  CampaignCreateResult,
  CampaignImplementationDraft,
  CampaignJobOutcome,
  CampaignKeyword,
  CampaignPlatform,
  CampaignPlatformResult,
  CampaignType,
  GoogleBiddingOption,
  GoogleBiddingStrategy,
  GoogleCampaignChannel,
  GoogleCreativeFieldSpec,
  GoogleCreativeSection,
  LinkedInAccount,
  LinkedInCreativeVariant,
  LinkedInGeoTarget,
  LinkedInTargetingProfile,
  MetaAdVariant,
  MetaObjective,
  MetaPlacement,
  MicrosoftKeyword,
  RedditAdVariant,
} from '@lfx-one/shared/interfaces';

type ImplementationStep = 'form' | 'creating' | 'results';

/**
 * One campaign-service platform result paired with the three-state outcome the row renders.
 *
 * A local intersection rather than a `@lfx-one/shared` interface: it is this component's view
 * model, derived from `CampaignPlatformResult` and consumed only by this template, so it is not
 * part of any contract between the tiers. Two repo rules meet here and an intersection is the
 * only form satisfying both — AGENTS.md's "all shared constants and interfaces live in `@lfx-one/shared`" rule prohibits the local `interface Foo {}` form inside
 * `apps/lfx-one/`, while ESLint's `@typescript-eslint/consistent-type-definitions` rejects a
 * plain `type X = { … }` object literal.
 */
type PlatformResultRow = CampaignPlatformResult & { outcome: 'created' | 'orphaned' | 'unconfirmed' };

/** See `ImplementationTabComponent.platformOutcomes` for why `ok` alone is not the test. */
function toPlatformResultRow(result: CampaignPlatformResult): PlatformResultRow {
  if (result.ok) {
    return { ...result, outcome: 'created' };
  }
  return { ...result, outcome: result.campaignId ? 'orphaned' : 'unconfirmed' };
}

@Component({
  selector: 'lfx-implementation-tab',
  imports: [ReactiveFormsModule, ButtonComponent, SlicePipe],
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
        // Must carry the SAME information as the visible banner, which tells the user to re-enter
        // the event URL after a reload. Announcing only "Brief saved." gives screen-reader users
        // the reassurance without the instruction — and the instruction is the part they cannot
        // recover on their own, since nothing else on the page says the brief needs a URL to come
        // back.
        //
        // The unapproved message, when there is one, is appended rather than replacing this: the
        // brief IS saved and the reload instruction still applies, so dropping either half would
        // leave a screen-reader user with less than the visible banner shows.
        return `Brief saved. After a reload, re-enter the event URL to restore it.${
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
  protected readonly redditMaxBudget = REDDIT_MAX_BUDGET_USD;
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
    // be destroyed and rebuilt as the operator changes their mind, losing everything typed into it
    // — and `getRawValue()` reports a disabled group, so hiding one in the template costs nothing
    // that has to be paid for here.
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
    linkedInTargetingProfile: ['cloud-native' as LinkedInTargetingProfile],
  });

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
   * `platformResults` with each row's outcome resolved to three states rather than the boolean
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
   * The third state is `unconfirmed`, NOT "not created", and the absence of a `campaign_id` is
   * not evidence that nothing was created. `orchestrator.go` emits `ok: false` with no id for at
   * least four distinct situations: a genuine upstream rejection (:869), a concurrent dispatch
   * that skipped this platform (:780 — which campaign-service explicitly calls a skip, not a
   * failure), and two responses in which an upstream campaign may well exist but its id did not
   * survive — "dispatcher returned no campaign" (:879) and "dispatcher returned no upstream
   * campaign id" (:887). Rendering all four as a definite "not created" tells an ED that no paid
   * artifact exists, and their next move is to create a second one that really does spend money.
   *
   * So the row states what is known — this platform's campaign could not be confirmed — and
   * leaves the reader to check. That over-warns on the genuine-rejection and skip cases, which is
   * the cheap direction: a needless look at the ad account costs a minute, a duplicate paid
   * campaign costs budget. Note the skip is NOT detected by matching its human-readable sentence;
   * the wire has no dedicated `skipped` field yet (LFXV2-2665 tracks adding one) and a message
   * reworded upstream would silently flip the UI's verdict.
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
   * The negative case is headed "Campaign Status Unconfirmed" rather than "No Campaigns Created"
   * for the same reason the row state is named `unconfirmed`: a heading is the one line a reader
   * acts on without reading further, and this one must not assert an absence nobody verified.
   */
  protected readonly anyPlatformCreated = computed(() => this.platformOutcomes().some((r) => r.outcome !== 'unconfirmed'));

  protected readonly errors = signal<string[]>([]);
  protected readonly briefKeywords = signal<CampaignKeyword[]>([]);
  protected readonly briefHsToken = signal<string | null>(null);
  protected readonly briefDriveFolderUrl = signal('');
  protected readonly selectedPlatforms = signal<CampaignPlatform[]>(['google-ads']);
  protected readonly linkedInVariants = signal<LinkedInCreativeVariant[]>([]);
  protected readonly linkedInBudgetUsd = signal(500);
  protected readonly linkedInLifetimeBudget = signal(false);
  protected readonly linkedInAccounts = signal<LinkedInAccount[]>([]);
  protected readonly linkedInAccountsLoading = signal(false);
  protected readonly redditVariants = signal<RedditAdVariant[]>([]);
  protected readonly redditSubreddits = signal<string[]>([]);
  protected readonly redditInterests = signal<string[]>([]);
  protected readonly redditKeywords = signal<string[]>([]);
  protected readonly redditGeoTargets = signal<string[]>([]);
  protected readonly redditBudgetUsd = signal(500);
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
  protected readonly microsoftBudgetUsd = signal(500);
  protected readonly microsoftCpcBid = signal('');
  /**
   * Google's own geo targets, as ISO-2 country codes.
   *
   * A SEPARATE list from the form's single `countryCode`, not a replacement for it. `countryCode` is
   * read by five other things — the campaign-name region token, the Meta, Microsoft and Reddit geo
   * fallbacks, and the draft — and widening it to a list would change what every one of them
   * targets. This list is additive: empty means "use the event country", exactly as before.
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
  protected readonly metaVariants = signal<MetaAdVariant[]>([]);
  protected readonly metaGeoTargets = signal<string[]>([]);
  protected readonly metaBudgetUsd = signal(500);
  protected readonly metaLifetimeBudget = signal(false);
  /**
   * Meta campaign objective. Defaults to `traffic`, matching what campaign-service assumes when
   * the field is absent, so turning the selector on does not silently change any existing
   * caller's campaign.
   */
  protected readonly metaObjective = signal<MetaObjective>('traffic');
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
    if (chips.length > 0) return chips;
    return [this.googleGeoFallbackCode()];
  });

  /**
   * The event country as Google would read it: trimmed and upper-cased, because the map's keys are
   * upper-case and `countryCode` is a free-text control an operator can type `de` into.
   *
   * Empty is a real answer and is deliberately NOT turned into an empty geo list — an empty list is
   * not a refusal, it is a campaign with no geographic restriction, which is the one outcome nobody
   * asked for. It stays a single empty entry so the BFF's guard refuses the create, and the section
   * says so before the operator gets there.
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
    if (!googleSelected && !linkedInSelected && !redditSelected && !metaSelected && !microsoftSelected) return false;

    const form = this.campaignForm.controls;
    const sharedFieldsValid = !!form.eventName.value?.trim() && !!form.registrationUrl.value?.trim() && !!form.startDate.value && !!form.endDate.value;
    if (!sharedFieldsValid) return false;

    if (googleSelected) {
      const channels = this.selectedGoogleChannels();
      if (channels.length === 0) return false;
      // A Performance Max, Video or Display selection may not be combined with anything else.
      //
      // Narrower than "at most one channel", and the narrowness is the point. Search + Demand Gen
      // together is still allowed through to the server, because with the create cutover DARK the
      // LEGACY creator serves that pair perfectly well — blocking it here would break a working
      // capability for the whole of the staged rollout, which is the mistake the server-side
      // guard's own comments record. The three channels below cannot be reached at all unless the
      // cutover owns creation (`canCreateGoogleChannels` upstream requires it), so for them the
      // create is certain to be refused and stopping here saves the user a terminal failure.
      // Derived from the shared constant, not an inverse literal. Both server consumers of this
      // same policy read it (`campaign.controller.ts`, `campaign-service.service.ts`); a channel
      // added to `GOOGLE_CAMPAIGN_CHANNELS` that does NOT require the flag would be misclassified
      // here while those two stayed correct.
      const flagged = channels.filter((c) => (GOOGLE_CAMPAIGN_CHANNELS_REQUIRING_FLAG as readonly string[]).includes(c));
      if (flagged.length > 0 && channels.length > 1) return false;
    }
    if (googleSelected && this.campaignForm.invalid) return false;
    // The bidding plan's own checking, which is a computed rather than control validators — see the
    // form declaration. Scoped to Google because the plan only exists there.
    if (googleSelected && this.googleBiddingError() !== null) return false;
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
    // Budget only: unlike Meta and LinkedIn, Reddit's remaining inputs are all AI-recommended
    // from the brief and rendered read-only for review, so there is no user-entered value left to
    // validate. The section exists so the operator SEES what will dispatch. Deliberately not an
    // enumeration — listing which inputs those are is a claim the next added field falsifies.
    if (redditSelected && !this.redditBudgetIsUsable()) return false;
    // No usable geo at all — the brief recommended none AND the country code is blank. The
    // request would carry [''], which Reddit cannot target and the operator cannot see, because
    // the preview correctly renders nothing. countryCode has no validator, so this state is
    // reachable by clearing one optional field.
    if (redditSelected && this.redditEffectiveGeoTargets().length === 0) return false;
    if (metaSelected && !this.metaVariants().some((v) => v.primaryText.trim() && v.headline.trim())) return false;
    if (metaSelected && !this.metaHasPlacement()) return false;
    if (metaSelected && !this.metaPixelValid()) return false;

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
    if (microsoftSelected && !this.microsoftCpcBidValid()) return false;
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
    //   error + a briefId  → a CONFLICT (`stale-brief`, `unverified-validator`,
    //     `superseded-after-write`). That id is the STORED row's, which by definition is not the
    //     brief on screen — the save was refused precisely because the two disagree. Creating
    //     from it would launch paid campaigns off another writer's version while the user reads
    //     their own unsaved copy. BLOCKED, and the id being present is what makes it dangerous.
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

    const persistence = this.briefPersistence();
    if (persistence.status === 'saving') return false;
    if (persistence.status === 'error' && persistence.briefId !== null) return false;

    // A durable but UNAPPROVED brief cannot create campaigns: campaign-service refuses outright —
    // `internal/service/brief.go:439` returns 400 "brief must be approved before creating
    // campaigns". The state is `saved` because the write genuinely landed, and its banner already
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
  protected readonly searchCopyApplies: Signal<boolean> = this.initSearchCopyApplies();
  protected readonly googleCreativeSections: Signal<GoogleCreativeSection[]> = this.initGoogleCreativeSections();
  protected readonly googleBiddingChannel: Signal<GoogleCampaignChannel | null> = this.initGoogleBiddingChannel();
  protected readonly googleBiddingOptions: Signal<GoogleBiddingOption[]> = this.initGoogleBiddingOptions();
  protected readonly googleBiddingStrategy: Signal<GoogleBiddingStrategy | null> = this.initGoogleBiddingStrategy();
  protected readonly googleBiddingDefaultLabel: Signal<string> = this.initGoogleBiddingDefaultLabel();
  protected readonly googleTakesTargetCpa: Signal<boolean> = this.initGoogleTakesTargetCpa();
  protected readonly googleTakesTargetRoas: Signal<boolean> = this.initGoogleTakesTargetRoas();
  protected readonly googleTakesCpcBid: Signal<boolean> = this.initGoogleTakesCpcBid();
  protected readonly googleTakesConversionActions: Signal<boolean> = this.initGoogleTakesConversionActions();
  protected readonly googleBiddingError: Signal<string | null> = this.initGoogleBiddingError();
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
      this.populateFromBrief(brief);
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

    // Re-run the two ad-copy array validators when the channel selection moves.
    //
    // Angular revalidates a control when IT changes and propagates the result upward; it never
    // revalidates a SIBLING. `searchCopyRequired` asks about the channel checkboxes, which are
    // siblings of the arrays it guards, so without this the gate would latch at whatever the
    // selection was the last time a headline was typed: unticking Search would leave the form
    // invalid with no visible control to fix, and ticking Search back on with the copy already
    // emptied would leave it valid and submit an ad with no text.
    //
    // `includeVideo` is deliberately absent — Video reads neither array, and the control is
    // constructed disabled so it emits nothing here anyway. Both arrays are revalidated together
    // rather than one per source, because either checkbox moves the answer for both.
    merge(this.campaignForm.controls.includeSearch.valueChanges, this.campaignForm.controls.includeDemandGen.valueChanges)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.headlinesArray.updateValueAndValidity({ emitEvent: false });
        this.descriptionsArray.updateValueAndValidity({ emitEvent: false });
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
    // The only Reddit control the template binds today, so this is the one door a Reddit edit
    // comes through. Deliberately not enumerating the platform's other carried values — a count
    // here is a claim the next editor added to the template falsifies.
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
    this.microsoftCpcBid.set((event.target as HTMLInputElement).value);
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
    if (this.googleGeoTargets().length >= GOOGLE_ADS_MAX_GEO_TARGETS) return;
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

  /**
   * The guidance line under a creative field: its bounds, then anything its catalogue entry adds.
   *
   * Assembled here rather than in the template because the sentence depends on which bounds the
   * field actually has — a `@if` ladder over four combinations in the template would say the same
   * thing in four places, and the repo forbids the nested ternary that would otherwise compress it.
   *
   * `min` is stated as guidance only. No validator enforces it ({@link creativeFieldValidators}
   * explains why), so this line is what tells an operator that a half-filled Performance Max
   * creative will be refused by Google even though this form will submit it.
   */
  protected creativeFieldHint(field: GoogleCreativeFieldSpec): string {
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
  protected creativeFieldError(groupName: string, field: GoogleCreativeFieldSpec): string | null {
    const control = this.campaignForm.get([groupName, field.control]);
    if (!control?.touched) return null;
    const errors = control.errors;
    if (!errors) return null;
    if (errors['creativeListMax']) return `At most ${errors['creativeListMax'].max} entries — ${errors['creativeListMax'].actual} given.`;
    if (errors['creativeListWidth']) return `Each entry must be ${errors['creativeListWidth'].width} characters or fewer.`;
    if (errors['maxlength']) return `Must be ${errors['maxlength'].requiredLength} characters or fewer.`;
    return null;
  }

  protected submit(): void {
    if (!this.canSubmit()) return;

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
      // The per-channel creative objects, present only for a selected channel that has one and
      // only when something was actually typed into it. Google-gated for the same reason the
      // section is: a LinkedIn-only create must not carry a Google creative the operator left
      // behind from an earlier selection.
      ...(platforms.includes('google-ads') ? this.googleCreativePayload(campaignTypes) : {}),
      // The bidding plan, Google-gated for the same reason the creative is, and already narrowed
      // to the fields the effective strategy and channel actually take.
      ...(platforms.includes('google-ads') ? this.googleBiddingPayload() : {}),
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
              variants: this.linkedInVariants(),
              adAccountId: this.linkedInAccountId(),
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
              project: this.briefData()?.eventDetails?.themes?.[0] || undefined,
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
              variants: this.metaVariants(),
              objective: this.metaObjective(),
              placements: this.metaPlacementOverrides(),
              // Sent only under `conversions`. Under every other objective the promoted object is
              // a page id or nothing at all, so an id left in the box from an earlier selection
              // would be a field the service ignores — and one a reader of the payload would
              // reasonably take as meaningful. Trimmed to match the upstream trim.
              ...(this.metaRequiresPixel() ? { pixelId: this.metaPixelId().trim() } : {}),
              project: this.briefData()?.eventDetails?.themes?.[0] || undefined,
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
              // No startDate/endDate: `microsoftConfig` declares no scheduling fields, so sending
              // them put values on the wire that were silently discarded. See the interface note.

              // The SAME computeds the section renders and `canSubmit` gates on, so the screen,
              // the guard and the request cannot disagree — see `microsoftEffectiveGeoTargets`.
              geoTargets: this.microsoftEffectiveGeoTargets(),
              keywords: this.microsoftEffectiveKeywords(),
              // Sent only when set. An explicit 0 would claim a bid the account does not have,
              // whereas omitting it lets Microsoft apply the account-currency minimum.
              ...(this.microsoftEffectiveCpcBid() !== null ? { cpcBid: this.microsoftEffectiveCpcBid() as number } : {}),
              project: this.briefData()?.eventDetails?.themes?.[0] || undefined,
            },
          }
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
    if (!draft) return;

    const currentSlug = this.campaignForm.controls.eventSlug.value ?? '';
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
    // Copied rather than referenced, so the restored form does not share an array with the draft
    // the parent still holds — the same rule `metaGeoTargets` follows below.
    if (draft.googleGeoTargets !== undefined) {
      this.googleGeoTargets.set([...draft.googleGeoTargets]);
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
      // Spread, not referenced, for the same reason the Meta and Microsoft geo lists below are.
      googleGeoTargets: [...this.googleGeoTargets()],
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
      // The remaining signal-backed values, on the same terms as the Meta block above: snapshotted
      // rather than referenced, and named explicitly rather than spread.
      //
      // Scoped to the per-platform BUDGETS, which is the whole of what this snapshot needs to
      // carry, and the boundary is drawn by asking one question per field: can a user change it?
      //
      // These can. The template binds `(input)` and `(change)` on the LinkedIn budget pair,
      // and `(input)` on the Reddit budget, so an operator types a number the brief did not
      // recommend and that number exists nowhere but this component. Losing it is the money-shaped
      // half of LFXV2-3315: the campaign silently reverts to the recommended spend, a decision the
      // operator did not make and the form does not show them re-making.
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
    });
  }

  private populateFromBrief(brief: CampaignBriefOutput): void {
    this.step.set('form');
    this.creationProgress.set([]);
    this.results.set([]);
    this.platformResults.set([]);
    this.errors.set([]);
    const details = brief.eventDetails;
    this.campaignForm.patchValue({
      eventName: details.name,
      eventSlug: details.slug,
      countryCode: details.countryCode || 'US',
      registrationUrl: details.registrationUrl,
      budgetUsd: brief.totalBudget ?? 500,
      startDate: this.todayDate,
      endDate: this.defaultEndDate,
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
      const selectable = new Set(CAMPAIGN_PLATFORMS.filter((o) => !o.disabled).map((o) => o.id));
      this.selectedPlatforms.set(brief.selectedPlatforms.filter((p) => selectable.has(p)));
    }

    const searchCopy = brief.structuredCopy?.['google_search'] as Record<string, unknown> | undefined;
    if (searchCopy) {
      const headlines = (searchCopy['headlines'] as string[]) ?? [];
      const descriptions = (searchCopy['descriptions'] as string[]) ?? [];

      this.replaceCopyArray(this.campaignForm.controls.headlines as FormArray, headlines, CAMPAIGN_CHAR_LIMITS.searchHeadline, true);
      this.replaceCopyArray(this.campaignForm.controls.descriptions as FormArray, descriptions, CAMPAIGN_CHAR_LIMITS.searchDescription, true);
    }

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
    // `countryCodeValue` must not be read in this method: `populateFromBrief` runs inside the
    // TRACKED `briefData` effect, and that signal is a `toSignal` over `campaignForm.valueChanges`.
    // Reading it makes the seed's own `patchValue` a dependency of the effect performing the seed,
    // which re-enters continuously — the spec suite hung before running a single test.
    //
    // Nothing is lost by leaving it empty: `microsoftEffectiveGeoTargets` already falls back to
    // the country code, so the request still carries a target, and the template renders that
    // fallback explicitly ("defaults to XX") rather than leaving it invisible.
    this.briefHsToken.set(brief.hsUtm);
    this.briefDriveFolderUrl.set(brief.driveFolderUrl);
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
   * So the slider is shown for Search + Demand Gen and withheld otherwise. Previously it rendered
   * for every Google selection and labelled its second half "Display" — a channel the split has
   * never funded, next to real Display and Performance Max boxes that it does not fund either.
   * The control is left in the form regardless; hiding it must not drop a restored draft's value.
   */
  private initBudgetSplitApplies(): Signal<boolean> {
    return computed(() => {
      void this.campaignFormRevision();
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
   * box does not by itself move this array's validity — the constructor subscription that watches
   * the two channel controls is what revalidates both arrays, and this validator is inert without
   * it.
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
   */
  private initGoogleCreativeSections(): Signal<GoogleCreativeSection[]> {
    return computed(() => {
      void this.campaignFormRevision();
      if (!this.showGoogleSection()) return [];
      const selected = this.selectedGoogleChannels();
      return GOOGLE_CHANNELS_WITH_CREATIVE.filter((channel) => selected.includes(channel)).map((channel) => ({
        channel,
        label: GOOGLE_CREATIVE_SECTION_TITLES[channel],
        groupName: GOOGLE_CREATIVE_REQUEST_KEYS[channel],
        fields: GOOGLE_CREATIVE_FIELD_SPECS[channel],
      }));
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
   */
  private initGoogleBiddingChannel(): Signal<GoogleCampaignChannel | null> {
    return computed(() => {
      void this.campaignFormRevision();
      if (!this.showGoogleSection()) return null;
      const channels = this.selectedGoogleChannels();
      if (channels.length === 0) return null;
      return channels.includes('search') ? 'search' : channels[0];
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

  private initGoogleTakesCpcBid(): Signal<boolean> {
    return computed(() => this.googleBiddingStrategy() === 'manual-cpc');
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
        if (this.googleBiddingStrategy() === 'target-cpa' && form.googleTargetCpa.value.trim() === '') {
          return 'Target CPA strategy needs a target CPA.';
        }
      }
      if (this.googleTakesTargetRoas()) {
        const error = this.googleBidAmountError(form.googleTargetRoas.value, 'Target ROAS', GOOGLE_ADS_BIDDING_BOUNDS.targetRoas);
        if (error) return error;
        if (this.googleBiddingStrategy() === 'target-roas' && form.googleTargetRoas.value.trim() === '') {
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
   * `min` is deliberately absent. campaign-service ACCEPTS a channel with no creative at all, and
   * a minimum enforced here would refuse a create that upstream would have made: an operator who
   * wants the campaign and budget now, and the assets later, is doing something the platform
   * supports. `min` is shown as guidance in the section instead ({@link GOOGLE_CREATIVE_FIELD_SPECS}),
   * which is where a floor that only applies to a PARTIALLY filled creative belongs.
   *
   * `max` and `width` are the other direction: both are hard upstream bounds, so enforcing them
   * refuses only what Google would have refused anyway — after the campaign already exists, which
   * is the expensive place to find out.
   */
  private creativeFieldValidators(field: GoogleCreativeFieldSpec): ValidatorFn[] {
    if (field.kind === 'text') {
      return field.width === undefined ? [] : [Validators.maxLength(field.width)];
    }
    return [this.creativeListBounds(field)];
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
      if (field.width !== undefined && lines.some((line) => line.length > (field.width as number))) {
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
   */
  private googleCreativePayload(channels: CampaignType[]): Record<string, Record<string, string | string[]>> {
    const payload: Record<string, Record<string, string | string[]>> = {};
    for (const channel of GOOGLE_CHANNELS_WITH_CREATIVE) {
      if (!channels.includes(channel)) continue;
      const raw = this.campaignForm.controls[GOOGLE_CREATIVE_REQUEST_KEYS[channel]].getRawValue();
      const creative: Record<string, string | string[]> = {};
      for (const field of GOOGLE_CREATIVE_FIELD_SPECS[channel]) {
        const value = raw[field.control] ?? '';
        if (field.kind === 'list') {
          const lines = this.splitCreativeLines(value);
          if (lines.length > 0) creative[field.control] = lines;
          continue;
        }
        const trimmed = value.trim();
        if (trimmed !== '') creative[field.control] = trimmed;
      }
      if (Object.keys(creative).length > 0) payload[GOOGLE_CREATIVE_REQUEST_KEYS[channel]] = creative;
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
