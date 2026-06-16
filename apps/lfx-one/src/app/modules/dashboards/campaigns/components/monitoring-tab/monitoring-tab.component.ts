// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Subscription } from 'rxjs';
import { CAMPAIGN_PACING_THRESHOLDS, parseCampaignName } from '@lfx-one/shared/constants';
import { CampaignService } from '@services/campaign.service';

import type {
  CampaignMetrics,
  CampaignMonitorResponse,
  KeywordMetrics,
  KeywordMetricsResponse,
  LinkedInAccountOption,
  LinkedInMonitorResponse,
  LinkedInPacingLabel,
  RedditAccountOption,
  RedditMonitorResponse,
  RedditPacingLabel,
} from '@lfx-one/shared/interfaces';

import { AudienceDemographicsComponent } from '../audience-demographics/audience-demographics.component';

type DateRangeOption = 7 | 14 | 30;
type PlatformType = 'google' | 'linkedin' | 'reddit';

const KEYWORD_PAGE_SIZE = 10;

@Component({
  selector: 'lfx-monitoring-tab',
  imports: [AudienceDemographicsComponent],
  templateUrl: './monitoring-tab.component.html',
  styleUrl: './monitoring-tab.component.scss',
})
export class MonitoringTabComponent implements OnInit {
  private readonly campaignService = inject(CampaignService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private monitorSub: Subscription | null = null;
  private keywordsSub: Subscription | null = null;
  private linkedInSub: Subscription | null = null;
  private redditSub: Subscription | null = null;
  private readonly currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  protected readonly Math = Math;
  protected readonly dateRangeOptions: DateRangeOption[] = [7, 14, 30];
  protected readonly keywordPageSize = KEYWORD_PAGE_SIZE;
  protected readonly copiedName = signal<string | null>(null);

  protected readonly selectedDays = signal<DateRangeOption>(30);
  protected readonly loading = signal(false);
  protected readonly monitorData = signal<CampaignMonitorResponse | null>(null);
  protected readonly error = signal<string | null>(null);

  // Platform switcher
  protected readonly selectedPlatform = signal<PlatformType>('google');
  protected readonly linkedInAccountOptions = signal<LinkedInAccountOption[]>([]);
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

  protected readonly keywordsLoading = signal(false);
  protected readonly keywordsData = signal<KeywordMetricsResponse | null>(null);
  protected readonly keywordsError = signal<string | null>(null);
  protected readonly keywordPage = signal(1);

  protected readonly campaigns = computed(() => this.monitorData()?.campaigns ?? []);
  protected readonly accountTotals = computed(() => this.monitorData()?.accountTotals ?? null);
  protected readonly pulledAt = computed(() => this.monitorData()?.pulledAt ?? '');
  protected readonly hasCampaigns = computed(() => this.campaigns().length > 0);

  protected readonly totalCtr = computed(() => {
    const totals = this.accountTotals();
    if (!totals || totals.impressions === 0) return 0;
    return (totals.clicks / totals.impressions) * 100;
  });

  protected readonly keywords = computed(() => this.keywordsData()?.keywords ?? []);
  protected readonly keywordTotals = computed(() => this.keywordsData()?.totals ?? null);
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

  public ngOnInit(): void {
    this.fetchData();
    this.campaignService
      .getLinkedInAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          this.linkedInAccountOptions.set(accounts);
          if (accounts.length > 0 && !this.selectedLinkedInAccountKey()) {
            this.selectedLinkedInAccountKey.set(accounts[0].key);
            if (this.selectedPlatform() === 'linkedin') {
              this.fetchLinkedInData();
            }
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
          if (accounts.length > 0 && !this.selectedRedditAccountKey()) {
            this.selectedRedditAccountKey.set(accounts[0].key);
            if (this.selectedPlatform() === 'reddit') {
              this.fetchRedditData();
            }
          }
        },
        error: (err: unknown) => {
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.redditError.set(httpErr?.error?.message || httpErr?.message || 'Failed to load Reddit accounts');
        },
      });
  }

  protected setDateRange(days: DateRangeOption): void {
    this.selectedDays.set(days);
    this.fetchData();
    if (this.selectedPlatform() === 'linkedin') {
      this.fetchLinkedInData();
    } else if (this.selectedPlatform() === 'reddit') {
      this.fetchRedditData();
    } else {
      this.linkedInData.set(null);
      this.redditData.set(null);
    }
  }

  protected refresh(): void {
    this.fetchData();
    if (this.selectedPlatform() === 'linkedin') {
      this.fetchLinkedInData();
    } else if (this.selectedPlatform() === 'reddit') {
      this.fetchRedditData();
    }
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
          this.error.set(err?.error?.message || err?.message || 'Failed to load campaign data');
          this.loading.set(false);
        },
      });

    this.keywordsLoading.set(true);
    this.keywordsError.set(null);
    this.keywordPage.set(1);
    this.keywordsSub = this.campaignService
      .getKeywords(days)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.keywordsData.set(result);
          this.keywordsLoading.set(false);
        },
        error: (err: unknown) => {
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.keywordsError.set(httpErr?.error?.message || httpErr?.message || 'Failed to load keywords');
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

  protected linkedInPacingClass(label: LinkedInPacingLabel): string {
    if (label === 'underspending') return 'text-red-600';
    if (label === 'constrained' || label === 'overspending') return 'text-amber-600';
    return 'text-green-600';
  }

  protected formatLinkedInCurrency(n: number): string {
    return this.currencyFormatter.format(n);
  }

  protected formatLinkedInPct(n: number): string {
    return `${n.toFixed(2)}%`;
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

  protected redditPacingClass(label: RedditPacingLabel): string {
    if (label === 'underspending') return 'text-red-600';
    if (label === 'constrained' || label === 'overspending') return 'text-amber-600';
    return 'text-green-600';
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

  protected formatCurrency(value: number): string {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  protected formatNumber(value: number): string {
    return value.toLocaleString('en-US');
  }

  protected formatPct(value: number): string {
    return `${value.toFixed(2)}%`;
  }
}
