// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import type {
  CampaignIndexDoc,
  CampaignMonitorResponse,
  CampaignPlatform,
  CampaignRow,
  CampaignToggleAction,
  CampaignToggleStatus,
  DateRangeOption,
  KeywordActionType,
  KeywordMetrics,
  KeywordMetricsResponse,
  LinkedInAccount,
  LinkedInActionItem,
  LinkedInMonitorResponse,
  MetaAccountOption,
  MetaActionItem,
  MetaMonitorResponse,
  RedditAccountOption,
  RedditActionItem,
  RedditMonitorResponse,
} from '@lfx-one/shared/interfaces';
import {
  CAMPAIGN_TOGGLE_CONFLICT_MESSAGE,
  CAMPAIGN_TOGGLE_DONE_VERBS,
  CAMPAIGN_TOGGLE_FAILURE_MESSAGES,
  CAMPAIGN_TOGGLE_LABELS,
  CAMPAIGN_TOGGLE_PENDING_VERBS,
  CAMPAIGN_UNAVAILABLE_DEFAULT_REASON,
  CAMPAIGN_UNAVAILABLE_DEPLOYMENT_REASON,
  CAMPAIGN_UNAVAILABLE_PLATFORM_REASON,
  CAMPAIGN_UNAVAILABLE_REASONS,
  PLATFORM_BRAND_COLORS,
  TOGGLEABLE_CAMPAIGN_PLATFORMS,
  campaignToggleAction,
  normalizeCampaignStatus,
} from '@lfx-one/shared/constants';
import { AdsCurrencyPipe, AdsPctPipe, EventLabelPipe, PacingClassPipe, PriorityClassPipe, QualityScoreClassPipe } from '@pipes/campaign-optimization.pipe';
import { CampaignService } from '@services/campaign.service';
import { MessageService } from 'primeng/api';
import { skip, take, type Subscription } from 'rxjs';

@Component({
  selector: 'lfx-optimization-tab',
  imports: [DecimalPipe, AdsCurrencyPipe, AdsPctPipe, EventLabelPipe, PacingClassPipe, PriorityClassPipe, QualityScoreClassPipe],
  templateUrl: './optimization-tab.component.html',
  styleUrl: './optimization-tab.component.scss',
})
export class OptimizationTabComponent implements OnInit {
  private readonly campaignService = inject(CampaignService);
  private readonly destroyRef = inject(DestroyRef);
  // Provided at app root and rendered by `app.component`, OUTSIDE the `@switch` that owns this
  // tab. That is what makes it the right surface for a toggle outcome: the request now outlives
  // the component, so its result has to land somewhere the component's destruction cannot take
  // with it.
  private readonly messageService = inject(MessageService);

  /**
   * The campaigns this brief created, or `null` when the list has not been loaded.
   *
   * `null` and `[]` are deliberately different and must stay so: `null` is "we have not asked, or
   * the read failed", `[]` is "the index says this brief has none". Collapsing them would render
   * a confident "no campaigns" over a failed read — for campaigns that may be live and spending.
   *
   * NOT `campaigns`: that name is taken by the Google Ads monitor's own list on this component,
   * which is a different set from a different source. Two lists of campaigns under one name would
   * be a real ambiguity, not a naming nit.
   */
  public readonly briefCampaigns = input<CampaignIndexDoc[] | null>(null);

  /** True when an empty list may simply not be indexed yet, rather than genuinely empty. */
  public readonly campaignsPossiblyStale = input(false);

  /**
   * True when the campaign list READ FAILED, as opposed to never having been asked for.
   *
   * `briefCampaigns` is `null` for both, and rendering nothing for both makes an outage
   * indistinguishable from a fresh page — the failure-as-absence shape. This input is what lets
   * the tab say so, and offer the retry, for campaigns that may still be spending.
   */
  public readonly campaignsUnavailable = input(false);

  /**
   * Whether this deployment can service a pause/resume at all, reported by the server with the
   * list (`CampaignListResult.statusToggleEnabled`).
   *
   * The list read is ungated while the toggle route refuses every UUID unless
   * `LFX_CUTOVER_CAMPAIGN_SERVICE_STATUS_TOGGLE` is on, and the chart leaves it unset by default.
   * Without this the tab renders a row of controls whose every click 400s, which an operator reads
   * as the campaign refusing to stop rather than as a capability nobody enabled.
   *
   * Defaults to `false`: withholding a control for one request is cheap, offering a doomed one on
   * a spending campaign is not.
   */
  public readonly statusToggleEnabled = input(false);

  /** Emitted when the operator asks to re-read a failed campaign list; the parent owns the read. */
  public readonly retryCampaigns = output<void>();

  /** The project the campaigns belong to; the toggle is addressed per-project upstream. */
  public readonly projectSlug = input('');

  /** The brief the campaigns belong to; part of the campaign's upstream address. */
  public readonly briefId = input('');

  /**
   * Per-campaign toggle state, keyed by campaign id.
   *
   * Keyed rather than a single flag because each row toggles independently: a single in-flight
   * boolean would disable every button while one request is out, and worse, an error on one row
   * would render against another.
   */
  protected readonly togglePending = signal<Record<string, boolean>>({});
  protected readonly toggleError = signal<Record<string, string>>({});

  /**
   * The text of the visually-hidden `aria-live="polite"` region that narrates a toggle.
   *
   * A separate surface from the button's own label, and that separation is the fix. The pending
   * state used to be announced by swapping the button's `aria-label` to "Working" and setting
   * `aria-busy`, on the SAME button that goes native-`disabled` in the same tick. A disabled
   * button leaves the focus order, and screen readers do not reliably announce an attribute
   * change on an unfocused, disabled element — so the announcement the change existed to make
   * was only perceivable if the user manually navigated back to a control they could no longer
   * focus.
   *
   * A live region has no such dependency: it is announced wherever focus happens to be. Empty
   * when there is nothing to say, so the region does not re-announce stale text — and written on
   * DISPATCH, on CONFIRMATION and on FAILURE, so the narration covers the whole interaction
   * rather than only its beginning.
   */
  protected readonly toggleAnnouncement = signal('');

  /**
   * The campaigns whose validator a 412 has refused and which no re-read has since advanced.
   *
   * Keyed per campaign, like the two above, and that is a correction rather than a preference.
   * The 412 itself is evidence about the LIST — it proves this view was read before a write it
   * did not see — but RESOLUTION is only ever proved per row: a refresh advances the rows the
   * index has caught up on and leaves the rest behind, because indexing is asynchronous. A single
   * boolean had to answer "is anything still conflicted?" from evidence about one row, and got it
   * wrong in both directions: any advancing row cleared the banner while other rows still held
   * dead validators, and there was no way to keep the warning up for the rows that had not moved.
   * Membership answers it exactly.
   *
   * Drives two things that must not disagree — the list-wide refresh affordance (via
   * `campaignsConflicted`) and the per-row disable — which is why both read this one set.
   * Deliberately an OFFER rather than an automatic re-read: reloading silently would replace the
   * rows under whoever is mid-click, the same class of surprise the stale-render fix on the parent
   * exists to prevent.
   */
  private readonly conflictedCampaignIds = signal<ReadonlySet<string>>(new Set<string>());

