// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { SkeletonModule } from 'primeng/skeleton';
import { HEALTH_METRICS_PARTICIPATING_ORGS_DEFAULT_SUMMARY, lfxColors } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { environment } from '@environments/environment';
import { downloadCardAsImage } from '@shared/utils/download-card.util';
import { initializeRangeDataFetching } from '@shared/utils/health-metrics-data.util';

import type { EngagementSegment, HealthMetricsRange, ParticipatingOrgsSummaryResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-participating-orgs-card',
  standalone: true,
  imports: [NgClass, SkeletonModule],
  templateUrl: './participating-orgs-card.component.html',
  styleUrl: './participating-orgs-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParticipatingOrgsCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly elementRef = inject(ElementRef);

  public readonly range = input<HealthMetricsRange>('YTD');

  protected readonly loading = signal(true);
  protected readonly summaryData = signal<ParticipatingOrgsSummaryResponse>(HEALTH_METRICS_PARTICIPATING_ORGS_DEFAULT_SUMMARY);

  protected readonly totalEngagement = computed(() => {
    const data = this.summaryData();
    return data.highEngagement + data.medEngagement + data.lowEngagement;
  });

  protected readonly segments = computed((): EngagementSegment[] => {
    const data = this.summaryData();
    const total = this.totalEngagement();
    if (total === 0) return [];

    const visible = [
      { label: 'High', count: data.highEngagement, color: lfxColors.emerald[400], dotColor: lfxColors.emerald[400] },
      { label: 'Medium', count: data.medEngagement, color: lfxColors.amber[300], dotColor: lfxColors.amber[300] },
      { label: 'Low', count: data.lowEngagement, color: lfxColors.red[400], dotColor: lfxColors.red[400] },
    ].filter((s) => s.count > 0);

    let usedPercent = 0;
    return visible.map((segment, index) => {
      const isLast = index === visible.length - 1;
      const percent = isLast ? 100 - usedPercent : Math.round((segment.count / total) * 100);
      usedPercent += percent;
      return { ...segment, percent };
    });
  });

  protected readonly dominantSegment = computed(() => {
    const data = this.summaryData();
    const total = this.totalEngagement();
    if (total === 0) return null;

    const highPct = Math.round((data.highEngagement / total) * 100);
    const lowPct = Math.round((data.lowEngagement / total) * 100);

    if (lowPct >= 50) return { level: 'low' as const, percent: lowPct };
    if (highPct >= 50) return { level: 'high' as const, percent: highPct };

    const segments = [
      { level: 'high' as const, percent: highPct },
      { level: 'medium' as const, percent: Math.round((data.medEngagement / total) * 100) },
      { level: 'low' as const, percent: lowPct },
    ];
    return segments.reduce((max, s) => (s.percent > max.percent ? s : max));
  });

  protected readonly isLowDominant = computed(() => this.dominantSegment()?.level === 'low');

  protected readonly alertMessage = computed(() => {
    const dominant = this.dominantSegment();
    if (!dominant) return '';
    const levelLabels: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
    const label = levelLabels[dominant.level] ?? 'Low';
    return `${dominant.percent}% ${label} Engagement`;
  });

  protected readonly alertSubtitle = computed(() => {
    const data = this.summaryData();
    const total = this.totalEngagement();
    const dominant = this.dominantSegment();
    if (total === 0 || !dominant) return '';

    const highPct = Math.round((data.highEngagement / total) * 100);
    const medPct = Math.round((data.medEngagement / total) * 100);

    const subtitleMap: Record<string, string> = {
      high: `${highPct}% of members are highly engaged this period`,
      medium: `${medPct}% of members show medium engagement this period`,
      low: `Only ${highPct}% of members are highly engaged this period`,
    };
    return subtitleMap[dominant.level] ?? '';
  });

  protected readonly alertBgClass = computed(() => {
    const dominant = this.dominantSegment();
    if (!dominant) return '';
    const bgMap: Record<string, string> = { high: 'bg-emerald-50', medium: 'bg-amber-50', low: 'bg-red-50' };
    return bgMap[dominant.level] ?? 'bg-red-50';
  });

  protected readonly exploreMoreUrl = computed(() => {
    const data = this.summaryData();
    if (!data.projectId) return '';
    const pccBaseUrl = environment.urls.pcc;
    const baseUrl = pccBaseUrl.endsWith('/') ? pccBaseUrl.slice(0, -1) : pccBaseUrl;
    return `${baseUrl}/project/${data.projectId}/reports/health-metrics/members`;
  });

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initializeDataFetching();
    }
  }

  protected downloadCard(): void {
    downloadCardAsImage(this.elementRef.nativeElement, 'participating-organizations');
  }

  private initializeDataFetching(): void {
    initializeRangeDataFetching({
      projectContextService: this.projectContextService,
      range: this.range,
      loading: this.loading,
      data: this.summaryData,
      defaultValue: HEALTH_METRICS_PARTICIPATING_ORGS_DEFAULT_SUMMARY,
      fetchFn: (slug, range) => this.analyticsService.getParticipatingOrgsSummary(slug, range),
      destroyRef: this.destroyRef,
    });
  }
}
