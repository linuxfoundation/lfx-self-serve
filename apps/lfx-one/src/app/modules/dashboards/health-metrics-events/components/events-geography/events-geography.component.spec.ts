// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { WorldGeometryService } from '@services/world-geometry.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EventsGeographyComponent } from './events-geography.component';

import type { HealthMetricsEventsGeography, HealthMetricsEventsGeographyPeriod, HealthMetricsWorldGeometry } from '@lfx-one/shared/interfaces';

const GEOMETRY: HealthMetricsWorldGeometry = {
  source: 'test',
  width: 960,
  height: 470,
  countries: [
    { code: 'CA', name: 'Canada', d: 'M0,0L1,1Z' },
    { code: 'DE', name: 'Germany', d: 'M2,2L3,3Z' },
    { code: 'US', name: 'United States', d: 'M4,4L5,5Z' },
  ],
};

function period(overrides: Partial<HealthMetricsEventsGeographyPeriod> = {}): HealthMetricsEventsGeographyPeriod {
  return {
    range: 'YTD',
    countries: 42,
    changes: { countries: 0.1 },
    registrationsByCountry: [
      { code: 'CA', country: 'Canada', registrations: 800 },
      { code: 'DE', country: 'Germany', registrations: 400 },
    ],
    ...overrides,
  };
}

function geography(
  periods: HealthMetricsEventsGeographyPeriod[] = [
    period(),
    period({ range: 'COMPLETED_YEAR', countries: 1, changes: null, registrationsByCountry: [{ code: 'JP', country: 'Japan', registrations: 50 }] }),
  ]
): HealthMetricsEventsGeography {
  return { periods };
}

describe('EventsGeographyComponent', () => {
  let fixture: ComponentFixture<EventsGeographyComponent>;
  let getEventsGeography: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];
  let verdicts: boolean[];

  async function render(payload: HealthMetricsEventsGeography | Error = geography()): Promise<void> {
    getEventsGeography = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [EventsGeographyComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getEventsGeography } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: WorldGeometryService, useValue: { getGeometry: () => of(GEOMETRY) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsGeographyComponent);
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe((empty) => {
      lifecycle.push('settled');
      verdicts.push(empty);
    });
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string): string {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function pickRange(range: HealthMetricsEventsGeographyPeriod['range']): Promise<void> {
    TestBed.inject(HealthMetricsChromeService).selectedRange.set(range);
    await settle();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    verdicts = [];
  });

  it('reads the foundation once and settles', async () => {
    await render();

    expect(getEventsGeography).toHaveBeenCalledTimes(1);
    expect(getEventsGeography).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
    expect(query('events-geo-loading')).toBeNull();
  });

  it('lays out the metrics row: countries represented with its change, the top country and the share outside the US', async () => {
    await render();

    expect(text('events-geo-metrics-countries-value')).toBe('42');
    expect(text('events-geo-metrics-countries-trend')).toBe('+10%');
    expect(text('events-geo-metrics-top-value')).toBe('Canada');
    expect(text('events-geo-metrics-top-description')).toBe('800 registrations · 67%');
    expect(text('events-geo-metrics-outside-us-value')).toBe('100%');
    expect(text('events-geo-metrics-outside-us-description')).toBe('of registrations');
    // The countries caption pill is gone.
    expect(query('events-geo-countries')).toBeNull();
  });

  it('draws the map beside the top countries, each with its flag, count and share', async () => {
    await render();

    expect(query('events-geo-map-svg')?.getAttribute('aria-label')).toBe('Registrations by country');
    expect(query('events-geo-map-country-CA')?.getAttribute('fill')).toBe('#0061A3');
    expect(query('events-geo-map-country-US')?.getAttribute('fill')).toBe('#E2E8F0');
    expect(text('events-geo-country-0')).toContain('🇨🇦');
    expect(text('events-geo-country-0')).toContain('Canada');
    expect(text('events-geo-country-0-value')).toBe('800');
    expect(text('events-geo-country-0-pct')).toBe('67%');
    expect(text('events-geo-country-1-pct')).toBe('33%');
    // The design's wrapping row: map 3 1 520px, list 1 1 260px from 220px.
    expect(query('events-geo-map')?.closest('lfx-health-metrics-world-map')?.className).toContain('flex-[3_1_520px]');
    expect(query('events-geo-top')?.className).toContain('flex-[1_1_260px]');
    expect(query('events-geo-top')?.className).toContain('min-w-[220px]');
  });

  it('re-projects a period change without re-reading', async () => {
    await render();
    lifecycle = [];

    await pickRange('COMPLETED_YEAR');

    expect(getEventsGeography).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(['settled']);
    expect(text('events-geo-metrics-countries-value')).toBe('1');
    expect(query('events-geo-metrics-countries-trend')).toBeNull();
    expect(text('events-geo-country-0')).toContain('Japan');
  });

  it('settles a period without country rows empty, with no body', async () => {
    await render();

    await pickRange('COMPLETED_YEAR_2');

    expect(verdicts).toEqual([false, true]);
    expect(query('events-geo-metrics')).toBeNull();
    expect(query('events-geo-top')).toBeNull();
  });

  it('settles empty, with no body, when the read carries no period', async () => {
    await render(geography([]));

    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([true]);
    expect(query('events-geo-metrics')).toBeNull();
  });

  it('shows the error state and still settles when the read fails', async () => {
    await render(new Error('boom'));

    expect(query('events-geo-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('holds the skeleton without reading or settling until a foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getEventsGeography).not.toHaveBeenCalled();
    expect(query('events-geo-loading')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);
  });
});