  /**
   * Whether ANY row is still known to be conflicted.
   *
   * Derived rather than stored so the banner cannot disagree with the set that drives the row
   * controls — the disagreement being exactly the defect: a cleared flag hid the banner while
   * `toggledEtag` still held rejected validators for rows the refresh never advanced.
   */
  protected readonly campaignsConflicted = computed(() => this.conflictedCampaignIds().size > 0);

  /**
   * The status each campaign holds after any toggle this session, keyed by campaign id.
   *
   * Overlays the indexed status rather than replacing it. The index is asynchronous, so a row
   * re-read moments after a pause still reports the old status — showing that back to someone who
   * just paused a campaign reads as the pause having failed. The overlay is what the row renders
   * when present, and it is only ever set from a CONFIRMED response.
   */
  protected readonly toggledStatus = signal<Record<string, string>>({});

  /**
   * The FRESH etag each campaign returned from its last toggle this session, keyed by campaign id.
   *
   * Required for a second toggle of the same row to work at all. The row the user is looking at is
   * an immutable input carrying the etag as READ, which the first toggle invalidates the moment it
   * commits — campaign-service bumps the version and answers a replayed `If-Match` with 412. That
   * 412 surfaces as a generic failure that reads like a concurrent edit, so pause-then-resume, the
   * two-step interaction this feature exists for, would fail with a misleading cause.
   *
   * Only ever set from a CONFIRMED response, and only ever preferred over the row's own etag when
   * present — a toggle that returned no etag falls back to the indexed one rather than to ''.
   */
  protected readonly toggledEtag = signal<Record<string, string>>({});

  /**
   * The etag each row carried the last time a list was DELIVERED, keyed by campaign id.
   *
   * The reference point for "did this row actually move?". Compared against the next delivered
   * list rather than against `toggledEtag`, because the question a refresh has to answer is
   * whether the INDEX advanced — see `initConflictClearOnRefresh`.
   */
  private lastDeliveredEtags: Record<string, string | undefined> = {};

  /** Whether any list has been delivered yet; the first one is a baseline, not a re-read. */
  private hasDeliveredList = false;

  /**
   * Ids whose cached etag was minted while a list read was already in flight.
   *
   * The discriminator that makes a refresh safe. `loadBriefCampaigns` sets `briefCampaigns` to
   * `null` the moment it begins a read, so a toggle answering after that `null` produced its etag
   * CONCURRENTLY with the read now landing. That etag came from campaign-service, which bumps the
   * version synchronously on the write, so it is necessarily ahead of what this Query Service read
   * could have carried — and the row must keep it even though the index reports the row advanced.
   *
   * This is the case a `togglePending` guard cannot catch: the success arm sets `togglePending` to
   * `false` BEFORE writing `toggledEtag`, so by the time the fresh rows arrive the row is no
   * longer pending yet holds the fresher validator.
   */
  private etagsWrittenDuringRead = new Set<string>();

  /** True between the parent's `null` push and the delivery that answers it. */
  private listReadInFlight = false;

  /**
   * Bumped on every (project, brief) change; a toggle captures it at dispatch.
   *
   * The discriminator for a response that outlives its context. `toggleCampaign`'s response arms
   * write `toggledEtag`, `toggledStatus`, `toggleError` and the conflicted-id set by campaign id,
   * and `takeUntilDestroyed` does not fire on a context change — the component stays mounted under
   * `@case ('optimization')`. So a toggle dispatched against brief A that answers after a switch
   * to brief B would write A's id into B's state, and a 412 would re-arm the banner for a brief
   * that was never conflicted. Worse, that id is not in B's list, so no delivery can ever clear
   * it: the per-row clear only removes ids a delivered row advanced.
   *
   * Same shape as `briefCampaignsGeneration` on the parent, and for the same reason — a late
   * response has to be identified as late rather than prevented.
   */
  private contextGeneration = 0;

  private monitorSub: Subscription | null = null;
  private keywordsSub: Subscription | null = null;
  private linkedInSub: Subscription | null = null;
  private redditSub: Subscription | null = null;

  protected readonly platformColors = PLATFORM_BRAND_COLORS;
  protected readonly dateRangeOptions: DateRangeOption[] = [7, 14, 30];

  protected readonly selectedDays = signal<DateRangeOption>(30);
  protected readonly loading = signal(false);
  protected readonly monitorData = signal<CampaignMonitorResponse | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly keywordsLoading = signal(false);
  protected readonly keywordsData = signal<KeywordMetricsResponse | null>(null);
  protected readonly keywordsError = signal<string | null>(null);

  protected readonly actionItems = computed(() => this.monitorData()?.actionItems ?? []);
  protected readonly campaigns = computed(() => this.monitorData()?.campaigns ?? []);
  protected readonly hasActionItems = computed(() => this.actionItems().length > 0);
  protected readonly hasCampaigns = computed(() => this.campaigns().length > 0);
  protected readonly pulledAt = computed(() => this.monitorData()?.pulledAt ?? '');

  protected readonly highCount = computed(() => this.actionItems().filter((i) => i.priority === 'HIGH').length);
  protected readonly medCount = computed(() => this.actionItems().filter((i) => i.priority === 'MED').length);

  protected readonly wastedKeywords = computed<KeywordMetrics[]>(() => {
    const all = this.keywordsData()?.keywords ?? [];
    return all.filter((k) => k.spend > 0 && k.conversions === 0).sort((a, b) => b.spend - a.spend);
  });

  protected readonly lowQualityKeywords = computed<KeywordMetrics[]>(() => {
    const all = this.keywordsData()?.keywords ?? [];
    return all.filter((k) => k.qualityScore !== null && k.qualityScore <= 4).sort((a, b) => (a.qualityScore ?? 0) - (b.qualityScore ?? 0));
  });

  protected readonly displayCampaigns = computed(() => {
    return this.campaigns()
      .filter((c) => !c.adFormat.toLowerCase().includes('search'))
      .sort((a, b) => a.ctr - b.ctr)
      .map((c) => ({ ...c, displayPacingPct: Math.min(c.pacingPct, 100) }));
  });

