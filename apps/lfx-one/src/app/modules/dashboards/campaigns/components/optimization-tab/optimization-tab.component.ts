// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, DOCUMENT } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, inject, Injector, input, OnInit, output, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import type {
  BriefMetrics,
  CampaignBidChange,
  CampaignBidOutcome,
  CampaignBudgetChange,
  CampaignBudgetOutcome,
  CampaignIndexDoc,
  CampaignMonitorResponse,
  CampaignNegativeKeywordsRequestState,
  CampaignOptimizeFinding,
  CampaignOptimizeLever,
  CampaignPlatform,
  CampaignRow,
  CampaignToggleAction,
  CampaignToggleStatus,
  DateRangeOption,
  KeywordActionPlatform,
  KeywordActionType,
  KeywordMetrics,
  KeywordMetricsResponse,
  LinkedInAccount,
  LinkedInActionItem,
  LinkedInMonitorResponse,
  MetaAccountOption,
  MetaActionItem,
  KeywordActionOutcome,
  MetaMonitorResponse,
  MicrosoftKeywordActionRequest,
  RedditAccountOption,
  RedditActionItem,
  RedditMonitorResponse,
} from '@lfx-one/shared/interfaces';
import {
  BID_WRITABLE_CAMPAIGN_PLATFORMS,
  BUDGET_WRITABLE_CAMPAIGN_PLATFORMS,
  CAMPAIGN_BID_BLOCKED_BUSY_REASON,
  CAMPAIGN_BID_BLOCKED_STALE_REASON,
  CAMPAIGN_BID_CONFLICT_MESSAGE,
  CAMPAIGN_BID_UNAVAILABLE_PLATFORM_REASON,
  CAMPAIGN_BID_UNAVAILABLE_UNPROVISIONED_REASON,
  CAMPAIGN_BUDGET_BLOCKED_BID_REASON,
  CAMPAIGN_BUDGET_BLOCKED_STALE_REASON,
  CAMPAIGN_BUDGET_BLOCKED_TOGGLE_REASON,
  CAMPAIGN_BUDGET_CONFLICT_MESSAGE,
  CAMPAIGN_BUDGET_UNAVAILABLE_PLATFORM_REASON,
  CAMPAIGN_BUDGET_UNAVAILABLE_UNPROVISIONED_REASON,
  CAMPAIGN_FINDING_ALREADY_PAUSED_REASON,
  CAMPAIGN_NEGATIVE_KEYWORDS_UNAVAILABLE_UNPROVISIONED_REASON,
  CAMPAIGN_OPTIMIZE_LEVER_LABELS,
  CAMPAIGN_PLATFORMS,
  CAMPAIGN_TOGGLE_CONFLICT_MESSAGE,
  CAMPAIGN_TOGGLE_DONE_VERBS,
  CAMPAIGN_TOGGLE_FAILURE_MESSAGES,
  CAMPAIGN_TOGGLE_UNCONFIRMED_MESSAGES,
  CAMPAIGN_TOGGLE_LABELS,
  CAMPAIGN_TOGGLE_PENDING_VERBS,
  CAMPAIGN_UNAVAILABLE_DEFAULT_REASON,
  CAMPAIGN_UNAVAILABLE_DEPLOYMENT_REASON,
  CAMPAIGN_UNAVAILABLE_PLATFORM_REASON,
  CAMPAIGN_UNAVAILABLE_REASONS,
  DEFAULT_CAMPAIGN_BID_TYPE,
  KEYWORD_ACTION_OUTCOME_CLASSES,
  KEYWORD_ACTION_OUTCOME_LABELS,
  NEGATIVE_KEYWORD_CAMPAIGN_PLATFORMS,
  PLATFORM_BRAND_COLORS,
  TOGGLEABLE_CAMPAIGN_PLATFORMS,
  campaignToggleAction,
  normalizeCampaignStatus,
} from '@lfx-one/shared/constants';
import { campaignActionItemLever, keywordActionKey, keywordIdentityKey } from '@lfx-one/shared/utils';
import { AdsCurrencyPipe, AdsPctPipe, EventLabelPipe, PacingClassPipe, PriorityClassPipe, QualityScoreClassPipe } from '@pipes/campaign-optimization.pipe';
import { campaignBidFailureOutcome } from '@shared/utils/campaign-bid-error.utils';
import { campaignBudgetFailureOutcome } from '@shared/utils/campaign-budget-error.utils';
import { classifyCampaignWriteFailure } from '@shared/utils/campaign-write-error.utils';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { CampaignNegativeKeywordsService } from '@services/campaign-negative-keywords.service';
import { campaignNegativeKeywordsKey } from '@shared/utils/campaign-negative-keywords.utils';
import { CampaignService } from '@services/campaign.service';
import { MessageService } from 'primeng/api';
import { catchError, EMPTY, map, of, skip, switchMap, take, type Subscription } from 'rxjs';

import { CampaignBidFormComponent } from '../campaign-bid-form/campaign-bid-form.component';
import { CampaignBudgetFormComponent } from '../campaign-budget-form/campaign-budget-form.component';
import { CampaignNegativeKeywordsFormComponent } from '../campaign-negative-keywords-form/campaign-negative-keywords-form.component';
import { MicrosoftKeywordsTableComponent } from '../microsoft-keywords-table/microsoft-keywords-table.component';

