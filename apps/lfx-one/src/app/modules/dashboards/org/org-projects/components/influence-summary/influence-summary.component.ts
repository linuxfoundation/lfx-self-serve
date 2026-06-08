// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, output, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  DEFAULT_INFLUENCE_SUMMARY_MODE,
  HEALTH_SCORE_LABELS,
  HEALTH_SCORE_SEVERITY,
  INFLUENCE_BAND_LABELS,
  INFLUENCE_BAND_SEVERITY,
  INFLUENCE_SUMMARY_CARD_COUNT,
  INFLUENCE_TREND_COLOR,
  ORG_PROJECTS_INFLUENCE_TABS,
  VALID_INFLUENCE_SUMMARY_MODES,
} from '@lfx-one/shared/constants';
import type { HealthScore, InfluenceBand, InfluenceSummaryCard, InfluenceSummaryMode, OrgLensProject, TagSeverity } from '@lfx-one/shared/interfaces';

import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TagComponent } from '@components/tag/tag.component';

@Component({
  selector: 'lfx-influence-summary',
  imports: [AvatarComponent, ButtonComponent, CardTabsBarComponent, ChartComponent, DecimalPipe, TagComponent],
  templateUrl: './influence-summary.component.html',
})
export class InfluenceSummaryComponent {
  // Inputs / outputs
  public readonly projects = input<OrgLensProject[]>([]);
  public readonly loading = input<boolean>(false);
  public readonly error = input<boolean>(false);
  public readonly retryRequested = output<void>();

  // Private injections
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  // Configuration
  protected readonly tabs = ORG_PROJECTS_INFLUENCE_TABS.map((tab) => ({ id: tab.id, label: tab.label }));
  protected readonly skeletonCards = Array.from({ length: INFLUENCE_SUMMARY_CARD_COUNT });
  // Minimal Chart.js line config for the card sparkline (no axes, points, legend, or tooltip).
  protected readonly sparklineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    elements: { point: { radius: 0 }, line: { borderWidth: 2, tension: 0.4 } },
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: { x: { display: false }, y: { display: false } },
  };

  // Computed / toSignal
  private readonly queryParamMap = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  protected readonly activeMode: Signal<InfluenceSummaryMode> = computed(() => {
    const raw = this.queryParamMap().get('influenceTab');
    return raw && VALID_INFLUENCE_SUMMARY_MODES.has(raw as InfluenceSummaryMode) ? (raw as InfluenceSummaryMode) : DEFAULT_INFLUENCE_SUMMARY_MODE;
  });
  protected readonly cards: Signal<InfluenceSummaryCard[]> = computed(() => this.buildCards(this.projects(), this.activeMode()));
  /** True when the active mode has no qualifying projects at all (drives insufficient-history copy). */
  protected readonly hasNoQualifying = computed(() => !this.loading() && !this.error() && this.cards().length === 0);
  /** Empty slots to backfill the grid when fewer than 3 cards qualify. */
  protected readonly fillerSlots = computed(() => Array.from({ length: Math.max(0, INFLUENCE_SUMMARY_CARD_COUNT - this.cards().length) }));

  // Protected methods
  protected switchMode(modeId: string): void {
    if (!VALID_INFLUENCE_SUMMARY_MODES.has(modeId as InfluenceSummaryMode) || modeId === this.activeMode()) {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { influenceTab: modeId === DEFAULT_INFLUENCE_SUMMARY_MODE ? null : modeId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected openDetail(project: OrgLensProject): void {
    // Project Detail sub-page is delivered in LFXV2-1885; navigation target wired there.
    void this.router.navigate([], { relativeTo: this.route, queryParams: { project: project.slug }, queryParamsHandling: 'merge' });
  }

  protected bandLabel(band: InfluenceBand): string {
    return INFLUENCE_BAND_LABELS[band];
  }
  protected bandSeverity(band: InfluenceBand): TagSeverity {
    return INFLUENCE_BAND_SEVERITY[band];
  }
  protected healthLabel(health: HealthScore): string {
    return HEALTH_SCORE_LABELS[health];
  }
  protected healthSeverity(health: HealthScore): TagSeverity {
    return HEALTH_SCORE_SEVERITY[health];
  }
  protected driverSeverity(): TagSeverity {
    return this.activeMode() === 'gains' ? 'success' : 'danger';
  }
  protected sparklineData(project: OrgLensProject): { labels: string[]; datasets: { data: number[]; borderColor: string; fill: boolean }[] } {
    return {
      labels: project.trend.series.map((_, i) => String(i)),
      datasets: [{ data: project.trend.series, borderColor: INFLUENCE_TREND_COLOR[project.trend.direction], fill: false }],
    };
  }

  // Private helpers
  private buildCards(projects: OrgLensProject[], mode: InfluenceSummaryMode): InfluenceSummaryCard[] {
    if (mode === 'gains') {
      return projects
        .filter((p) => p.priorYearScore !== 0)
        .sort((a, b) => this.delta(b) - this.delta(a) || a.name.localeCompare(b.name))
        .slice(0, INFLUENCE_SUMMARY_CARD_COUNT)
        .map((project) => ({ project, primaryMetric: `${this.signed(this.delta(project))} points (1y)` }));
    }
    if (mode === 'decreases') {
      return projects
        .filter((p) => p.influenceScore !== 0)
        .sort((a, b) => this.delta(a) - this.delta(b) || a.name.localeCompare(b.name))
        .slice(0, INFLUENCE_SUMMARY_CARD_COUNT)
        .map((project) => ({ project, primaryMetric: `${this.signed(this.delta(project))} points (1y)` }));
    }
    // Most Influential: current score desc, tie-break 1y delta desc, then name asc.
    return projects
      .filter((p) => p.influenceScore > 0)
      .sort((a, b) => b.influenceScore - a.influenceScore || b.trend.deltaPct - a.trend.deltaPct || a.name.localeCompare(b.name))
      .slice(0, INFLUENCE_SUMMARY_CARD_COUNT)
      .map((project) => ({ project, primaryMetric: `Influence score: ${project.influenceScore} (${INFLUENCE_BAND_LABELS[project.technicalInfluence]})` }));
  }

  private delta(project: OrgLensProject): number {
    return Math.round((project.influenceScore - project.priorYearScore) * 10) / 10;
  }

  private signed(value: number): string {
    return value > 0 ? `+${value}` : String(value);
  }
}
