// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { SkeletonModule } from 'primeng/skeleton';
import { HEALTH_METRICS_EVENTS_DEFAULT_SUMMARY } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { environment } from '@environments/environment';
import { downloadCardAsImage } from '@shared/utils/download-card.util';
import { initializeRangeDataFetching } from '@shared/utils/health-metrics-data.util';
import type { EventsSummaryResponse, HealthMetricsRange } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-events-card',
  standalone: true,
  imports: [SkeletonModule],
  templateUrl: './events-card.component.html',
  styleUrl: './events-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventsCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly elementRef = inject(ElementRef);

  public readonly range = input<HealthMetricsRange>('YTD');

  protected readonly loading = signal(true);
  protected readonly summaryData = signal<EventsSummaryResponse>(HEALTH_METRICS_EVENTS_DEFAULT_SUMMARY);

  protected readonly formattedTotalEvents = computed(() => {
    return this.summaryData().totalEvents.toLocaleString();
  });

  protected readonly formattedUpcomingEvents = computed(() => {
    return this.summaryData().upcomingEvents.toLocaleString();
  });

  protected readonly formattedPastEvents = computed(() => {
    return this.summaryData().pastEvents.toLocaleString();
  });

  protected readonly changeDirection = computed((): 'up' | 'down' | 'neutral' => {
    const diff = this.summaryData().eventCountDiff;
    if (diff > 0) return 'up';
    if (diff < 0) return 'down';
    return 'neutral';
  });

  protected readonly formattedChange = computed(() => {
    const diff = this.summaryData().eventCountDiff;
    const abs = Math.abs(diff);
    let prefix = '';
    if (diff > 0) prefix = '+';
    else if (diff < 0) prefix = '-';
    return `${prefix}${abs} vs prev period`;
  });

  protected readonly showChangeIndicator = computed(() => {
    return this.summaryData().totalEvents > 0 || this.summaryData().eventCountDiff !== 0;
  });

  protected readonly sponsorshipProgressWidth = computed(() => {
    const pct = this.summaryData().sponsorshipProgressPct;
    return Math.min(pct, 100);
  });

  protected readonly formattedProgressLabel = computed(() => {
    const pct = Math.round(this.summaryData().sponsorshipProgressPct);
    return `${pct}% of goal`;
  });

  protected readonly formattedRevenue = computed(() => {
    return this.abbreviateDollar(this.summaryData().sponsorshipRevenue);
  });

  protected readonly formattedGoal = computed(() => {
    return this.abbreviateDollar(this.summaryData().sponsorshipGoal);
  });

  protected readonly formattedDollarLabel = computed(() => {
    return `${this.formattedRevenue()} / ${this.formattedGoal()}`;
  });

  protected readonly exploreMoreUrl = computed(() => {
    const data = this.summaryData();
    if (!data.projectId) return '';
    const pccBaseUrl = environment.urls.pcc;
    const baseUrl = pccBaseUrl.endsWith('/') ? pccBaseUrl.slice(0, -1) : pccBaseUrl;
    return `${baseUrl}/project/${data.projectId}/reports/health-metrics/events`;
  });

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initializeDataFetching();
    }
  }

  protected downloadCard(): void {
    downloadCardAsImage(this.elementRef.nativeElement, 'events');
  }

  private initializeDataFetching(): void {
    initializeRangeDataFetching({
      projectContextService: this.projectContextService,
      range: this.range,
      loading: this.loading,
      data: this.summaryData,
      defaultValue: HEALTH_METRICS_EVENTS_DEFAULT_SUMMARY,
      fetchFn: (slug, range) => this.analyticsService.getEventsSummary(slug, range),
      destroyRef: this.destroyRef,
    });
  }

  private abbreviateDollar(value: number): string {
    if (value >= 1_000_000) {
      const millions = value / 1_000_000;
      return `$${millions.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
    }
    if (value >= 1_000) {
      const thousands = value / 1_000;
      return `$${thousands.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}K`;
    }
    return `$${value.toLocaleString()}`;
  }
}
