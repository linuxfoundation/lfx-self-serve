// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SlicePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, OnInit, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import {
  CAMPAIGN_BUDGET_DEFAULTS,
  CAMPAIGN_CHAR_LIMITS,
  CAMPAIGN_JOB_POLL_INTERVAL_MS,
  LINKEDIN_CHAR_LIMITS,
  LINKEDIN_GEO_RESOLVE_MAP,
  META_CHAR_LIMITS,
  CAMPAIGN_PLATFORMS,
  REDDIT_MAX_BUDGET_USD,
} from '@lfx-one/shared/constants';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { map, startWith, Subscription, take } from 'rxjs';

import type { Signal } from '@angular/core';
import type {
  CampaignBriefOutput,
  CampaignBriefPersistenceState,
  CampaignCreateResult,
  CampaignImplementationDraft,
  CampaignJobOutcome,
  CampaignKeyword,
  CampaignPlatform,
  CampaignPlatformResult,
  CampaignType,
  LinkedInAccount,
  LinkedInCreativeVariant,
  LinkedInGeoTarget,
  LinkedInTargetingProfile,
  MetaAdVariant,
  RedditAdVariant,
} from '@lfx-one/shared/interfaces';

type ImplementationStep = 'form' | 'creating' | 'results';

/**
 * One campaign-service platform result paired with the three-state outcome the row renders.
 *
 * A local intersection rather than a `@lfx-one/shared` interface: it is this component's view
 * model, derived from `CampaignPlatformResult` and consumed only by this template, so it is not
 * part of any contract between the tiers. Two repo rules meet here and an intersection is the
 * only form satisfying both — CLAUDE.md's "all shared constants and interfaces live in `@lfx-one/shared`" rule prohibits the local `interface Foo {}` form inside
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
    includeDemandGen: [true],
    headlines: this.fb.array([this.fb.control('', [Validators.required, Validators.maxLength(CAMPAIGN_CHAR_LIMITS.searchHeadline)])]),
    descriptions: this.fb.array([this.fb.control('', [Validators.required, Validators.maxLength(CAMPAIGN_CHAR_LIMITS.searchDescription)])]),
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
  protected readonly metaVariants = signal<MetaAdVariant[]>([]);
  protected readonly metaGeoTargets = signal<string[]>([]);
  protected readonly metaBudgetUsd = signal(500);
  protected readonly metaLifetimeBudget = signal(false);

  // === Computed Signals ===
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
   * The geo targets a Reddit dispatch will actually carry.
   *
   * Same reason as `redditEffectiveKeywords`: `submit()` falls back to the form's country code
   * when the brief recommends no geos, so rendering only `redditGeoTargets()` shows an empty
   * list for a request that targets somewhere specific. A section built so the operator can
   * review what dispatches has to show the value that dispatches.
   */
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

  protected readonly linkedInGeoTargets = toSignal(
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

  protected readonly showMetaSection = computed(() => this.selectedPlatforms().includes('meta-ads'));
  protected readonly selectedLinkedInAccount = computed(() => {
    const accounts = this.linkedInAccounts();
    return accounts.find((a) => a.accountId === this.linkedInAccountId()) ?? accounts[0];
  });

  protected readonly canSubmit = computed(() => {
    const platforms = this.selectedPlatforms();
    const googleSelected = platforms.includes('google-ads');
    const linkedInSelected = platforms.includes('linkedin-ads');
    const redditSelected = platforms.includes('reddit-ads');
    const metaSelected = platforms.includes('meta-ads');
    if (!googleSelected && !linkedInSelected && !redditSelected && !metaSelected) return false;

    const form = this.campaignForm.controls;
    const sharedFieldsValid = !!form.eventName.value?.trim() && !!form.registrationUrl.value?.trim() && !!form.startDate.value && !!form.endDate.value;
    if (!sharedFieldsValid) return false;

    if (googleSelected && !this.campaignForm.controls.includeSearch.value && !this.campaignForm.controls.includeDemandGen.value) return false;
    if (googleSelected && this.campaignForm.invalid) return false;
    if (linkedInSelected && this.linkedInBudgetUsd() < 1) return false;
    if (linkedInSelected && this.linkedInGeoTargets().length === 0) return false;
    if (linkedInSelected && this.linkedInVariants().length === 0) return false;
    if (metaSelected && this.metaBudgetUsd() < 1) return false;
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
      this.emitDraft();
    });

    // Emit as the user types. `valueChanges` covers the form (copy, budget, flight, campaign
    // types); it does NOT cover the platform signals, which is deliberate — see the draft
    // interface for why this snapshot is scoped to the fields a user types rather than everything
    // the component holds.
    this.campaignForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.seeding) return;
      this.emitDraft();
    });
  }

  public ngOnInit(): void {
    this.linkedInAccountsLoading.set(true);
    this.campaignService
      .getLinkedInAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          this.linkedInAccounts.set(accounts);
          // Default to the first account ONLY when nothing is selected yet. The guard predates
          // LFXV2-3230 but carries more weight now: a restored draft has already put the user's
          // account on the form by the time this response lands, and dropping the guard would
          // overwrite their choice with the list's first entry every single mount.
          //
          // Writes through the form rather than a signal, since that is where the value now
          // lives. `emitEvent` is left ON deliberately — this assignment CHANGES what `submit()`
          // would send, so the parent's draft has to learn about it; suppressing the event would
          // leave the draft carrying '' while the form and the request carry a real account.
          if (accounts.length > 0 && !this.linkedInAccountId()) {
            this.campaignForm.controls.linkedInAccountId.setValue(accounts[0].accountId);
          }
          this.linkedInAccountsLoading.set(false);
        },
        error: () => {
          this.linkedInAccountsLoading.set(false);
        },
      });
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

  protected addHeadline(): void {
    (this.campaignForm.controls.headlines as FormArray).push(
      this.fb.control('', [Validators.required, Validators.maxLength(CAMPAIGN_CHAR_LIMITS.searchHeadline)])
    );
  }

  protected removeHeadline(index: number): void {
    const arr = this.campaignForm.controls.headlines as FormArray;
    if (arr.length > 1) arr.removeAt(index);
  }

  protected addDescription(): void {
    (this.campaignForm.controls.descriptions as FormArray).push(
      this.fb.control('', [Validators.required, Validators.maxLength(CAMPAIGN_CHAR_LIMITS.searchDescription)])
    );
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

  protected setLinkedInLifetimeBudget(value: boolean): void {
    this.linkedInLifetimeBudget.set(value);
  }

  protected setLinkedInBudget(value: number): void {
    this.linkedInBudgetUsd.set(value);
  }

  protected setLinkedInAccount(accountId: string): void {
    this.campaignForm.controls.linkedInAccountId.setValue(accountId);
  }

  protected onLinkedInAccountChange(event: Event): void {
    this.campaignForm.controls.linkedInAccountId.setValue((event.target as HTMLSelectElement).value);
  }

  protected onGeoTargetChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.addGeoTarget(select.value);
    select.value = '';
  }

  protected onLinkedInBudgetInput(event: Event): void {
    this.linkedInBudgetUsd.set((event.target as HTMLInputElement).valueAsNumber || 0);
  }

  protected onLinkedInLifetimeBudgetChange(event: Event): void {
    this.linkedInLifetimeBudget.set((event.target as HTMLInputElement).checked);
  }

  protected onMetaBudgetInput(event: Event): void {
    this.metaBudgetUsd.set((event.target as HTMLInputElement).valueAsNumber || 0);
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
  }

  protected onMetaLifetimeBudgetChange(event: Event): void {
    this.metaLifetimeBudget.set((event.target as HTMLInputElement).checked);
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
    const campaignTypes: CampaignType[] = [];
    if (form.includeSearch) campaignTypes.push('search');
    if (form.includeDemandGen) campaignTypes.push('demand-gen');
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
      geoTargets: [form.countryCode],
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
              geoTargets: this.metaGeoTargets().length > 0 ? this.metaGeoTargets() : [form.countryCode],
              variants: this.metaVariants(),
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
      error: () => {
        this.errors.set(['Unable to reach the campaign service. Please check your connection and try again.']);
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
      includeDemandGen: draft.includeDemandGen,
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
      target.push(this.fb.control(value, [Validators.required, Validators.maxLength(maxLength)]), { emitEvent: false });
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
      // The three LinkedIn controls (LFXV2-3230). Listed EXPLICITLY, like every field above,
      // because this emit is an object literal rather than a spread of `getRawValue()` — a
      // control added to the form does not reach the draft until it is named here. That is the
      // one step "just put it on the form" does not do for you.
      linkedInAccountId: form.linkedInAccountId,
      linkedInGeoTargets: form.linkedInGeoTargets,
      linkedInTargetingProfile: form.linkedInTargetingProfile,
      eventSlug: form.eventSlug,
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
      this.metaGeoTargets.set(Array.isArray(rawGeos) ? (rawGeos as string[]) : []);
    } else if (brief.metaCopy) {
      this.metaVariants.set(brief.metaCopy.variants);
      this.metaGeoTargets.set(brief.metaCopy.recommendedGeos);
    }

    this.briefKeywords.set(brief.keywords);
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
    return toSignal(
      this.campaignForm.valueChanges.pipe(
        startWith(this.campaignForm.getRawValue()),
        map((form) => {
          const name = form.eventName;
          const region = form.countryCode || 'NA';
          const startDate = form.startDate || '';
          const includeSearch = form.includeSearch;
          const includeDemandGen = form.includeDemandGen;
          let channel = 'Search';
          if (includeSearch && includeDemandGen) channel = 'Multi';
          else if (includeDemandGen) channel = 'DG Display';
          return name ? `Events | ${name} | ${region} | Conversions | Prospecting | ${channel} | Linux Foundation | BoFU | ${startDate}` : '';
        })
      ),
      { initialValue: '' }
    );
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
}