  /**
   * The brief's campaigns as the row renders them: indexed facts overlaid with what this session
   * CONFIRMED. `null` stays `null` — see `briefCampaigns` for why that must not become `[]`.
   *
   * A computed rather than template methods, because a template may only read signals, computed
   * values and pipes (frontend-checklist §4). Per-row template methods also re-ran on every change
   * detection pass for every row; this recomputes only when a toggle lands.
   */
  protected readonly campaignRows = computed<CampaignRow[] | null>(() => {
    const rows = this.briefCampaigns();
    if (rows === null) {
      return null;
    }
    const toggled = this.toggledStatus();
    // Read here so the row's `describedBy` recomputes when an error appears or clears. Reading it
    // inside a template method instead was the frontend-checklist §4 violation this replaces.
    const toggleErrors = this.toggleError();
    const conflictedIds = this.conflictedCampaignIds();
    const deploymentDisabled = !this.statusToggleEnabled();
    return rows.map((campaign) => {
      // Normalized HERE, once, rather than inside each consumer. `status` feeds three of them —
      // `campaignToggleAction`, `unavailableReasonFor`, and the rendered `status` field — and a
      // non-string from the unvalidated wire makes any `.toLowerCase()` throw INSIDE this
      // computed, blanking the whole campaigns section on every change-detection pass. Guarding
      // one consumer just moves the crash to the next one.
      const status = normalizeCampaignStatus(toggled[campaign.id] ?? campaign.status);
      // Three states, not two. `campaignToggleAction` derives them from the shared status sets, so
      // a status upstream refuses — `pending`, a partial orphan, or one added after this was
      // written — lands on `unavailable` rather than on the Resume button that would 409.
      // Deployment capability first, then platform, then status — in refusal strength order. A
      // flag-off deployment cannot toggle ANY row, so no status or platform makes a button work.
      // Platform then status for the same reason: each is sufficient on its own to refuse.
      // The platform support check is made HERE and fed into the action, rather than letting
      // `campaignToggleAction` decide from `campaign.platform` alone. That function treats an
      // ABSENT platform as "not asked" and answers on status only — correct for a status-only
      // caller, fail-OPEN for this one. `listBriefCampaigns` spreads index docs through
      // unvalidated, so a doc missing `platform` reaches here as `undefined`, earns a Pause or
      // Resume button, and every click 400s: the request omits `body.platform` and the controller
      // refuses it before dispatch. An unsupported platform is refused for the same reason one
      // click later. Deciding it from the row's own support check makes both cases fail closed,
      // exactly as a malformed status already does.
      const platformSupported = typeof campaign.platform === 'string' && TOGGLEABLE_CAMPAIGN_PLATFORMS.has(campaign.platform);
      const action = deploymentDisabled || !platformSupported ? 'unavailable' : campaignToggleAction(status, campaign.platform);
      // The platform reason wins when it applies, because it is the one the operator cannot act
      // on. A Microsoft row in `pending` is BOTH not-yet-created and not-supported-here; telling
      // them it "resolves itself once it finishes" would promise a button that never arrives.
      const platformUnsupported = !platformSupported;
      // This row's validator is known dead. A 412 refused the exact etag the next click would
      // send, and nothing since has proved the row advanced, so re-clicking reproduces the same
      // 412 deterministically — while the banner beside it tells the operator to refresh FIRST.
      // Scoped to the row that conflicted rather than the whole list: the other rows' validators
      // are untested, not disproved, and disabling them would withdraw controls from campaigns
      // that are spending on no evidence at all.
      const conflicted = conflictedIds.has(campaign.id);
      return {
        campaign,
        status,
        action,
        conflicted,
        unavailableReason: action === 'unavailable' ? this.unavailableReasonFor(status, deploymentDisabled, platformUnsupported) : '',
        toggleLabel: CAMPAIGN_TOGGLE_LABELS[action],
        describedBy: this.describedByFor(campaign.id, action, toggleErrors),
      };
    });
  });

  protected readonly hasWastedKeywords = computed(() => this.wastedKeywords().length > 0);
  protected readonly hasLowQualityKeywords = computed(() => this.lowQualityKeywords().length > 0);
  protected readonly hasDisplayCampaigns = computed(() => this.displayCampaigns().length > 0);

  // LinkedIn optimization
  protected readonly linkedInAccountOptions = signal<LinkedInAccount[]>([]);
  protected readonly selectedLinkedInAccountKey = signal<string>('');
  protected readonly linkedInLoading = signal(false);
  protected readonly linkedInData = signal<LinkedInMonitorResponse | null>(null);
  protected readonly linkedInError = signal<string | null>(null);
  protected readonly linkedInActionItems = computed<LinkedInActionItem[]>(() => this.linkedInData()?.actionItems ?? []);

  // Reddit optimization
  protected readonly redditAccountOptions = signal<RedditAccountOption[]>([]);
  protected readonly selectedRedditAccountKey = signal<string>('');
  protected readonly redditLoading = signal(false);
  protected readonly redditData = signal<RedditMonitorResponse | null>(null);
  protected readonly redditError = signal<string | null>(null);
  protected readonly redditActionItems = computed<RedditActionItem[]>(() => this.redditData()?.actionItems ?? []);

  // Meta optimization
  private metaSub: Subscription | null = null;

  protected readonly metaAccountOptions = signal<MetaAccountOption[]>([]);
  protected readonly selectedMetaAccountKey = signal<string>('');
  protected readonly metaLoading = signal(false);
  protected readonly metaData = signal<MetaMonitorResponse | null>(null);
  protected readonly metaError = signal<string | null>(null);
  protected readonly metaActionItems = computed<MetaActionItem[]>(() => this.metaData()?.actionItems ?? []);

  protected readonly actionInProgress = signal<Record<string, boolean>>({});
  protected readonly actionResults = signal<Record<string, { success: boolean; message: string }>>({});

  public constructor() {
    // Runs in the component's injection context, which is what `toObservable` requires and what
    // lets `takeUntilDestroyed()` bind this component's `DestroyRef` without retaining the
    // subscription by hand. Deliberately not `ngOnInit` — `toObservable` would throw there.
    this.initConflictClearOnRefresh();
  }

