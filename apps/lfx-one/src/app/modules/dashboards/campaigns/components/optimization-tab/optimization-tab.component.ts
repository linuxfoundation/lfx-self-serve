// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type {
  CampaignMonitorResponse,
  DateRangeOption,
  KeywordActionType,
  KeywordMetrics,
  KeywordMetricsResponse,
  LinkedInAccountOption,
  LinkedInActionItem,
  LinkedInMonitorResponse,
} from '@lfx-one/shared/interfaces';
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
  private monitorSub: Subscription | null = null;
  private keywordsSub: Subscription | null = null;
  private linkedInSub: Subscription | null = null;

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

  protected readonly hasWastedKeywords = computed(() => this.wastedKeywords().length > 0);
  protected readonly hasLowQualityKeywords = computed(() => this.lowQualityKeywords().length > 0);
  protected readonly hasDisplayCampaigns = computed(() => this.displayCampaigns().length > 0);

  // LinkedIn optimization
  protected readonly linkedInAccountOptions = signal<LinkedInAccountOption[]>([]);
  protected readonly selectedLinkedInAccountKey = signal<string>('');
  protected readonly linkedInLoading = signal(false);
  protected readonly linkedInData = signal<LinkedInMonitorResponse | null>(null);
  protected readonly linkedInError = signal<string | null>(null);
  protected readonly linkedInActionItems = computed<LinkedInActionItem[]>(() => this.linkedInData()?.actionItems ?? []);

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
            this.selectedLinkedInAccountKey.set(accounts[0].key);
            this.fetchLinkedInOptimization();
          }
        },
        error: (err: unknown) => {
          const httpErr = err as { error?: { message?: string }; message?: string };
          this.linkedInError.set(httpErr?.error?.message || httpErr?.message || 'Failed to load LinkedIn accounts');
        },
      });
  }

  protected setDateRange(days: DateRangeOption): void {
    this.selectedDays.set(days);
    this.fetchData();
    this.fetchLinkedInOptimization();
  }

  protected refresh(): void {
    this.fetchData();
    this.fetchLinkedInOptimization();
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
}
