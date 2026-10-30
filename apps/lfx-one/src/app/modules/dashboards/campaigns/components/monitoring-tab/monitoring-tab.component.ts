// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, OnInit, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { skip, take, type Observable, type Subscription } from 'rxjs';
import { ButtonComponent } from '@components/button/button.component';
import {
  ACCOUNT_MONITOR_METRICS_DISABLED_CODE,
  ACCOUNT_MONITOR_NO_CONNECTION_CODE,
  CAMPAIGN_ACT_FOUNDATION_CHANGED_MESSAGE,
  CAMPAIGN_MONITOR_ACT_LEVER_LABELS,
  CAMPAIGN_MONITOR_ACT_PLATFORMS,
  CAMPAIGN_PACING_THRESHOLDS,
  CAMPAIGN_PLATFORMS,
  campaignPlatformMonitorable,
  MONITOR_CONNECTION_PROVIDERS,
  MONITOR_DATE_RANGE_OPTIONS,
  MONITOR_KEYWORD_PAGE_SIZE,
  MONITOR_PLATFORM_BUTTON_COLORS,
  MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE,
  parseCampaignName,
} from '@lfx-one/shared/constants';
import { formatPercent } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';

import type {
  AccountMonitorCampaignRowView,
  AccountMonitorKpisView,
  AccountMonitorPanelReadState,
  AccountMonitorPanelView,
  CampaignActDialogData,
  CampaignActDialogResult,
  CampaignAdoptDialogData,
  CampaignMetrics,
  CampaignMonitorActLever,
  CampaignMonitorActPlatform,
  CampaignMonitorConnections,
  CampaignMonitorResponse,
  GoogleMonitorCampaignRowView,
  GoogleMonitorKpisView,
  HubSpotEmailMonitorResponse,
  HubSpotMonitorView,
  KeywordMetrics,
  KeywordMetricsResponse,
  KeywordRowView,
  KeywordTotalsView,
  LinkedInAccount,
  LinkedInCampaignMetrics,
  LinkedInMonitorResponse,
  LinkedInPacingLabel,
  GoogleAdsAccountOption,
  MetaAccountOption,
  MetaCampaignMetrics,
  MetaMonitorResponse,
  MonitorAccountSource,
  MonitorCellView,
  MonitorConnectionAccount,
  MonitorConnectionPlatform,
  MonitorDateRangeOption,
  MonitorPanelKey,
  MonitorPanelNotice,
  MonitorPanelNoticeState,
  MonitorPlatformButtonView,
  MonitorTabPlatform,
  RedditAccountOption,
  RedditAccountTotals,
  RedditCampaignMetrics,
  RedditMonitorResponse,
  RedditPacingLabel,
  ReportBackedMonitorResponse,
} from '@lfx-one/shared/interfaces';

import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { AudienceDemographicsComponent } from '../audience-demographics/audience-demographics.component';
import { CampaignActDialogComponent } from '../campaign-act-dialog/campaign-act-dialog.component';
import { CampaignAdoptDialogComponent } from '../campaign-adopt-dialog/campaign-adopt-dialog.component';
import { PaidAudienceInsightsComponent } from '../paid-audience-insights/paid-audience-insights.component';

