// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED,
  HEALTH_METRICS_EVENTS_DATA_SECTIONS,
  HEALTH_METRICS_EVENTS_SECTION_ID_PREFIX,
  HEALTH_METRICS_EVENTS_SECTIONS,
  HEALTH_METRICS_EVENTS_SUB_NAV_CROSS_REFERENCE_NOTE,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEventsSubNavItems } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, distinctUntilChanged, of, switchMap, tap } from 'rxjs';

import { HealthMetricsL2SectionDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section.directive';
import { HealthMetricsL2ShellComponent } from '../components/health-metrics-l2-shell/health-metrics-l2-shell.component';
import { EventsAtAGlanceComponent } from './components/events-at-a-glance/events-at-a-glance.component';
import { EventsPastEventsComponent } from './components/events-past-events/events-past-events.component';
import { EventsRegistrationForecastComponent } from './components/events-registration-forecast/events-registration-forecast.component';

import type { HealthMetricsEventsAtAGlance, HealthMetricsEventsAtAGlanceStatus, HealthMetricsEventsSubNavItem } from '@lfx-one/shared/interfaces';

/**
 * Events (Level 2) — nine anchored sections in the shared Level 2 shell; a section without a body
 * renders as an "Awaiting data" placeholder. Rendered inside HealthMetricsGateComponent's outlet.
 */
@Component({
  selector: 'lfx-health-metrics-events',
  imports: [
    EventsAtAGlanceComponent,
    EventsPastEventsComponent,
    EventsRegistrationForecastComponent,
    HealthMetricsL2SectionDirective,
    HealthMetricsL2ShellComponent,
  ],
  templateUrl: './health-metrics-events.component.html',
})
export class HealthMetricsEventsComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly sections = HEALTH_METRICS_EVENTS_SECTIONS;
  protected readonly idPrefix = HEALTH_METRICS_EVENTS_SECTION_ID_PREFIX;
  protected readonly dataSections = HEALTH_METRICS_EVENTS_DATA_SECTIONS;
  protected readonly crossReferenceNote = HEALTH_METRICS_EVENTS_SUB_NAV_CROSS_REFERENCE_NOTE;

  // Empty until the forecast reports, which renders no note rather than a premature one.
  protected readonly forecastNote = signal<string>('');
  // `null` until Past events reports, so the badge never shows a count the section has not read.
  protected readonly pastCount = signal<number | null>(null);

  protected readonly subNavItems = computed<HealthMetricsEventsSubNavItem[]>(() =>
    buildHealthMetricsEventsSubNavItems({ forecast: this.forecastNote() }, { past: this.pastCount() })
  );

  // Owned here rather than by the section, since the same read decides whether the tab has any events.
  protected readonly glanceStatus = signal<HealthMetricsEventsAtAGlanceStatus>('loading');
  protected readonly glance: Signal<HealthMetricsEventsAtAGlance> = this.initGlance();

  private initGlance(): Signal<HealthMetricsEventsAtAGlance> {
    if (!isPlatformBrowser(this.platformId)) {
      // `glanceStatus` stays at `loading` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED);
    }

    const slug = computed(() => this.projectContextService.selectedFoundation()?.slug ?? '');

    return toSignal(
      toObservable(slug).pipe(
        distinctUntilChanged(),
        tap(() => this.glanceStatus.set('loading')),
        switchMap((foundationSlug) =>
          // An unresolved foundation holds the skeleton rather than reading an empty scope.
          foundationSlug
            ? this.analyticsService.getEventsAtAGlance({ foundationSlug }).pipe(
                tap(() => this.glanceStatus.set('ready')),
                // `AnalyticsService` has already logged the error before rethrowing it.
                catchError(() => {
                  this.glanceStatus.set('failed');
                  return of(HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED);
                })
              )
            : of(HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED)
        )
      ),
      { initialValue: HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED }
    );
  }
}