  public ngOnInit(): void {
    this.fetchData();
    this.campaignService
      .getLinkedInAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          this.linkedInAccountOptions.set(accounts);
          if (accounts.length > 0) {
            this.selectedLinkedInAccountKey.set(accounts[0].accountId);
            this.fetchLinkedInOptimization();
          }
        },
        error: (err: unknown) => {
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.linkedInError.set(httpErr?.error?.message || httpErr?.message || 'Failed to load LinkedIn accounts');
        },
      });
    this.campaignService
      .getRedditAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          this.redditAccountOptions.set(accounts);
          if (accounts.length > 0) {
            this.selectedRedditAccountKey.set(accounts[0].key);
            this.fetchRedditOptimization();
          }
        },
        error: (err: unknown) => {
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.redditError.set(httpErr?.error?.message || httpErr?.message || 'Failed to load Reddit accounts');
        },
      });
    this.campaignService
      .getMetaAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          this.metaAccountOptions.set(accounts);
          if (accounts.length > 0) {
            this.selectedMetaAccountKey.set(accounts[0].key);
            this.fetchMetaOptimization();
          }
        },
        error: (err: unknown) => {
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.metaError.set(httpErr?.error?.message || httpErr?.message || 'Failed to load Meta accounts');
        },
      });
  }

  /**
   * Pause or resume one campaign on its ad platform.
   *
   * The write this whole tab exists to reach. It changes money-affecting state on a third party:
   * a success means the ad platform itself moved, not that a row was updated.
   *
   * The ETag is taken from the row the user is looking at, never cached from an earlier render —
   * the server sends it as `If-Match`, and a 412 means someone else moved this campaign since the
   * list was read. That refusal is the point: it stops a pause being applied on the strength of a
   * stale view.
   */
  protected toggleCampaign(row: CampaignRow): void {
    const campaign = row.campaign;
    if (this.togglePending()[campaign.id]) {
      return;
    }
    // The template disables the button for these rows, so reaching here means the DOM and the
    // computed disagreed. Refuse rather than spend a round trip on a 409 the status already
    // predicted — and never send a direction that was never offered.
    if (row.action === 'unavailable') {
      this.toggleError.update((e) => ({ ...e, [campaign.id]: row.unavailableReason }));
      return;
    }
    // Same fail-closed reasoning for a row whose validator a 412 already rejected. The template
    // disables it, so this arm is only reachable if the DOM and the computed disagree — but the
    // request it would send is KNOWN to fail, and the existing conflict message already names the
    // remedy, so it is restated rather than replaced by a second wording for one condition.
    if (row.conflicted) {
      this.toggleError.update((e) => ({ ...e, [campaign.id]: CAMPAIGN_TOGGLE_CONFLICT_MESSAGE }));
      return;
    }
    // The FRESH etag first: the row is an immutable input holding the etag as read, which this
    // session's own earlier toggle already invalidated. Replaying it earns a 412 that reads as
    // someone else's concurrent edit.
    const etag = this.toggledEtag()[campaign.id] ?? campaign.etag ?? '';
    if (etag === '') {
      // No validator means the server would answer 428. Say so here rather than spending a round
      // trip to be told, and name the cause — a row indexed before etags were carried.
      this.toggleError.update((e) => ({ ...e, [campaign.id]: 'This campaign cannot be changed until it is re-indexed.' }));
      return;
    }

    // Narrowed to the two DIRECTIONS here, once. `row.action` is still typed with `'unavailable'`
    // even though the guard above returned for it, and the error handler below reads a per-
    // direction message map — so pinning the direction in a local is what lets that lookup be
    // total instead of cast.
    const direction: Exclude<CampaignToggleAction, 'unavailable'> = row.action;
    const status: CampaignToggleStatus = direction === 'pause' ? 'PAUSED' : 'ACTIVE';
    this.togglePending.update((p) => ({ ...p, [campaign.id]: true }));
    this.toggleError.update((e) => {
      const next = { ...e };
      delete next[campaign.id];
      return next;
    });

    // Captured at DISPATCH, compared on the response arms. A switch away from this brief while the
    // request is out makes both arms writes about a context that is gone.
    const dispatchedIn = this.contextGeneration;
    // Captured at DISPATCH too, and for a different reason than `dispatchedIn`: the toast arm
    // below runs after this component may be gone, so it cannot read `campaign.campaign_name`
    // off a signal or an input at that point without reaching into a destroyed view.
    const campaignName = campaign.campaign_name;
    // Announced on DISPATCH, into the live region rather than onto the button that is about to be
    // disabled. This is the announcement the pending state owes the operator, and it is made
    // while the control still exists to be described.
    this.toggleAnnouncement.set(`${CAMPAIGN_TOGGLE_PENDING_VERBS[direction]} ${campaignName}`);

    // Deliberately NOT `takeUntilDestroyed`. This is a state-changing mutation against live ad
    // spend, and `lfx-optimization-tab` renders inside `@case ('optimization')` on the parent —
    // so a tab switch DESTROYS this component. Tying the request to component lifetime meant the
    // XHR was aborted mid-flight: the operator clicked Pause, saw "Working", switched tab, and
    // the pause they believed they had submitted was cancelled with nothing shown. If it had not
    // yet committed upstream, the campaign kept spending.
    //
    // `docs/reviews/frontend-checklist.md` §6 is "No bare .subscribe()", and it lists
    // `takeUntilDestroyed()`, `take(1)` and `firstValueFrom` as equally acceptable ways to bound
    // a subscription. It does NOT mandate tying a mutation to the view. `take(1)` satisfies it
    // and completes the subscription on the first emission, so nothing leaks: an HttpClient
    // request is a finite, self-completing observable, and the only thing `takeUntilDestroyed`
    // added here was the abort.
    //
    // Writes made after destruction are inert — signal writes on a dead view render nothing —
    // and the `dispatchedIn` guard already discards responses that outlived their context. What
    // is NOT inert is the toast: `MessageService` is provided at app root and rendered by
    // `app.component`, which outlives the tab, so the outcome reaches the operator wherever they
    // navigated to.
    this.campaignService
      .updateCampaignStatus({
        projectSlug: this.projectSlug(),
        briefId: this.briefId(),
        campaignId: campaign.id,
        platform: campaign.platform as CampaignPlatform,
        status,
        etag,
      })
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          // Announced BEFORE the context guard, and that ordering is the point. The guard below
          // discards writes aimed at rows that are no longer on screen — but the mutation itself
          // still LANDED, and the operator who asked for it is entitled to know that whether or
          // not they are still looking at this brief. The toast is the only surface that survives
          // both a context switch and this component's destruction.
          this.announceToggleOutcome(direction, campaignName, result.serviceStatus ?? result.newStatus);
          // A response that outlived its context writes nothing. Its campaign id belongs to the
          // abandoned brief, and the maps it would write are keyed by id alone — so the overlay
          // would render against whichever row of the NEW list happens to share that id.
          if (dispatchedIn !== this.contextGeneration) {
            return;
          }
          this.togglePending.update((p) => ({ ...p, [campaign.id]: false }));
          // `serviceStatus` is what the SERVICE reports, which is not always what was requested:
          // pausing a `created_degraded` campaign pauses it upstream while deliberately leaving
          // the row's status unchanged. Rendering the request back would claim a transition the
          // service declined to record.
          this.toggledStatus.update((t) => ({ ...t, [campaign.id]: result.serviceStatus ?? result.newStatus }));
          // The toggle bumped the row's version upstream, so the etag this row was read with is
          // now stale. Keeping the fresh one is what makes the NEXT toggle possible: without it
          // pause-then-resume replays a dead validator and fails with a 412 that names the wrong
          // cause. Absent on the legacy per-platform path, which has no row — fall through to the
          // indexed etag there rather than storing ''.
          if (result.etag) {
            this.toggledEtag.update((e) => ({ ...e, [campaign.id]: result.etag as string }));
            // Recorded when a list read is already in flight: this validator was minted after
            // that read began, so it outruns whatever the read is about to deliver.
            if (this.listReadInFlight) {
              this.etagsWrittenDuringRead.add(campaign.id);
            }
          }
        },
        // The error is BOUND, not discarded. An argument-less handler is structurally incapable of
        // telling a 412 from a 500 or a dropped connection, so every failure got the same "try
        // again" — including the one failure for which retrying provably cannot work.
        error: (err: unknown) => {
          // Branched on the HTTP STATUS, not on the error `code`. The BFF's error middleware
          // writes the upstream status verbatim (`res.status(error.statusCode)`), so a 412 raised
          // by campaign-service's If-Match check arrives here as an `HttpErrorResponse` with
          // `status === 412`. Its `code` field is the generic `'CLIENT_ERROR'` that every 4xx
          // carries, so branching on that would fire on 405 and 409 too.
          //
          // Computed ABOVE the context guard because the toast below needs it. A failure the
          // operator caused is still theirs to hear about after they switch tabs — otherwise the
          // pause they think they submitted fails in silence, which is the whole defect.
          const conflict = err instanceof HttpErrorResponse && err.status === 412;
          const message = conflict ? CAMPAIGN_TOGGLE_CONFLICT_MESSAGE : CAMPAIGN_TOGGLE_FAILURE_MESSAGES[direction];
          this.announceToggleFailure(campaignName, message);
          // Same guard as the success arm, and it matters more here: a 412 landing after a switch
          // would re-arm the conflict banner for a brief that was never conflicted, and add an id
          // that is not in the new list — so no delivery could ever clear it, because the per-row
          // clear only removes ids a delivered row advanced. That is a permanently latched banner,
          // the exact defect this PR set out to remove.
          if (dispatchedIn !== this.contextGeneration) {
            return;
          }
          this.togglePending.update((p) => ({ ...p, [campaign.id]: false }));
          // Deliberately NOT optimistic: nothing about the row's status is changed on failure, so
          // the button still offers the action that did not happen. Claiming the pause landed
          // would be the expensive lie here — someone would stop watching a campaign that is
          // still spending.
          this.toggleError.update((e) => ({ ...e, [campaign.id]: message }));
          // A 412 also makes the LIST stale, not just this row: it is the index's proof that the
          // campaign moved under someone else's write. Surfacing the existing re-read affordance
          // is why the copy can send the operator to a refresh — without it the message would name
          // a remedy the tab does not offer. Deliberately an OFFER rather than an automatic
          // re-fetch: a silent reload would swap the rows out from under whoever is mid-click.
          if (conflict) {
            this.conflictedCampaignIds.update((ids) => {
              const next = new Set(ids);
              next.add(campaign.id);
              return next;
            });
          }
        },
      });
  }

  protected setDateRange(days: DateRangeOption): void {
    this.selectedDays.set(days);
    this.fetchData();
    this.fetchLinkedInOptimization();
    this.fetchRedditOptimization();
    this.fetchMetaOptimization();
  }

  protected refresh(): void {
    this.fetchData();
    this.fetchLinkedInOptimization();
    this.fetchRedditOptimization();
    this.fetchMetaOptimization();
  }

  protected fetchData(): void {
    this.monitorSub?.unsubscribe();
    this.keywordsSub?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    const days = this.selectedDays();

    this.monitorSub = this.campaignService
      .getMonitorData(days)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.monitorData.set(data);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err?.error?.message || err?.message || 'Failed to load optimization data');
          this.loading.set(false);
        },
      });

    this.keywordsLoading.set(true);
    this.keywordsData.set(null);
    this.keywordsError.set(null);
    this.keywordsSub = this.campaignService
      .getKeywords(days)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.keywordsData.set(data);
          this.keywordsLoading.set(false);
        },
        error: (err) => {
          this.keywordsError.set(err?.error?.message || err?.message || 'Failed to load keyword data');
          this.keywordsLoading.set(false);
        },
      });
  }

  protected setLinkedInAccount(key: string): void {
    this.selectedLinkedInAccountKey.set(key);
    this.fetchLinkedInOptimization();
  }

  protected onLinkedInAccountChange(event: Event): void {
    this.setLinkedInAccount((event.target as HTMLSelectElement).value);
  }

  protected fetchLinkedInOptimization(): void {
    const accountKey = this.selectedLinkedInAccountKey();
    if (!accountKey) return;
    this.linkedInSub?.unsubscribe();
    this.linkedInLoading.set(true);
    this.linkedInError.set(null);
    this.linkedInSub = this.campaignService
      .getLinkedInMonitorData(accountKey, this.selectedDays())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.linkedInData.set(data);
          this.linkedInLoading.set(false);
        },
        error: (err: unknown) => {
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.linkedInError.set(httpErr?.error?.message || httpErr?.message || 'Failed to load LinkedIn data');
          this.linkedInLoading.set(false);
        },
      });
  }

  protected linkedInPriorityClass(p: LinkedInActionItem['priority']): string {
    if (p === 'HIGH') return 'bg-red-100 text-red-700';
    if (p === 'MED') return 'bg-amber-100 text-amber-700';
    return 'bg-blue-100 text-blue-700';
  }

  protected setRedditAccount(key: string): void {
    this.selectedRedditAccountKey.set(key);
    this.fetchRedditOptimization();
  }

  protected onRedditAccountChange(event: Event): void {
    this.setRedditAccount((event.target as HTMLSelectElement).value);
  }

  protected fetchRedditOptimization(): void {
    const accountKey = this.selectedRedditAccountKey();
    if (!accountKey) return;
    this.redditSub?.unsubscribe();
    this.redditLoading.set(true);
    this.redditError.set(null);
    this.redditSub = this.campaignService
      .getRedditMonitorData(accountKey, this.selectedDays())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.redditData.set(data);
          this.redditLoading.set(false);
        },
        error: (err: unknown) => {
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.redditError.set(httpErr?.error?.message || httpErr?.message || 'Failed to load Reddit data');
          this.redditLoading.set(false);
        },
      });
  }

  protected redditPriorityClass(p: RedditActionItem['priority']): string {
    if (p === 'HIGH') return 'bg-red-100 text-red-700';
    if (p === 'MED') return 'bg-amber-100 text-amber-700';
    return 'bg-blue-100 text-blue-700';
  }

  protected setMetaAccount(key: string): void {
    this.selectedMetaAccountKey.set(key);
    this.fetchMetaOptimization();
  }

  protected onMetaAccountChange(event: Event): void {
    this.setMetaAccount((event.target as HTMLSelectElement).value);
  }

  protected fetchMetaOptimization(): void {
    const accountKey = this.selectedMetaAccountKey();
    if (!accountKey) return;
    this.metaSub?.unsubscribe();
    this.metaLoading.set(true);
    this.metaError.set(null);
    this.metaSub = this.campaignService
      .getMetaMonitorData(accountKey, this.selectedDays())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.metaData.set(data);
          this.metaLoading.set(false);
        },
        error: (err: unknown) => {
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.metaError.set(httpErr?.error?.message || httpErr?.message || 'Failed to load Meta data');
          this.metaLoading.set(false);
        },
      });
  }

  protected executeKeywordAction(kw: KeywordMetrics, action: KeywordActionType): void {
    const key = `${kw.adGroupId}-${kw.criterionId}`;
    this.actionInProgress.update((map) => ({ ...map, [key]: true }));

    this.campaignService
      .executeKeywordActions({
        action,
        keywords: [{ campaignId: kw.campaignId, adGroupId: kw.adGroupId, criterionId: kw.criterionId, action }],
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.actionInProgress.update((map) => ({ ...map, [key]: false }));
          const result = res.results[0];
          this.actionResults.update((map) => ({
            ...map,
            [key]: { success: result?.success ?? false, message: result?.message ?? 'Unknown result' },
          }));
        },
        error: (err) => {
          this.actionInProgress.update((map) => ({ ...map, [key]: false }));
          this.actionResults.update((map) => ({
            ...map,
            [key]: { success: false, message: err?.error?.message || err?.message || 'Action failed' },
          }));
        },
      });
  }

  protected bulkKeywordAction(keywords: KeywordMetrics[], action: KeywordActionType): void {
    const items = keywords.map((kw) => ({ campaignId: kw.campaignId, adGroupId: kw.adGroupId, criterionId: kw.criterionId, action }));
    const keys = keywords.map((kw) => `${kw.adGroupId}-${kw.criterionId}`);

    this.actionInProgress.update((map) => {
      const updated = { ...map };
      for (const key of keys) updated[key] = true;
      return updated;
    });

    this.campaignService
      .executeKeywordActions({ action, keywords: items })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.actionInProgress.update((map) => {
            const updated = { ...map };
            for (const key of keys) updated[key] = false;
            return updated;
          });
          this.actionResults.update((map) => {
            const updated = { ...map };
            for (let i = 0; i < keys.length; i++) {
              const result = res.results[i];
              updated[keys[i]] = { success: result?.success ?? false, message: result?.message ?? 'Done' };
            }
            return updated;
          });
        },
        error: (err) => {
          this.actionInProgress.update((map) => {
            const updated = { ...map };
            for (const key of keys) updated[key] = false;
            return updated;
          });
          const msg = err?.error?.message || err?.message || 'Bulk action failed';
          this.actionResults.update((map) => {
            const updated = { ...map };
            for (const key of keys) updated[key] = { success: false, message: msg };
            return updated;
          });
        },
      });
  }

  /**
   * Clears conflict state for the rows a re-read proves have moved on.
   *
   * Without this the 412 recovery path does not recover. `campaignsConflicted` latched `true` on
   * the error arm of `toggleCampaign` and nothing ever set it back, so the banner telling the
   * operator to refresh survived the refresh it asked for. The component is not destroyed by that
   * refresh either — it lives under the parent's `@case ('optimization')`, and
   * `retryCampaigns` → `retryBriefCampaigns()` → `loadBriefCampaigns()` stays on the Optimize tab
   * and only re-pushes the `briefCampaigns` input.
   *
   * A `toObservable` bridge rather than an `effect`, per frontend-checklist §5 ("No effect() — use
   * `toObservable()` with RxJS pipes instead"). Not a style preference here: the knowledge-base
   * pattern `frontend-state-and-timing/effect-resets-on-identity-equal-input` describes this exact
   * hazard — an effect re-running on an input that is identity-different but semantically equal,
   * and resetting state that was still valid. That is precisely what an eventually-consistent
   * re-read hands this component, so the shape the rule prescribes is also the correct one.
   *
   * Keyed on the ETAG CHANGING, not on a new array arriving, and that is the whole correctness
   * argument. `listBriefCampaigns` reads the QUERY SERVICE index (`/query/resources`, type
   * `campaign`) and derives each etag from the indexed `version`, while a toggle writes through
   * campaign-service, which bumps that version immediately. Indexing is asynchronous — the server
   * file says so where it sets `possiblyStale` — so the two are skewed by design. A re-read
   * moments after a 412 can therefore hand back a NEW ARRAY carrying the SAME version that was
   * just rejected. Treating delivery as proof of freshness would clear the warning and the cached
   * validator on that array, and the next click would replay the same dead etag: the original
   * defect wearing a different hat.
   *
   * So each row is judged on its own evidence. A row whose delivered etag differs from the one it
   * was last delivered with has demonstrably advanced in the index, and the session state held
   * against it is obsolete. A row whose etag is unchanged has proved nothing, and its state — the
   * cached validator included — is left exactly as it was.
   *
   * `null` is skipped rather than treated as a clear: it is the parent's in-flight/failed state,
   * not delivered data. On a re-read that FAILS the parent stays at `null` with
   * `campaignsUnavailable`, and clearing there would drop the warning while the condition it
   * describes still holds.
   */
  private initConflictClearOnRefresh(): void {
    // A context change abandons the conflict, rather than carrying it into a list it was never
    // about. `campaignsConflicted` is evidence that THIS brief's rows were read before a write
    // this view did not see; switching foundation or brief makes it evidence about a context no
    // longer on screen. The delivery-based clear below cannot reach that case: the parent's
    // foundation-switch path sets `briefCampaigns` to `null` and, when the new foundation has no
    // brief, `loadBriefCampaigns` early-returns without ever dispatching a read — so no list is
    // ever delivered, and the component stays mounted under `@case ('optimization')` showing the
    // previous foundation's banner over a context that was never conflicted.
    //
    // Keyed on (project, brief) because either alone is insufficient: a foundation switch changes
    // the project while the brief id may be blank on both sides, and a restore can change the
    // brief within one project. The etag bookkeeping is reset with it — those validators and the
    // baseline they are compared against belong to the abandoned list, and judging the next
    // context's first delivery against them would compare ids across two different briefs.
    toObservable(computed(() => `${this.projectSlug()}\u0000${this.briefId()}`))
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        // Anything still in flight belongs to the context being abandoned.
        this.contextGeneration++;
        // Cleared HERE rather than left to the late response arms, which now return early: a row
        // stranded at `pending` renders "Working" on a disabled button forever, because the
        // response that would have cleared it belongs to a context that no longer exists.
        this.togglePending.set({});
        this.conflictedCampaignIds.set(new Set<string>());
        this.toggleError.set({});
        this.toggledEtag.set({});
        // The live region goes with them. Its text names a campaign in the brief being abandoned,
        // so leaving it would narrate the old context into the new one's region — and unlike the
        // toast, which is deliberately context-free and belongs to the operator's ACTION, this
        // region is part of THIS list's rendering.
        this.toggleAnnouncement.set('');
        // `toggledStatus` goes too, unlike on a refresh. There it is what the service CONFIRMED
        // for rows still on screen; here those rows are gone, and keeping it would overlay one
        // brief's confirmed statuses onto another brief's ids if they ever collide.
        this.toggledStatus.set({});
        this.lastDeliveredEtags = {};
        this.hasDeliveredList = false;
        this.etagsWrittenDuringRead.clear();
        this.listReadInFlight = false;
      });

    toObservable(this.briefCampaigns)
      .pipe(takeUntilDestroyed())
      .subscribe((rows) => {
        if (rows === null) {
          // The parent has begun a read. Everything written from here until rows land is
          // concurrent with it.
          this.listReadInFlight = true;
          return;
        }
        const readWasInFlight = this.listReadInFlight;
        this.listReadInFlight = false;

        const delivered: Record<string, string | undefined> = {};
        for (const row of rows) {
          delivered[row.id] = row.etag;
        }

        // The first list is a baseline: there is no prior delivery to compare against, and no
        // stale state behind it to clear.
        if (!this.hasDeliveredList) {
          this.hasDeliveredList = true;
          this.lastDeliveredEtags = delivered;
          this.etagsWrittenDuringRead.clear();
          return;
        }

        // Only rows whose indexed etag actually changed. An unchanged etag means the index has not
        // caught up with the write that caused the 412, so this row's cached validator is still
        // the best one available and its conflict is still live.
        const advanced = rows.filter((row) => row.etag !== undefined && row.etag !== this.lastDeliveredEtags[row.id]).map((row) => row.id);
        this.lastDeliveredEtags = delivered;
        // A row whose validator was minted while this very read was in flight keeps it: the write
        // that produced it is newer than the read, so the indexed etag is the older of the two.
        const concurrent = this.etagsWrittenDuringRead;
        this.etagsWrittenDuringRead = new Set<string>();
        const superseded = readWasInFlight ? advanced.filter((id) => !concurrent.has(id)) : advanced;

        if (superseded.length > 0) {
          this.clearConflictStateFor(superseded);
        }

        // A conflicted row that is no longer IN the list is cleared too.
        //
        // `superseded` is by construction a subset of the delivered rows, so on its own it can
        // only ever clear a conflict the operator can still see. A row that a 412 conflicted and
        // that was then deleted or archived upstream never appears in another delivery, so it
        // never entered `advanced`, never reached `clearConflictStateFor`, and kept
        // `campaignsConflicted()` true — a banner offering a Refresh that provably cannot dismiss
        // it, because the row it is about will never come back. That is the same latched-banner
        // defect this component was rewritten to remove, narrowed to a row that left.
        //
        // Gated on `!campaignsPossiblyStale()`, and that gate is the whole safety argument.
        // Absence is only evidence of removal when the delivery is a COMPLETE, current picture:
        //
        //   - A failed read never reaches here at all — `loadBriefCampaigns` sets `briefCampaigns`
        //     to `null` on its error arm, and `null` is handled above as "read in flight". So a
        //     failure can never present as an empty list. That is what stops this from becoming
        //     "the read broke, therefore everything is resolved".
        //   - `possiblyStale` is the server's own statement that the list may be incomplete: it is
        //     set when the index returned nothing (which may only mean "not indexed yet") and on a
        //     refusal, which answers `[]` with the flag rather than an error. Treating absence
        //     from THAT list as proof a campaign is gone would clear a live conflict on the
        //     strength of a lagging index.
        //
        // So conflicts survive a stale or failed delivery and are only dropped by a list that is
        // both successful and complete. Intersecting rather than deleting per id keeps this
        // total: any conflicted id absent from a trustworthy full list goes, however it got there.
        if (!this.campaignsPossiblyStale()) {
          this.conflictedCampaignIds.update((ids) => {
            const stillListed = new Set<string>();
            for (const id of ids) {
              if (id in delivered) {
                stillListed.add(id);
              }
            }
            // Same identity-preserving contract as `clearConflictStateFor`: returning a new Set
            // when nothing changed would re-fire `campaignsConflicted` and every computed reading
            // it on every delivery.
            return stillListed.size === ids.size ? ids : stillListed;
          });
        }
      });
  }

  /**
   * Narrates a CONFIRMED toggle: live region for the in-page reader, toast for everyone else.
   *
   * The toast exists because the request now outlives this component. `take(1)` replaced
   * `takeUntilDestroyed` so a pause is not aborted by a tab switch, which means the response can
   * arrive when this tab is gone — and a result nobody can see is barely better than the abort it
   * replaced. `MessageService` renders from `app.component`, above the `@switch`, so it lands.
   *
   * `reportedStatus` is what the SERVICE said, not what was requested, for the same reason the
   * row overlay reads it: pausing a `created_degraded` campaign pauses it upstream while leaving
   * the row's status alone. The announcement states the direction that was confirmed, so it
   * cannot promise a transition the service declined to record.
   */
  private announceToggleOutcome(direction: Exclude<CampaignToggleAction, 'unavailable'>, campaignName: string, reportedStatus: string): void {
    // The live region is CLEARED rather than given the outcome, and that is deliberate: the toast
    // is itself an ARIA live region (`p-toast` renders `role="alert"`), so writing the completion
    // to both would announce one action twice to the same user. The region owns the PENDING state
    // — which the toast has no equivalent of — and the toast owns outcomes, which is also the only
    // surface that works once this tab is destroyed. Clearing keeps "Pausing X" from sitting in
    // the region as a permanent claim about an action that has already finished.
    this.toggleAnnouncement.set('');
    const summary = `${CAMPAIGN_TOGGLE_DONE_VERBS[direction]} ${campaignName}`;
    this.messageService.add({ severity: 'success', summary, detail: `Campaign status is now ${normalizeCampaignStatus(reportedStatus)}.`, life: 5000 });
  }

  /**
   * Narrates a FAILED toggle to the same two surfaces.
   *
   * `sticky` rather than timed: this is the arm that says a pause did NOT happen on a campaign
   * that is still spending money. A message that disappears on its own is the wrong affordance
   * for that — the operator has to dismiss it, which is the acknowledgement the failure warrants.
   */
  private announceToggleFailure(campaignName: string, message: string): void {
    // Same single-surface rule, and it matters more on this arm: the row also renders the failure
    // in a `role="alert"` span (`optimization-tab.component.html:142`), so writing it here too
    // would make one failure speak three times.
    this.toggleAnnouncement.set('');
    this.messageService.add({ severity: 'error', summary: campaignName, detail: message, sticky: true });
  }

  /**
   * Drops the session state held against rows a re-read proved have moved.
   *
   * Scoped to the ids whose indexed etag actually changed, rather than wiping the maps. Two
   * separate defects made that necessary, and both are about a row whose state is still valid at
   * the moment a list arrives:
   *
   *   1. The index is eventually consistent, so an unchanged etag is not evidence the row moved —
   *      see `clearConflictOnRefresh`. Those rows keep their cached validator.
   *   2. A toggle can ANSWER inside the parent's `null` window. `loadBriefCampaigns` sets the
   *      input to `null` on entry and to the fetched array on the response arm, so a request
   *      dispatched before the refresh can land between the two and write a genuinely fresh
   *      `toggledEtag` — minted by campaign-service, and therefore AHEAD of whatever the index
   *      returns. A wholesale clear discarded it and sent the older indexed etag on the next
   *      click. Per-row scoping alone does not fix that, because such a row's indexed etag may
   *      well have changed too, so the in-flight guard below is what protects it.
   *
   * `toggledStatus` deliberately SURVIVES either way. It is not a claim about the list's
   * freshness; it records what the service CONFIRMED for a row this session, and it exists
   * precisely because the index lags a toggle. Clearing it would re-expose the lag it was written
   * to hide: a campaign paused seconds ago, re-read before the index caught up, would render as
   * running.
   *
   * NOT gated on `togglePending`, and that was re-checked rather than assumed after a reviewer
   * raised the in-flight window. A toggle still OUTSTANDING has no entry in either map to protect:
   * `toggleCampaign` deletes that row's `toggleError` before dispatch and writes `toggledEtag`
   * only on a response arm. A toggle that ANSWERS inside the window is the real hazard, and a
   * pending check cannot see it either — the success arm sets `togglePending` to `false` BEFORE
   * writing `toggledEtag`, so the row is already not-pending when the rows land. That case is
   * handled where the evidence actually is, by `etagsWrittenDuringRead`. A `togglePending` guard
   * was written here twice and removed twice: no mutation could make it fail, because every
   * interleaving it would catch is either empty or already covered.
   */
  private clearConflictStateFor(campaignIds: string[]): void {
    const clearable = campaignIds;
    if (clearable.length === 0) {
      return;
    }

    // Only the rows that actually advanced leave the conflicted set. Setting a single flag false
    // here was the defect two reviewers found independently: with `c-1` conflicted, a refresh that
    // still returns `c-1`'s rejected version but a newer one for `c-2` proves nothing about `c-1`,
    // yet cleared the banner and its Refresh control while `c-1` still held a dead validator and
    // per-row copy telling the operator to refresh. Membership is per-row evidence, so the banner
    // now survives exactly as long as some row remains unproven.
    this.conflictedCampaignIds.update((ids) => {
      if (!clearable.some((id) => ids.has(id))) {
        return ids;
      }
      const next = new Set(ids);
      for (const id of clearable) {
        next.delete(id);
      }
      return next;
    });
    this.toggleError.update((errors) => this.omitKeys(errors, clearable));
    this.toggledEtag.update((etags) => this.omitKeys(etags, clearable));
  }

  /** A copy of `source` without the given keys. Returns `source` itself when nothing is dropped. */
  private omitKeys<T>(source: Record<string, T>, keys: string[]): Record<string, T> {
    if (!keys.some((key) => key in source)) {
      return source;
    }
    const next = { ...source };
    for (const key of keys) {
      delete next[key];
    }
    return next;
  }

  /**
   * Why a row's toggle is disabled, in the order the reasons OVERRIDE one another.
   *
   * Deployment first, then platform, then status — strongest refusal wins, because a row can be
   * refused for several reasons at once and only the most fundamental one is actionable. A
   * `pending` Microsoft row on a flag-off deployment is all three; telling that operator it
   * "resolves itself once it finishes" would promise a button that no amount of waiting produces.
   *
   * Ordered `if`s rather than a chained ternary: the repo forbids nested ternaries, and the
   * precedence is the whole point of this function rather than an incidental shape.
   */
  private unavailableReasonFor(status: string, deploymentDisabled: boolean, platformUnsupported: boolean): string {
    if (deploymentDisabled) {
      return CAMPAIGN_UNAVAILABLE_DEPLOYMENT_REASON;
    }
    if (platformUnsupported) {
      return CAMPAIGN_UNAVAILABLE_PLATFORM_REASON;
    }
    // `status` arrives normalized from `campaignRows`; no `.toLowerCase()` here, which is
    // exactly the call that threw on a non-string wire value.
    return CAMPAIGN_UNAVAILABLE_REASONS[status] ?? CAMPAIGN_UNAVAILABLE_DEFAULT_REASON;
  }

  /**
   * The button's `aria-describedby`, or null when there is nothing to point at.
   *
   * Computed per row inside `campaignRows` and carried ON the row, NOT called from the template:
   * `docs/reviews/frontend-checklist.md` §4 permits only signal reads, computed values and pipes
   * in bindings, and as a template method this also re-ran for every row on every change
   * detection pass while reading `toggleError()` internally.
   *
   * A helper rather than an inline expression because the choice is three-way, which inline would
   * mean a nested ternary in a template — the construct this repo forbids. Both ids may be present
   * at once (a disabled row can still hold an error from a click that raced the status), and
   * `aria-describedby` takes a LIST, so both are named rather than one silently shadowing the
   * other. A dangling reference to an element that renders conditionally is worse than none, so
   * each id is included only when its element is actually drawn.
   *
   * `static` in spirit — it reads no signals, so the computed above owns the reactivity.
   */
  private describedByFor(campaignId: string, action: CampaignToggleAction, toggleErrors: Record<string, string>): string | null {
    const ids: string[] = [];
    if (toggleErrors[campaignId]) {
      ids.push(`campaign-error-${campaignId}`);
    }
    if (action === 'unavailable') {
      ids.push(`campaign-unavailable-${campaignId}`);
    }
    return ids.length > 0 ? ids.join(' ') : null;
  }
}
