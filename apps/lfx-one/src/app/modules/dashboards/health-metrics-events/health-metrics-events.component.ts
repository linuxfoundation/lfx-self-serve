// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal } from '@angular/core';
import {
  HEALTH_METRICS_EVENTS_DATA_SECTIONS,
  HEALTH_METRICS_EVENTS_SECTION_ID_PREFIX,
  HEALTH_METRICS_EVENTS_SECTIONS,
  HEALTH_METRICS_EVENTS_SUB_NAV_CROSS_REFERENCE_NOTE,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEventsSubNavItems } from '@lfx-one/shared/utils';

import { HealthMetricsL2SectionDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section.directive';
import { HealthMetricsL2ShellComponent } from '../components/health-metrics-l2-shell/health-metrics-l2-shell.component';
import { EventsRegistrationForecastComponent } from './components/events-registration-forecast/events-registration-forecast.component';

import type { HealthMetricsEventsSubNavItem } from '@lfx-one/shared/interfaces';

/**
 * Events (Level 2) — nine anchored sections in the shared Level 2 shell; a section without a body
 * renders as an "Awaiting data" placeholder. Rendered inside HealthMetricsGateComponent's outlet.
 */
@Component({
  selector: 'lfx-health-metrics-events',
  imports: [EventsRegistrationForecastComponent, HealthMetricsL2SectionDirective, HealthMetricsL2ShellComponent],
  templateUrl: './health-metrics-events.component.html',
})
export class HealthMetricsEventsComponent {
  protected readonly sections = HEALTH_METRICS_EVENTS_SECTIONS;
  protected readonly idPrefix = HEALTH_METRICS_EVENTS_SECTION_ID_PREFIX;
  protected readonly dataSections = HEALTH_METRICS_EVENTS_DATA_SECTIONS;
  protected readonly crossReferenceNote = HEALTH_METRICS_EVENTS_SUB_NAV_CROSS_REFERENCE_NOTE;

  // Empty until the forecast reports, which renders no note rather than a premature one.
  protected readonly forecastNote = signal<string>('');

  protected readonly subNavItems = computed<HealthMetricsEventsSubNavItem[]>(() => buildHealthMetricsEventsSubNavItems({ forecast: this.forecastNote() }));
}
