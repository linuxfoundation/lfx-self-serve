// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CAMPAIGN_PACING_THRESHOLDS } from '@lfx-one/shared/constants';
import { CampaignService } from '@services/campaign.service';

import type { CampaignMetrics, CampaignMonitorResponse, KeywordMetrics, KeywordMetricsResponse, SearchTermMetrics } from '@lfx-one/shared/interfaces';

import { AudienceDemographicsComponent } from '../audience-demographics/audience-demographics.component';

type DateRangeOption = 7 | 14 | 30;

const KEYWORD_PAGE_SIZE = 10;
const SEARCH_TERM_PAGE_SIZE = 10;

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

  protected readonly Math = Math;
  protected readonly dateRangeOptions: DateRangeOption[] = [7, 14, 30];
  protected readonly copiedName = signal<string | null>(null);

  protected readonly selectedDays = signal<DateRangeOption>(30);
  protected readonly loading = signal(false);
  protected readonly monitorData = signal<CampaignMonitorResponse | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly keywordsLoading = signal(false);
  protected readonly keywordsData = signal<KeywordMetricsResponse | null>(null);
  protected readonly keywordPage = signal(1);

  protected readonly searchTermsLoading = signal(false);
  protected readonly searchTerms = signal<SearchTermMetrics[]>([]);
  protected readonly searchTermPage = signal(1);

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

  protected readonly hasSearchTerms = computed(() => this.searchTerms().length > 0);
  protected readonly searchTermTotalPages = computed(() => Math.max(1, Math.ceil(this.searchTerms().length / SEARCH_TERM_PAGE_SIZE)));
  protected readonly hasSearchTermPrevPage = computed(() => this.searchTermPage() > 1);
  protected readonly hasSearchTermNextPage = computed(() => this.searchTermPage() < this.searchTermTotalPages());

  protected readonly visibleSearchTerms = computed<SearchTermMetrics[]>(() => {
    const all = this.searchTerms();
    const start = (this.searchTermPage() - 1) * SEARCH_TERM_PAGE_SIZE;
    return all.slice(start, start + SEARCH_TERM_PAGE_SIZE);
  });

  protected readonly keywordPageNumbers = computed(() => Array.from({ length: this.keywordTotalPages() }, (_, i) => i + 1));
  protected readonly searchTermPageNumbers = computed(() => Array.from({ length: this.searchTermTotalPages() }, (_, i) => i + 1));

  public ngOnInit(): void {
    this.fetchData();
  }

  protected setDateRange(days: DateRangeOption): void {
    this.selectedDays.set(days);
    this.fetchData();
  }

  protected refresh(): void {
    this.fetchData();
  }

  protected fetchData(): void {
    this.loading.set(true);
    this.error.set(null);
    const days = this.selectedDays();

    this.campaignService
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
    this.keywordPage.set(1);
    this.campaignService
      .getKeywords(days)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.keywordsData.set(result);
          this.keywordsLoading.set(false);
        },
        error: () => this.keywordsLoading.set(false),
      });

    this.searchTermsLoading.set(true);
    this.searchTermPage.set(1);
    this.campaignService
      .getOptimizationInsights(days)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.searchTerms.set(result.searchTerms);
          this.searchTermsLoading.set(false);
        },
        error: () => this.searchTermsLoading.set(false),
      });
  }

  protected goToKeywordPage(page: number): void {
    this.keywordPage.set(Math.max(1, Math.min(page, this.keywordTotalPages())));
  }

  protected goToSearchTermPage(page: number): void {
    this.searchTermPage.set(Math.max(1, Math.min(page, this.searchTermTotalPages())));
  }

  protected copyName(name: string): void {
    if (isPlatformBrowser(this.platformId)) {
      void navigator.clipboard.writeText(name).then(() => {
        this.copiedName.set(name);
        setTimeout(() => this.copiedName.set(null), 2000);
      });
    }
  }

  protected eventLabel(campaignName: string): string {
    const parts = campaignName.split(' | ');
    return parts[1] || campaignName;
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
