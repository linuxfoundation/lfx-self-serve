// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { SkeletonModule } from 'primeng/skeleton';
import { HEALTH_METRICS_MEMBERSHIP_CHURN_DEFAULT_SUMMARY } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { environment } from '@environments/environment';
import { downloadCardAsImage } from '@shared/utils/download-card.util';
import { initializeRangeDataFetching } from '@shared/utils/health-metrics-data.util';

import type { HealthMetricsRange, MembershipChurnPerTierSummaryResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-membership-churn-tier-card',
  standalone: true,
  imports: [SkeletonModule],
  templateUrl: './membership-churn-tier-card.component.html',
  styleUrl: './membership-churn-tier-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MembershipChurnTierCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly elementRef = inject(ElementRef);

  public readonly range = input<HealthMetricsRange>('YTD');

  protected readonly loading = signal(true);
  protected readonly summaryData = signal<MembershipChurnPerTierSummaryResponse>(HEALTH_METRICS_MEMBERSHIP_CHURN_DEFAULT_SUMMARY);

  protected readonly currentPeriod = computed(() => this.summaryData().currentPeriod);
  protected readonly previousYear = computed(() => this.summaryData().previousYear);
  protected readonly comparisonAvailable = computed(() => this.summaryData().comparisonAvailable);
  protected readonly trend = computed(() => this.summaryData().trend);

  protected readonly formattedChurnRate = computed(() => {
    const pct = this.currentPeriod().churnRatePct;
    return `${pct.toFixed(1)}%`;
  });

  protected readonly formattedValueLostHeadline = computed(() => {
    const value = this.currentPeriod().valueLost;
    if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `$${Math.round(value / 1_000)}K`;
    }
    return `$${value.toLocaleString()}`;
  });

  protected readonly formattedMembersLost = computed(() => {
    return this.currentPeriod().membersLost.toLocaleString();
  });

  protected readonly currentPeriodLine = computed(() => {
    const p = this.currentPeriod();
    return `$${p.valueLost.toLocaleString()} lost \u00B7 ${p.membersLost} members`;
  });

  protected readonly previousYearLine = computed(() => {
    const p = this.previousYear();
    if (!p) return '';
    return `$${p.valueLost.toLocaleString()} lost \u00B7 ${p.membersLost} members`;
  });

  protected readonly isChurnWorsening = computed(() => {
    const pct = this.currentPeriod().churnRatePct;
    return pct > 0;
  });

  protected readonly exploreMoreUrl = computed(() => {
    const data = this.summaryData();
    if (!data.projectId) return '';
    const pccBaseUrl = environment.urls.pcc;
    const baseUrl = pccBaseUrl.endsWith('/') ? pccBaseUrl.slice(0, -1) : pccBaseUrl;
    return `${baseUrl}/project/${data.projectId}/reports/health-metrics/membership-churn`;
  });

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initializeDataFetching();
    }
  }

  protected downloadCard(): void {
    downloadCardAsImage(this.elementRef.nativeElement, 'membership-churn-per-tier');
  }

  private initializeDataFetching(): void {
    initializeRangeDataFetching({
      projectContextService: this.projectContextService,
      range: this.range,
      loading: this.loading,
      data: this.summaryData,
      defaultValue: HEALTH_METRICS_MEMBERSHIP_CHURN_DEFAULT_SUMMARY,
      fetchFn: (slug, range) => this.analyticsService.getMembershipChurnPerTierSummary(slug, range),
      destroyRef: this.destroyRef,
    });
  }
}
