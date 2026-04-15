// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { SkeletonModule } from 'primeng/skeleton';
import { HEALTH_METRICS_CODE_CONTRIBUTION_DEFAULT_SUMMARY } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { downloadCardAsImage } from '@shared/utils/download-card.util';
import { initializeRangeDataFetching } from '@shared/utils/health-metrics-data.util';

import type { CodeContributionSummaryResponse, HealthMetricsRange } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-code-contribution-card',
  standalone: true,
  imports: [SkeletonModule],
  templateUrl: './code-contribution-card.component.html',
  styleUrl: './code-contribution-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeContributionCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly elementRef = inject(ElementRef);

  public readonly range = input<HealthMetricsRange>('YTD');

  protected readonly loading = signal(true);
  protected readonly summaryData = signal<CodeContributionSummaryResponse>(HEALTH_METRICS_CODE_CONTRIBUTION_DEFAULT_SUMMARY);

  protected readonly hasContributorData = computed(() => this.summaryData().dataAvailable);

  protected readonly formattedTotalContributors = computed(() => {
    return this.abbreviateCount(this.summaryData().totalContributors);
  });

  protected readonly formattedNewContributors = computed(() => {
    return this.abbreviateCount(this.summaryData().newContributors);
  });

  protected readonly showTotalChange = computed(() => {
    const change = this.summaryData().totalContributorsChange;
    return change >= 0.01;
  });

  protected readonly formattedTotalChange = computed(() => {
    const pct = Math.abs(this.summaryData().totalContributorsChange * 100).toFixed(0);
    return `↑ ${pct}%`;
  });

  protected readonly showNewChange = computed(() => {
    const change = this.summaryData().newContributorsChange;
    return change >= 0.01;
  });

  protected readonly formattedNewChange = computed(() => {
    const pct = Math.abs(this.summaryData().newContributorsChange * 100).toFixed(0);
    return `↑ ${pct}%`;
  });

  protected readonly hasRoleData = computed(() => {
    const data = this.summaryData();
    return data.committers > 0 || data.maintainers > 0 || data.reviewers > 0;
  });

  protected readonly totalRoleCount = computed(() => {
    const data = this.summaryData();
    return data.committers + data.maintainers + data.reviewers;
  });

  protected readonly committersWidthPct = computed(() => {
    const total = this.totalRoleCount();
    if (total === 0) return 0;
    return (this.summaryData().committers / total) * 100;
  });

  protected readonly maintainersWidthPct = computed(() => {
    const total = this.totalRoleCount();
    if (total === 0) return 0;
    return (this.summaryData().maintainers / total) * 100;
  });

  protected readonly reviewersWidthPct = computed(() => {
    const total = this.totalRoleCount();
    if (total === 0) return 0;
    return 100 - this.committersWidthPct() - this.maintainersWidthPct();
  });

  protected readonly formattedCommitters = computed(() => {
    return this.summaryData().committers.toLocaleString();
  });

  protected readonly formattedMaintainers = computed(() => {
    return this.summaryData().maintainers.toLocaleString();
  });

  protected readonly formattedReviewers = computed(() => {
    return this.summaryData().reviewers.toLocaleString();
  });

  protected readonly contributionsSectionTitle = computed(() => {
    const range = this.range();
    const currentYear = new Date().getFullYear();
    const rangeYearMap: Record<string, number> = {
      COMPLETED_YEAR: currentYear - 1,
      COMPLETED_YEAR_2: currentYear - 2,
      COMPLETED_YEAR_3: currentYear - 3,
      COMPLETED_YEAR_4: currentYear - 4,
    };
    const year = rangeYearMap[range];
    return year ? `Contributions by Type (${year})` : 'Contributions by Type';
  });

  protected readonly exploreMoreUrl = computed(() => {
    const slug = this.summaryData().projectSlug;
    if (!slug) return '';
    return `https://insights.linuxfoundation.org/project/${slug}/contributors`;
  });

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initializeDataFetching();
    }
  }

  protected downloadCard(): void {
    downloadCardAsImage(this.elementRef.nativeElement, 'code-contribution');
  }

  private abbreviateCount(value: number): string {
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}K`;
    }
    return value.toLocaleString();
  }

  private initializeDataFetching(): void {
    initializeRangeDataFetching({
      projectContextService: this.projectContextService,
      range: this.range,
      loading: this.loading,
      data: this.summaryData,
      defaultValue: HEALTH_METRICS_CODE_CONTRIBUTION_DEFAULT_SUMMARY,
      fetchFn: (slug, range) => this.analyticsService.getCodeContributionSummary(slug, range),
      destroyRef: this.destroyRef,
    });
  }
}
