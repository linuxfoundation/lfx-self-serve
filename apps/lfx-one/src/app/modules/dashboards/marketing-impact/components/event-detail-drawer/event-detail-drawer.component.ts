// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TagComponent } from '@components/tag/tag.component';
import { BEHIND_GOAL_PERCENT_THRESHOLD, lfxColors, ON_TRACK_PERCENT_THRESHOLD } from '@lfx-one/shared/constants';
import { formatCurrency, formatNumber } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { DrawerModule } from 'primeng/drawer';
import { Skeleton } from 'primeng/skeleton';
import { catchError, combineLatest, distinctUntilChanged, finalize, of, switchMap } from 'rxjs';

import type { ChartData, ChartOptions } from 'chart.js';
import type { EventDetailResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-event-detail-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, DrawerModule, Skeleton, ButtonComponent, CardComponent, TagComponent, ChartComponent],
  templateUrl: './event-detail-drawer.component.html',
})
export class EventDetailDrawerComponent {
  private readonly analyticsService = inject(AnalyticsService);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  /** Event id to load when the drawer opens. */
  public readonly eventId = input<string | null>(null);
  /** Foundation the event belongs to; required by the server to scope the read. */
  public readonly foundationSlug = input<string | undefined>();

  // === WritableSignals ===
  /**
   * Set by the detail stream rather than derived from `detail() === null`. The request can end in
   * an error, so a derived flag would leave the skeleton up forever instead of falling through.
   */
  protected readonly loading = signal(false);
  /**
   * Distinguishes "we could not load this" from "this event has no detail" — both leave `detail()`
   * null, but only one of them should tell the user something went wrong.
   */
  protected readonly failed = signal(false);

  // === Computed Signals ===
  protected readonly detail: Signal<EventDetailResponse | null> = this.initDetail();

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
        // No `reverse` here. This is a category axis, so points render in array order, and the
        // query already returns DAYS_TO_EVENT descending — the event (0) lands on the right.
        // Reversing as well would flip it back and run the timeline backwards.
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

  /**
   * Everything the template renders as a derived label, computed once per detail change rather
   * than called from the template — these do locale, number and string formatting, which a
   * template invocation would re-run on every change-detection pass (frontend-checklist.md §4).
   */
  protected readonly dateLabel = computed(() => this.formatDate(this.detail()?.startDate ?? ''));
  protected readonly vsLastYearLabel = computed(() => this.formatVsLastYear(this.detail()?.vsLastYear ?? null));
  protected readonly locationLabel = computed(() => {
    const d = this.detail();
    if (!d) return '';
    return [d.location, d.city, d.country].filter((part) => part && part.length).join(', ');
  });
  /**
   * Goal-bar tone from the shared thresholds rather than literals, so this bar and the roster's
   * bar + at-risk icon move together when either constant is tuned.
   */
  protected readonly registrationsTone = computed(() => {
    const percent = this.regProgress();
    if (percent === null) return null;
    if (percent >= ON_TRACK_PERCENT_THRESHOLD) return 'good';
    if (percent >= BEHIND_GOAL_PERCENT_THRESHOLD) return 'warn';
    return 'critical';
  });

  /** Human label for the comparison pace rating. */
  protected readonly paceRatingLabel = computed(() => {
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
  });
  /** "N registrations behind goal" when there is a real, unmet goal; otherwise null. */
  protected readonly behindGoalLabel = computed(() => {
    const d = this.detail();
    if (!d || d.registrations.goal <= 0) return null;
    const gap = d.registrations.goal - d.registrations.actual;
    if (gap <= 0) return 'Registration goal met';
    return `${formatNumber(gap)} registrations behind goal`;
  });

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
  private formatVsLastYear(vsLastYear: number | null): string | null {
    if (vsLastYear === null) return null;
    const pct = Math.round((vsLastYear - 1) * 100);
    if (pct > 0) return `+${pct}% vs last year`;
    if (pct < 0) return `${pct}% vs last year`;
    return 'On par with last year';
  }

  private formatDate(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    if (!year || !month || !day) return iso;
    // Range-check before Date.UTC: it rolls out-of-range parts over silently (month=13 becomes
    // January of the next year), rendering a confidently wrong date instead of the raw value.
    if (month < 1 || month > 12 || day < 1 || day > 31) return iso;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return iso;
    return parsed.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  /** Full venue + city + country line for the header; '' when nothing is known. */
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
        // Only when a prior-year edition exists — the headline already gates on hasPriorYear, and
        // an all-null series would otherwise render as a legend entry with no line behind it.
        ...(this.detail()?.hasPriorYear
          ? [
              {
                label: 'Last year',
                data: points.map((point) => point.priorYear),
                borderColor: lfxColors.gray[400],
                backgroundColor: 'transparent',
                borderDash: [4, 4],
              },
            ]
          : []),
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
    // Lazy-load on open, and reload when the selected event changes. Both are triggers: the
    // drawer stays open while the user clicks a different roster row, so watching `visible`
    // alone would leave the previous event's numbers on screen under the new event's name.
    return toSignal(
      combineLatest([toObservable(this.visible), toObservable(this.eventId), toObservable(this.foundationSlug)]).pipe(
        // The parent sets eventId and visible in two separate writes, so one open produces two
        // emissions; dedupe the triple so that lands as a single fetch rather than a duplicate.
        distinctUntilChanged(([prevOpen, prevId, prevSlug], [open, id, slug]) => prevOpen === open && prevId === id && prevSlug === slug),
        switchMap(([open, id, slug]) => {
          if (!open || !id || !slug) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          this.failed.set(false);
          // finalize, not a tap on the value — the stream can end in an error, and that still
          // has to clear the skeleton. The error is caught here rather than in the service so a
          // failure renders "couldn't load" instead of the "no detail" empty state.
          return this.analyticsService.getEventDetail(id, slug).pipe(
            catchError((error: unknown) => {
              console.error('[analytics] event-detail failed', { eventId: id, foundationSlug: slug, error });
              this.failed.set(true);
              return of(null);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
