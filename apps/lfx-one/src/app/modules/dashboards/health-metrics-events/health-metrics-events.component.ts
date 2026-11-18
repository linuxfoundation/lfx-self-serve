// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED,
  HEALTH_METRICS_EVENTS_BLANK,
  HEALTH_METRICS_EVENTS_DATA_SECTIONS,
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_SEGMENT_OPTIONS,
  HEALTH_METRICS_EVENTS_QUERY_PARAMS,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_METRIC_OPTIONS,
  HEALTH_METRICS_EVENTS_SECTIONS,
  HEALTH_METRICS_EVENTS_SECTION_ID_PREFIX,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEventsSubNavItems } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';
import { catchError, distinctUntilChanged, of, switchMap, tap } from 'rxjs';

import { HealthMetricsL2SectionControlsDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section-controls.directive';
import { HealthMetricsL2SectionDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section.directive';
import { HealthMetricsL2ShellComponent } from '../components/health-metrics-l2-shell/health-metrics-l2-shell.component';
import { EventsAtAGlanceComponent } from './components/events-at-a-glance/events-at-a-glance.component';
import { EventsGeographyComponent } from './components/events-geography/events-geography.component';
import { EventsOrganizationsComponent } from './components/events-organizations/events-organizations.component';
import { EventsPastEventsComponent } from './components/events-past-events/events-past-events.component';
import { EventsRegistrationForecastComponent } from './components/events-registration-forecast/events-registration-forecast.component';
import { EventsRegistrationsGrowthComponent } from './components/events-registrations-growth/events-registrations-growth.component';
import { EventsRevenueComponent } from './components/events-revenue/events-revenue.component';
import { EventsSpeakersComponent } from './components/events-speakers/events-speakers.component';
import { EventsSponsorshipComponent } from './components/events-sponsorship/events-sponsorship.component';

import type {
  HealthMetricsEventsAtAGlance,
  HealthMetricsEventsAtAGlanceStatus,
  HealthMetricsEventsForecastPicker,
  HealthMetricsEventsOrganizationsSegment,
  HealthMetricsEventsRegistrationsGrowthMetric,
  HealthMetricsEventsSubNavItem,
} from '@lfx-one/shared/interfaces';

/**
 * Events (Level 2) — nine anchored sections in the shared Level 2 shell, which swaps them for the Events blank card when none
 * has anything for the period. Rendered inside HealthMetricsGateComponent's outlet.
 */
@Component({
  selector: 'lfx-health-metrics-events',
  imports: [
    EventsAtAGlanceComponent,
    EventsGeographyComponent,
    EventsOrganizationsComponent,
    EventsPastEventsComponent,
    EventsRegistrationForecastComponent,
    EventsRegistrationsGrowthComponent,
    EventsRevenueComponent,
    EventsSpeakersComponent,
    EventsSponsorshipComponent,
    HealthMetricsL2SectionControlsDirective,
    HealthMetricsL2SectionDirective,
    HealthMetricsL2ShellComponent,
    UiOptionComponent,
    UiSelectComponent,
    UiSwitchComponent,
    UiSwitchOptionComponent,
  ],
  templateUrl: './health-metrics-events.component.html',
})
export class HealthMetricsEventsComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);

  protected readonly sections = HEALTH_METRICS_EVENTS_SECTIONS;
  protected readonly idPrefix = HEALTH_METRICS_EVENTS_SECTION_ID_PREFIX;
  protected readonly dataSections = HEALTH_METRICS_EVENTS_DATA_SECTIONS;
  protected readonly blank = HEALTH_METRICS_EVENTS_BLANK;

  // Empty until the forecast reports, which renders no note rather than a premature one. It is the tab's only note.
  protected readonly forecastNote = signal<string>('');
  // The forecast's event select sits in its card header, so the tab holds the pick and the forecast reports its events.
  protected readonly forecastEventId = signal<string | null>(null);
  protected readonly forecastPicker = signal<HealthMetricsEventsForecastPicker>({ options: [], eventId: null });
  protected readonly growthMetrics = HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_METRIC_OPTIONS;
  /** Registrations & growth's header switch. */
  protected readonly growthMetric = signal<HealthMetricsEventsRegistrationsGrowthMetric>(HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_METRIC_OPTIONS[0].id);
  protected readonly orgSegments = HEALTH_METRICS_EVENTS_ORGANIZATIONS_SEGMENT_OPTIONS;
  /** Companies at events' header switch, read from the URL on arrival; the section writes it back. */
  protected readonly orgSegment = signal<HealthMetricsEventsOrganizationsSegment>(
    toOrgSegment(this.route.snapshot.queryParamMap.get(HEALTH_METRICS_EVENTS_QUERY_PARAMS.orgSegment))
  );
  // Owned here and handed to the at-a-glance section as inputs.
  protected readonly glanceStatus = signal<HealthMetricsEventsAtAGlanceStatus>('loading');

  protected readonly subNavItems = computed<HealthMetricsEventsSubNavItem[]>(() => buildHealthMetricsEventsSubNavItems({ forecast: this.forecastNote() }));

  protected readonly glance: Signal<HealthMetricsEventsAtAGlance> = this.initGlance();

  protected onOrgSegmentChange(id: string | null): void {
    this.orgSegment.set(toOrgSegment(id));
  }

  protected onGrowthMetricChange(id: string | null): void {
    const option = this.growthMetrics.find((candidate) => candidate.id === id);
    if (option) this.growthMetric.set(option.id);
  }

  private initGlance(): Signal<HealthMetricsEventsAtAGlance> {
    if (!isPlatformBrowser(this.platformId)) {
      // `glanceStatus` stays at `loading` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED);
    }

    const slug = computed(() => this.projectContextService.selectedFoundation()?.slug ?? '');
    // Latches on the first non-empty slug: an unresolved foundation holds the skeleton, a cleared one settles.
    let foundationSeen = false;

    return toSignal(
      toObservable(slug).pipe(
        distinctUntilChanged(),
        tap((foundationSlug) => {
          foundationSeen = foundationSeen || foundationSlug !== '';
          this.glanceStatus.set('loading');
        }),
        switchMap((foundationSlug) =>
          (foundationSlug ? this.analyticsService.getEventsAtAGlance({ foundationSlug }) : of(HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.glanceStatus.set('failed');
              return of(HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED);
            }),
            tap(() => {
              if (foundationSeen && this.glanceStatus() !== 'failed') this.glanceStatus.set('ready');
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED }
    );
  }
}

/** A segment id from the URL or the switch; anything else is All. */
function toOrgSegment(id: string | null): HealthMetricsEventsOrganizationsSegment {
  return HEALTH_METRICS_EVENTS_ORGANIZATIONS_SEGMENT_OPTIONS.find((option) => option.id === id)?.id ?? 'all';
}
