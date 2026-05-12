// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, output, PLATFORM_ID, signal } from '@angular/core';
import { SkeletonModule } from 'primeng/skeleton';
import { HealthMetricsCardEmptyStateComponent } from '../health-metrics-card-empty-state/health-metrics-card-empty-state.component';
import { HEALTH_METRICS_TRAINING_CERTIFICATION_DEFAULT_SUMMARY } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { environment } from '@environments/environment';
import { downloadCardAsImage } from '@shared/utils/download-card.util';
import { emitHasDataOnLoad, initializeRangeDataFetching } from '@shared/utils/health-metrics-data.util';

import type { HealthMetricsRange, TrainingCertificationSummaryResponse } from '@lfx-one/shared/interfaces';

type CardMode = 'enrollment' | 'revenue';

@Component({
  selector: 'lfx-training-certification-card',
  standalone: true,
  imports: [SkeletonModule, HealthMetricsCardEmptyStateComponent],
  templateUrl: './training-certification-card.component.html',
  styleUrl: './training-certification-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingCertificationCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly elementRef = inject(ElementRef);

  public readonly range = input<HealthMetricsRange>('YTD');
  public readonly hasDataChange = output<boolean>();

  protected readonly loading = signal(true);
  protected readonly summaryData = signal<TrainingCertificationSummaryResponse>(HEALTH_METRICS_TRAINING_CERTIFICATION_DEFAULT_SUMMARY);
  protected readonly activeMode = signal<CardMode>('enrollment');

  protected readonly hasData = computed(() => {
    const data = this.summaryData();
    const e = data.enrollment;
    const r = data.revenue;
    const hasEnrollment = e.instructorLed > 0 || e.eLearning > 0 || e.certExams > 0 || e.edx > 0;
    const hasRevenue = r.instructorLed > 0 || r.eLearning > 0 || r.certExams > 0;
    return hasEnrollment || hasRevenue;
  });

  protected readonly activeMetrics = computed(() => {
    const mode = this.activeMode();
    if (mode === 'enrollment') {
      const e = this.summaryData().enrollment;
      return [
        { label: 'Instructor Led', formatted: this.formatValue(e.instructorLed, 'enrollment') },
        { label: 'eLearning', formatted: this.formatValue(e.eLearning, 'enrollment') },
        { label: 'Cert Exams', formatted: this.formatValue(e.certExams, 'enrollment') },
        { label: 'edX', formatted: this.formatValue(e.edx, 'enrollment') },
      ];
    }
    const r = this.summaryData().revenue;
    return [
      { label: 'Instructor Led', formatted: this.formatValue(r.instructorLed, 'revenue') },
      { label: 'eLearning', formatted: this.formatValue(r.eLearning, 'revenue') },
      { label: 'Cert Exams', formatted: this.formatValue(r.certExams, 'revenue') },
    ];
  });

  protected readonly activeModeLabel = computed(() => {
    return this.activeMode() === 'enrollment' ? 'Enrollment' : 'Revenue';
  });

  protected readonly exploreMoreUrl = computed(() => {
    const data = this.summaryData();
    if (!data.projectId) return '';
    const pccBaseUrl = environment.urls.pcc;
    const baseUrl = pccBaseUrl.endsWith('/') ? pccBaseUrl.slice(0, -1) : pccBaseUrl;
    return `${baseUrl}/project/${data.projectId}/reports/health-metrics/training`;
  });

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initializeDataFetching();
    }
    emitHasDataOnLoad(this.loading, this.hasData, this.hasDataChange, this.destroyRef);
  }

  protected setMode(mode: CardMode): void {
    this.activeMode.set(mode);
  }

  protected downloadCard(): void {
    downloadCardAsImage(this.elementRef.nativeElement, 'training-certification');
  }

  private formatValue(value: number, mode: CardMode): string {
    if (mode === 'revenue') {
      if (value >= 1_000_000) {
        return `$${(value / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}M`;
      }
      if (value >= 1_000) {
        return `$${(value / 1_000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}K`;
      }
      return `$${value.toLocaleString()}`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}K`;
    }
    return value.toLocaleString();
  }

  private initializeDataFetching(): void {
    initializeRangeDataFetching({
      projectContextService: this.projectContextService,
      range: this.range,
      loading: this.loading,
      data: this.summaryData,
      defaultValue: HEALTH_METRICS_TRAINING_CERTIFICATION_DEFAULT_SUMMARY,
      fetchFn: (slug, range) => this.analyticsService.getTrainingCertificationSummary(slug, range),
      destroyRef: this.destroyRef,
    });
  }
}
