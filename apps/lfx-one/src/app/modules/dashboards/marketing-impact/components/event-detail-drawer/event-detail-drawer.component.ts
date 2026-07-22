// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, model, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TagComponent } from '@components/tag/tag.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { formatCurrency, formatNumber } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { DrawerModule } from 'primeng/drawer';
import { finalize, of, skip, switchMap } from 'rxjs';

import type { ChartData, ChartOptions } from 'chart.js';
import type { EventDetailResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-event-detail-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, DrawerModule, ButtonComponent, CardComponent, TagComponent, ChartComponent],
  templateUrl: './event-detail-drawer.component.html',
})
export class EventDetailDrawerComponent {
  private readonly analyticsService = inject(AnalyticsService);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  /** Event id to load when the drawer opens. */
  public readonly eventId = input<string | null>(null);

  // === Computed Signals ===
  protected readonly detail: Signal<EventDetailResponse | null> = this.initDetail();
  protected readonly loading = computed(() => this.visible() && this.detail() === null && this.eventId() !== null);

  // Registration progress (0–100) when a real goal exists.
  protected readonly regProgress = computed(() => {
    const d = this.detail();
    if (!d || d.registrations.goal <= 0) return null;
    return Math.min(100, Math.round((d.registrations.actual / d.registrations.goal) * 100));
  });
  // Sponsorship progress (0–100) when a real goal exists.
  protected readonly sponProgress = computed(() => {
    const d = this.detail();
    if (!d || d.sponsorshipRevenue.goal <= 0) return null;
    return Math.min(100, Math.round((d.sponsorshipRevenue.actual / d.sponsorshipRevenue.goal) * 100));
  });

  // Whether we have a daily curve to plot (needs the drilldown prediction data).
  protected readonly hasPacingChart = computed(() => (this.detail()?.pacing.points.length ?? 0) > 0);

  // Registration-pacing line chart: current-year + last-year + predicted, over days-to-event.
  protected readonly pacingChartData: Signal<ChartData<'line'>> = computed(() => this.buildPacingChart());

  protected readonly pacingChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, color: lfxColors.gray[500], font: { size: 11 } } },
      tooltip: { enabled: true },
    },
    scales: {
      x: {
        // Days to event count DOWN to zero; reverse so the event (0) sits on the right.
        reverse: true,
        title: { display: true, text: 'Days to event', color: lfxColors.gray[400], font: { size: 10 } },
        grid: { display: false },
        ticks: { color: lfxColors.gray[500], font: { size: 10 }, maxTicksLimit: 8 },
      },
      y: {
        beginAtZero: true,
        grid: { color: lfxColors.gray[200] },
        border: { display: false },
        ticks: { color: lfxColors.gray[500], font: { size: 10 } },
      },
    },
    elements: { point: { radius: 0, hitRadius: 8 }, line: { tension: 0.3, borderWidth: 2 } },
  };

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Protected Helpers (template) ===
  protected num(value: number): string {
    return formatNumber(value);
  }

  /** lfx-tag severity for the registration-pace rating. */
  protected paceSeverity(): 'success' | 'warn' | 'danger' | 'secondary' {
    switch (this.detail()?.compScore) {
      case 'high':
        return 'success';
      case 'medium':
        return 'warn';
      case 'low':
        return 'danger';
      default:
        return 'secondary';
    }
  }

  protected money(value: number): string {
    return formatCurrency(value);
  }

  /** Registration pace vs last year as a signed percent string, or null when no baseline. */
  protected vsLastYearLabel(): string | null {
    const d = this.detail();
    if (!d || d.vsLastYear === null) return null;
    const pct = Math.round((d.vsLastYear - 1) * 100);
    if (pct > 0) return `+${pct}% vs last year`;
    if (pct < 0) return `${pct}% vs last year`;
    return 'On par with last year';
  }

  protected dateLabel(): string {
    const iso = this.detail()?.startDate ?? '';
    const [year, month, day] = iso.split('-').map(Number);
    if (!year || !month || !day) return iso;
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  /** Full venue + city + country line for the header; '' when nothing is known. */
  protected locationLabel(): string {
    const d = this.detail();
    if (!d) return '';
    return [d.location, d.city, d.country].filter((part) => part && part.length).join(', ');
  }

  /** Human label for the comparison pace rating. */
  protected paceRatingLabel(): string {
    switch (this.detail()?.compScore) {
      case 'high':
        return 'Pacing ahead';
      case 'medium':
        return 'On pace';
      case 'low':
        return 'Pacing behind';
      default:
        return 'No pace signal';
    }
  }

  /** "N registrations behind goal" when there is a real, unmet goal; otherwise null. */
  protected behindGoalLabel(): string | null {
    const d = this.detail();
    if (!d || d.registrations.goal <= 0) return null;
    const gap = d.registrations.goal - d.registrations.actual;
    if (gap <= 0) return 'Registration goal met';
    return `${formatNumber(gap)} registrations behind goal`;
  }

  // === Private Helpers ===
  private buildPacingChart(): ChartData<'line'> {
    const points = this.detail()?.pacing.points ?? [];
    const labels = points.map((point) => point.daysToEvent);
    return {
      labels,
      datasets: [
        {
          label: 'Current year',
          data: points.map((point) => point.current),
          borderColor: lfxColors.blue[500],
          backgroundColor: 'transparent',
          spanGaps: false,
        },
        {
          label: 'Last year',
          data: points.map((point) => point.priorYear),
          borderColor: lfxColors.gray[400],
          backgroundColor: 'transparent',
          borderDash: [4, 4],
        },
        {
          label: 'Predicted',
          data: points.map((point) => point.predictedAvg),
          borderColor: lfxColors.violet[500],
          backgroundColor: 'transparent',
          borderDash: [6, 4],
        },
      ],
    };
  }

  // === Private Initializers ===
  private initDetail(): Signal<EventDetailResponse | null> {
    // Lazy-load on open: react to visibility flipping true (skip the initial value).
    return toSignal(
      toObservable(this.visible).pipe(
        skip(1),
        switchMap((open) => {
          const id = this.eventId();
          if (!open || !id) return of(null);
          return this.analyticsService.getEventDetail(id).pipe(finalize(() => undefined));
        })
      ),
      { initialValue: null }
    );
  }
}
