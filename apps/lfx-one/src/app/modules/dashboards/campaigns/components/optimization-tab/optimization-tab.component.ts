// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CAMPAIGN_PACING_THRESHOLDS, parseCampaignName } from '@lfx-one/shared/constants';
import type {
  CampaignActionItem,
  CampaignMetrics,
  CampaignMonitorResponse,
  KeywordActionType,
  KeywordMetrics,
  KeywordMetricsResponse,
} from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import type { Subscription } from 'rxjs';

type DateRangeOption = 7 | 14 | 30;

@Component({
  selector: 'lfx-optimization-tab',
  imports: [],
  templateUrl: './optimization-tab.component.html',
  styleUrl: './optimization-tab.component.scss',
})
export class OptimizationTabComponent implements OnInit {
  private readonly campaignService = inject(CampaignService);
  private readonly destroyRef = inject(DestroyRef);
  private monitorSub: Subscription | null = null;
  private keywordsSub: Subscription | null = null;

  protected readonly Math = Math;
  protected readonly dateRangeOptions: DateRangeOption[] = [7, 14, 30];

  protected readonly selectedDays = signal<DateRangeOption>(30);
  protected readonly loading = signal(false);
  protected readonly monitorData = signal<CampaignMonitorResponse | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly keywordsLoading = signal(false);
  protected readonly keywordsData = signal<KeywordMetricsResponse | null>(null);

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

  protected readonly displayCampaigns = computed<CampaignMetrics[]>(() => {
    return this.campaigns()
      .filter((c) => !c.adFormat.toLowerCase().includes('search'))
      .sort((a, b) => a.ctr - b.ctr);
  });

  protected readonly hasWastedKeywords = computed(() => this.wastedKeywords().length > 0);
  protected readonly hasLowQualityKeywords = computed(() => this.lowQualityKeywords().length > 0);
  protected readonly hasDisplayCampaigns = computed(() => this.displayCampaigns().length > 0);

  protected readonly actionInProgress = signal<Record<string, boolean>>({});
  protected readonly actionResults = signal<Record<string, { success: boolean; message: string }>>({});

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
    this.keywordsSub = this.campaignService
      .getKeywords(days)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.keywordsData.set(data);
          this.keywordsLoading.set(false);
        },
        error: () => {
          this.keywordsLoading.set(false);
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

  protected isActionInProgress(kw: KeywordMetrics): boolean {
    return this.actionInProgress()[`${kw.adGroupId}-${kw.criterionId}`] ?? false;
  }

  protected getActionResult(kw: KeywordMetrics): { success: boolean; message: string } | null {
    return this.actionResults()[`${kw.adGroupId}-${kw.criterionId}`] ?? null;
  }

  protected priorityClass(priority: CampaignActionItem['priority']): string {
    switch (priority) {
      case 'HIGH':
        return 'bg-red-100 text-red-700';
      case 'MED':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }

  protected pacingClass(campaign: CampaignMetrics): string {
    const pct = campaign.pacingPct;
    if (pct < CAMPAIGN_PACING_THRESHOLDS.underspending) return 'bg-red-500';
    if (pct <= CAMPAIGN_PACING_THRESHOLDS.normal) return 'bg-green-500';
    if (pct <= CAMPAIGN_PACING_THRESHOLDS.constrained) return 'bg-amber-500';
    return 'bg-red-500';
  }

  protected qualityScoreClass(score: number | null): string {
    if (score === null) return 'text-gray-400';
    if (score >= 7) return 'text-green-700';
    if (score >= 4) return 'text-amber-700';
    return 'text-red-700';
  }

  protected eventLabel(campaignName: string): string {
    return parseCampaignName(campaignName).baseName || campaignName;
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