@Component({
  selector: 'lfx-optimization-tab',
  imports: [
    DecimalPipe,
    AdsCurrencyPipe,
    AdsPctPipe,
    CampaignBidFormComponent,
    CampaignBudgetFormComponent,
    CampaignNegativeKeywordsFormComponent,
    EventLabelPipe,
    MicrosoftKeywordsTableComponent,
    PacingClassPipe,
    PriorityClassPipe,
    QualityScoreClassPipe,
  ],
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
  private readonly negativeKeywordsService = inject(CampaignNegativeKeywordsService);
  // Both serve the finding levers' focus hand-off: `afterNextRender` needs an injector outside the
  // constructor, and the editor it focuses is rendered by this template a tick after it opens.
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

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
   * `LFX_CUTOVER_CAMPAIGN_SERVICE_STATUS_TOGGLE` is on. The chart now ships that flag `"true"`,
   * so the common case is enabled — but the flag is read per request from the environment, so a
   * values override or a not-yet-rolled chart still turns it off underneath this tab. Without
   * this the tab renders a row of controls whose every click 400s, which an operator reads as the
   * campaign refusing to stop rather than as a capability nobody enabled.
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

  /**
   * Holds the DIRECTION dispatched, not merely `true`.
   *
   * The template only asks "is this row busy?", but the live region has to say WHICH action is in
   * flight, and re-deriving that from the row would be a guess: `row.action` is computed from the
   * row's status, which is deliberately NOT updated optimistically, so it happens to still read
   * the dispatched direction today purely because the status has not moved yet. Recording what
   * was actually sent removes that dependency — the announcement states the direction the request
   * carries rather than one inferred from state the request has not yet changed.
   */
  protected readonly togglePending = signal<Record<string, Exclude<CampaignToggleAction, 'unavailable'> | undefined>>({});
  protected readonly toggleError = signal<Record<string, string>>({});

  /**
   * Budget-change state, per campaign id, for the same reason the toggle's is keyed: each row
   * changes independently, and one row's error must never render against another.
   *
   * The budget change is the toggle's sibling write on the same row. It sends the same validator
   * (`toggledEtag` first, else the indexed etag), writes the fresh one back to the same map, and a
   * 412 marks the same row conflicted — so the two controls can never disagree about whether the
   * row's etag is still good.
   */
  protected readonly budgetEditorOpen = signal<Record<string, boolean>>({});
  protected readonly budgetPending = signal<Record<string, boolean>>({});
  /** The last non-success outcome per row; cleared when a new change is dispatched. */
  protected readonly budgetOutcome = signal<Partial<Record<string, CampaignBudgetOutcome>>>({});
  /**
   * The amount and pacing this session CONFIRMED per row. The index carries no budget, so this is
   * the only budget the row can show, and the only pacing it can pre-select on the next change.
   */
  protected readonly confirmedBudget = signal<Partial<Record<string, CampaignBudgetChange>>>({});

  /**
   * Bid-change state, per campaign id: the budget editor's sibling write on the same row, sharing
   * its validator (`toggledEtag`), its 412 handling and its one-write-at-a-time rule.
   */
  protected readonly bidEditorOpen = signal<Record<string, boolean>>({});
  protected readonly bidPending = signal<Record<string, boolean>>({});
  /** The last non-success bid outcome per row; cleared when a new change is dispatched. */
  protected readonly bidOutcome = signal<Partial<Record<string, CampaignBidOutcome>>>({});
  /** The bid this session CONFIRMED per row. The index carries no bid, so this is the only one the row can show. */
  protected readonly confirmedBid = signal<Partial<Record<string, CampaignBidChange>>>({});

  /** Which Microsoft rows have their negative-keyword editor open. */
  protected readonly negativesEditorOpen = signal<Record<string, boolean>>({});
  /**
   * Which rows' negative-keyword request is in flight. Read from the root
   * `CampaignNegativeKeywordsService`, which owns the request, rather than reported by the editor:
   * a campaign-list re-read or a tab switch destroys the editor mid-flight, and a flag fed by its
   * output then stayed `true` forever, leaving Close dead and the disclosure disabled.
   */
  protected readonly negativesPending: Signal<Record<string, boolean>> = this.initNegativesFlag((request) => request.pending);
  /**
   * Rows whose last negative-keyword request has keywords not confirmed, stated on the row while
   * the editor is closed: they may already have been added, and the sticky toast can be dismissed.
   */
  protected readonly negativesUnconfirmed: Signal<Record<string, boolean>> = this.initNegativesFlag(
    (request) => !request.pending && (request.batchOutcome?.state === 'unconfirmed' || request.outcomeRows.some((row) => row.outcome === 'UNCONFIRMED'))
  );

  /** Bumped by Refresh to re-read the Microsoft keyword table, which owns its own read. */
  protected readonly microsoftKeywordsReload = signal(0);

  /**
   * The brief's metrics read, for its `action_items`: campaign-service's single-source rule
   * engine, whose items carry a stable `rule` token and the campaign's own id. Those two are what
   * let a finding be linked to the row control that resolves it, which the per-platform monitor
   * items below (prose only, keyed by name) cannot do.
   *
   * `null` until a read lands, and on a failed read — `briefMetricsState` says which. A failure is
   * never rendered as "no findings".
   */
  protected readonly briefMetrics = signal<BriefMetrics | null>(null);
  protected readonly briefMetricsState = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  /** Bumped by Refresh (and the findings retry) to re-read the brief's metrics. */
  private readonly briefMetricsReload = signal(0);

  /**
   * Each monitor finding joined to the brief campaign row it is about, with its ONE lever decided.
   *
   * The lever comes from `campaignActionItemLever` — the shared rule→lever map gated on the same
   * platform sets the row controls use — and is then withheld when the campaign is not in the
   * loaded list, because there is no control to hand the operator.
   */
  protected readonly findings: Signal<CampaignOptimizeFinding[]> = this.initFindings();

  /** What the findings panel says when the read returned no items. Never an unqualified all-clear. */
  protected readonly findingsEmptyMessage: Signal<string> = this.initFindingsEmptyMessage();

  protected readonly platformLabels: Readonly<Record<string, string>> = Object.fromEntries(CAMPAIGN_PLATFORMS.map((p) => [p.id, p.label]));

  /**
   * The text of the visually-hidden `aria-live="polite"` region: which rows are CURRENTLY working.
   *
   * ONE ownership rule governs all four announcement sites, and stating it once is what stops the
   * three separate defects that came from patching them individually:
   *
   *   PENDING is owned by this region. OUTCOME is owned by the toast.
   *
   * Pending needs the region because the control that would otherwise carry it goes native
   * `disabled` in the same tick: a disabled button leaves the focus order, and screen readers do
   * not reliably announce an `aria-label`/`aria-busy` change on an unfocused, disabled element.
   * A live region is announced wherever focus happens to be, so it has no such dependency.
   *
   * Outcome belongs to the toast because `p-toast` is ITSELF a live region (`role="alert"`), and
   * the row additionally renders its failure text. Announcing an outcome here too would speak one
   * action twice — three times on the failure arm. The toast is also the only surface that
   * survives this component's destruction, which is what a mutation outliving its tab requires.
   *
   * DERIVED, not written. Every earlier bug here came from this being an imperatively-assigned
   * slot: a single string standing in for per-row state, so whichever response answered first
   * wiped a message still true of another row, and a late response from an abandoned brief could
   * wipe a live one. Computing it from `togglePending` — the same per-row map that drives the
   * buttons — makes those states unrepresentable rather than merely guarded: the region is a
   * function of which rows are working, so it can never disagree with them.
   *
   * Names every working campaign rather than "N campaigns working": with two rows in flight the
   * operator needs to know WHICH, and the count alone is exactly the information they lack.
   */
  protected readonly toggleAnnouncement = computed(() => {
    const pending = this.togglePending();
    const budgetPending = this.budgetPending();
    const bidPending = this.bidPending();
    const rows = this.campaignRows();
    if (rows === null) {
      return '';
    }
    // Read off the delivered rows rather than a captured name, so the region cannot narrate a
    // campaign that is no longer in the list — the context-switch case, handled structurally
    // instead of by remembering to clear a slot.
    const working: string[] = [];
    for (const row of rows) {
      const direction = pending[row.campaign.id];
      if (direction) {
        working.push(`${CAMPAIGN_TOGGLE_PENDING_VERBS[direction]} ${row.campaign.campaign_name}`);
      }
      if (budgetPending[row.campaign.id]) {
        working.push(`Changing the budget of ${row.campaign.campaign_name}`);
      }
      if (bidPending[row.campaign.id]) {
        working.push(`Changing the bid of ${row.campaign.campaign_name}`);
      }
    }
    return working.join(', ');
  });

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
   * How many rows are conflicted, so the banner can scope its instruction to them.
   *
   * The banner told the operator to refresh "before pausing or resuming anything" while the
   * implementation disables only the conflicted rows — deliberately, since the other rows'
   * validators are untested rather than disproved. An instruction broader than the enforcement
   * leaves the operator unable to tell which campaign the warning is about.
   */
  protected readonly conflictedCount = computed(() => this.conflictedCampaignIds().size);

  /**
   * Whether any OTHER row is still actually usable — the precondition for saying so.
   *
   * The banner's reassurance that other campaigns can still be paused or resumed was written as
   * an unconditional sentence, which made it false in three ordinary shapes: a brief with only
   * the conflicted row, every row conflicted, and siblings already `unavailable` for a platform
   * or status reason. Recovery copy that asserts controls the operator cannot see is the same
   * defect as the over-broad instruction it replaced, pointed the other way.
   *
   * Derived from the rendered rows rather than a count, so it agrees with the buttons by
   * construction: a row is offerable exactly when it is not conflicted and its action is a real
   * direction, which is the same condition the template's `[disabled]` uses.
   */
  protected readonly hasActionableSiblings = computed(() => {
    const rows = this.campaignRows();
    if (rows === null) {
      return false;
    }
    return rows.some((row) => !row.conflicted && row.action !== 'unavailable');
  });

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
    const pending = this.togglePending();
    // Read here so the row's `describedBy` recomputes when an error appears or clears. Reading it
    // inside a template method instead was the frontend-checklist §4 violation this replaces.
    const toggleErrors = this.toggleError();
    const conflictedIds = this.conflictedCampaignIds();
    const budgetPending = this.budgetPending();
    const bidPending = this.bidPending();
    const deploymentDisabled = !this.statusToggleEnabled();
    return rows.map((campaign) => {
      // Normalized HERE, once, rather than inside each consumer. `status` feeds three of them —
      // `campaignToggleAction`, `unavailableReasonFor`, and the rendered `status` field — and a
      // non-string from the unvalidated wire makes any `.toLowerCase()` throw INSIDE this
      // computed, blanking the whole campaigns section on every change-detection pass. Guarding
      // one consumer just moves the crash to the next one.
      // A row with a toggle IN FLIGHT renders the direction that request carries, not one derived
      // from a status that may change under it. `clearConflictStateFor` can drop this row's
      // `toggledStatus` mid-flight when a refresh proves the index advanced — correct for a
      // resting row, but for a busy one it flipped the label and `aria-label` from "Resume" to
      // "Pause" while the spinner still ran, so the control announced the opposite of what it was
      // doing and of what the live region was saying. The dispatched direction is the only honest
      // answer until the response lands.
      const pendingDirection = pending[campaign.id];
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
      // The dispatched direction wins while the request is out; otherwise derive it from status.
      const derivedAction = deploymentDisabled || !platformSupported ? 'unavailable' : campaignToggleAction(status, campaign.platform);
      const action: CampaignToggleAction = pendingDirection ?? derivedAction;
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
      const budgetUnavailableReason = this.budgetUnavailableReasonFor(campaign, status);
      const bidUnavailableReason = this.bidUnavailableReasonFor(campaign, status);
      const negativeKeywordsOffered = typeof campaign.platform === 'string' && NEGATIVE_KEYWORD_CAMPAIGN_PLATFORMS.has(campaign.platform);
      const negativeKeywordsUnavailableReason = negativeKeywordsOffered ? this.negativeKeywordsUnavailableReasonFor(campaign, status) : '';
      return {
        campaign,
        status,
        action,
        conflicted,
        unavailableReason: action === 'unavailable' ? this.unavailableReasonFor(status, deploymentDisabled, platformUnsupported) : '',
        toggleLabel: CAMPAIGN_TOGGLE_LABELS[action],
        describedBy: this.describedByFor(campaign.id, action, toggleErrors),
        budgetAvailable: budgetUnavailableReason === '',
        budgetUnavailableReason,
        budgetBlockedReason: this.budgetBlockedReasonFor(conflicted, pendingDirection !== undefined, !!bidPending[campaign.id]),
        bidAvailable: bidUnavailableReason === '',
        bidUnavailableReason,
        bidBlockedReason: this.bidBlockedReasonFor(conflicted, pendingDirection !== undefined || !!budgetPending[campaign.id]),
        negativeKeywordsOffered,
        negativeKeywordsAvailable: negativeKeywordsOffered && negativeKeywordsUnavailableReason === '',
        negativeKeywordsUnavailableReason,
      };
    });
  });

  protected readonly hasWastedKeywords = computed(() => this.wastedKeywords().length > 0);
  /**
   * True when the keyword set was capped upstream, so "no wasted keywords" covers only the
   * returned slice.
   *
   * `=== true` rather than truthiness: the field is optional because the legacy path issues a
   * bare LIMIT with no probe for a further row, so absence means UNKNOWN, not complete.
   * Qualifying every legacy response would be its own false statement.
   */
  protected readonly keywordsPartial = computed(() => this.keywordsData()?.truncated === true);
  /**
   * Completeness was never established: `truncated` is absent, which the contract defines as
   * UNKNOWN rather than complete.
   *
   * Kept distinct from `keywordsPartial` because the two license different sentences. An
   * unqualified "all keywords with spend are generating conversions" is a claim about EVERY
   * keyword, and making it over a set nobody proved complete hides exactly the waste it says is
   * absent. Reporting unknown as truncated would be its own false statement, so the template
   * gets a third arm rather than folding this into either boolean.
   */
  protected readonly keywordsCompletenessUnknown = computed(() => this.keywordsData()?.truncated === undefined);
  /** How many keywords were actually examined, for the qualified all-clear. */
  protected readonly keywordsExamined = computed(() => this.keywordsData()?.keywords.length ?? 0);
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
  protected readonly actionResults = signal<Record<string, KeywordActionOutcome>>({});
  /**
   * Keywords a confirmed REMOVE deleted on this page, by `keywordIdentityKey`. Recorded when the
   * response lands, from the action that request carried, and never cleared by a re-read: Microsoft's
   * keywords come from a finished saved report, which can still list a keyword after it is gone, and
   * offering Pause/Remove on it again would act on nothing.
   */
  protected readonly removedKeywords = signal<ReadonlySet<string>>(new Set<string>());
  /**
   * Label and colour per outcome state, as lookup maps so the template does no work.
   *
   * The three states are not two with a variant: an UNCONFIRMED action may already have applied,
   * and a retried REMOVE is irreversible, so it must never read as "Failed".
   */
  protected readonly OUTCOME_LABEL = KEYWORD_ACTION_OUTCOME_LABELS;
  protected readonly OUTCOME_CLASS = KEYWORD_ACTION_OUTCOME_CLASSES;

  protected readonly activeFoundationSlug = computed(() => this.projectSlug());

  public constructor() {
    // Runs in the component's injection context, which is what `toObservable` requires and what
    // lets `takeUntilDestroyed()` bind this component's `DestroyRef` without retaining the
    // subscription by hand. Deliberately not `ngOnInit` — `toObservable` would throw there.
    this.initConflictClearOnRefresh();
    this.initBriefMetricsLoad();

    // skip(1) drops the emission toObservable fires immediately on subscribe — ngOnInit already
    // runs the initial load, so only later foundation switches should reach
    // loadForActiveFoundation() again.
    toObservable(this.activeFoundationSlug)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.loadForActiveFoundation());
  }

  public ngOnInit(): void {
    this.loadForActiveFoundation();
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
    // A budget change in flight on this row holds the same validator; a toggle sent alongside it
    // would race it to the same `If-Match` and one of the two would 412.
    if (this.togglePending()[campaign.id] || this.budgetPending()[campaign.id] || this.bidPending()[campaign.id]) {
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
    this.togglePending.update((p) => ({ ...p, [campaign.id]: direction }));
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
          this.togglePending.update((p) => this.omitKeys(p, [campaign.id]));
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
          //
          // Classified by the SAME `classifyCampaignWriteFailure` the budget, bid and negative-keyword
          // levers use, so all four agree: a 412 is a conflict, and any 4xx a definite refusal, only
          // in the BFF's `{ error, code }` envelope; anything else (no answer, a proxy's own 4xx or
          // 5xx, campaign-service's "unconfirmed") may have reached the platform and is never
          // reported as "it is still running".
          const outcome = classifyCampaignWriteFailure(err, {
            conflict: CAMPAIGN_TOGGLE_CONFLICT_MESSAGE,
            unconfirmed: CAMPAIGN_TOGGLE_UNCONFIRMED_MESSAGES[direction],
            failureFallback: CAMPAIGN_TOGGLE_FAILURE_MESSAGES[direction],
          });
          const conflict = outcome.state === 'conflict';
          // A definite failure keeps the per-direction copy, which states which way it left the row.
          let message = CAMPAIGN_TOGGLE_FAILURE_MESSAGES[direction];
          if (outcome.state !== 'failed') {
            message = outcome.message;
          }
          this.announceToggleFailure(campaignName, message, outcome.state === 'unconfirmed' ? 'warn' : 'error');
          // Same guard as the success arm, and it matters more here: a 412 landing after a switch
          // would re-arm the conflict banner for a brief that was never conflicted, and add an id
          // that is not in the new list — so no delivery could ever clear it, because the per-row
          // clear only removes ids a delivered row advanced. That is a permanently latched banner,
          // the exact defect this PR set out to remove.
          if (dispatchedIn !== this.contextGeneration) {
            return;
          }
          this.togglePending.update((p) => this.omitKeys(p, [campaign.id]));
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

  /** Opens or closes one row's budget editor. A change in flight keeps it open. */
  protected toggleBudgetEditor(row: CampaignRow): void {
    const id = row.campaign.id;
    if (this.budgetPending()[id]) {
      return;
    }
    if (this.budgetEditorOpen()[id]) {
      this.closeBudgetEditor(id);
      return;
    }
    if (!row.budgetAvailable) {
      return;
    }
    this.budgetEditorOpen.update((open) => ({ ...open, [id]: true }));
  }

  protected closeBudgetEditor(campaignId: string): void {
    if (this.budgetPending()[campaignId]) {
      return;
    }
    this.budgetEditorOpen.update((open) => this.omitKeys(open, [campaignId]));
  }

  /** The editor's Cancel: closes it and returns focus to the row's disclosure button. */
  protected cancelBudgetEditor(campaignId: string): void {
    if (this.budgetPending()[campaignId]) {
      return;
    }
    this.returnFocusToDisclosure(`campaign-budget-edit-${campaignId}`, `campaign-budget-panel-${campaignId}`);
    this.closeBudgetEditor(campaignId);
  }

  /**
   * Hands the operator the ONE control that resolves a monitor finding, reusing that control's
   * own method and guards rather than a second copy of its logic.
   *
   * - `budget` opens the row's editor (or leaves it open) and focuses its amount. It never submits:
   *   the change still needs the operator's own Save.
   * - `pause_resume` runs the row toggle's own `toggleCampaign`, so the pending, conflict, platform
   *   and deployment guards are the toggle's, unchanged — and only to PAUSE an active campaign.
   * - `keywords` moves focus to the keyword actions of the campaign's platform (Google or Microsoft).
   */
  protected resolveFinding(finding: CampaignOptimizeFinding): void {
    const row = finding.row;
    if (row === null || finding.leverBlockedReason !== '') {
      return;
    }
    switch (finding.lever) {
      case 'budget':
        this.openBudgetEditorFor(row);
        return;
      case 'pause_resume':
        // Pause only: a finding never resumes spend, whatever the row's toggle offers right now.
        if (row.action === 'pause') {
          this.toggleCampaign(row);
        }
        return;
      case 'keywords':
        // The keyword table of the campaign's own platform: Microsoft keywords are their own table.
        this.focusAfterRender(row.campaign.platform === 'microsoft-ads' ? 'optimization-microsoft-keywords' : 'optimization-wasted-keywords');
        return;
      case 'none':
        return;
    }
  }

  protected reloadFindings(): void {
    this.briefMetricsReload.update((n) => n + 1);
  }

  /**
   * Change one campaign's budget on its ad platform.
   *
   * The toggle's sibling, and deliberately built the same way: the row's freshest validator is
   * sent as `If-Match`, the fresh one the response returns replaces it for the NEXT write on the
   * row (budget or toggle), a 412 marks the row conflicted, and a response that outlives its
   * (project, brief) writes nothing but the toast.
   *
   * The amount goes out exactly as the operator typed it, in the ad account's own currency. Every
   * refusal upstream owns — the platform's minimum, a shared budget, a pacing mismatch, a currency
   * or provenance problem — comes back as its own message and is shown verbatim. An outcome nobody
   * could confirm is reported as such and never retried here: the change may already be applied,
   * and only the operator, looking at the ad platform, can tell.
   */
  protected changeCampaignBudget(row: CampaignRow, change: CampaignBudgetChange): void {
    const campaign = row.campaign;
    const id = campaign.id;
    if (this.budgetPending()[id] || this.togglePending()[id] || this.bidPending()[id]) {
      return;
    }
    // The template withholds the editor for these rows; reaching here means the DOM and the
    // computed disagreed, so refuse rather than send a change upstream would refuse anyway.
    if (!row.budgetAvailable) {
      this.budgetOutcome.update((o) => ({ ...o, [id]: { state: 'failed', message: row.budgetUnavailableReason } }));
      return;
    }
    if (row.conflicted) {
      this.budgetOutcome.update((o) => ({ ...o, [id]: { state: 'conflict', message: CAMPAIGN_BUDGET_CONFLICT_MESSAGE } }));
      return;
    }
    // The FRESH etag first, for the reason `toggleCampaign` gives: an earlier write this session
    // (a toggle or a budget change) already invalidated the one the row was read with.
    const etag = this.toggledEtag()[id] ?? campaign.etag ?? '';
    if (etag === '') {
      this.budgetOutcome.update((o) => ({ ...o, [id]: { state: 'failed', message: 'This campaign cannot be changed until it is re-indexed.' } }));
      return;
    }

    this.budgetPending.update((p) => ({ ...p, [id]: true }));
    this.budgetOutcome.update((o) => this.omitKeys(o, [id]));
    const dispatchedIn = this.contextGeneration;
    const campaignName = campaign.campaign_name;

    // `take(1)`, not `takeUntilDestroyed`, for the toggle's reason: a tab switch destroys this
    // component, and aborting a budget write mid-flight would leave its outcome unknown with
    // nothing shown. The toast carries the outcome past the component.
    this.campaignService
      .updateCampaignBudget({
        projectSlug: this.projectSlug(),
        briefId: this.briefId(),
        campaignId: id,
        budget: change.budget,
        budgetType: change.budgetType,
        etag,
      })
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          this.announceBudgetSuccess(campaignName, result.budget, result.budgetType);
          if (dispatchedIn !== this.contextGeneration) {
            return;
          }
          this.budgetPending.update((p) => this.omitKeys(p, [id]));
          this.confirmedBudget.update((c) => ({ ...c, [id]: { budget: result.budget, budgetType: result.budgetType } }));
          this.returnFocusToDisclosure(`campaign-budget-edit-${id}`, `campaign-budget-panel-${id}`);
          this.budgetEditorOpen.update((open) => this.omitKeys(open, [id]));
          // The change bumped the row's version upstream. Without the fresh etag the next write on
          // this row — another budget change, or a pause — would replay a dead validator and 412.
          if (result.etag) {
            this.toggledEtag.update((e) => ({ ...e, [id]: result.etag as string }));
            if (this.listReadInFlight) {
              this.etagsWrittenDuringRead.add(id);
            }
          }
        },
        error: (err: unknown) => {
          const outcome = campaignBudgetFailureOutcome(err);
          this.announceBudgetFailure(campaignName, outcome);
          if (dispatchedIn !== this.contextGeneration) {
            return;
          }
          this.budgetPending.update((p) => this.omitKeys(p, [id]));
          this.budgetOutcome.update((o) => ({ ...o, [id]: outcome }));
          // Same evidence as the toggle's 412: this view was read before a write it never saw, so
          // the row's validator is dead for BOTH controls until a refresh proves it advanced.
          if (outcome.state === 'conflict') {
            this.conflictedCampaignIds.update((ids) => {
              const next = new Set(ids);
              next.add(id);
              return next;
            });
          }
        },
      });
  }

  /** Opens or closes one row's bid editor. A change in flight keeps it open. */
  protected toggleBidEditor(row: CampaignRow): void {
    const id = row.campaign.id;
    if (this.bidPending()[id]) {
      return;
    }
    if (this.bidEditorOpen()[id]) {
      this.closeBidEditor(id);
      return;
    }
    if (!row.bidAvailable) {
      return;
    }
    this.bidEditorOpen.update((open) => ({ ...open, [id]: true }));
  }

  protected closeBidEditor(campaignId: string): void {
    if (this.bidPending()[campaignId]) {
      return;
    }
    this.bidEditorOpen.update((open) => this.omitKeys(open, [campaignId]));
  }

  /** The editor's Cancel: closes it and returns focus to the row's disclosure button. */
  protected cancelBidEditor(campaignId: string): void {
    if (this.bidPending()[campaignId]) {
      return;
    }
    this.returnFocusToDisclosure(`campaign-bid-edit-${campaignId}`, `campaign-bid-panel-${campaignId}`);
    this.closeBidEditor(campaignId);
  }

  /**
   * Opens or closes one Microsoft row's negative-keyword editor. A request in flight keeps it open,
   * but does not keep a CLOSED one shut: after a remount the editor shows the request's progress.
   */
  protected toggleNegativesEditor(row: CampaignRow): void {
    const id = row.campaign.id;
    if (this.negativesEditorOpen()[id]) {
      this.closeNegativesEditor(id);
      return;
    }
    if (!row.negativeKeywordsAvailable) {
      return;
    }
    this.negativesEditorOpen.update((open) => ({ ...open, [id]: true }));
  }

  protected closeNegativesEditor(campaignId: string): void {
    if (this.negativesPending()[campaignId]) {
      return;
    }
    this.negativesEditorOpen.update((open) => this.omitKeys(open, [campaignId]));
  }

  /** The row note's Dismiss: forgets one campaign's settled negative-keyword result. */
  protected dismissNegativesResult(campaignId: string): void {
    this.negativeKeywordsService.dismiss(this.projectSlug(), this.briefId(), campaignId);
  }

  /**
   * Change one campaign's manual max CPC bid on its ad platform.
   *
   * The budget change's sibling, built the same way and on the same row state: the freshest
   * validator goes out as `If-Match`, the fresh one the response returns replaces it for the next
   * write on the row (bid, budget or toggle), a 412 marks the row conflicted, and a response that
   * outlives its (project, brief) writes nothing but the toast. One write per row at a time, since
   * every write needs the same validator.
   *
   * The bid goes out exactly as typed, in the ad account's own currency. Upstream's refusals are
   * shown verbatim — including its neutral 409 when the campaign is not on a manual per-click bid.
   * An outcome nobody could confirm is reported as possibly applied and never retried here.
   */
  protected changeCampaignBid(row: CampaignRow, change: CampaignBidChange): void {
    const campaign = row.campaign;
    const id = campaign.id;
    if (this.bidPending()[id] || this.budgetPending()[id] || this.togglePending()[id]) {
      return;
    }
    if (!row.bidAvailable) {
      this.bidOutcome.update((o) => ({ ...o, [id]: { state: 'failed', message: row.bidUnavailableReason } }));
      return;
    }
    if (row.conflicted) {
      this.bidOutcome.update((o) => ({ ...o, [id]: { state: 'conflict', message: CAMPAIGN_BID_CONFLICT_MESSAGE } }));
      return;
    }
    const etag = this.toggledEtag()[id] ?? campaign.etag ?? '';
    if (etag === '') {
      this.bidOutcome.update((o) => ({ ...o, [id]: { state: 'failed', message: 'This campaign cannot be changed until it is re-indexed.' } }));
      return;
    }

    this.bidPending.update((p) => ({ ...p, [id]: true }));
    this.bidOutcome.update((o) => this.omitKeys(o, [id]));
    const dispatchedIn = this.contextGeneration;
    const campaignName = campaign.campaign_name;

    // `take(1)`, not `takeUntilDestroyed`, for the toggle's reason: a tab switch must not abort a
    // write against live spend. The toast carries the outcome past the component.
    this.campaignService
      .updateCampaignBid({
        projectSlug: this.projectSlug(),
        briefId: this.briefId(),
        campaignId: id,
        bid: change.bid,
        bidType: DEFAULT_CAMPAIGN_BID_TYPE,
        etag,
      })
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          this.announceBidSuccess(campaignName, result.bid);
          if (dispatchedIn !== this.contextGeneration) {
            return;
          }
          this.bidPending.update((p) => this.omitKeys(p, [id]));
          this.confirmedBid.update((c) => ({ ...c, [id]: { bid: result.bid } }));
          this.returnFocusToDisclosure(`campaign-bid-edit-${id}`, `campaign-bid-panel-${id}`);
          this.bidEditorOpen.update((open) => this.omitKeys(open, [id]));
          // The change bumped the row's version upstream; the next write on the row needs this one.
          if (result.etag) {
            this.toggledEtag.update((e) => ({ ...e, [id]: result.etag as string }));
            if (this.listReadInFlight) {
              this.etagsWrittenDuringRead.add(id);
            }
          }
        },
        error: (err: unknown) => {
          const outcome = campaignBidFailureOutcome(err);
          this.announceBidFailure(campaignName, outcome);
          if (dispatchedIn !== this.contextGeneration) {
            return;
          }
          this.bidPending.update((p) => this.omitKeys(p, [id]));
          this.bidOutcome.update((o) => ({ ...o, [id]: outcome }));
          if (outcome.state === 'conflict') {
            this.conflictedCampaignIds.update((ids) => {
              const next = new Set(ids);
              next.add(id);
              return next;
            });
          }
        },
      });
  }

  /** A pause/remove asked for on a Microsoft keyword row: the Google path, sent with `platform: 'microsoft-ads'`. */
  protected onMicrosoftKeywordAction(request: MicrosoftKeywordActionRequest): void {
    this.executeKeywordAction(request.keyword, request.action, 'microsoft-ads');
  }

  protected setDateRange(days: DateRangeOption): void {
    this.selectedDays.set(days);
    this.fetchData();
    this.fetchLinkedInOptimization();
    this.fetchRedditOptimization();
    this.fetchMetaOptimization();
  }

  protected refresh(): void {
    // A refresh re-reads the platform, so settled negative-keyword results are stale; one still in
    // flight is kept by the service.
    this.negativeKeywordsService.clearSettled(this.projectSlug(), this.briefId());
    this.reloadFindings();
    this.microsoftKeywordsReload.update((n) => n + 1);
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
      .getMonitorData(this.activeFoundationSlug(), days)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.monitorData.set(data);
          this.loading.set(false);
        },
        error: (err) => {
          // `extractErrorMessage`, not `err?.error?.message`. BaseApiError.toResponse serialises
          // the operator-facing text as `{ error: string }` (`BaseApiError.toResponse`), so `.error.message`
          // is undefined for every error this path produces and the operator got Angular's generic
          // "Http failure response for <url>" instead of the actionable upstream reason. The same
          // reading already exists in `toTransportOutcome`; these loaders never got it (Copilot).
          this.error.set(extractErrorMessage(err, 'Failed to load optimization data'));
          this.loading.set(false);
        },
      });

    this.keywordsLoading.set(true);
    this.keywordsData.set(null);
    this.keywordsError.set(null);
    this.keywordsSub = this.campaignService
      .getKeywords(this.activeFoundationSlug(), days)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.keywordsData.set(data);
          this.keywordsLoading.set(false);
        },
        error: (err) => {
          // `extractErrorMessage`, not `err?.error?.message`. BaseApiError.toResponse serialises
          // the operator-facing text as `{ error: string }` (`BaseApiError.toResponse`), so `.error.message`
          // is undefined for every error this path produces and the operator got Angular's generic
          // "Http failure response for <url>" instead of the actionable upstream reason. The same
          // reading already exists in `toTransportOutcome`; these loaders never got it (Copilot).
          this.keywordsError.set(extractErrorMessage(err, 'Failed to load keyword data'));
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
      .getLinkedInMonitorData(this.activeFoundationSlug(), accountKey, this.selectedDays())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.linkedInData.set(data);
          this.linkedInLoading.set(false);
        },
        error: (err: unknown) => {
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.linkedInError.set(extractErrorMessage(httpErr, 'Failed to load LinkedIn data'));
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
      .getRedditMonitorData(this.activeFoundationSlug(), accountKey, this.selectedDays())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.redditData.set(data);
          this.redditLoading.set(false);
        },
        error: (err: unknown) => {
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.redditError.set(extractErrorMessage(httpErr, 'Failed to load Reddit data'));
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
      .getMetaMonitorData(this.activeFoundationSlug(), accountKey, this.selectedDays())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.metaData.set(data);
          this.metaLoading.set(false);
        },
        error: (err: unknown) => {
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.metaError.set(extractErrorMessage(httpErr, 'Failed to load Meta data'));
          this.metaLoading.set(false);
        },
      });
  }

  /**
   * Pause or remove one keyword. `platform` is sent only for Microsoft Advertising: a Google
   * request keeps the exact body it always had (the BFF defaults an absent platform to Google).
   * The action state is keyed by `keywordActionKey`, so a Microsoft id cannot collide with a Google one.
   */
  protected executeKeywordAction(
    kw: Pick<KeywordMetrics, 'campaignId' | 'adGroupId' | 'criterionId'>,
    action: KeywordActionType,
    platform: KeywordActionPlatform = 'google-ads'
  ): void {
    const key = keywordActionKey(platform, kw.adGroupId, kw.criterionId);
    this.actionInProgress.update((map) => ({ ...map, [key]: true }));
    const item = { campaignId: kw.campaignId, adGroupId: kw.adGroupId, criterionId: kw.criterionId, action };

    this.campaignService
      .executeKeywordActions(this.activeFoundationSlug(), {
        action,
        keywords: [platform === 'google-ads' ? item : { ...item, platform }],
      })
      // `take(1)`, NOT `takeUntilDestroyed` -- the same call the campaign toggle above makes, for
      // the same reason. This component lives inside `@case ('optimization')`, so switching tab
      // DESTROYS it and `takeUntilDestroyed` would abort the request mid-flight. A keyword REMOVE
      // is irreversible and may already have applied upstream, so aborting loses the outcome of a
      // mutation that happened. `take(1)` still bounds the subscription -- an HttpClient request
      // is finite and self-completing -- it just does not cancel it.
      //
      // The signal writes below become inert once this component is gone, which is harmless. The
      // toast is what carries the outcome across the tab switch, because MessageService is
      // provided at app root.
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          this.actionInProgress.update((map) => ({ ...map, [key]: false }));
          const result = res.results[0];
          const outcome: KeywordActionOutcome = { ...this.positionalOutcome(result), action };
          this.actionResults.update((map) => ({
            ...map,
            [key]: outcome,
          }));
          if (action === 'remove' && outcome.state === 'done') {
            const identity = keywordIdentityKey(platform, kw.campaignId, kw.adGroupId, kw.criterionId);
            this.removedKeywords.update((removed) => new Set(removed).add(identity));
          }
          this.announceKeywordOutcome(action, 1, outcome.state, outcome.message);
        },
        error: (err) => {
          this.actionInProgress.update((map) => ({ ...map, [key]: false }));
          const outcome: KeywordActionOutcome = { ...this.toTransportOutcome(err), action };
          this.actionResults.update((map) => ({
            ...map,
            [key]: outcome,
          }));
          this.announceKeywordOutcome(action, 1, outcome.state, outcome.message);
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
      .executeKeywordActions(this.activeFoundationSlug(), { action, keywords: items })
      // `take(1)` for the same reason as the single-keyword path: a tab switch destroys this
      // component, and aborting a BULK remove mid-flight is worse -- the fan-out is sequential
      // upstream, so a cancelled request can leave part of the selection already mutated with no
      // outcome shown anywhere.
      .pipe(take(1))
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
              // `?? false` here marked every unmatched key "Failed" -- across the WHOLE
              // selection when the array came back short. Positional absence is unconfirmed.
              updated[keys[i]] = this.positionalOutcome(res.results[i]);
            }
            return updated;
          });
          // Summarised for the toast: the per-row detail lives in the table, which an operator
          // who switched tabs cannot see. Reports the worst state in the batch, because a
          // partially-unconfirmed bulk REMOVE is the case that needs acting on.
          const outcomes = keys.map((_, i) => this.positionalOutcome(res.results[i]).state);
          // UNCONFIRMED OUTRANKS FAILED, which is the opposite of the intuitive ordering and is
          // the same rule the error arm states twenty lines below: a definite failure did NOT
          // apply, so retrying it is safe; an unconfirmed row MAY have applied, so retrying can
          // duplicate an irreversible REMOVE. A batch carrying both was summarised as "Remove
          // failed", which invites exactly that retry (Copilot).
          const worst = (['unconfirmed', 'failed', 'done'] as const).find((state) => outcomes.includes(state)) ?? 'done';
          // The COUNT must describe the state it is paired with. `keys.length` is the whole
          // selection, so one unconfirmed row in a batch of ten announced "10 unconfirmed" --
          // overstating an irreversible-REMOVE hazard by the size of the selection, and telling
          // the operator to check nine rows that are fine (dealako, #1923 round 7).
          const worstCount = outcomes.filter((state) => state === worst).length;
          this.announceKeywordOutcome(
            action,
            worstCount,
            worst,
            worst === 'done'
              ? 'All rows in the selection completed.'
              : 'Some rows did not complete. Open the Optimize tab to see which, and check the platform before retrying.'
          );
        },
        error: (err) => {
          this.actionInProgress.update((map) => {
            const updated = { ...map };
            for (const key of keys) updated[key] = false;
            return updated;
          });
          // Classified the same way as the single-keyword path. A dropped, timed-out or 5xx bulk
          // response says NOTHING about whether the mutations applied -- and it covers every
          // keyword in the selection, so rendering "Failed" here invites an operator to re-run a
          // bulk REMOVE that may already have gone through. `toActionOutcome(false, msg)` reads
          // the MESSAGE for an unconfirmed marker, which a transport failure never carries: the
          // request died before campaign-service could describe its own outcome.
          const outcome = this.toTransportOutcome(err);
          this.actionResults.update((map) => {
            const updated = { ...map };
            for (const key of keys) updated[key] = outcome;
            return updated;
          });
          this.announceKeywordOutcome(action, keys.length, outcome.state, outcome.message);
        },
      });
  }

  /**
   * Whether a failed action's outcome is UNKNOWN rather than known-failed.
   *
   * The BFF deliberately surfaces campaign-service's unconfirmed message instead of flattening it,
   * because that is the one distinction a caller must act on — and rendering every non-success as
   * "Failed" threw it away right at the end. A retried REMOVE is irreversible, so an operator told
   * "Failed" about a change that may already have applied is being invited to run it twice.
   *
   * Matched on the message because that is what the wire carries; `success` alone cannot express
   * three states.
   *
   * TWO producers reach here, and an earlier version recognised only one. The BFF writes its own
   * text when the returned outcomes do not match what was asked ("confirmation did not match"),
   * while campaign-service reports its own ambiguity in its own words — "UNCONFIRMED (... the
   * changes may have been applied ...)" from the Google Ads client, or "is unconfirmed" from the
   * service layer — and that message passes through the BFF verbatim. Missing the second meant
   * a genuine upstream ambiguity still rendered as "Failed", which is the exact retry-an-
   * irreversible-REMOVE hazard this exists to prevent.
   *
   * Matched case-insensitively on the WORD, not a full sentence, so a wording tweak upstream
   * cannot silently re-collapse the states.
   */

  /**
   * Build the stored outcome, classifying it ONCE at the point of storage.
   *
   * The template must not call this: the repo's frontend checklist allows only signal reads,
   * computeds and pipes there, precisely so logic does not re-run per row per change detection.
   * Deriving here also means every write site gets the same classification for free, rather than
   * each one remembering to.
   */

  /**
   * Classify a browser-to-BFF failure, which carries no structured result to read.
   *
   * The BFF may already have dispatched the mutation when the connection dropped, timed out, or
   * returned a 5xx — so the outcome is UNKNOWN, not failed. Reporting `failed` for a
   * spend-affecting pause/remove tells the operator nothing happened and invites a retry of a
   * change that may have applied; on a REMOVE that is irreversible.
   *
   * Only a 4xx the BFF produced BEFORE dispatching is a definite failure: those are validation
   * refusals (a bad payload, too many rows), and a request refused at the boundary never
   * reached the platform. 0 (network), 408 (timeout) and 5xx are all unconfirmed.
   */
  private toTransportOutcome(err: unknown): KeywordActionOutcome {
    const e = err as { status?: number; error?: { error?: string; message?: string } | string; message?: string };
    const status = typeof e?.status === 'number' ? e.status : 0;
    // `error.error` FIRST: BaseApiError.toResponse serialises the operator-facing text as
    // `{ error: string }`, not `{ message: string }` (`BaseApiError.toResponse`). Reading only `.message`
    // dropped every actionable 4xx -- "adGroupId must be numeric", a permission refusal -- and
    // rendered Angular's generic "Http failure response for <url>" in the row instead, which
    // tells the operator nothing they can act on. `.message` and a plain-string body are kept as
    // fallbacks so a non-BaseApiError shape still surfaces something.
    const body = e?.error;
    const message = (typeof body === 'string' ? body : body?.error || body?.message) || e?.message || 'Action failed';
    const definitelyRefused = status >= 400 && status < 500 && status !== 408;
    if (definitelyRefused) {
      return { success: false, message, state: 'failed' };
    }
    return {
      success: false,
      message: `${message} — this may or may not have been applied; check the platform before retrying.`,
      state: 'unconfirmed',
    };
  }

  /**
   * The outcome for ONE positional entry of a keyword-action response.
   *
   * A MISSING entry is unconfirmed, never failed. The response is positional -- the client zips
   * `results[i]` onto the list it sent -- so a 2xx whose array is short says nothing about
   * whether that mutation applied. Rendering "Failed" there invites a retry of a REMOVE that may
   * already have run, and Google cannot re-enable a removed criterion.
   *
   * Shared by the single and bulk paths deliberately: both read positionally, and the bulk one is
   * the more dangerous of the two because one short array covers an entire selection.
   */
  private positionalOutcome(result: { success: boolean; message: string } | undefined): KeywordActionOutcome {
    if (!result) {
      return {
        success: false,
        message: 'The change was sent but no outcome came back for it. Check the keyword in the platform before retrying.',
        state: 'unconfirmed',
      };
    }
    return this.toActionOutcome(result.success, result.message);
  }

  private toActionOutcome(success: boolean, message: string): KeywordActionOutcome {
    if (success) {
      return { success, message, state: 'done' };
    }
    return { success, message, state: this.isUnconfirmed({ success, message }) ? 'unconfirmed' : 'failed' };
  }

  private isUnconfirmed(result: { success: boolean; message: string }): boolean {
    if (result.success) {
      return false;
    }
    const message = result.message.toLowerCase();
    // "could not be confirmed" is the Microsoft wording (`MICROSOFT_KEYWORD_ACTION_OUTCOME_UNCONFIRMED`).
    return message.includes('unconfirmed') || message.includes('confirmation did not match') || message.includes('could not be confirmed');
  }

  private loadForActiveFoundation(): void {
    // Stale account selections belong to the previous foundation — drop them so the
    // "pick first account" logic below re-runs for the new foundation's accounts.
    this.selectedLinkedInAccountKey.set('');
    this.selectedRedditAccountKey.set('');
    this.selectedMetaAccountKey.set('');
    // Also drop the previous foundation's account CATALOGS, not just the selection — otherwise the
    // dropdowns keep offering the old foundation's accounts for the whole in-flight window (or
    // forever, if the refetch below fails), and a pick there pairs the NEW foundation's project
    // with an account from ANOTHER foundation. Mirrors `implementation-tab.component.ts`'s
    // `loadLinkedInAccounts`, which clears its own catalog at the start of its reload for the same
    // reason.
    this.linkedInAccountOptions.set([]);
    this.redditAccountOptions.set([]);
    this.metaAccountOptions.set([]);
    // Clear the previous foundation's optimization data too — otherwise it stays on screen,
    // attributed to the new foundation, until the new fetch resolves (mirrors
    // `monitoring-tab.component.ts`'s `loadForActiveFoundation`).
    //
    // Also cancel any in-flight per-platform monitor fetch for the OLD foundation — clearing the
    // signal above isn't enough on its own. If the new foundation has no accounts for a platform,
    // `fetchLinkedInOptimization`/etc never runs again to replace the subscription, so a late
    // response from the old foundation's request would otherwise land after the clear and put
    // that foundation's data back on screen under the new one.
    //
    // The unsubscribe cancels the fetch but also prevents its `next`/`error` handler from ever
    // firing — those handlers are the only place the loading flag gets cleared. Clear it
    // explicitly here too, or a foundation with zero accounts for a platform leaves that panel
    // spinning forever.
    this.linkedInSub?.unsubscribe();
    this.redditSub?.unsubscribe();
    this.metaSub?.unsubscribe();
    this.linkedInLoading.set(false);
    this.redditLoading.set(false);
    this.metaLoading.set(false);
    this.linkedInData.set(null);
    this.redditData.set(null);
    this.metaData.set(null);

    // The template gates its loading placeholder on `!monitorData()`, so the aggregate signal
    // needs clearing too — otherwise action items/campaigns from the OLD foundation render under
    // the new one until the new fetch resolves (or indefinitely if it fails).
    this.monitorData.set(null);

    this.fetchData();

    // Each account-list request is stamped with the slug it was made for. A foundation switch
    // fires a new request before the previous one resolves, and `takeUntilDestroyed` alone
    // doesn't cancel it (the component survives the switch). Without this guard, a slower
    // response for the OLD foundation can arrive after a faster one for the new foundation and
    // overwrite it with the wrong account catalog.
    const linkedInSlug = this.activeFoundationSlug();
    this.campaignService
      .getLinkedInAccounts(linkedInSlug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          if (linkedInSlug !== this.activeFoundationSlug()) return;
          this.linkedInAccountOptions.set(accounts);
          if (accounts.length > 0) {
            this.selectedLinkedInAccountKey.set(accounts[0].accountId);
            this.fetchLinkedInOptimization();
          }
        },
        error: (err: unknown) => {
          if (linkedInSlug !== this.activeFoundationSlug()) return;
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.linkedInError.set(extractErrorMessage(httpErr, 'Failed to load LinkedIn accounts'));
        },
      });
    const redditSlug = this.activeFoundationSlug();
    this.campaignService
      .getRedditAccounts(redditSlug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          if (redditSlug !== this.activeFoundationSlug()) return;
          this.redditAccountOptions.set(accounts);
          if (accounts.length > 0) {
            this.selectedRedditAccountKey.set(accounts[0].key);
            this.fetchRedditOptimization();
          }
        },
        error: (err: unknown) => {
          if (redditSlug !== this.activeFoundationSlug()) return;
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.redditError.set(extractErrorMessage(httpErr, 'Failed to load Reddit accounts'));
        },
      });
    const metaSlug = this.activeFoundationSlug();
    this.campaignService
      .getMetaAccounts(metaSlug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          if (metaSlug !== this.activeFoundationSlug()) return;
          this.metaAccountOptions.set(accounts);
          if (accounts.length > 0) {
            this.selectedMetaAccountKey.set(accounts[0].key);
            this.fetchMetaOptimization();
          }
        },
        error: (err: unknown) => {
          if (metaSlug !== this.activeFoundationSlug()) return;
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.metaError.set(extractErrorMessage(httpErr, 'Failed to load Meta accounts'));
        },
      });
  }

  /**
   * Reads the brief's metrics for its action items, once per (project, brief) and on Refresh.
   *
   * `switchMap`, so a read for an abandoned brief is cancelled rather than landing over the new
   * one. Errors are caught INSIDE the switch so one failed read does not end the stream and leave
   * every later context unread.
   */
  private initBriefMetricsLoad(): void {
    toObservable(computed(() => ({ projectSlug: this.projectSlug(), briefId: this.briefId(), reload: this.briefMetricsReload() })))
      .pipe(
        switchMap(({ projectSlug, briefId }) => {
          this.briefMetrics.set(null);
          // Both are preconditions of the route; the BFF refuses either empty with a 400.
          if (projectSlug === '' || briefId === '') {
            this.briefMetricsState.set('idle');
            return EMPTY;
          }
          this.briefMetricsState.set('loading');
          return this.campaignService.getBriefMetrics(projectSlug, briefId).pipe(
            map((metrics): BriefMetrics | null => metrics),
            catchError((error: unknown) => {
              console.error('Failed to load brief metrics for the Optimize tab findings:', error);
              return of(null);
            })
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe((metrics) => {
        this.briefMetrics.set(metrics);
        this.briefMetricsState.set(metrics === null ? 'error' : 'loaded');
      });
  }

  /**
   * Per campaign id of THIS (project, brief), whether its negative-keyword request matches `test`.
   * The root service holds every scope's requests; only this tab's are read back.
   */
  private initNegativesFlag(test: (request: CampaignNegativeKeywordsRequestState) => boolean): Signal<Record<string, boolean>> {
    return computed(() => {
      const prefix = campaignNegativeKeywordsKey(this.projectSlug(), this.briefId(), '');
      const flags: Record<string, boolean> = {};
      for (const [key, request] of Object.entries(this.negativeKeywordsService.requests())) {
        if (key.startsWith(prefix) && test(request)) {
          flags[key.slice(prefix.length)] = true;
        }
      }
      return flags;
    });
  }

  private initFindings(): Signal<CampaignOptimizeFinding[]> {
    return computed(() => {
      const items = this.briefMetrics()?.action_items ?? [];
      const rowsById = new Map((this.campaignRows() ?? []).map((row) => [row.campaign.id, row]));
      const budgetPending = this.budgetPending();
      const togglePending = this.togglePending();
      const bidPending = this.bidPending();
      return items.map((item) => {
        const row = rowsById.get(item.campaign_id) ?? null;
        // The row's platform when the row is known: it is what the control itself is gated on.
        const lever: CampaignOptimizeLever = row === null ? 'none' : campaignActionItemLever(item.rule, row.campaign.platform);
        const campaignName = row?.campaign.campaign_name ?? 'A campaign not in the list below';
        let leverLabel = '';
        let leverBlockedReason = '';
        if (row !== null && lever === 'budget') {
          leverLabel = CAMPAIGN_OPTIMIZE_LEVER_LABELS.budget;
          leverBlockedReason = row.budgetAvailable ? '' : row.budgetUnavailableReason;
          if (leverBlockedReason === '' && budgetPending[row.campaign.id]) {
            leverBlockedReason = 'A budget change for this campaign is in progress.';
          }
        } else if (row !== null && lever === 'pause_resume' && row.action === 'resume') {
          // A `zero_delivery` finding only ever offers PAUSE. Offering the row's current toggle
          // label meant that once the finding had paused the campaign it offered "Resume", and one
          // more click restarted spend on a campaign flagged for delivering nothing. The lever
          // stays `pause_resume` (NOT `none`, which renders "No control for this in LFX One" over a
          // row that has one): still labelled Pause, disabled with the already-paused reason, and
          // `resolveFinding` refuses a blocked finding and only ever toggles a row offering Pause.
          leverLabel = CAMPAIGN_TOGGLE_LABELS.pause;
          leverBlockedReason = CAMPAIGN_FINDING_ALREADY_PAUSED_REASON;
        } else if (row !== null && lever === 'pause_resume') {
          // `pause`, or `unavailable` (shown disabled with the row's reason): the label is always
          // Pause, never the row's toggle word.
          leverLabel = CAMPAIGN_TOGGLE_LABELS.pause;
          leverBlockedReason = this.toggleBlockedReasonFor(
            row,
            !!togglePending[row.campaign.id] || !!budgetPending[row.campaign.id] || !!bidPending[row.campaign.id]
          );
        } else if (lever === 'keywords') {
          leverLabel = CAMPAIGN_OPTIMIZE_LEVER_LABELS.keywords;
        }
        return {
          key: `${item.campaign_id}-${item.rule}`,
          item,
          row,
          campaignName,
          platformLabel: this.platformLabels[item.platform] ?? item.platform,
          lever,
          leverLabel,
          leverAriaLabel: leverLabel === '' ? '' : `${leverLabel} ${campaignName}`,
          leverBlockedReason,
        };
      });
    });
  }

  private initFindingsEmptyMessage(): Signal<string> {
    return computed(() => {
      const metrics = this.briefMetrics();
      if (metrics === null) {
        return '';
      }
      const total = metrics.rows.length;
      // Unreadable rows raise no items, so an empty list only covers the rows that were measured.
      if (metrics.ok_count < total) {
        return `Monitor flagged nothing on the ${metrics.ok_count} of ${total} campaigns it could measure. The others raise no findings until they can be read.`;
      }
      return "Monitor flagged nothing on this brief's campaigns.";
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
        // `toggledStatus` goes too, unlike on a refresh. There it is what the service CONFIRMED
        // for rows still on screen; here those rows are gone, and keeping it would overlay one
        // brief's confirmed statuses onto another brief's ids if they ever collide.
        this.toggledStatus.set({});
        // The budget state belongs to the abandoned rows for the same reasons.
        this.budgetEditorOpen.set({});
        this.budgetPending.set({});
        this.budgetOutcome.set({});
        this.confirmedBudget.set({});
        this.bidEditorOpen.set({});
        this.bidPending.set({});
        this.bidOutcome.set({});
        this.confirmedBid.set({});
        // Negative-keyword requests are keyed by (project, brief, campaign) in the root service, and
        // the campaigns page (which stays mounted across tabs) scopes them; see `setScope`.
        this.negativesEditorOpen.set({});
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
        // MERGED over the previous baseline rather than replacing it, so a row this delivery
        // OMITTED keeps the etag it was last seen at.
        //
        // A wholesale replace erased the baseline for absent rows, and an absent row is not the
        // rare case: `possiblyStale` deliveries include the empty list the index returns before it
        // has caught up, and a refusal answers `[]` outright. Sequence that broke: a 412 conflicts
        // `c-1` at `"3"` → a stale empty refresh drops `c-1` from the baseline → the next refresh
        // returns `c-1` still at `"3"` → it compares against `undefined`, counts as "advanced",
        // and clears the conflict plus the cached validator. The row's rejected etag would then be
        // re-offered as if a re-read had proved it good, which is the opposite of what happened.
        //
        // Keyed on the union, so a row that genuinely disappears keeps a harmless stale entry
        // rather than corrupting the next comparison; `conflictedCampaignIds` is what tracks
        // whether it still matters, and the absence rule below already prunes that.
        this.lastDeliveredEtags = { ...this.lastDeliveredEtags, ...delivered };
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
   * Narrates a keyword action to the toast, which is the surface that SURVIVES a tab switch.
   *
   * `lfx-optimization-tab` renders inside `@case ('optimization')`, so leaving the tab destroys
   * it and every signal these handlers write becomes inert. `MessageService` is provided at app
   * root, so this is the only channel that still reaches an operator who has moved on -- the same
   * reasoning the campaign toggle above already runs on.
   *
   * `sticky` for anything that is not a clean success: an unconfirmed or failed REMOVE is
   * irreversible and still spending, which is not something to let time out on its own.
   */
  private announceKeywordOutcome(action: KeywordActionType, count: number, outcome: 'done' | 'failed' | 'unconfirmed', detail: string): void {
    const noun = count === 1 ? 'keyword' : `${count} keywords`;
    if (outcome === 'done') {
      this.messageService.add({ severity: 'success', summary: `${action === 'pause' ? 'Paused' : 'Removed'} ${noun}`, detail, life: 5000 });
      return;
    }
    this.messageService.add({
      severity: outcome === 'unconfirmed' ? 'warn' : 'error',
      summary: `${action === 'pause' ? 'Pause' : 'Remove'} ${outcome === 'unconfirmed' ? 'not confirmed' : 'failed'} for ${noun}`,
      detail,
      sticky: true,
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
    // The outcome goes to the toast ALONE. `p-toast` is itself a live region (`role="alert"`), so
    // announcing the completion in the local region too would speak one action twice. The region
    // retires this row's message on its own, because it is computed from `togglePending` and the
    // response arm removes this row's entry — no clear to write, and none to forget.
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
  private announceToggleFailure(campaignName: string, message: string, severity: 'warn' | 'error' = 'error'): void {
    // Same single-surface rule. The row's inline failure text is now a plain `aria-describedby`
    // target rather than a `role="alert"`, so this failure is announced exactly once — by the
    // toast — and the inline copy remains readable on demand as the button's description.
    this.messageService.add({ severity, summary: campaignName, detail: message, sticky: true });
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
   * `toggledStatus` is dropped for these ids too, and the reason is the same evidence that got
   * them into this list. An earlier revision kept it unconditionally, reasoning that the overlay
   * exists because the index LAGS a toggle, so clearing it would re-expose the lag: a campaign
   * paused seconds ago, re-read before the index caught up, would render as running. That is
   * correct — for a row whose etag did NOT advance, which is exactly the row this function never
   * receives.
   *
   * An id reaches here only when its indexed etag CHANGED and was not excluded as a write
   * concurrent with the read, which is positive proof the index has caught up past the version
   * this session wrote. At that point the delivered row is the authority and the overlay is the
   * stale one. Keeping it inverted the bug it was written to prevent: this session pauses at v4,
   * another actor resumes at v5, the refresh adopts v5's etag and clears the conflict — and the
   * row went on rendering `paused` and offering Resume, a confident falsehood about a campaign
   * that is spending. The overlay must not outlive the evidence that justified it.
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
    // Dropped alongside the etag, never independently: the two are one claim about one version,
    // and clearing the validator while keeping the status it was minted with is what let the row
    // render a stale `paused` over a newer authoritative row.
    this.toggledStatus.update((statuses) => this.omitKeys(statuses, clearable));
    // A budget 412's message goes with the conflict it reported. Any OTHER outcome stays: an
    // unconfirmed change is not resolved by the index moving, which may only reflect it, and the
    // operator still has to verify it in the ad platform.
    const conflictOutcomes = clearable.filter((id) => this.budgetOutcome()[id]?.state === 'conflict');
    this.budgetOutcome.update((outcomes) => this.omitKeys(outcomes, conflictOutcomes));
    const bidConflictOutcomes = clearable.filter((id) => this.bidOutcome()[id]?.state === 'conflict');
    this.bidOutcome.update((outcomes) => this.omitKeys(outcomes, bidConflictOutcomes));
  }

  /** Opens one row's budget editor for a finding (leaving it open if it already is) and focuses it. */
  private openBudgetEditorFor(row: CampaignRow): void {
    const id = row.campaign.id;
    if (!row.budgetAvailable) {
      return;
    }
    if (!this.budgetEditorOpen()[id]) {
      this.budgetEditorOpen.update((open) => ({ ...open, [id]: true }));
    }
    this.focusAfterRender(`campaign-budget-amount-${id}`);
  }

  /**
   * Focuses an element by id once the pending render has drawn it.
   *
   * `getElementById` rather than a `#id` selector: campaign ids are UUIDs, which may begin with a
   * digit and are then not valid CSS id selectors. `afterNextRender` never runs on the server.
   */
  private focusAfterRender(elementId: string): void {
    afterNextRender(
      () => {
        this.document.getElementById(elementId)?.focus();
      },
      { injector: this.injector }
    );
  }

  /**
   * Returns focus to a row's editor disclosure once its panel closes, so a keyboard user is not
   * dropped to the top of the page. Only when focus is still in the panel (or was lost to the body):
   * a save that lands after the operator moved on must not pull focus back.
   */
  private returnFocusToDisclosure(disclosureId: string, panelId: string): void {
    const active = this.document.activeElement;
    if (active && active !== this.document.body && !this.document.getElementById(panelId)?.contains(active)) {
      return;
    }
    this.focusAfterRender(disclosureId);
  }

  /**
   * Why the row's toggle cannot be used right now, or `''` — the same conditions its own button is
   * disabled on, so the finding's lever and the row control can never disagree.
   */
  private toggleBlockedReasonFor(row: CampaignRow, busy: boolean): string {
    if (row.action === 'unavailable') {
      return row.unavailableReason;
    }
    if (row.conflicted) {
      return CAMPAIGN_TOGGLE_CONFLICT_MESSAGE;
    }
    if (busy) {
      return 'A change to this campaign is in progress.';
    }
    return '';
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
   * Why a row cannot offer the budget editor at all, or `''` when it can.
   *
   * Platform first: a platform without budget-write support upstream is refused whatever the
   * campaign's state. Then provisioning: with no `platform_campaign_id` there is no budget on the
   * platform to change, which upstream refuses with 409. A removed campaign has nothing to change.
   * NOT gated on the toggle's deployment flag or its status sets — the budget route has neither,
   * and a paused campaign's budget is still changeable.
   */
  private budgetUnavailableReasonFor(campaign: CampaignIndexDoc, status: string): string {
    if (typeof campaign.platform !== 'string' || !BUDGET_WRITABLE_CAMPAIGN_PLATFORMS.has(campaign.platform)) {
      return CAMPAIGN_BUDGET_UNAVAILABLE_PLATFORM_REASON;
    }
    if (typeof campaign.platform_campaign_id !== 'string' || campaign.platform_campaign_id.trim() === '') {
      return CAMPAIGN_BUDGET_UNAVAILABLE_UNPROVISIONED_REASON;
    }
    if (status === 'deleted') {
      return CAMPAIGN_UNAVAILABLE_REASONS['deleted'];
    }
    return '';
  }

  /** Why an available budget editor cannot submit right now, or `''`. Stale validator first. */
  private budgetBlockedReasonFor(conflicted: boolean, togglePending: boolean, bidPending: boolean): string {
    if (conflicted) {
      return CAMPAIGN_BUDGET_BLOCKED_STALE_REASON;
    }
    if (togglePending) {
      return CAMPAIGN_BUDGET_BLOCKED_TOGGLE_REASON;
    }
    if (bidPending) {
      return CAMPAIGN_BUDGET_BLOCKED_BID_REASON;
    }
    return '';
  }

  /**
   * Why a row cannot offer the bid editor at all, or `''` when it can. Platform first (Microsoft,
   * Reddit, Meta and X only), then provisioning, then a removed campaign. Whether the campaign's bid
   * STRATEGY takes a manual bid cannot be known here; upstream answers that with a 409.
   */
  private bidUnavailableReasonFor(campaign: CampaignIndexDoc, status: string): string {
    if (typeof campaign.platform !== 'string' || !BID_WRITABLE_CAMPAIGN_PLATFORMS.has(campaign.platform)) {
      return CAMPAIGN_BID_UNAVAILABLE_PLATFORM_REASON;
    }
    if (typeof campaign.platform_campaign_id !== 'string' || campaign.platform_campaign_id.trim() === '') {
      return CAMPAIGN_BID_UNAVAILABLE_UNPROVISIONED_REASON;
    }
    if (status === 'deleted') {
      return CAMPAIGN_UNAVAILABLE_REASONS['deleted'];
    }
    return '';
  }

  /** Why an available bid editor cannot submit right now, or `''`. Stale validator first. */
  private bidBlockedReasonFor(conflicted: boolean, otherWritePending: boolean): string {
    if (conflicted) {
      return CAMPAIGN_BID_BLOCKED_STALE_REASON;
    }
    if (otherWritePending) {
      return CAMPAIGN_BID_BLOCKED_BUSY_REASON;
    }
    return '';
  }

  /** Why a Microsoft row's negative-keyword editor is disabled, or `''`. Only asked for offered rows. */
  private negativeKeywordsUnavailableReasonFor(campaign: CampaignIndexDoc, status: string): string {
    if (typeof campaign.platform_campaign_id !== 'string' || campaign.platform_campaign_id.trim() === '') {
      return CAMPAIGN_NEGATIVE_KEYWORDS_UNAVAILABLE_UNPROVISIONED_REASON;
    }
    if (status === 'deleted') {
      return CAMPAIGN_UNAVAILABLE_REASONS['deleted'];
    }
    return '';
  }

  /**
   * Narrates a confirmed budget change to the toast, which survives a tab switch.
   *
   * States the amount as the platform accepted it, in the account's own currency and without a
   * currency symbol: this app does not know the account's currency, and printing `$` would be a
   * claim it cannot back.
   */
  private announceBudgetSuccess(campaignName: string, budget: number, budgetType: CampaignBudgetChange['budgetType']): void {
    this.messageService.add({
      severity: 'success',
      summary: `Budget changed for ${campaignName}`,
      detail: `New ${budgetType} budget: ${budget} in the ad account's currency.`,
      life: 5000,
    });
  }

  /**
   * Narrates a budget change that did not succeed. Sticky in every case: a refusal leaves a
   * campaign spending at the old amount, and an unconfirmed change needs checking in the platform.
   *
   * UNCONFIRMED is a warning, not an error, and its summary says the change may already be applied
   * — the distinction the operator has to act on before trying again.
   */
  private announceBudgetFailure(campaignName: string, outcome: CampaignBudgetOutcome): void {
    if (outcome.state === 'unconfirmed') {
      this.messageService.add({
        severity: 'warn',
        summary: `Budget change not confirmed for ${campaignName}`,
        detail: `It may already be applied. ${outcome.message}`,
        sticky: true,
      });
      return;
    }
    this.messageService.add({ severity: 'error', summary: `Budget not changed for ${campaignName}`, detail: outcome.message, sticky: true });
  }

  /**
   * Narrates a confirmed bid change to the toast. No currency symbol: the bid is in the ad
   * account's own currency, which this app does not know.
   */
  private announceBidSuccess(campaignName: string, bid: number): void {
    this.messageService.add({
      severity: 'success',
      summary: `Bid changed for ${campaignName}`,
      detail: `New max cost-per-click bid: ${bid} in the ad account's currency.`,
      life: 5000,
    });
  }

  /** Narrates a bid change that did not succeed. Sticky; UNCONFIRMED is a warning that says it may have applied. */
  private announceBidFailure(campaignName: string, outcome: CampaignBidOutcome): void {
    if (outcome.state === 'unconfirmed') {
      this.messageService.add({
        severity: 'warn',
        summary: `Bid change not confirmed for ${campaignName}`,
        detail: `It may have applied. ${outcome.message}`,
        sticky: true,
      });
      return;
    }
    this.messageService.add({ severity: 'error', summary: `Bid not changed for ${campaignName}`, detail: outcome.message, sticky: true });
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