@Component({
  selector: 'lfx-monitoring-tab',
  imports: [AudienceDemographicsComponent, ButtonComponent, NgTemplateOutlet, PaidAudienceInsightsComponent],
  templateUrl: './monitoring-tab.component.html',
  styleUrl: './monitoring-tab.component.scss',
})
export class MonitoringTabComponent implements OnInit {
  private readonly campaignService = inject(CampaignService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private monitorSub: Subscription | null = null;
  private keywordsSub: Subscription | null = null;
  private linkedInSub: Subscription | null = null;
  private redditSub: Subscription | null = null;
  private readonly currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  /** The two-decimal currency and percentage every ad panel but LinkedIn renders. */
  private readonly standardFormats = { currency: (n: number): string => this.formatCurrency(n), pct: (n: number): string => this.formatPct(n) };

  protected readonly dateRangeOptions: readonly MonitorDateRangeOption[] = MONITOR_DATE_RANGE_OPTIONS;
  protected readonly keywordPageSize = MONITOR_KEYWORD_PAGE_SIZE;
  protected readonly copiedName = signal<string | null>(null);

  protected readonly selectedDays = signal<MonitorDateRangeOption>(30);
  protected readonly loading = signal(false);
  protected readonly monitorData = signal<CampaignMonitorResponse | null>(null);
  protected readonly error = signal<string | null>(null);

  // Platform switcher
  protected readonly selectedPlatform = signal<MonitorTabPlatform>('google');
  // Only the id and label are rendered; with the monitor cutover on, the one option is the
  // project's connection's account, which carries no org id.
  protected readonly linkedInAccountOptions = signal<Pick<LinkedInAccount, 'accountId' | 'label'>[]>([]);
  protected readonly selectedLinkedInAccountKey = signal<string>('');
  protected readonly linkedInLoading = signal(false);
  protected readonly linkedInData = signal<LinkedInMonitorResponse | null>(null);
  protected readonly linkedInError = signal<string | null>(null);
  protected readonly linkedInCampaigns = computed(() => this.linkedInData()?.campaigns ?? []);
  protected readonly linkedInTotalsNote = computed(() => this.totalsCoverageNote(this.linkedInCampaigns()));
  /**
   * Whether the LinkedIn figures on screen came from campaign-service (the connection's account).
   * Those figures never carry the legacy `$`: they are printed in the currency campaign-service
   * names, or with no symbol and a note when it names none. An unnamed currency is NOT known to be
   * the account's own: a campaign-service that predates its `costInLocalCurrency` read sends USD
   * (`costInUsd`) with no `currency` either, so that note claims no currency. Recorded with the data.
   */
  protected readonly linkedInAmountsInAccountCurrency = signal(false);
  /** The connection's named-currency format, in whole units; never applied to legacy figures. */
  private readonly linkedInNamedCurrencyFormat = computed(() =>
    this.linkedInAmountsInAccountCurrency() ? this.namedCurrencyFormat(this.linkedInData()?.currency, true) : null
  );
  /** The "did not report its currency" note: a connection's figures whose currency campaign-service did not name. */
  protected readonly linkedInCurrencyNote = computed(() => this.linkedInAmountsInAccountCurrency() && this.linkedInNamedCurrencyFormat() === null);
  protected readonly linkedInPulledAt = computed(() => {
    const pulledAt = this.linkedInData()?.pulledAt;
    return pulledAt ? new Date(pulledAt).toLocaleString('en-US') : null;
  });

  // Reddit
  protected readonly redditAccountOptions = signal<RedditAccountOption[]>([]);
  protected readonly selectedRedditAccountKey = signal<string>('');
  protected readonly redditLoading = signal(false);
  protected readonly redditData = signal<RedditMonitorResponse | null>(null);
  protected readonly redditError = signal<string | null>(null);
  protected readonly redditCampaigns = computed(() => this.redditData()?.campaigns ?? []);
  protected readonly redditTotalsNote = computed(() => this.totalsCoverageNote(this.redditCampaigns()));
  protected readonly redditPulledAt = computed(() => {
    const pulledAt = this.redditData()?.pulledAt;
    return pulledAt ? new Date(pulledAt).toLocaleString('en-US') : null;
  });

  // Meta
  private metaSub: Subscription | null = null;
  protected readonly metaAccountOptions = signal<MetaAccountOption[]>([]);
  protected readonly selectedMetaAccountKey = signal<string>('');
  protected readonly metaLoading = signal(false);
  protected readonly metaData = signal<MetaMonitorResponse | null>(null);
  protected readonly metaError = signal<string | null>(null);
  protected readonly metaCampaigns = computed(() => this.metaData()?.campaigns ?? []);
  protected readonly metaTotalsNote = computed(() => this.totalsCoverageNote(this.metaCampaigns()));
  /**
   * Whether the Meta figures on screen came from campaign-service (the connection's account). Its
   * Meta monitor reports spend and budgets unconverted in the account's own currency, and the
   * connection's account need not be a USD one, so those figures never carry the legacy `$`: they
   * are printed in the currency campaign-service names, or with no symbol when it names none — see
   * `initMetaView`. Recorded with the data it describes, not read from the live source flag.
   */
  protected readonly metaAmountsInAccountCurrency = signal(false);
  /**
   * Whether the Meta panel states the unit once in a note: only for a connection's figures whose
   * currency campaign-service did not name. A named currency is printed on every amount instead.
   */
  protected readonly metaCurrencyNote = computed(() => this.metaAmountsInAccountCurrency() && this.metaNamedCurrencyFormat() === null);
  /** The connection's named-currency format; never applied to legacy figures, which keep their `$`. */
  private readonly metaNamedCurrencyFormat = computed(() => (this.metaAmountsInAccountCurrency() ? this.namedCurrencyFormat(this.metaData()?.currency) : null));
  protected readonly metaPulledAt = computed(() => {
    const pulledAt = this.metaData()?.pulledAt;
    return pulledAt ? new Date(pulledAt).toLocaleString('en-US') : null;
  });

  // campaign-service monitor cutover (#2519). Set from `/monitor/connections`: while the server's
  // flag is off it stays false, the legacy account lists fill the pickers, and nothing below renders.
  private connectionsSub: Subscription | null = null;
  /** The in-flight legacy account-list reads; cancelled whenever the picker source changes. */
  private legacyAccountSubs: Subscription[] = [];
  protected readonly monitorViaCampaignService = signal(false);
  protected readonly monitorConnections = signal<CampaignMonitorConnections['platforms']>({});
  protected readonly metricsDisabledPlatforms = signal<ReadonlySet<MonitorConnectionPlatform>>(new Set());
  /**
   * Panels whose read the BFF refused because the ad account is shared by every foundation
   * (`MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE`, lfx-self-serve-ops#54). Shown as a notice on either path.
   */
  protected readonly restrictedPlatforms = signal<ReadonlySet<MonitorConnectionPlatform>>(new Set());
  /** The Google Ads monitor is independent of the separately authorized keyword and audience reads. */
  protected readonly googleRestricted = signal(false);
  private googleAccountsSub: Subscription | null = null;
  /**
   * Set once the discovery read is refused as shared-account-restricted. The refusal is about the
   * caller (root-only, as the Google Ads monitor), so loads skip a read that would answer 403 again
   * until `resetGoogleAccounts` clears it on a fresh context.
   */
  private googleAccountsRefused = false;
  /**
   * The Google Ads accounts the project's connection can reach (campaign-service account discovery).
   * Read only with the cutover on; listed for reference, since the Google Ads monitor reads the
   * aggregate view rather than one picked account. `null` until a read answers, and for a non-root
   * caller, whose read is refused; an empty array is a connection that reaches no account.
   */
  protected readonly googleAccountOptions = signal<GoogleAdsAccountOption[] | null>(null);
  protected readonly googleAccountsLoading = signal(false);
  protected readonly googleAccountsError = signal<string | null>(null);
  /**
   * X's monitor follows `monitorable` in `CAMPAIGN_PLATFORMS`, not its `disabled` create flag. It shows
   * only with the cutover on; metrics off upstream, or a non-root caller, gets the panel's notice.
   */
  protected readonly twitterOffered = campaignPlatformMonitorable('twitter-ads');

  // Microsoft Ads / X: one report-backed panel, showing whichever of the two is selected.
  private reportBackedSub: Subscription | null = null;
  protected readonly reportBackedLoading = signal(false);
  protected readonly reportBackedData = signal<ReportBackedMonitorResponse | null>(null);
  protected readonly reportBackedError = signal<string | null>(null);
  protected readonly reportBackedCampaigns = computed(() => this.reportBackedData()?.campaigns ?? []);
  protected readonly reportBackedTotalsNote = computed(() => this.totalsCoverageNote(this.reportBackedCampaigns()));
  /** The "account's own currency" note shows only while campaign-service has not named the currency. */
  protected readonly reportBackedCurrencyNote = computed(() => this.namedCurrencyFormat(this.reportBackedData()?.currency) === null);
  protected readonly reportBackedPulledAt = computed(() => {
    const pulledAt = this.reportBackedData()?.pulledAt;
    return pulledAt ? new Date(pulledAt).toLocaleString('en-US') : null;
  });

  // HubSpot email monitor: project-scoped, so no account picker.
  private hubSpotSub: Subscription | null = null;
  protected readonly hubSpotLoading = signal(false);
  protected readonly hubSpotData = signal<HubSpotEmailMonitorResponse | null>(null);
  protected readonly hubSpotError = signal<string | null>(null);
  protected readonly hubSpotNoticeState = signal<MonitorPanelNoticeState | null>(null);
  protected readonly hubSpotPulledAt = computed(() => {
    const pulledAt = this.hubSpotData()?.pulledAt;
    return pulledAt ? new Date(pulledAt).toLocaleString('en-US') : null;
  });

  protected readonly keywordsLoading = signal(false);
  protected readonly keywordsData = signal<KeywordMetricsResponse | null>(null);
  protected readonly keywordsError = signal<string | null>(null);
  protected readonly keywordsRestricted = signal(false);
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
  protected readonly keywordTotalPages = computed(() => Math.max(1, Math.ceil(this.keywords().length / MONITOR_KEYWORD_PAGE_SIZE)));
  protected readonly hasKeywordPrevPage = computed(() => this.keywordPage() > 1);
  protected readonly hasKeywordNextPage = computed(() => this.keywordPage() < this.keywordTotalPages());

  protected readonly visibleKeywords = computed<KeywordMetrics[]>(() => {
    const all = this.keywords();
    const start = (this.keywordPage() - 1) * MONITOR_KEYWORD_PAGE_SIZE;
    return all.slice(start, start + MONITOR_KEYWORD_PAGE_SIZE);
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
  /** Each live-read paid panel's retry button's accessible name; the visible "Retry" alone does not say what it retries. */
  protected readonly paidRetryLabels: Readonly<Record<'linkedin' | 'reddit' | 'meta', string>> = {
    linkedin: `Retry loading ${this.paidPanelLabel('linkedin')} campaigns`,
    reddit: `Retry loading ${this.paidPanelLabel('reddit')} campaigns`,
    meta: `Retry loading ${this.paidPanelLabel('meta')} campaigns`,
  };
  protected readonly reportBackedRetryLabel = computed(() => `Retry loading ${this.reportBackedLabel()} campaigns`);
  /** The act platform of the report-backed panel's rows: Microsoft's or X's, whichever the panel shows. */
  protected readonly reportBackedActPlatform = computed<CampaignMonitorActPlatform>(() =>
    this.reportBackedPanel() === 'twitter' ? 'twitter-ads' : 'microsoft-ads'
  );
  protected readonly reportBackedFreshness: Signal<string | null> = this.initReportBackedFreshness();
  protected readonly hubSpotFreshness: Signal<string | null> = this.initHubSpotFreshness();
  protected readonly hubSpotCoverageNote: Signal<string | null> = this.initHubSpotCoverageNote();
  /** The Microsoft/X and HubSpot sections, formatted for the template (no template functions). */
  protected readonly reportBackedView: Signal<AccountMonitorPanelView | null> = this.initReportBackedView();
  /** The four original panels, formatted the same way (no template functions). */
  protected readonly linkedInView: Signal<AccountMonitorPanelView | null> = this.initLinkedInView();
  protected readonly redditView: Signal<AccountMonitorPanelView | null> = this.initRedditView();
  protected readonly metaView: Signal<AccountMonitorPanelView | null> = this.initMetaView();
  protected readonly googleKpisView: Signal<GoogleMonitorKpisView | null> = this.initGoogleKpisView();
  protected readonly googleCampaignRows: Signal<GoogleMonitorCampaignRowView[]> = this.initGoogleCampaignRows();
  protected readonly keywordTotalsView: Signal<KeywordTotalsView | null> = this.initKeywordTotalsView();
  protected readonly visibleKeywordRows: Signal<KeywordRowView[]> = this.initVisibleKeywordRows();
  protected readonly platformButtons: Signal<Record<MonitorTabPlatform, MonitorPlatformButtonView>> = this.initPlatformButtons();
  protected readonly hubSpotView: Signal<HubSpotMonitorView | null> = this.initHubSpotView();
  /** What the persistent live region says about the selected LinkedIn/Reddit/Meta/Microsoft Ads/X panel's read. */
  protected readonly adPanelAnnouncement: Signal<string> = this.initAdPanelAnnouncement();

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

  /**
   * Act on a Monitor row's campaign: opens the act dialog, which resolves the row's PLATFORM campaign
   * id to the campaign LFX One manages before showing any lever. When LFX One does not manage it, the
   * dialog asks to adopt it; a confirmed adoption reopens the act dialog on the same lever.
   */
  protected openAct(platform: CampaignMonitorActPlatform, platformCampaignId: string, campaignName: string, lever: CampaignMonitorActLever): void {
    // The project is captured HERE, once, and carried through the adopt step and back: a foundation
    // switch while a dialog is open must not point the flow at another project.
    const projectSlug = this.activeFoundationSlug();
    if (!projectSlug || !CAMPAIGN_MONITOR_ACT_PLATFORMS.has(platform) || !platformCampaignId) {
      return;
    }
    this.openActDialog({ projectSlug, platform, platformCampaignId, campaignName, lever });
  }

  protected setDateRange(days: MonitorDateRangeOption): void {
    this.selectedDays.set(days);
    this.clearWindowedPanels();
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

  /**
   * Reads the Google Ads accounts the project's connection can reach. Stamped with the slug it was
   * made for, as the legacy account lists are, so a late answer for the previous foundation is dropped.
   */
  protected loadGoogleAccounts(): void {
    const slug = this.activeFoundationSlug();
    this.googleAccountsSub?.unsubscribe();
    // A caller already known to be restricted (by this read, or by the Google Ads monitor) would only
    // be refused again: no request, and nothing shown, as for the refusal itself.
    if (this.googleAccountsRefused || this.googleRestricted()) {
      this.googleAccountsLoading.set(false);
      this.googleAccountsError.set(null);
      this.googleAccountOptions.set(null);
      return;
    }
    this.googleAccountsLoading.set(true);
    this.googleAccountsError.set(null);
    this.googleAccountsSub = this.campaignService
      .getGoogleAdsAccounts(slug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          if (slug !== this.activeFoundationSlug() || !this.monitorViaCampaignService()) return;
          this.googleAccountOptions.set(accounts);
          this.googleAccountsLoading.set(false);
        },
        error: (err: unknown) => {
          if (slug !== this.activeFoundationSlug() || !this.monitorViaCampaignService()) return;
          this.googleAccountsLoading.set(false);
          this.googleAccountOptions.set(null);
          // A non-root caller is refused the list as the Google Ads monitor is: nothing to show, not an error.
          if (this.isSharedAccountRestricted(err)) {
            this.googleAccountsRefused = true;
          } else {
            this.googleAccountsError.set(extractErrorMessage(err, 'Failed to load Google Ads accounts'));
          }
        },
      });
  }

  protected fetchData(): void {
    this.monitorSub?.unsubscribe();
    this.keywordsSub?.unsubscribe();

    this.loading.set(true);
    this.error.set(null);
    this.googleRestricted.set(false);
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
          this.loading.set(false);
          if (this.isSharedAccountRestricted(err)) {
            this.googleRestricted.set(true);
            this.monitorData.set(null);
            return;
          }
          // `extractErrorMessage`, not `err?.error?.message`. BaseApiError.toResponse serialises
          // the operator-facing text as `{ error: string }` (`BaseApiError.toResponse`), so `.error.message`
          // is undefined for every error this path produces and the operator got Angular's generic
          // "Http failure response for <url>" instead of the actionable upstream reason. The same
          // reading already exists in `toTransportOutcome`; these loaders never got it (Copilot).
          this.error.set(withHttpStatus(extractErrorMessage(err, 'Failed to load campaign data'), err));
        },
      });

