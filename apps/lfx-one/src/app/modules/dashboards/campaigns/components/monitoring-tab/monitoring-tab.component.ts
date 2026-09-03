// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { skip, type Subscription } from 'rxjs';
import { CAMPAIGN_PACING_THRESHOLDS, parseCampaignName, PLATFORM_BRAND_COLORS } from '@lfx-one/shared/constants';
import { formatPercent } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';

import type {
  CampaignMetrics,
  CampaignMonitorResponse,
  KeywordMetrics,
  KeywordMetricsResponse,
  LinkedInAccount,
  LinkedInMonitorResponse,
  LinkedInPacingLabel,
  MetaAccountOption,
  MetaMonitorResponse,
  RedditAccountOption,
  RedditMonitorResponse,
  RedditPacingLabel,
} from '@lfx-one/shared/interfaces';

import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { MetaPacingClassPipe } from '@pipes/campaign-optimization.pipe';
import { AudienceDemographicsComponent } from '../audience-demographics/audience-demographics.component';

type DateRangeOption = 7 | 14 | 30;
type PlatformType = 'google' | 'linkedin' | 'reddit' | 'meta';

const KEYWORD_PAGE_SIZE = 10;

@Component({
  selector: 'lfx-monitoring-tab',
  imports: [AudienceDemographicsComponent, MetaPacingClassPipe],
  templateUrl: './monitoring-tab.component.html',
  styleUrl: './monitoring-tab.component.scss',
})
export class MonitoringTabComponent implements OnInit {
  private readonly campaignService = inject(CampaignService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private monitorSub: Subscription | null = null;
  private keywordsSub: Subscription | null = null;
  private linkedInSub: Subscription | null = null;
  private redditSub: Subscription | null = null;
  private readonly currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  protected readonly Math = Math;
  protected readonly platformColors = PLATFORM_BRAND_COLORS;
  protected readonly dateRangeOptions: DateRangeOption[] = [7, 14, 30];
  protected readonly keywordPageSize = KEYWORD_PAGE_SIZE;
  protected readonly copiedName = signal<string | null>(null);

  protected readonly selectedDays = signal<DateRangeOption>(30);
  protected readonly loading = signal(false);
  protected readonly monitorData = signal<CampaignMonitorResponse | null>(null);
  protected readonly error = signal<string | null>(null);

  // Platform switcher
  protected readonly selectedPlatform = signal<PlatformType>('google');
  protected readonly linkedInAccountOptions = signal<LinkedInAccount[]>([]);
  protected readonly selectedLinkedInAccountKey = signal<string>('');
  protected readonly linkedInLoading = signal(false);
  protected readonly linkedInData = signal<LinkedInMonitorResponse | null>(null);
  protected readonly linkedInError = signal<string | null>(null);
  protected readonly linkedInCampaigns = computed(() => this.linkedInData()?.campaigns ?? []);
  protected readonly linkedInTotals = computed(() => this.linkedInData()?.accountTotals ?? null);
  protected readonly linkedInPulledAt = computed(() => {
    const pulledAt = this.linkedInData()?.pulledAt;
    return pulledAt ? new Date(pulledAt).toLocaleString() : null;
  });

  // Reddit
  protected readonly redditAccountOptions = signal<RedditAccountOption[]>([]);
  protected readonly selectedRedditAccountKey = signal<string>('');
  protected readonly redditLoading = signal(false);
  protected readonly redditData = signal<RedditMonitorResponse | null>(null);
  protected readonly redditError = signal<string | null>(null);
  protected readonly redditCampaigns = computed(() => this.redditData()?.campaigns ?? []);
  protected readonly redditTotals = computed(() => this.redditData()?.accountTotals ?? null);
  protected readonly redditPulledAt = computed(() => {
    const pulledAt = this.redditData()?.pulledAt;
    return pulledAt ? new Date(pulledAt).toLocaleString() : null;
  });

  // Meta
  private metaSub: Subscription | null = null;
  protected readonly metaAccountOptions = signal<MetaAccountOption[]>([]);
  protected readonly selectedMetaAccountKey = signal<string>('');
  protected readonly metaLoading = signal(false);
  protected readonly metaData = signal<MetaMonitorResponse | null>(null);
  protected readonly metaError = signal<string | null>(null);
  protected readonly metaCampaigns = computed(() => this.metaData()?.campaigns ?? []);
  protected readonly metaTotals = computed(() => this.metaData()?.accountTotals ?? null);
  protected readonly metaPulledAt = computed(() => {
    const pulledAt = this.metaData()?.pulledAt;
    return pulledAt ? new Date(pulledAt).toLocaleString() : null;
  });

  protected readonly keywordsLoading = signal(false);
  protected readonly keywordsData = signal<KeywordMetricsResponse | null>(null);
  protected readonly keywordsError = signal<string | null>(null);
  protected readonly keywordPage = signal(1);

  protected readonly campaigns = computed(() => this.monitorData()?.campaigns ?? []);
  protected readonly accountTotals = computed(() => this.monitorData()?.accountTotals ?? null);
  protected readonly pulledAt = computed(() => this.monitorData()?.pulledAt ?? '');
  protected readonly hasCampaigns = computed(() => this.campaigns().length > 0);

  /**
   * Account CTR, or NULL when it cannot be computed.
   *
   * Returning 0 conflated two different facts: "no totals arrived" (the read failed, or has not
   * loaded) and "there were impressions but no clicks" — a measured zero. The template rendered
   * both as `0.0%`, so an outage displayed as a real measurement.
   *
   * `null` for both non-computable cases, which the template renders as an em dash. That is
   * what the LinkedIn, Reddit and Meta panels in this same file already do — Google was the
   * odd one out.
   *
   * Zero impressions stays non-computable rather than 0: clicks/0 is undefined, and reporting
   * 0% for a campaign that served nothing states a click-through rate that was never measured.
   */
  protected readonly totalCtr = computed<number | null>(() => {
    const totals = this.accountTotals();
    if (!totals || totals.impressions === 0) return null;
    return (totals.clicks / totals.impressions) * 100;
  });

  protected readonly keywords = computed(() => this.keywordsData()?.keywords ?? []);
  protected readonly keywordTotals = computed(() => this.keywordsData()?.totals ?? null);
  /**
   * True only when the backend positively reported more keywords than it returned.
   *
   * `=== true` rather than a truthiness check, deliberately: the field is optional because the
   * legacy path cannot know (a bare LIMIT with no probe for a further row), and `undefined` there
   * means "unknown", not "complete". Treating unknown as truncated would caption every legacy
   * response as partial; treating it as complete is the status quo those numbers already carry.
   */
  protected readonly keywordTotalsPartial = computed(() => this.keywordsData()?.truncated === true);
  /**
   * Completeness was never established (`truncated` absent = UNKNOWN per the contract).
   *
   * Weaker consequence here than on the optimization tab, deliberately. This tab attaches no
   * claim to the totals when the flag is false -- it simply omits the "(top N)" qualifier -- so
   * the failure mode is a missing caveat, not a false statement. The caption below says which
   * keywords the numbers cover WITHOUT asserting they are all of them.
   */
  protected readonly keywordTotalsUnverified = computed(() => this.keywordsData()?.truncated === undefined);
  protected readonly hasKeywords = computed(() => this.keywords().length > 0);
  protected readonly keywordTotalPages = computed(() => Math.max(1, Math.ceil(this.keywords().length / KEYWORD_PAGE_SIZE)));
  protected readonly hasKeywordPrevPage = computed(() => this.keywordPage() > 1);
  protected readonly hasKeywordNextPage = computed(() => this.keywordPage() < this.keywordTotalPages());

  protected readonly visibleKeywords = computed<KeywordMetrics[]>(() => {
    const all = this.keywords();
    const start = (this.keywordPage() - 1) * KEYWORD_PAGE_SIZE;
    return all.slice(start, start + KEYWORD_PAGE_SIZE);
  });

  protected readonly keywordPageNumbers = computed(() => Array.from({ length: this.keywordTotalPages() }, (_, i) => i + 1));

  protected readonly activeFoundationSlug = computed(() => this.projectContextService.activeContext()?.slug ?? '');

  public constructor() {
    // toObservable + skip(1) per frontend-checklist §5 ("No effect() — use toObservable() with
    // RxJS pipes instead"). skip(1) drops the emission toObservable fires immediately on
    // subscribe — ngOnInit already runs the initial load, so only later foundation switches
    // should reach loadForActiveFoundation().
    toObservable(this.activeFoundationSlug)
      .pipe(skip(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadForActiveFoundation());
  }

  public ngOnInit(): void {
    this.loadForActiveFoundation();
  }

  protected setDateRange(days: DateRangeOption): void {
    this.selectedDays.set(days);
    this.fetchData();
    if (this.selectedPlatform() === 'linkedin') {
      this.fetchLinkedInData();
    } else if (this.selectedPlatform() === 'reddit') {
      this.fetchRedditData();
    } else if (this.selectedPlatform() === 'meta') {
      this.fetchMetaData();
    } else {
      this.linkedInData.set(null);
      this.redditData.set(null);
      this.metaData.set(null);
    }
  }

  protected refresh(): void {
    this.fetchData();
    if (this.selectedPlatform() === 'linkedin') {
      this.fetchLinkedInData();
    } else if (this.selectedPlatform() === 'reddit') {
      this.fetchRedditData();
    } else if (this.selectedPlatform() === 'meta') {
      this.fetchMetaData();
    }
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
          // the operator-facing text as `{ error: string }` (base.error.ts:78), so `.error.message`
          // is undefined for every error this path produces and the operator got Angular's generic
          // "Http failure response for <url>" instead of the actionable upstream reason. The same
          // reading already exists in `toTransportOutcome`; these loaders never got it (Copilot).
          this.error.set(extractErrorMessage(err, 'Failed to load campaign data'));
          this.loading.set(false);
        },
      });

