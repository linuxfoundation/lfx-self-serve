// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { SkeletonModule } from 'primeng/skeleton';
import { HEALTH_METRICS_NPS_DEFAULT_SUMMARY } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { environment } from '@environments/environment';
import { downloadCardAsImage } from '@shared/utils/download-card.util';
import { initializeRangeDataFetching } from '@shared/utils/health-metrics-data.util';

import type { NpsSummaryResponse, HealthMetricsRange } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-nps-card',
  standalone: true,
  imports: [SkeletonModule],
  templateUrl: './nps-card.component.html',
  styleUrl: './nps-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NpsCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly elementRef = inject(ElementRef);

  public readonly range = input<HealthMetricsRange>('YTD');

  protected readonly loading = signal(true);
  protected readonly summaryData = signal<NpsSummaryResponse>(HEALTH_METRICS_NPS_DEFAULT_SUMMARY);

  private static readonly arcLength = Math.PI * 80;

  protected readonly arcFillLength = computed(() => {
    const score = this.summaryData().npsScore;
    const clamped = Math.max(-100, Math.min(100, score));
    const ratio = (clamped + 100) / 200;
    return ratio * NpsCardComponent.arcLength;
  });

  protected readonly arcTotalLength = NpsCardComponent.arcLength;

  protected readonly formattedScore = computed(() => {
    const score = this.summaryData().npsScore;
    return score > 0 ? `+${score}` : `${score}`;
  });

  protected readonly exploreMoreUrl = computed(() => {
    const data = this.summaryData();
    if (!data.projectId) return '';
    const pccBaseUrl = environment.urls.pcc;
    const baseUrl = pccBaseUrl.endsWith('/') ? pccBaseUrl.slice(0, -1) : pccBaseUrl;
    return `${baseUrl}/project/${data.projectId}/reports/health-metrics/nps-details`;
  });

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initializeDataFetching();
    }
  }

  protected downloadCard(): void {
    downloadCardAsImage(this.elementRef.nativeElement, 'net-promoter-score');
  }

  private initializeDataFetching(): void {
    initializeRangeDataFetching({
      projectContextService: this.projectContextService,
      range: this.range,
      loading: this.loading,
      data: this.summaryData,
      defaultValue: HEALTH_METRICS_NPS_DEFAULT_SUMMARY,
      fetchFn: (slug, range) => this.analyticsService.getNpsSummary(slug, range),
      destroyRef: this.destroyRef,
    });
  }
}
