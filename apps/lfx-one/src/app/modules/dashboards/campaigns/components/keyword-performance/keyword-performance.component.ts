// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Subscription } from 'rxjs';
import { parseCampaignName } from '@lfx-one/shared/constants';
import { CampaignService } from '@services/campaign.service';

import type { KeywordMetrics, KeywordMetricsResponse } from '@lfx-one/shared/interfaces';

const PAGE_SIZE = 10;

@Component({
  selector: 'lfx-keyword-performance',
  imports: [],
  templateUrl: './keyword-performance.component.html',
  styleUrl: './keyword-performance.component.scss',
})
export class KeywordPerformanceComponent {
  // === Services ===
  private readonly campaignService = inject(CampaignService);
  private readonly destroyRef = inject(DestroyRef);
  private keywordsSub: Subscription | null = null;

  // === Inputs ===
  public readonly days = input(30);

  // === Constants ===
  protected readonly pageSize = PAGE_SIZE;

  // === WritableSignals ===
  protected readonly loading = signal(false);
  protected readonly data = signal<KeywordMetricsResponse | null>(null);
  protected readonly currentPage = signal(1);

  // === Computed Signals ===
  protected readonly keywords = computed(() => this.data()?.keywords ?? []);
  protected readonly totals = computed(() => this.data()?.totals ?? null);
  protected readonly hasKeywords = computed(() => this.keywords().length > 0);
  protected readonly pulledAt = computed(() => this.data()?.pulledAt ?? '');
  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.keywords().length / PAGE_SIZE)));
  protected readonly hasPrevPage = computed(() => this.currentPage() > 1);
  protected readonly hasNextPage = computed(() => this.currentPage() < this.totalPages());
  protected readonly pageNumbers = computed(() => Array.from({ length: this.totalPages() }, (_, i) => i + 1));

  protected readonly visibleKeywords = computed<KeywordMetrics[]>(() => {
    const all = this.keywords();
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return all.slice(start, start + PAGE_SIZE);
  });

  // === Effects ===
  private readonly fetchOnDaysChange = effect(() => {
    const days = this.days();
    this.refresh(days);
  });

  // === Protected Methods ===
  protected refresh(days?: number): void {
    this.keywordsSub?.unsubscribe();
    this.loading.set(true);
    this.currentPage.set(1);
    this.keywordsSub = this.campaignService
      .getKeywords(days ?? this.days())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.data.set(result);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  protected goToPage(page: number): void {
    this.currentPage.set(Math.max(1, Math.min(page, this.totalPages())));
  }

  protected eventLabel(kw: KeywordMetrics): string {
    return parseCampaignName(kw.campaign).baseName || kw.campaign;
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
      case 'BROAD':
        return 'bg-gray-100 text-gray-600';
      default:
        return 'bg-gray-100 text-gray-600';
    }
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