    this.keywordsLoading.set(true);
    this.keywordsError.set(null);
    this.keywordPage.set(1);
    this.keywordsSub = this.campaignService
      .getKeywords(this.activeFoundationSlug(), days)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.keywordsData.set(result);
          this.keywordsLoading.set(false);
        },
        error: (err: unknown) => {
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.keywordsError.set(extractErrorMessage(httpErr, 'Failed to load keywords'));
          this.keywordsLoading.set(false);
        },
      });
  }

  protected goToKeywordPage(page: number): void {
    this.keywordPage.set(Math.max(1, Math.min(page, this.keywordTotalPages())));
  }

  protected copyName(name: string): void {
    if (isPlatformBrowser(this.platformId)) {
      void navigator.clipboard
        .writeText(name)
        .then(() => {
          this.copiedName.set(name);
          const captured = name;
          const timer = setTimeout(() => {
            if (this.copiedName() === captured) this.copiedName.set(null);
          }, 2000);
          this.destroyRef.onDestroy(() => clearTimeout(timer));
        })
        .catch(() => undefined);
    }
  }

  protected setPlatform(p: PlatformType): void {
    this.selectedPlatform.set(p);
    if (p === 'linkedin') {
      this.fetchLinkedInData();
    } else if (p === 'reddit') {
      this.fetchRedditData();
    } else if (p === 'meta') {
      this.fetchMetaData();
    }
  }

  protected setLinkedInAccount(key: string): void {
    this.selectedLinkedInAccountKey.set(key);
    this.fetchLinkedInData();
  }

  protected onLinkedInAccountChange(event: Event): void {
    this.setLinkedInAccount((event.target as HTMLSelectElement).value);
  }

  protected fetchLinkedInData(): void {
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

  protected linkedInPacingClass(label: LinkedInPacingLabel): string {
    if (label === 'underspending') return 'text-red-600';
    if (label === 'constrained' || label === 'overspending') return 'text-amber-600';
    return 'text-green-600';
  }

  protected formatLinkedInCurrency(n: number): string {
    return this.currencyFormatter.format(n);
  }

  protected formatLinkedInPct(n: number): string {
    return `${formatPercent(n)}%`;
  }

  protected setRedditAccount(key: string): void {
    this.selectedRedditAccountKey.set(key);
    this.fetchRedditData();
  }

  protected onRedditAccountChange(event: Event): void {
    this.setRedditAccount((event.target as HTMLSelectElement).value);
  }

  protected fetchRedditData(): void {
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

  protected redditPacingClass(label: RedditPacingLabel): string {
    if (label === 'underspending') return 'text-red-600';
    if (label === 'constrained' || label === 'overspending') return 'text-amber-600';
    return 'text-green-600';
  }

  protected setMetaAccount(key: string): void {
    this.selectedMetaAccountKey.set(key);
    this.fetchMetaData();
  }

  protected onMetaAccountChange(event: Event): void {
    this.setMetaAccount((event.target as HTMLSelectElement).value);
  }

  protected fetchMetaData(): void {
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

  protected eventLabel(campaignName: string): string {
    return parseCampaignName(campaignName).baseName || campaignName;
  }

  protected qualityScoreClass(score: number | null): string {
    if (score === null) return 'text-gray-400';
    if (score >= 7) return 'text-green-700';
    if (score >= 4) return 'text-amber-700';
    return 'text-red-700';
  }

  protected matchTypeClass(type: string): string {
    switch (type) {
      case 'EXACT':
        return 'bg-blue-100 text-blue-700';
      case 'PHRASE':
        return 'bg-violet-100 text-violet-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }

  protected formatDate(dateStr: string): string {
    if (!dateStr) return '–';
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00` : dateStr;
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return '–';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  protected pacingClass(campaign: CampaignMetrics): string {
    const pct = campaign.pacingPct;
    if (pct < CAMPAIGN_PACING_THRESHOLDS.underspending) return 'bg-red-500';
    if (pct <= CAMPAIGN_PACING_THRESHOLDS.normal) return 'bg-green-500';
    if (pct <= CAMPAIGN_PACING_THRESHOLDS.constrained) return 'bg-amber-500';
    return 'bg-red-500';
  }

  /**
   * Two decimals for every monetary figure on this tab. Budgets and spend are cents-denominated
   * amounts a user reconciles against the ad platform's own reporting, and avgCpc is typically
   * under a dollar — one-decimal rounding would turn $10.04 into $10 and a $0.42 CPC into $0.4.
   * `formatCompactRounded` is for derived figures with unbounded precision (CPA), not these.
   */
  protected formatCurrency(value: number): string {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  protected formatNumber(value: number): string {
    return value.toLocaleString('en-US');
  }

  protected formatPct(value: number): string {
    return `${formatPercent(value)}%`;
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

    // Also cancel any in-flight per-platform monitor fetch for the OLD foundation — clearing the
    // signal below isn't enough on its own. If the new foundation has no accounts for a platform,
    // `fetchLinkedInData`/etc never runs again to replace the subscription, so a late response
    // from the old foundation's request would otherwise land after the clear and put that
    // foundation's data back on screen under the new one.
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

    // Same reason as the per-platform signals above: the templates gate their loading placeholder
    // on `loading() && !monitorData()` (and the keywords equivalent), so leaving the aggregate data
    // from the OLD foundation in place would render it under the new foundation until the new
    // request resolves — or indefinitely if it fails.
    this.monitorData.set(null);
    this.keywordsData.set(null);

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
          if (accounts.length > 0 && !this.selectedLinkedInAccountKey()) {
            this.selectedLinkedInAccountKey.set(accounts[0].accountId);
            if (this.selectedPlatform() === 'linkedin') {
              this.fetchLinkedInData();
            }
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
          if (accounts.length > 0 && !this.selectedRedditAccountKey()) {
            this.selectedRedditAccountKey.set(accounts[0].key);
            if (this.selectedPlatform() === 'reddit') {
              this.fetchRedditData();
            }
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
          if (accounts.length > 0 && !this.selectedMetaAccountKey()) {
            this.selectedMetaAccountKey.set(accounts[0].key);
            if (this.selectedPlatform() === 'meta') {
              this.fetchMetaData();
            }
          }
        },
        error: (err: unknown) => {
          if (metaSlug !== this.activeFoundationSlug()) return;
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.metaError.set(extractErrorMessage(httpErr, 'Failed to load Meta accounts'));
        },
      });
  }
}