    this.keywordsLoading.set(true);
    this.keywordsError.set(null);
    this.keywordsRestricted.set(false);
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
          if (this.isSharedAccountRestricted(err)) {
            this.keywordsData.set(null);
            this.keywordsRestricted.set(true);
            this.keywordsLoading.set(false);
            return;
          }
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

  protected setPlatform(p: MonitorTabPlatform): void {
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
   * A shared-account refusal (`restricted`) is cleared and read again too: the BFF decides it per
   * read, from the caller's ROOT grants, so there is no connection to re-read.
   */
  protected retryPanel(panel: MonitorPanelKey): void {
    if (panel === 'hubspot') {
      this.fetchHubSpotData();
      return;
    }
    const notice = this.panelNotices()[panel];
    this.setMetricsDisabled(panel, false);
    this.setRestricted(panel, false);
    if (notice?.state === 'metrics_disabled' || notice?.state === 'restricted') {
      this.fetchSelectedPanel();
      return;
    }
    this.loadMonitorConnections();
  }

  /**
   * The Retry on a panel's error. The data source is ALWAYS re-checked first, whichever source the
   * tab is on, because the flag is per pod and a rolling change can go either way: a
   * `MONITOR_CUTOVER_MISMATCH` means a flag-OFF pod refused a connection-path read, and a
   * `MONITOR_CUTOVER_LEGACY_MISMATCH` means a flag-ON pod refused a legacy-picker read. Retrying the
   * read on the source the tab already has would repeat either refusal; re-running discovery lets
   * the tab settle on whichever source the deployment now serves, and the selected panel is read
   * again on it (the cutover path re-reads it once the connections land; the legacy path is told to).
   */
  protected retryPanelRead(): void {
    this.loadMonitorConnections(true);
  }

  protected fetchReportBackedData(): void {
    const platform = this.selectedPlatform();
    if (platform !== 'microsoft' && platform !== 'twitter') return;
    this.reportBackedSub?.unsubscribe();
    // A previous read's "metrics not enabled" must not outlive this one: if this read fails some
    // other way, the notice would otherwise hide that error and its Retry. As `fetchHubSpotData` does.
    this.setMetricsDisabled(platform, false);
    this.setRestricted(platform, false);
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
        if (this.isSharedAccountRestricted(err)) {
          this.reportBackedData.set(null);
          this.setRestricted(platform, true);
          return;
        }
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
          } else if (this.upstreamCode(err) === ACCOUNT_MONITOR_NO_CONNECTION_CODE) {
            // Only campaign-service's typed not-found carries this marker (the BFF classifies it): the
            // project has no HubSpot connection and there is no LF system one to fall back to. Any other
            // 404 — a gateway or routing miss — falls through to a retryable error below.
            this.hubSpotNoticeState.set('no_connection');
          } else {
            this.hubSpotError.set(extractErrorMessage(err, 'Failed to load HubSpot email data'));
          }
        },
      });
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
    // Cleared per read, as `fetchReportBackedData` does: a stale "metrics not enabled" would hide a new error.
    this.setMetricsDisabled('linkedin', false);
    this.setRestricted('linkedin', false);
    const accountSource = this.monitorAccountSource();
    this.linkedInSub = this.campaignService
      .getLinkedInMonitorData(this.activeFoundationSlug(), accountKey, this.selectedDays(), accountSource)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.setMetricsDisabled('linkedin', false);
          this.linkedInAmountsInAccountCurrency.set(accountSource === 'connection');
          this.linkedInData.set(data);
          this.linkedInLoading.set(false);
        },
        error: (err: unknown) => {
          if (this.isSharedAccountRestricted(err)) {
            this.linkedInData.set(null);
            this.setRestricted('linkedin', true);
            this.linkedInLoading.set(false);
            return;
          }
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
    // Cleared per read, as `fetchReportBackedData` does: a stale "metrics not enabled" would hide a new error.
    this.setMetricsDisabled('reddit', false);
    this.setRestricted('reddit', false);
    this.redditSub = this.campaignService
      .getRedditMonitorData(this.activeFoundationSlug(), accountKey, this.selectedDays(), this.monitorAccountSource())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.setMetricsDisabled('reddit', false);
          this.redditData.set(data);
          this.redditLoading.set(false);
        },
        error: (err: unknown) => {
          if (this.isSharedAccountRestricted(err)) {
            this.redditData.set(null);
            this.setRestricted('reddit', true);
            this.redditLoading.set(false);
            return;
          }
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
    // Cleared per read, as `fetchReportBackedData` does: a stale "metrics not enabled" would hide a new error.
    this.setMetricsDisabled('meta', false);
    this.setRestricted('meta', false);
    const accountSource = this.monitorAccountSource();
    this.metaSub = this.campaignService
      .getMetaMonitorData(this.activeFoundationSlug(), accountKey, this.selectedDays(), accountSource)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.setMetricsDisabled('meta', false);
          this.metaAmountsInAccountCurrency.set(accountSource === 'connection');
          this.metaData.set(data);
          this.metaLoading.set(false);
        },
        error: (err: unknown) => {
          if (this.isSharedAccountRestricted(err)) {
            this.metaData.set(null);
            this.setRestricted('meta', true);
            this.metaLoading.set(false);
            return;
          }
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

  /**
   * The screen-reader status of the selected ad-platform panel, mirroring the branch its template
   * shows: a notice says nothing (it is static guidance, not a read), a read in flight — first load
   * or Refresh — says it is loading, and a finished read says how many campaigns the panel shows
   * and what its totals leave out. Without it a read and a Refresh were visual only: the spinner
   * and the changing figures were never announced.
   *
   * A failure returns '' on purpose: the visible error block carries role="alert", so repeating
   * the message here would announce it twice. Google Ads and HubSpot are outside this region.
   */
  private initAdPanelAnnouncement(): Signal<string> {
    return computed(() => {
      const panel = this.selectedPlatform();
      if (panel === 'google' || panel === 'hubspot' || this.panelNotices()[panel]) return '';
      const read = this.adPanelReadState(panel);
      if (read.loading) return `Loading ${read.label} campaigns`;
      if (read.error || !read.loaded) return '';
      const count = read.campaigns;
      const shown = count === 0 ? read.emptyMessage : `${read.label}: ${count} ${count === 1 ? 'campaign' : 'campaigns'} shown.`;
      return read.note ? `${shown} ${read.note}` : shown;
    });
  }

  private adPanelReadState(panel: MonitorConnectionPlatform): AccountMonitorPanelReadState {
    switch (panel) {
      case 'linkedin':
        return {
          label: 'LinkedIn',
          loading: this.linkedInLoading(),
          error: this.linkedInError(),
          loaded: this.linkedInData() !== null,
          campaigns: this.linkedInCampaigns().length,
          emptyMessage: 'No active LinkedIn campaigns found for this account.',
          note: this.linkedInTotalsNote(),
        };
      case 'reddit':
        return {
          label: 'Reddit',
          loading: this.redditLoading(),
          error: this.redditError(),
          loaded: this.redditData() !== null,
          campaigns: this.redditCampaigns().length,
          emptyMessage: 'No active Reddit campaigns found for this account.',
          note: this.redditTotalsNote(),
        };
      case 'meta':
        return {
          label: 'Meta',
          loading: this.metaLoading(),
          error: this.metaError(),
          loaded: this.metaData() !== null,
          campaigns: this.metaCampaigns().length,
          emptyMessage: 'No active Meta campaigns found for this account.',
          note: this.metaTotalsNote(),
        };
      default:
        return {
          label: this.reportBackedLabel(),
          loading: this.reportBackedLoading(),
          error: this.reportBackedError(),
          loaded: this.reportBackedData() !== null,
          campaigns: this.reportBackedCampaigns().length,
          emptyMessage: `No ${this.reportBackedLabel()} campaigns found for this account.`,
          note: this.reportBackedTotalsNote(),
        };
    }
  }

  private initPanelNotices(): Signal<Partial<Record<MonitorPanelKey, MonitorPanelNotice>>> {
    return computed(() => {
      const notices: Partial<Record<MonitorPanelKey, MonitorPanelNotice>> = {};
      // A refused shared-account read can come from either path, so it is noticed before the legacy early return.
      for (const platform of this.restrictedPlatforms()) {
        notices[platform] = this.noticeFor(platform, 'restricted');
      }
      if (!this.monitorViaCampaignService()) return notices;
      const connections = this.monitorConnections();
      const disabled = this.metricsDisabledPlatforms();
      for (const platform of Object.keys(MONITOR_CONNECTION_PROVIDERS) as MonitorConnectionPlatform[]) {
        if (notices[platform]) continue;
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

  private initReportBackedView(): Signal<AccountMonitorPanelView | null> {
    return computed(() => {
      const data = this.reportBackedData();
      // The report-backed rows keep the neutral status badge they always had: Microsoft's statuses are
      // not the uppercase ACTIVE the green badge keys on, and X's should not turn green by accident.
      // Their amounts are in the account's own currency: printed in it when campaign-service names
      // it, and otherwise with no symbol at all (see formatAccountAmount).
      return data
        ? this.buildAccountPanelView(data.campaigns, data.accountTotals, {
            currency: this.namedCurrencyFormat(data.currency) ?? ((n) => this.formatAccountAmount(n)),
            pct: (n) => this.formatPct(n),
            statusBadges: false,
          })
        : null;
    });
  }

  private initLinkedInView(): Signal<AccountMonitorPanelView | null> {
    return computed(() => {
      const data = this.linkedInData();
      if (!data) return null;
      // LinkedIn heads each row with the event name over the full campaign name, and adds the
      // creative count — "Not read" when campaign-service did not read creatives. Built from the
      // row's OWN campaign inside the builder, so no index join can pair a row with another's data.
      // The legacy path keeps its whole-dollar `$` exactly as before. A connection's figures are
      // printed in whole units of the currency campaign-service names, and otherwise currency-neutral,
      // with a note that the currency was not reported (it may be USD from an older campaign-service).
      const unnamed = this.linkedInAmountsInAccountCurrency()
        ? (n: number): string => this.formatAccountAmount(n, 0)
        : (n: number): string => this.formatLinkedInCurrency(n);
      return this.buildAccountPanelView(
        data.campaigns,
        data.accountTotals,
        {
          currency: this.linkedInNamedCurrencyFormat() ?? unnamed,
          pct: (n) => this.formatLinkedInPct(n),
          statusBadges: true,
        },
        (camp: LinkedInCampaignMetrics) => ({
          title: camp.eventName,
          subtitle: camp.campaignName,
          creatives:
            camp.creativesMeasured === false
              ? { text: 'Not read', className: 'text-gray-500' }
              : { text: String(camp.creatives.length), className: 'text-gray-700' },
        })
      );
    });
  }

  private initRedditView(): Signal<AccountMonitorPanelView | null> {
    return computed(() => {
      const data = this.redditData();
      if (!data) return null;
      // In the account's currency when campaign-service names it (only its path can); otherwise the
      // `$` the panel has always shown.
      const currency = this.namedCurrencyFormat(data.currency) ?? this.standardFormats.currency;
      return this.buildAccountPanelView(data.campaigns, data.accountTotals, { ...this.standardFormats, currency, statusBadges: true });
    });
  }

  private initMetaView(): Signal<AccountMonitorPanelView | null> {
    return computed(() => {
      const data = this.metaData();
      if (!data) return null;
      // The legacy path reads only the allowlisted (USD) LF accounts, so it keeps its `$` exactly as
      // before. A connection's account can be in any currency and campaign-service passes its amounts
      // unconverted: printed in that currency when campaign-service names it, and otherwise
      // currency-neutral, as Microsoft/X are, with the panel stating the unit once.
      const unnamed = this.metaAmountsInAccountCurrency() ? (n: number): string => this.formatAccountAmount(n) : this.standardFormats.currency;
      const currency = this.metaNamedCurrencyFormat() ?? unnamed;
      return this.buildAccountPanelView(data.campaigns, data.accountTotals, { ...this.standardFormats, currency, statusBadges: true });
    });
  }

  private initGoogleKpisView(): Signal<GoogleMonitorKpisView | null> {
    return computed(() => {
      const totals = this.accountTotals();
      if (!totals) return null;
      const ctr = this.totalCtr();
      return {
        impressions: this.formatNumber(totals.impressions),
        clicks: this.formatNumber(totals.clicks),
        ctr: ctr === null ? '—' : this.formatPct(ctr),
        spend: this.formatCurrency(totals.spend),
        // Only the campaign-service path sets the flag; the legacy read always measured conversions.
        conversions: totals.conversionsMeasured === false ? 'Not measured' : this.formatNumber(totals.conversions),
      };
    });
  }

  /**
   * The Google Ads rows. On the campaign-service path (#4526) a row can arrive unread or unpaced; its
   * zeros are placeholders, so they render as the other panels render them — every figure a dash for
   * an unread row, "Unknown" pacing with an empty bar, "Not measured" conversions — never as a
   * measured 0 or a red 0% bar. The legacy path sets none of the flags, so its rows are unchanged.
   */
  private initGoogleCampaignRows(): Signal<GoogleMonitorCampaignRowView[]> {
    return computed(() =>
      this.campaigns().map((campaign) => {
        const unread = campaign.fetchFailed === true;
        const pacingKnown = !unread && campaign.pacingUnknown !== true;
        let pacingText = 'Unknown';
        if (unread) {
          pacingText = '—';
        } else if (pacingKnown) {
          pacingText = `${campaign.pacingPct}%`;
        }
        let conversions = this.formatNumber(campaign.conversions);
        if (unread) {
          conversions = '—';
        } else if (campaign.conversionsMeasured === false) {
          conversions = 'Not measured';
        }
        return {
          campaignId: campaign.campaignId,
          title: campaign.eventName || campaign.name,
          name: campaign.name,
          shortName: campaign.shortName,
          startDate: this.formatDate(campaign.startDate),
          endDate: this.formatDate(campaign.endDate),
          totalBudget: unread ? '—' : this.formatCurrency(campaign.totalBudget),
          spend: unread ? '—' : this.formatCurrency(campaign.spend),
          impressions: unread ? '—' : this.formatNumber(campaign.impressions),
          clicks: unread ? '—' : this.formatNumber(campaign.clicks),
          ctr: unread ? '—' : this.formatPct(campaign.ctr),
          avgCpc: unread ? '—' : this.formatCurrency(campaign.avgCpc),
          conversions,
          pacingBarClass: pacingKnown ? this.pacingClass(campaign) : 'bg-gray-300',
          pacingBarWidth: pacingKnown ? Math.min(campaign.pacingPct, 100) : 0,
          pacingText,
        };
      })
    );
  }

  private initKeywordTotalsView(): Signal<KeywordTotalsView | null> {
    return computed(() => {
      const totals = this.keywordTotals();
      if (!totals) return null;
      return {
        impressions: this.formatNumber(totals.impressions),
        clicks: this.formatNumber(totals.clicks),
        avgCtr: this.formatPct(totals.avgCtr),
        spend: this.formatCurrency(totals.spend),
        conversions: this.formatNumber(totals.conversions),
      };
    });
  }

  private initVisibleKeywordRows(): Signal<KeywordRowView[]> {
    return computed(() =>
      this.visibleKeywords().map((kw) => ({
        trackKey: `${kw.keyword}-${kw.campaignId}`,
        keyword: kw.keyword,
        campaign: kw.campaign,
        campaignLabel: this.eventLabel(kw.campaign),
        matchType: kw.matchType,
        matchTypeClass: this.matchTypeClass(kw.matchType),
        qualityScore: kw.qualityScore === null || kw.qualityScore === undefined ? '–' : String(kw.qualityScore),
        qualityScoreClass: this.qualityScoreClass(kw.qualityScore),
        impressions: this.formatNumber(kw.impressions),
        clicks: this.formatNumber(kw.clicks),
        ctr: this.formatPct(kw.ctr),
        avgCpc: this.formatCurrency(kw.avgCpc),
        spend: this.formatCurrency(kw.spend),
        conversions: this.formatNumber(kw.conversions),
      }))
    );
  }

  /** Each platform button's classes and background for the current selection; see `MONITOR_PLATFORM_BUTTON_COLORS`. */
  private initPlatformButtons(): Signal<Record<MonitorTabPlatform, MonitorPlatformButtonView>> {
    return computed(() => {
      const selected = this.selectedPlatform();
      const buttons = {} as Record<MonitorTabPlatform, MonitorPlatformButtonView>;
      for (const platform of Object.keys(MONITOR_PLATFORM_BUTTON_COLORS) as MonitorTabPlatform[]) {
        const colors = MONITOR_PLATFORM_BUTTON_COLORS[platform];
        buttons[platform] =
          platform === selected
            ? { className: `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${colors.textClass}`, background: colors.background }
            : {
                className: 'flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200',
                background: null,
              };
      }
      return buttons;
    });
  }

  /**
   * One ad-platform panel, formatted: the KPI tiles and a row per campaign with every cell's text
   * and class. Shared by LinkedIn, Reddit, Meta and the report-backed Microsoft/X panel, which
   * render the same conventions — "Couldn't read" rows dashed, "Unknown" pacing, "Not measured"
   * conversions. `formats` carries what differs per panel: the currency formatter (the account's
   * named currency when campaign-service names one, else the panel's unnamed format — LinkedIn's
   * in whole units) and LinkedIn's own percentage formatter.
   */
  private buildAccountPanelView<T extends RedditCampaignMetrics | LinkedInCampaignMetrics | MetaCampaignMetrics>(
    campaigns: readonly T[] | null | undefined,
    totals: RedditAccountTotals | null | undefined,
    formats: { currency: (n: number) => string; pct: (n: number) => string; statusBadges: boolean },
    extendRow?: (camp: T) => Partial<AccountMonitorCampaignRowView>
  ): AccountMonitorPanelView {
    const kpis: AccountMonitorKpisView | null = totals
      ? {
          impressions: this.formatNumber(totals.impressions),
          clicks: this.formatNumber(totals.clicks),
          ctr: totals.impressions > 0 ? formats.pct((totals.clicks / totals.impressions) * 100) : '—',
          spend: formats.currency(totals.spend),
          conversions:
            totals.conversionsMeasured === false
              ? { text: 'Not measured', className: 'text-gray-500' }
              : { text: this.formatNumber(totals.conversions), className: 'text-gray-900' },
        }
      : null;
    const unread: MonitorCellView = { text: '—', className: 'text-gray-500' };
    const measured = (text: string): MonitorCellView => ({ text, className: 'text-gray-700' });
    const rows = (campaigns ?? []).map((camp): AccountMonitorCampaignRowView => {
      const base = {
        campaignId: camp.campaignId,
        title: camp.campaignName,
        subtitle: null,
        campaignName: camp.campaignName,
        status: camp.status,
        statusClass:
          formats.statusBadges && camp.status === 'ACTIVE'
            ? 'inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700'
            : 'inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600',
        fetchFailed: camp.fetchFailed === true,
        flight: camp.startDate ? `${camp.startDate} → ${camp.endDate || 'Ongoing'}` : '—',
        // A failed row's budget was not read either (it arrives as 0), so it is a dash, not 0.00.
        budget: camp.fetchFailed ? '—' : formats.currency(camp.totalBudget || camp.dailyBudget),
        creatives: null,
      };
      // Metrics that could not be read are not zeros: every metric cell is a dash.
      const extension = extendRow?.(camp) ?? {};
      if (camp.fetchFailed) {
        return { ...base, spend: unread, pacing: unread, impressions: unread, clicks: unread, ctr: unread, conversions: unread, ...extension };
      }
      const pacing: MonitorCellView =
        camp.pacingUnknown || !camp.pacingLabel
          ? { text: 'Unknown', className: 'text-gray-500' }
          : { text: `${camp.pacingPct.toFixed(0)}% ${camp.pacingLabel}`, className: `font-medium ${this.redditPacingClass(camp.pacingLabel)}` };
      return {
        ...base,
        spend: measured(formats.currency(camp.spend)),
        pacing,
        impressions: measured(this.formatNumber(camp.impressions)),
        clicks: measured(this.formatNumber(camp.clicks)),
        ctr: measured(formats.pct(camp.ctr)),
        conversions: camp.conversionsMeasured === false ? { text: 'Not measured', className: 'text-gray-500' } : measured(String(camp.conversions)),
        ...extension,
      };
    });
    return { kpis, rows };
  }

  private initHubSpotView(): Signal<HubSpotMonitorView | null> {
    return computed(() => {
      const data = this.hubSpotData();
      if (!data) return null;
      const t = data.totals;
      return {
        emptyMessage: data.emails.length > 0 ? null : this.hubSpotEmptyMessage(data),
        kpis: {
          emails: this.formatNumber(t.emailCount),
          sent: this.formatNumber(t.sent),
          delivered: this.formatNumber(t.delivered),
          opens: this.formatNumber(t.opens),
          clicks: this.formatNumber(t.clicks),
          bounces: this.formatNumber(t.bounces),
          openRate: this.rateCell(t.openRate, 'text-gray-700'),
          clickRate: this.rateCell(t.clickRate, 'text-gray-700'),
          bounceRate: this.rateCell(t.bounceRate, 'text-gray-700'),
        },
        rows: data.emails.map((email) => ({
          emailId: email.emailId,
          name: email.name,
          abVariant: email.abVariant,
          deleted: email.deleted,
          sent: this.formatNumber(email.sent),
          delivered: this.formatNumber(email.delivered),
          opens: this.formatNumber(email.opens),
          clicks: this.formatNumber(email.clicks),
          spamReports: this.formatNumber(email.spamReports),
          openRate: this.rateCell(email.openRate, 'text-gray-700'),
          clickRate: this.rateCell(email.clickRate, 'text-gray-700'),
          bounceRate: this.rateCell(email.bounceRate, 'text-gray-700'),
          unsubscribeRate: this.rateCell(email.unsubscribeRate, 'text-gray-700'),
        })),
        actionItems: data.actionItems.map((item) => ({
          priority: item.priority,
          priorityClass: this.priorityClass(item.priority),
          heading: `${item.emailName || 'All emails'}: ${item.issue}`,
          action: item.action,
        })),
      };
    });
  }

  /**
   * Why there are no rows. "Nothing was sent" is claimed only when every recorded email was
   * checked and read: with some unreadable or beyond the 50-campaign cap, an email sent in the
   * window may simply not be in the answer, so the result is called incomplete instead.
   */
  private hubSpotEmptyMessage(data: HubSpotEmailMonitorResponse): string {
    if (data.emailsUnattributable > 0 || data.emailsTruncated) {
      return `No sends were found in the last ${data.days} days among the emails that could be checked, but the results are incomplete — see the note above.`;
    }
    if (data.metricsAsOf) {
      return `No HubSpot emails from this project were sent in the last ${data.days} days.`;
    }
    return 'This project has no HubSpot emails created through campaigns yet.';
  }

  /** HubSpot rates are fractions; null — a rate over zero deliveries — is unknown, never 0%. */
  private rateCell(rate: number | null, measuredClass: string): MonitorCellView {
    return rate === null ? { text: '—', className: 'text-gray-500' } : { text: `${formatPercent(rate * 100)}%`, className: measuredClass };
  }

  private priorityClass(priority: string): string {
    if (priority === 'HIGH') return 'bg-red-50 text-red-700';
    if (priority === 'MED') return 'bg-amber-50 text-amber-700';
    return 'bg-gray-100 text-gray-600';
  }

  /**
   * The Microsoft/X and HubSpot reads are per window. On a window change their data describes the
   * OLD window, so it is dropped (and any in-flight read for it cancelled) rather than shown under
   * the new one: the panel shows its loading state until the new read lands.
   */
  private clearWindowedPanels(): void {
    this.reportBackedSub?.unsubscribe();
    this.hubSpotSub?.unsubscribe();
    this.reportBackedData.set(null);
    this.reportBackedError.set(null);
    this.reportBackedLoading.set(false);
    this.hubSpotData.set(null);
    this.hubSpotError.set(null);
    this.hubSpotLoading.set(false);
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
        return `Metrics as of ${new Date(data.metricsAsOf).toLocaleString('en-US')}${window}.${pending}`;
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
      return `Counters as of ${new Date(data.metricsAsOf).toLocaleString('en-US')} (totals to date, not only the window).${window}`;
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

  private isReportBackedPlatform(platform: MonitorTabPlatform): boolean {
    return platform === 'microsoft' || platform === 'twitter';
  }

  /** The `accountSource` marker for a LinkedIn/Reddit/Meta read: where its picker's account came from. */
  private monitorAccountSource(): MonitorAccountSource {
    return this.monitorViaCampaignService() ? 'connection' : 'legacy';
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

  private setRestricted(platform: MonitorConnectionPlatform, restricted: boolean): void {
    const current = this.restrictedPlatforms();
    if (current.has(platform) === restricted) return;
    const next = new Set(current);
    if (restricted) {
      next.add(platform);
    } else {
      next.delete(platform);
    }
    this.restrictedPlatforms.set(next);
  }

  /** The BFF's 403 for a monitor read whose ad account is shared by every foundation (lfx-self-serve-ops#54). */
  private isSharedAccountRestricted(err: unknown): boolean {
    return this.errorCode(err) === MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE;
  }

  /** The BFF's own error `code` (`BaseApiError.toResponse`), as distinct from an upstream service's `upstreamCode`. */
  private errorCode(err: unknown): string | null {
    const code = (err as { error?: { code?: unknown } | null } | null)?.error?.code;
    return typeof code === 'string' ? code : null;
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

  /** A paid panel's platform name, as `CAMPAIGN_PLATFORMS` labels it. */
  private paidPanelLabel(panel: MonitorConnectionPlatform): string {
    return CAMPAIGN_PLATFORMS.find((p) => p.id === MONITOR_CONNECTION_PROVIDERS[panel])?.label ?? panel;
  }

  /** The empty state for one panel: what is wrong, and who can fix it. */
  private noticeFor(panel: MonitorPanelKey, state: MonitorPanelNoticeState): MonitorPanelNotice {
    const label = panel === 'hubspot' ? 'HubSpot' : this.paidPanelLabel(panel);
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
      case 'restricted':
        return {
          state,
          title: `${label} monitoring is limited to LF administrators`,
          message: `This ${label} ad account is shared by every foundation, so its campaigns and spend can't be shown for a single project.`,
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
    this.resetGoogleAccounts();

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
    this.cancelLegacyAccountReads();
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
    this.restrictedPlatforms.set(new Set());
    this.googleRestricted.set(false);

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

  /**
   * Reads the project's connections; see `loadForActiveFoundation`. Also the retry behind a panel's
   * connection notice and error. `readPanelOnLegacy` re-reads the selected panel when the answer is
   * the legacy pickers (the cutover path re-reads it anyway): set by a Retry, whose panel must be
   * read again even when its legacy account is already selected.
   */
  private loadMonitorConnections(readPanelOnLegacy = false): void {
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
            this.useLegacyAccounts(slug, readPanelOnLegacy);
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
            // Not "cutover off": nothing is known yet. The legacy lists fill in meanwhile, and a
            // panel's Retry re-runs this discovery before reading again.
            this.useLegacyAccounts(slug, readPanelOnLegacy);
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
    // A late legacy account list must not replace the connection's accounts, and figures read for
    // the previous selection must not stay up under the new one.
    this.cancelLegacyAccountReads();
    this.resetAccountPanels();
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
    this.loadGoogleAccounts();

    // Read the panel the user is on now that its account is known.
    this.fetchSelectedPanel();
  }

  /** Drop the Google Ads account list and cancel its read: the foundation or the picker source changed. */
  private resetGoogleAccounts(): void {
    this.googleAccountsSub?.unsubscribe();
    // Re-checked on a fresh context: the root checks fail closed on an upstream error, so a refusal
    // remembered from an outage must not outlive the foundation or source it was answered for.
    this.googleAccountsRefused = false;
    this.googleAccountsLoading.set(false);
    this.googleAccountsError.set(null);
    this.googleAccountOptions.set(null);
  }

  /** The cutover is off: the pickers are the legacy account lists, loaded exactly as before it existed. */
  private useLegacyAccounts(slug: string, readPanel = false): void {
    const wasViaCampaignService = this.monitorViaCampaignService();
    this.monitorViaCampaignService.set(false);
    if (wasViaCampaignService) {
      // The flag went off since the last read (a rollback): the connection's accounts, their
      // figures, and any read still running for them must not stay up under the legacy pickers that
      // replace them — even if those lists come back empty.
      this.resetAccountPanels();
      this.selectedLinkedInAccountKey.set('');
      this.selectedRedditAccountKey.set('');
      this.selectedMetaAccountKey.set('');
      this.linkedInAccountOptions.set([]);
      this.redditAccountOptions.set([]);
      this.metaAccountOptions.set([]);
      this.monitorConnections.set({});
    }
    // campaign-service only: the legacy path has no Google Ads account list to offer.
    this.resetGoogleAccounts();
    if (this.selectedPlatform() === 'microsoft' || this.selectedPlatform() === 'twitter' || this.selectedPlatform() === 'hubspot') {
      // Those panels exist only behind the cutover, and their buttons are gone with it.
      this.selectedPlatform.set('google');
    }
    this.loadLegacyAccounts(slug);
    if (readPanel) {
      // With no account selected yet this reads nothing; the legacy list's arrival reads it instead.
      this.fetchSelectedPanel();
    }
  }

  /** Cancel the legacy account-list reads still in flight, so a late one cannot land after a source switch. */
  private cancelLegacyAccountReads(): void {
    for (const sub of this.legacyAccountSubs) {
      sub.unsubscribe();
    }
    this.legacyAccountSubs = [];
  }

  /**
   * Drop every account-scoped panel's figures and cancel its running read: LinkedIn, Reddit, Meta and
   * the shared Microsoft/X panel. Used when the accounts those figures belong to are replaced (the
   * picker source switching either way), so the old account's numbers never show under the new one,
   * on the visible panel or on one the user switches to later. HubSpot is project-scoped and keeps its own.
   */
  private resetAccountPanels(): void {
    this.linkedInSub?.unsubscribe();
    this.redditSub?.unsubscribe();
    this.metaSub?.unsubscribe();
    this.reportBackedSub?.unsubscribe();
    this.linkedInLoading.set(false);
    this.redditLoading.set(false);
    this.metaLoading.set(false);
    this.reportBackedLoading.set(false);
    this.linkedInData.set(null);
    this.redditData.set(null);
    this.metaData.set(null);
    this.reportBackedData.set(null);
    this.linkedInError.set(null);
    this.redditError.set(null);
    this.metaError.set(null);
    this.reportBackedError.set(null);
    this.metricsDisabledPlatforms.set(new Set());
    // Google's read is not redone here, so its restricted state stays with it.
    this.restrictedPlatforms.set(new Set());
  }

  private loadLegacyAccounts(slug: string): void {
    this.cancelLegacyAccountReads();
    // Each account-list request is stamped with the slug it was made for. A foundation switch
    // fires a new request before the previous one resolves, and `takeUntilDestroyed` alone
    // doesn't cancel it (the component survives the switch). Without this guard, a slower
    // response for the OLD foundation can arrive after a faster one for the new foundation and
    // overwrite it with the wrong account catalog.
    const linkedInSlug = slug;
    this.legacyAccountSubs.push(
      this.campaignService
        .getLinkedInAccounts(linkedInSlug)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (accounts) => {
            // Also refused once the connection path has taken over the pickers.
            if (linkedInSlug !== this.activeFoundationSlug() || this.monitorViaCampaignService()) return;
            this.linkedInAccountOptions.set(accounts);
            if (accounts.length > 0 && !this.selectedLinkedInAccountKey()) {
              this.selectedLinkedInAccountKey.set(accounts[0].accountId);
              if (this.selectedPlatform() === 'linkedin') {
                this.fetchLinkedInData();
              }
            }
          },
          error: (err: unknown) => {
            if (linkedInSlug !== this.activeFoundationSlug() || this.monitorViaCampaignService()) return;
            const httpErr = err as { error?: { message?: string }; message?: string };
            this.linkedInError.set(extractErrorMessage(httpErr, 'Failed to load LinkedIn accounts'));
          },
        })
    );
    const redditSlug = slug;
    this.legacyAccountSubs.push(
      this.campaignService
        .getRedditAccounts(redditSlug)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (accounts) => {
            // Also refused once the connection path has taken over the pickers.
            if (redditSlug !== this.activeFoundationSlug() || this.monitorViaCampaignService()) return;
            this.redditAccountOptions.set(accounts);
            if (accounts.length > 0 && !this.selectedRedditAccountKey()) {
              this.selectedRedditAccountKey.set(accounts[0].key);
              if (this.selectedPlatform() === 'reddit') {
                this.fetchRedditData();
              }
            }
          },
          error: (err: unknown) => {
            if (redditSlug !== this.activeFoundationSlug() || this.monitorViaCampaignService()) return;
            const httpErr = err as { error?: { message?: string }; message?: string };
            this.redditError.set(extractErrorMessage(httpErr, 'Failed to load Reddit accounts'));
          },
        })
    );
    const metaSlug = slug;
    this.legacyAccountSubs.push(
      this.campaignService
        .getMetaAccounts(metaSlug)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (accounts) => {
            // Also refused once the connection path has taken over the pickers.
            if (metaSlug !== this.activeFoundationSlug() || this.monitorViaCampaignService()) return;
            this.metaAccountOptions.set(accounts);
            if (accounts.length > 0 && !this.selectedMetaAccountKey()) {
              this.selectedMetaAccountKey.set(accounts[0].key);
              if (this.selectedPlatform() === 'meta') {
                this.fetchMetaData();
              }
            }
          },
          error: (err: unknown) => {
            if (metaSlug !== this.activeFoundationSlug() || this.monitorViaCampaignService()) return;
            const httpErr = err as { error?: { message?: string }; message?: string };
            this.metaError.set(extractErrorMessage(httpErr, 'Failed to load Meta accounts'));
          },
        })
    );
  }

  private eventLabel(campaignName: string): string {
    return parseCampaignName(campaignName).baseName || campaignName;
  }

  private qualityScoreClass(score: number | null): string {
    if (score === null) return 'text-gray-400';
    if (score >= 7) return 'text-green-700';
    if (score >= 4) return 'text-amber-700';
    return 'text-red-700';
  }

  private matchTypeClass(type: string): string {
    switch (type) {
      case 'EXACT':
        return 'bg-blue-100 text-blue-700';
      case 'PHRASE':
        return 'bg-violet-100 text-violet-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }

  private formatDate(dateStr: string): string {
    if (!dateStr) return '–';
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00` : dateStr;
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return '–';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private pacingClass(campaign: CampaignMetrics): string {
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
  private formatCurrency(value: number): string {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private formatNumber(value: number): string {
    return value.toLocaleString('en-US');
  }

  private formatPct(value: number): string {
    return `${formatPercent(value)}%`;
  }

  /**
   * An amount in the ad account's OWN currency, with no symbol. campaign-service's monitors report
   * spend and budgets unconverted in the account's currency, and `account-monitor`'s `currency` is
   * optional: when it is absent nobody said which currency, so a `$` would assert dollars nobody
   * checked. The panel states the unit once instead. Two decimals, as `formatCurrency`, unless the
   * panel rounds to whole units (LinkedIn).
   */
  private formatAccountAmount(value: number, fractionDigits = 2): string {
    return value.toLocaleString('en-US', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
  }

  /**
   * Amounts in the ad account's NAMED currency (campaign-service's optional ISO 4217 `currency`,
   * which the BFF passes on only as three uppercase letters), with its symbol and its own minor-unit
   * digits — or whole units for LinkedIn's panel, which has always rounded to them. NULL when no
   * currency is named, so the caller keeps its unnamed format; a code `Intl` rejects falls back the
   * same way rather than failing the panel.
   */
  private namedCurrencyFormat(currency: string | undefined, wholeUnits = false): ((n: number) => string) | null {
    if (!currency) return null;
    try {
      const formatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        ...(wholeUnits ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
      });
      return (n: number): string => formatter.format(n);
    } catch {
      return null;
    }
  }

  private linkedInPacingClass(label: LinkedInPacingLabel): string {
    if (label === 'underspending') return 'text-red-600';
    if (label === 'constrained' || label === 'overspending') return 'text-amber-600';
    return 'text-green-600';
  }

  private formatLinkedInCurrency(n: number): string {
    return this.currencyFormatter.format(n);
  }

  private formatLinkedInPct(n: number): string {
    return `${formatPercent(n)}%`;
  }

  private redditPacingClass(label: RedditPacingLabel): string {
    if (label === 'underspending') return 'text-red-600';
    if (label === 'constrained' || label === 'overspending') return 'text-amber-600';
    return 'text-green-600';
  }

  private openActDialog(data: CampaignActDialogData): void {
    this.dialogService
      .open(CampaignActDialogComponent, {
        header: `${CAMPAIGN_MONITOR_ACT_LEVER_LABELS[data.lever]}: ${data.campaignName}`,
        width: '36rem',
        // The dialog preset caps nothing, so a fixed width alone runs off a phone: capped to the viewport,
        // as the org EasyCLA dialogs do.
        style: { maxWidth: '90vw' },
        modal: true,
        closable: true,
        dismissableMask: true,
        data,
      })
      // Bound to this tab as well as to the one close: a dialog closed after the tab is gone opens nothing.
      ?.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((result: CampaignActDialogResult | undefined) => {
        if (result?.adopt && this.stillOnProject(data.projectSlug)) {
          this.openAdopt(data);
        }
      });
  }

  private openAdopt(act: CampaignActDialogData): void {
    const data: CampaignAdoptDialogData = {
      projectSlug: act.projectSlug,
      platform: act.platform,
      platformCampaignId: act.platformCampaignId,
      campaignName: act.campaignName,
    };
    this.dialogService
      .open(CampaignAdoptDialogComponent, {
        header: `Adopt campaign: ${act.campaignName}`,
        width: '36rem',
        // The dialog preset caps nothing, so a fixed width alone runs off a phone: capped to the viewport,
        // as the org EasyCLA dialogs do.
        style: { maxWidth: '90vw' },
        modal: true,
        closable: true,
        data,
      })
      ?.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((adopted: boolean | undefined) => {
        if (adopted === true && this.stillOnProject(act.projectSlug)) {
          // Reopened against the CAPTURED project, never the live selection.
          this.openActDialog(act);
        }
      });
  }

  /** Whether the foundation the flow started on is still selected; when not, says why nothing follows. */
  private stillOnProject(projectSlug: string): boolean {
    if (this.activeFoundationSlug() === projectSlug) {
      return true;
    }
    this.messageService.add({ severity: 'info', summary: 'Foundation changed', detail: CAMPAIGN_ACT_FOUNDATION_CHANGED_MESSAGE, life: 8000 });
    return false;
  }
}

/**
 * Appends the HTTP status to the Google panel's error detail (#4526). The detail is the server's own
 * message for a 4xx but the generic fallback for a 5xx or a dropped connection, so without the status
 * a guard's 403, a Google Ads 5xx and a network failure all read alike on a screenshot.
 */
function withHttpStatus(message: string, err: unknown): string {
  if (err instanceof HttpErrorResponse && err.status > 0) {
    return `${message} (HTTP ${err.status})`;
  }
  return message;
}
