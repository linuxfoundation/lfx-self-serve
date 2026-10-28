// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, output, PLATFORM_ID, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { HEALTH_METRICS_EVENTS_AT_A_GLANCE_FOOTNOTE } from '@lfx-one/shared/constants';
import { buildHealthMetricsEventsAtAGlanceView } from '@lfx-one/shared/utils';
import { Skeleton } from 'primeng/skeleton';
import { combineLatest } from 'rxjs';

import { HealthMetricsFootnoteComponent } from '../../../components/health-metrics-footnote/health-metrics-footnote.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsEventsAtAGlance,
  HealthMetricsEventsAtAGlanceStatus,
  HealthMetricsEventsAtAGlanceView,
  HealthMetricsRange,
} from '@lfx-one/shared/interfaces';

/**
 * `#kpi` — reach across every event in the period. The Events tab owns the read, since the same
 * response decides whether the tab shows at all; this section projects it for the selected period.
 */
@Component({
  selector: 'lfx-events-at-a-glance',
  imports: [EmptyStateComponent, HealthMetricsFootnoteComponent, Skeleton],
  templateUrl: './events-at-a-glance.component.html',
})
export class EventsAtAGlanceComponent {
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly platformId = inject(PLATFORM_ID);

  public readonly glance = input.required<HealthMetricsEventsAtAGlance>();
  public readonly status = input.required<HealthMetricsEventsAtAGlanceStatus>();

  /** Fires as the read starts, so the L2 shell knows this section's height is about to move. */
  public readonly reading = output<void>();
  /**
   * Fires once the read lands and on every period change — this section's height moves either way — `true`
   * when the period was never measured.
   */
  public readonly settled = output<boolean>();

  protected readonly footnote = HEALTH_METRICS_EVENTS_AT_A_GLANCE_FOOTNOTE;

  protected readonly view: Signal<HealthMetricsEventsAtAGlanceView> = computed(() =>
    buildHealthMetricsEventsAtAGlanceView(this.glance(), this.chrome.selectedRange())
  );
  /** The period was never measured or held nothing; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => this.status() === 'ready' && isEmptyPeriod(this.glance(), this.chrome.selectedRange()));

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // A period change re-projects the loaded read, so it re-settles like a landed read.
      combineLatest([toObservable(this.status), toObservable(this.chrome.selectedRange)])
        .pipe(takeUntilDestroyed())
        .subscribe(([status]) =>
          status === 'loading' ? this.reading.emit() : this.settled.emit(status === 'ready' && isEmptyPeriod(this.glance(), this.chrome.selectedRange()))
        );
    }
  }
}

/** The period was never measured, or held no event, registration or upcoming event; the read zero-fills a quiet one. */
function isEmptyPeriod(glance: HealthMetricsEventsAtAGlance, range: HealthMetricsRange): boolean {
  const period = glance.periods.find((candidate) => candidate.range === range);
  const upcoming = range === 'YTD' ? glance.upcomingEvents : 0;
  return !period || (!period.events && !period.pastEvents && !period.registrations && !upcoming);
}
