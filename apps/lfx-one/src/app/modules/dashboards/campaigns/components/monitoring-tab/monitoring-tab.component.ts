// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { skip, type Observable, type Subscription } from 'rxjs';
import {
  ACCOUNT_MONITOR_METRICS_DISABLED_CODE,
  CAMPAIGN_PACING_THRESHOLDS,
  CAMPAIGN_PLATFORMS,
  HUBSPOT_BRAND_COLOR,
  MONITOR_CONNECTION_PROVIDERS,
  parseCampaignName,
  PLATFORM_BRAND_COLORS,
} from '@lfx-one/shared/constants';
import { formatPercent } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';

import type {
  CampaignMetrics,
  CampaignMonitorConnections,
  CampaignMonitorResponse,
  HubSpotEmailMonitorResponse,
  KeywordMetrics,
  KeywordMetricsResponse,
  LinkedInAccount,
  LinkedInCampaignMetrics,
  LinkedInMonitorResponse,
  LinkedInPacingLabel,
  MetaAccountOption,
  MetaCampaignMetrics,
  MetaMonitorResponse,
  MonitorConnectionAccount,
  MonitorConnectionPlatform,
  MonitorPanelKey,
  MonitorPanelNotice,
  MonitorPanelNoticeState,
  RedditAccountOption,
  RedditCampaignMetrics,
  RedditMonitorResponse,
  RedditPacingLabel,
  ReportBackedMonitorResponse,
} from '@lfx-one/shared/interfaces';

import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { MetaPacingClassPipe } from '@pipes/campaign-optimization.pipe';
import { AudienceDemographicsComponent } from '../audience-demographics/audience-demographics.component';

type DateRangeOption = 7 | 14 | 30;
type PlatformType = 'google' | 'linkedin' | 'reddit' | 'meta' | 'microsoft' | 'twitter' | 'hubspot';

const KEYWORD_PAGE_SIZE = 10;

