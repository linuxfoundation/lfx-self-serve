// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { formatChangePct, formatNumber, trendColorClass, trendDirection } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { catchError, finalize, of, switchMap } from 'rxjs';

import type { BrandHealthMention, BrandHealthResponse, BrandHealthTopProject, PerformanceSummaryKpi, SentimentBar } from '@lfx-one/shared/interfaces';

import { SparklineKpiCardComponent } from '../sparkline-kpi-card/sparkline-kpi-card.component';

@Component({
  selector: 'lfx-social-listening-tab',
  imports: [SparklineKpiCardComponent],
  templateUrl: './social-listening-tab.component.html',
  styleUrl: './social-listening-tab.component.scss',
})
export class SocialListeningTabComponent {
  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);

  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();
  public readonly foundationName = input<string>('');

  // === WritableSignals ===
  protected readonly loading = signal(false);

  // === Computed Signals ===
  protected readonly brandData: Signal<BrandHealthResponse | null> = this.initBrandData();
  protected readonly kpiCards: Signal<PerformanceSummaryKpi[]> = this.initKpiCards();
  protected readonly sentimentBar: Signal<SentimentBar | null> = this.initSentimentBar();
  protected readonly topProjects: Signal<BrandHealthTopProject[]> = this.initTopProjects();
  protected readonly hasTopProjects = computed(() => this.topProjects().length > 0);
  protected readonly topMentions: Signal<BrandHealthMention[]> = this.initTopMentions();
  protected readonly hasTopMentions = computed(() => this.topMentions().length > 0);

  // === Private Initializers ===
  private initBrandData(): Signal<BrandHealthResponse | null> {
    const slug$ = toObservable(this.foundationSlug);

    return toSignal(
      slug$.pipe(
        switchMap((slug) => {
          if (!slug) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          return this.analyticsService.getBrandHealth(slug, true).pipe(
            finalize(() => this.loading.set(false)),
            catchError(() => of(null))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initKpiCards(): Signal<PerformanceSummaryKpi[]> {
    return computed(() => {
      const data = this.brandData();
      if (!data) return [];

      const changePct = data.mentionMomChangePct;

      return [
        {
          id: 'total-mentions',
          label: 'Total Mentions',
          icon: 'fa-light fa-at',
          iconClass: 'bg-blue-100 text-blue-600',
          value: formatNumber(data.totalMentions),
          momChange: formatChangePct(changePct, 'MoM'),
          momTrend: trendDirection(changePct),
          momTrendClass: trendColorClass(changePct),
          yoyChange: null,
          yoyTrend: 'neutral' as const,
          yoyTrendClass: 'text-gray-500',
          comparisonLine: '',
        },
        {
          id: 'positive-sentiment',
          label: 'Positive Sentiment',
          icon: 'fa-light fa-face-smile',
          iconClass: 'bg-green-100 text-green-600',
          value: `${data.sentiment.positive.toFixed(0)}%`,
          momChange: null,
          momTrend: 'neutral' as const,
          momTrendClass: 'text-gray-500',
          yoyChange: null,
          yoyTrend: 'neutral' as const,
          yoyTrendClass: 'text-gray-500',
          comparisonLine: '',
        },
        {
          id: 'negative-sentiment',
          label: 'Negative Sentiment',
          icon: 'fa-light fa-face-frown',
          iconClass: 'bg-red-100 text-red-600',
          value: `${data.sentiment.negative.toFixed(0)}%`,
          momChange: null,
          momTrend: 'neutral' as const,
          momTrendClass: 'text-gray-500',
          yoyChange: null,
          yoyTrend: 'neutral' as const,
          yoyTrendClass: 'text-gray-500',
          comparisonLine: '',
        },
      ];
    });
  }

  private initSentimentBar(): Signal<SentimentBar | null> {
    return computed(() => {
      const data = this.brandData();
      if (!data) return null;
      return {
        positive: data.sentiment.positive,
        neutral: data.sentiment.neutral,
        negative: data.sentiment.negative,
        positiveLabel: `${Math.round(data.sentiment.positive)}%`,
        neutralLabel: `${Math.round(data.sentiment.neutral)}%`,
        negativeLabel: `${Math.round(data.sentiment.negative)}%`,
      };
    });
  }

  private initTopProjects(): Signal<BrandHealthTopProject[]> {
    return computed(() => {
      const data = this.brandData();
      if (!data?.topProjects?.length) return [];
      return data.topProjects.slice(0, 5);
    });
  }

  private initTopMentions(): Signal<BrandHealthMention[]> {
    return computed(() => {
      const data = this.brandData();
      if (!data) return [];
      const positive = data.topPositiveMentions ?? [];
      const negative = data.topNegativeMentions ?? [];
      const interleaved: BrandHealthMention[] = [];
      const maxLen = Math.max(positive.length, negative.length);
      for (let i = 0; i < maxLen && interleaved.length < 5; i++) {
        if (i < positive.length) interleaved.push(positive[i]);
        if (i < negative.length && interleaved.length < 5) interleaved.push(negative[i]);
      }
      return interleaved;
    });
  }
}
