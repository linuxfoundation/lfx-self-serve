// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  CAMPAIGN_TOGGLE_LABELS,
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
import type { Subscription } from 'rxjs';

@Component({
  selector: 'lfx-optimization-tab',
  imports: [DecimalPipe, AdsCurrencyPipe, AdsPctPipe, EventLabelPipe, PacingClassPipe, PriorityClassPipe, QualityScoreClassPipe],
  templateUrl: './optimization-tab.component.html',
  styleUrl: './optimization-tab.component.scss',
})
export class OptimizationTabComponent implements OnInit {
  private readonly campaignService = inject(CampaignService);
  private readonly destroyRef = inject(DestroyRef);

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
      const action = deploymentDisabled ? 'unavailable' : campaignToggleAction(status, campaign.platform);
      // The platform reason wins when it applies, because it is the one the operator cannot act
      // on. A Microsoft row in `pending` is BOTH not-yet-created and not-supported-here; telling
      // them it "resolves itself once it finishes" would promise a button that never arrives.
      const platformUnsupported = !TOGGLEABLE_CAMPAIGN_PLATFORMS.has(campaign.platform);
      return {
        campaign,
        status,
        action,
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

    const status: CampaignToggleStatus = row.action === 'pause' ? 'PAUSED' : 'ACTIVE';
    this.togglePending.update((p) => ({ ...p, [campaign.id]: true }));
    this.toggleError.update((e) => {
      const next = { ...e };
      delete next[campaign.id];
      return next;
    });

    this.campaignService
      .updateCampaignStatus({
        projectSlug: this.projectSlug(),
        briefId: this.briefId(),
        campaignId: campaign.id,
        platform: campaign.platform as CampaignPlatform,
        status,
        etag,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
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
          }
        },
        error: () => {
          this.togglePending.update((p) => ({ ...p, [campaign.id]: false }));
          // Deliberately NOT optimistic: nothing about the row's status is changed on failure, so
          // the button still offers the action that did not happen. Claiming the pause landed
          // would be the expensive lie here — someone would stop watching a campaign that is
          // still spending.
          //
          // Worded PER DIRECTION, because the outcome differs by direction and both are about
          // money. A failed pause leaves the campaign RUNNING; a failed resume leaves it PAUSED.
          // Stating "it has not been paused" after a failed resume is the exact inversion of the
          // truth — it describes a campaign that is spending when the campaign is in fact dark.
          const message =
            row.action === 'pause'
              ? 'Could not pause this campaign. It is still running — try again.'
              : 'Could not resume this campaign. It is still paused — try again.';
          this.toggleError.update((e) => ({ ...e, [campaign.id]: message }));
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