@Component({
  selector: 'lfx-monitoring-tab',
  imports: [AudienceDemographicsComponent, MetaPacingClassPipe, NgTemplateOutlet],
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
  // Only the id and label are rendered; with the monitor cutover on, the one option is the
  // project's connection's account, which carries no org id.
  protected readonly linkedInAccountOptions = signal<Pick<LinkedInAccount, 'accountId' | 'label'>[]>([]);
  protected readonly selectedLinkedInAccountKey = signal<string>('');
  protected readonly linkedInLoading = signal(false);
  protected readonly linkedInData = signal<LinkedInMonitorResponse | null>(null);
  protected readonly linkedInError = signal<string | null>(null);
  protected readonly linkedInCampaigns = computed(() => this.linkedInData()?.campaigns ?? []);
  protected readonly linkedInTotals = computed(() => this.linkedInData()?.accountTotals ?? null);
  protected readonly linkedInTotalsNote = computed(() => this.totalsCoverageNote(this.linkedInCampaigns()));
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
  protected readonly redditTotalsNote = computed(() => this.totalsCoverageNote(this.redditCampaigns()));
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
  protected readonly metaTotalsNote = computed(() => this.totalsCoverageNote(this.metaCampaigns()));
  protected readonly metaPulledAt = computed(() => {
    const pulledAt = this.metaData()?.pulledAt;
    return pulledAt ? new Date(pulledAt).toLocaleString() : null;
  });

  // campaign-service monitor cutover (#2519). Set from `/monitor/connections`: while the server's
  // flag is off it stays false, the legacy account lists fill the pickers, and nothing below renders.
  private connectionsSub: Subscription | null = null;
  protected readonly monitorViaCampaignService = signal(false);
  protected readonly monitorConnections = signal<CampaignMonitorConnections['platforms']>({});
  protected readonly metricsDisabledPlatforms = signal<ReadonlySet<MonitorConnectionPlatform>>(new Set());
  /** X stays hidden while the app does not offer it (`disabled: true` in `CAMPAIGN_PLATFORMS`), whatever the flag says. */
  protected readonly twitterOffered = !CAMPAIGN_PLATFORMS.find((p) => p.id === 'twitter-ads')?.disabled;
  protected readonly hubSpotColor = HUBSPOT_BRAND_COLOR;

  // Microsoft Ads / X: one report-backed panel, showing whichever of the two is selected.
  private reportBackedSub: Subscription | null = null;
  protected readonly reportBackedLoading = signal(false);
  protected readonly reportBackedData = signal<ReportBackedMonitorResponse | null>(null);
  protected readonly reportBackedError = signal<string | null>(null);
  protected readonly reportBackedCampaigns = computed(() => this.reportBackedData()?.campaigns ?? []);
  protected readonly reportBackedTotals = computed(() => this.reportBackedData()?.accountTotals ?? null);
  protected readonly reportBackedTotalsNote = computed(() => this.totalsCoverageNote(this.reportBackedCampaigns()));
  protected readonly reportBackedPulledAt = computed(() => {
    const pulledAt = this.reportBackedData()?.pulledAt;
    return pulledAt ? new Date(pulledAt).toLocaleString() : null;
  });

  // HubSpot email monitor: project-scoped, so no account picker.
  private hubSpotSub: Subscription | null = null;
  protected readonly hubSpotLoading = signal(false);
  protected readonly hubSpotData = signal<HubSpotEmailMonitorResponse | null>(null);
  protected readonly hubSpotError = signal<string | null>(null);
  protected readonly hubSpotNoticeState = signal<MonitorPanelNoticeState | null>(null);
  protected readonly hubSpotEmails = computed(() => this.hubSpotData()?.emails ?? []);
  protected readonly hubSpotPulledAt = computed(() => {
    const pulledAt = this.hubSpotData()?.pulledAt;
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

  /** The empty state each panel shows instead of data, keyed by panel. Always empty while the cutover is off. */
  protected readonly panelNotices: Signal<Partial<Record<MonitorPanelKey, MonitorPanelNotice>>> = this.initPanelNotices();
  /** The connection's account the Microsoft/X panel reads, or null when it has none (or another panel is selected). */
  protected readonly reportBackedAccount: Signal<MonitorConnectionAccount | null> = this.initReportBackedAccount();
  /** Which of the two report-backed platforms the shared panel is showing. */
  protected readonly reportBackedPanel = computed<'microsoft' | 'twitter'>(() => (this.selectedPlatform() === 'twitter' ? 'twitter' : 'microsoft'));
  protected readonly reportBackedLabel = computed(() => (this.reportBackedPanel() === 'twitter' ? 'X Ads' : 'Microsoft Ads'));
  protected readonly reportBackedFreshness: Signal<string | null> = this.initReportBackedFreshness();
  protected readonly hubSpotFreshness: Signal<string | null> = this.initHubSpotFreshness();
  protected readonly hubSpotCoverageNote: Signal<string | null> = this.initHubSpotCoverageNote();

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
    } else if (this.isReportBackedPlatform(this.selectedPlatform())) {
      this.fetchReportBackedData();
    } else if (this.selectedPlatform() === 'hubspot') {
      this.fetchHubSpotData();
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
    } else if (this.isReportBackedPlatform(this.selectedPlatform())) {
      this.fetchReportBackedData();
    } else if (this.selectedPlatform() === 'hubspot') {
      this.fetchHubSpotData();
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
          // the operator-facing text as `{ error: string }` (`BaseApiError.toResponse`), so `.error.message`
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
    } else if (this.isReportBackedPlatform(p)) {
      // Microsoft and X share one panel's signals, so the other platform's figures must not show
      // under this one's name while the read is in flight.
      this.reportBackedData.set(null);
      this.reportBackedError.set(null);
      this.fetchReportBackedData();
    } else if (p === 'hubspot') {
      this.fetchHubSpotData();
    }
  }

  /**
   * The action on a panel's empty state. A connection state is re-read (a connection may have been
   * added or bound meanwhile), which re-fetches the selected panel once it arrives; "metrics not
   * enabled" is cleared and the panel read again, since enabling them changes nothing on our side.
   */
  protected retryPanel(panel: MonitorPanelKey): void {
    if (panel === 'hubspot') {
      this.fetchHubSpotData();
      return;
    }
    const notice = this.panelNotices()[panel];
    this.setMetricsDisabled(panel, false);
    if (notice?.state === 'metrics_disabled') {
      this.fetchSelectedPanel();
      return;
    }
    this.loadMonitorConnections();
  }

  protected fetchReportBackedData(): void {
    const platform = this.selectedPlatform();
    if (platform !== 'microsoft' && platform !== 'twitter') return;
    this.reportBackedSub?.unsubscribe();
    const accountId = this.reportBackedAccount()?.accountId;
    if (!accountId) {
      // No bound account: the panel shows the connection's empty state, and there is nothing to read.
      this.reportBackedLoading.set(false);
      return;
    }
    const label = this.reportBackedLabel();
    this.reportBackedLoading.set(true);
    this.reportBackedError.set(null);
    const request: Observable<ReportBackedMonitorResponse> =
      platform === 'microsoft'
        ? this.campaignService.getMicrosoftMonitorData(this.activeFoundationSlug(), accountId, this.selectedDays())
        : this.campaignService.getTwitterMonitorData(this.activeFoundationSlug(), accountId, this.selectedDays());
    this.reportBackedSub = request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.setMetricsDisabled(platform, false);
        this.reportBackedData.set(data);
        this.reportBackedLoading.set(false);
      },
      error: (err: unknown) => {
        this.reportBackedLoading.set(false);
        if (this.isMetricsDisabledError(err)) {
          this.reportBackedData.set(null);
          this.setMetricsDisabled(platform, true);
          return;
        }
        this.reportBackedError.set(this.reportBackedErrorMessage(err, label));
      },
    });
  }

  protected fetchHubSpotData(): void {
    this.hubSpotSub?.unsubscribe();
    this.hubSpotLoading.set(true);
    this.hubSpotError.set(null);
    this.hubSpotNoticeState.set(null);
    this.hubSpotSub = this.campaignService
      .getHubSpotMonitorData(this.activeFoundationSlug(), this.selectedDays())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.hubSpotData.set(data);
          this.hubSpotLoading.set(false);
        },
        error: (err: unknown) => {
          this.hubSpotLoading.set(false);
          this.hubSpotData.set(null);
          if (this.isMetricsDisabledError(err)) {
            this.hubSpotNoticeState.set('metrics_disabled');
          } else if ((err as { status?: unknown } | null)?.status === 404) {
            // The button only shows with the cutover on, so a 404 here is campaign-service finding no
            // HubSpot connection for the project and no LF system one to fall back to.
            this.hubSpotNoticeState.set('no_connection');
          } else {
            this.hubSpotError.set(extractErrorMessage(err, 'Failed to load HubSpot email data'));
          }
        },
      });
  }

  /** HubSpot rates are fractions; null — a rate over zero deliveries — is unknown, never 0%. */
  protected formatRate(rate: number | null): string {
    return rate === null ? '—' : `${formatPercent(rate * 100)}%`;
  }

  protected priorityClass(priority: string): string {
    if (priority === 'HIGH') return 'bg-red-50 text-red-700';
    if (priority === 'MED') return 'bg-amber-50 text-amber-700';
    return 'bg-gray-100 text-gray-600';
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
          this.setMetricsDisabled('linkedin', false);
          this.linkedInData.set(data);
          this.linkedInLoading.set(false);
        },
        error: (err: unknown) => {
          if (this.isMetricsDisabledError(err)) {
            this.linkedInData.set(null);
            this.setMetricsDisabled('linkedin', true);
            this.linkedInLoading.set(false);
            return;
          }
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
          this.setMetricsDisabled('reddit', false);
          this.redditData.set(data);
          this.redditLoading.set(false);
        },
        error: (err: unknown) => {
          if (this.isMetricsDisabledError(err)) {
            this.redditData.set(null);
            this.setMetricsDisabled('reddit', true);
            this.redditLoading.set(false);
            return;
          }
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
          this.setMetricsDisabled('meta', false);
          this.metaData.set(data);
          this.metaLoading.set(false);
        },
        error: (err: unknown) => {
          if (this.isMetricsDisabledError(err)) {
            this.metaData.set(null);
            this.setMetricsDisabled('meta', true);
            this.metaLoading.set(false);
            return;
          }
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

  private initPanelNotices(): Signal<Partial<Record<MonitorPanelKey, MonitorPanelNotice>>> {
    return computed(() => {
      const notices: Partial<Record<MonitorPanelKey, MonitorPanelNotice>> = {};
      if (!this.monitorViaCampaignService()) return notices;
      const connections = this.monitorConnections();
      const disabled = this.metricsDisabledPlatforms();
      for (const platform of Object.keys(MONITOR_CONNECTION_PROVIDERS) as MonitorConnectionPlatform[]) {
        const state = connections[platform]?.state;
        // No state yet means the connections are still loading: no notice, the panel just waits.
        if (state && state !== 'connected') {
          notices[platform] = this.noticeFor(platform, state);
        } else if (state === 'connected' && disabled.has(platform)) {
          notices[platform] = this.noticeFor(platform, 'metrics_disabled');
        }
      }
      const hubSpotState = this.hubSpotNoticeState();
      if (hubSpotState) {
        notices.hubspot = this.noticeFor('hubspot', hubSpotState);
      }
      return notices;
    });
  }

  private initReportBackedAccount(): Signal<MonitorConnectionAccount | null> {
    return computed(() => {
      const platform = this.selectedPlatform();
      if (platform !== 'microsoft' && platform !== 'twitter') return null;
      const connection = this.monitorConnections()[platform];
      return connection?.state === 'connected' ? connection : null;
    });
  }

  /**
   * How fresh the Microsoft/X figures are, in words. These platforms serve the last FINISHED
   * report, so the time the figures describe is not the time of this read, and an operator
   * reconciling against the platform needs to know which.
   */
  private initReportBackedFreshness(): Signal<string | null> {
    return computed(() => {
      const data = this.reportBackedData();
      if (!data) return null;
      if (data.metricsAsOf) {
        const window = data.metricsWindowStart && data.metricsWindowEnd ? `, covering ${data.metricsWindowStart} → ${data.metricsWindowEnd}` : '';
        const pending = data.metricsPending ? ' A newer report is building — refresh in a few minutes for newer figures.' : '';
        return `Metrics as of ${new Date(data.metricsAsOf).toLocaleString()}${window}.${pending}`;
      }
      if (data.metricsPending) {
        return 'The first report for this account is building, so its campaigns show "Couldn\'t read" until it finishes. Refresh in a few minutes.';
      }
      return 'No report has finished for this account yet, so its campaigns show "Couldn\'t read".';
    });
  }

  private initHubSpotFreshness(): Signal<string | null> {
    return computed(() => {
      const data = this.hubSpotData();
      if (!data?.metricsAsOf) return null;
      const window = data.metricsWindowStart && data.metricsWindowEnd ? ` Emails sent ${data.metricsWindowStart} → ${data.metricsWindowEnd}.` : '';
      return `Counters as of ${new Date(data.metricsAsOf).toLocaleString()} (totals to date, not only the window).${window}`;
    });
  }

  /** What the HubSpot totals leave out, or null when they cover every recorded email. */
  private initHubSpotCoverageNote(): Signal<string | null> {
    return computed(() => {
      const data = this.hubSpotData();
      if (!data) return null;
      const parts: string[] = [];
      if (data.emailsNotSentInWindow > 0) {
        parts.push(`${data.emailsNotSentInWindow} of ${data.emailsChecked} recorded emails had no send in this window`);
      }
      if (data.emailsUnattributable > 0) {
        parts.push(`${data.emailsUnattributable} could not be read safely (their HubSpot portal is unrecorded or has changed)`);
      }
      if (data.emailsTruncated) {
        parts.push('only the 50 most recently recorded campaigns were checked, so the totals may omit older emails');
      }
      if (parts.length === 0) return null;
      const sentence = parts.join('; ');
      return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
    });
  }

  /** Read the selected platform's panel (not Google's, which `fetchData` owns). */
  private fetchSelectedPanel(): void {
    const platform = this.selectedPlatform();
    if (platform === 'linkedin') {
      this.fetchLinkedInData();
    } else if (platform === 'reddit') {
      this.fetchRedditData();
    } else if (platform === 'meta') {
      this.fetchMetaData();
    } else if (this.isReportBackedPlatform(platform)) {
      this.fetchReportBackedData();
    } else if (platform === 'hubspot') {
      this.fetchHubSpotData();
    }
  }

  private isReportBackedPlatform(platform: PlatformType): boolean {
    return platform === 'microsoft' || platform === 'twitter';
  }

  private connectedAccount(connection: MonitorConnectionAccount | undefined): { accountId: string; label: string } | null {
    if (connection?.state !== 'connected' || !connection.accountId) return null;
    return { accountId: connection.accountId, label: connection.label || connection.accountId };
  }

  private setMetricsDisabled(platform: MonitorConnectionPlatform, disabled: boolean): void {
    const current = this.metricsDisabledPlatforms();
    // Only a real change writes, so the legacy path (which never disables anything) never touches it.
    if (current.has(platform) === disabled) return;
    const next = new Set(current);
    if (disabled) {
      next.add(platform);
    } else {
      next.delete(platform);
    }
    this.metricsDisabledPlatforms.set(next);
  }

  /** The BFF's 400 for "this platform's metrics are switched off in campaign-service", told apart by its `upstreamCode`. */
  private isMetricsDisabledError(err: unknown): boolean {
    return this.upstreamCode(err) === ACCOUNT_MONITOR_METRICS_DISABLED_CODE;
  }

  private upstreamCode(err: unknown): string | null {
    const code = (err as { error?: { upstreamCode?: unknown } | null } | null)?.error?.upstreamCode;
    return typeof code === 'string' ? code : null;
  }

  /** The X monitor's two 409 reasons get their own wording; everything else keeps the BFF's message. */
  private reportBackedErrorMessage(err: unknown, label: string): string {
    const code = this.upstreamCode(err);
    if (code === 'account_too_many_active_campaigns') {
      return `This ${label} account has more than 200 campaigns active in the window, more than one report can cover, so it cannot be monitored here.`;
    }
    if (code === 'account_timezone_unsupported') {
      return `This ${label} account's time zone is not a whole hour from UTC, so its days cannot be reported exactly and it cannot be monitored here.`;
    }
    return extractErrorMessage(err, `Failed to load ${label} data`);
  }

  /** The empty state for one panel: what is wrong, and who can fix it. */
  private noticeFor(panel: MonitorPanelKey, state: MonitorPanelNoticeState): MonitorPanelNotice {
    const label = panel === 'hubspot' ? 'HubSpot' : (CAMPAIGN_PLATFORMS.find((p) => p.id === MONITOR_CONNECTION_PROVIDERS[panel])?.label ?? panel);
    switch (state) {
      case 'no_connection':
        if (panel === 'hubspot') {
          return {
            state,
            title: 'No HubSpot connection',
            message:
              'Neither this project nor the LF system account has a HubSpot connection, so there are no email metrics to read. Ask an LFX administrator to connect HubSpot for this project, then refresh.',
          };
        }
        return {
          state,
          title: `No ${label} connection for this project`,
          message: `Monitoring reads only this project's own ${label} connection, and it has none. Ask an LFX administrator to connect this project's ${label} account, then refresh.`,
        };
      case 'no_account':
        return {
          state,
          title: `No ${label} ad account selected`,
          message: `This project's ${label} connection has no ad account bound to it, so there is nothing to monitor. Ask an LFX administrator to choose the ad account on the connection, then refresh.`,
        };
      case 'metrics_disabled':
        return {
          state,
          title: `${label} metrics are not enabled`,
          message: `campaign-service does not read ${label} metrics in this environment yet. Ask the LFX platform team to enable them, then refresh.`,
        };
      default:
        return {
          state,
          title: `Couldn't check the ${label} connection`,
          message: `This project's ${label} connection could not be read just now. Refresh to try again.`,
        };
    }
  }

  /**
   * What the LinkedIn/Reddit/Meta totals strip leaves out, or null when it covers every campaign.
   *
   * Only the campaign-service monitor path sets `fetchFailed` / `conversionsMeasured`; on the
   * legacy path both are undefined, so this returns null and the strip renders exactly as before.
   * A row whose metrics could not be read contributes zeros to the totals, and a row whose
   * conversions were not measured contributes a 0 to the conversions total, so the strip says so
   * rather than presenting a partial sum as the account's.
   */
  private totalsCoverageNote(rows: readonly (LinkedInCampaignMetrics | RedditCampaignMetrics | MetaCampaignMetrics)[]): string | null {
    const total = rows.length;
    const read = rows.filter((r) => !r.fetchFailed);
    const measured = read.filter((r) => r.conversionsMeasured !== false).length;
    const parts: string[] = [];
    if (read.length < total) {
      parts.push(`Totals cover ${read.length} of ${total} campaigns`);
    }
    // All-unmeasured is already stated by the "Not measured" conversions tile; only a PARTIAL sum needs saying.
    if (measured > 0 && measured < read.length) {
      parts.push(`conversions cover ${measured} of ${total} campaigns`);
    }
    return parts.length > 0 ? `${parts.join('; ')}.` : null;
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

    // The campaign-service panels, for the same reasons. `monitorViaCampaignService` is NOT reset:
    // it mirrors a server-wide flag, not the foundation, so dropping it would only make the extra
    // platform buttons flicker while the new foundation's connections load.
    this.connectionsSub?.unsubscribe();
    this.reportBackedSub?.unsubscribe();
    this.hubSpotSub?.unsubscribe();
    this.reportBackedLoading.set(false);
    this.hubSpotLoading.set(false);
    this.reportBackedData.set(null);
    this.reportBackedError.set(null);
    this.hubSpotData.set(null);
    this.hubSpotError.set(null);
    this.hubSpotNoticeState.set(null);
    this.monitorConnections.set({});
    this.metricsDisabledPlatforms.set(new Set());

    // Same reason as the per-platform signals above: the templates gate their loading placeholder
    // on `loading() && !monitorData()` (and the keywords equivalent), so leaving the aggregate data
    // from the OLD foundation in place would render it under the new foundation until the new
    // request resolves — or indefinitely if it fails.
    this.monitorData.set(null);
    this.keywordsData.set(null);

    this.fetchData();

    // Which accounts the pickers offer depends on the server's monitor cutover, which only the
    // BFF knows: with it on, each picker offers the project's OWN connection's account; with it off
    // (or if this read fails before the flag is known), the legacy account lists, exactly as before.
    this.loadMonitorConnections();
  }

  /** Reads the project's connections; see `loadForActiveFoundation`. Also the retry behind a panel's connection notice. */
  private loadMonitorConnections(): void {
    const slug = this.activeFoundationSlug();
    this.connectionsSub?.unsubscribe();
    this.connectionsSub = this.campaignService
      .getMonitorConnections(slug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (slug !== this.activeFoundationSlug()) return;
          if (result?.viaCampaignService === true) {
            this.applyMonitorConnections(result.platforms ?? {});
          } else {
            this.useLegacyAccounts(slug);
          }
        },
        error: () => {
          if (slug !== this.activeFoundationSlug()) return;
          if (this.monitorViaCampaignService()) {
            // The flag is server-wide and already known to be on, so falling back to the legacy
            // lists would offer accounts campaign-service refuses. Say the connections are unknown.
            const unavailable: MonitorConnectionAccount = { state: 'unavailable', accountId: null, label: null };
            this.applyMonitorConnections(
              Object.fromEntries((Object.keys(MONITOR_CONNECTION_PROVIDERS) as MonitorConnectionPlatform[]).map((p) => [p, unavailable]))
            );
          } else {
            this.useLegacyAccounts(slug);
          }
        },
      });
  }

  /**
   * Fill every connection-backed picker from the project's own connections. Each offers at most ONE
   * account — the one its connection is bound to — because that is the only account campaign-service
   * will read for this project; offering any other would only ever produce a refusal.
   */
  private applyMonitorConnections(platforms: CampaignMonitorConnections['platforms']): void {
    this.monitorViaCampaignService.set(true);
    this.monitorConnections.set(platforms);

    const linkedIn = this.connectedAccount(platforms.linkedin);
    this.linkedInAccountOptions.set(linkedIn ? [{ accountId: linkedIn.accountId, label: linkedIn.label }] : []);
    this.selectedLinkedInAccountKey.set(linkedIn?.accountId ?? '');
    const reddit = this.connectedAccount(platforms.reddit);
    this.redditAccountOptions.set(reddit ? [{ key: reddit.accountId, label: reddit.label }] : []);
    this.selectedRedditAccountKey.set(reddit?.accountId ?? '');
    const meta = this.connectedAccount(platforms.meta);
    this.metaAccountOptions.set(meta ? [{ key: meta.accountId, label: meta.label }] : []);
    this.selectedMetaAccountKey.set(meta?.accountId ?? '');

    // Clear what a previous read showed for an account that is no longer offered, then read the
    // panel the user is on now that its account is known.
    this.linkedInError.set(null);
    this.redditError.set(null);
    this.metaError.set(null);
    this.fetchSelectedPanel();
  }

  /** The cutover is off: the pickers are the legacy account lists, loaded exactly as before it existed. */
  private useLegacyAccounts(slug: string): void {
    this.monitorViaCampaignService.set(false);
    if (this.selectedPlatform() === 'microsoft' || this.selectedPlatform() === 'twitter' || this.selectedPlatform() === 'hubspot') {
      // Those panels exist only behind the cutover, and their buttons are gone with it.
      this.selectedPlatform.set('google');
    }
    this.loadLegacyAccounts(slug);
  }

  private loadLegacyAccounts(slug: string): void {
    // Each account-list request is stamped with the slug it was made for. A foundation switch
    // fires a new request before the previous one resolves, and `takeUntilDestroyed` alone
    // doesn't cancel it (the component survives the switch). Without this guard, a slower
    // response for the OLD foundation can arrive after a faster one for the new foundation and
    // overwrite it with the wrong account catalog.
    const linkedInSlug = slug;
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
    const redditSlug = slug;
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
    const metaSlug = slug;
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
