// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EventsGeographyComponent } from './events-geography.component';

import type { HealthMetricsEventsGeography, HealthMetricsEventsGeographyPeriod } from '@lfx-one/shared/interfaces';

function period(overrides: Partial<HealthMetricsEventsGeographyPeriod> = {}): HealthMetricsEventsGeographyPeriod {
  return {
    range: 'YTD',
    countries: 42,
    changes: { countries: 0.1 },
    topCountries: [
      { country: 'Canada', registrations: 800 },
      { country: 'Germany', registrations: 400 },
    ],
    rankedCountries: 42,
    ...overrides,
  };
}

function geography(
  periods: HealthMetricsEventsGeographyPeriod[] = [
    period(),
    period({ range: 'COMPLETED_YEAR', countries: 1, changes: null, topCountries: [{ country: 'Japan', registrations: 50 }], rankedCountries: 1 }),
  ]
): HealthMetricsEventsGeography {
  return { periods };
}

describe('EventsGeographyComponent', () => {
  let fixture: ComponentFixture<EventsGeographyComponent>;
  let getEventsGeography: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];
  let counts: (number | null)[];

  async function render(payload: HealthMetricsEventsGeography | Error = geography()): Promise<void> {
    getEventsGeography = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [EventsGeographyComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getEventsGeography } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsGeographyComponent);
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe(() => lifecycle.push('settled'));
    fixture.componentInstance.countChange.subscribe((count) => counts.push(count));
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
    counts = [];
  });

  it('reads the foundation once, settles and reports the countries count', async () => {
    await render();

    expect(getEventsGeography).toHaveBeenCalledTimes(1);
    expect(getEventsGeography).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(counts.at(-1)).toBe(42);
    expect(query('events-geo-loading')).toBeNull();
  });

  it('renders the headline, its delta, the pill and the ranked countries with the tail line', async () => {
    await render();

    expect(text('events-geo-headline-value')).toBe('42');
    expect(text('events-geo-headline-delta')).toBe('+10%');
    expect(query('events-geo-headline-delta')?.className).toContain('text-emerald-600');
    expect(text('events-geo-countries')).toBe('42 countries');
    expect(text('events-geo-country-0')).toContain('Canada');
    expect(text('events-geo-country-0-value')).toBe('800');
    expect(text('events-geo-country-1-value')).toBe('400');
    expect(text('events-geo-more')).toBe('+40 more');
  });

  it('re-projects a period change without re-reading and re-reports the count', async () => {
    await render();
    lifecycle = [];

    await pickRange('COMPLETED_YEAR');

    expect(getEventsGeography).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(['settled']);
    expect(text('events-geo-countries')).toBe('1 country');
    expect(query('events-geo-headline-delta')).toBeNull();
    expect(query('events-geo-more')).toBeNull();
    expect(counts.at(-1)).toBe(1);
  });

  it('marks a period without country rows as not available and clears the badge', async () => {
    await render();

    await pickRange('COMPLETED_YEAR_2');

    expect(query('events-geo-unmeasured')).not.toBeNull();
    expect(counts.at(-1)).toBeNull();
  });

  it('shows the foundation-level empty state when the read carries no period', async () => {
    await render(geography([]));

    expect(query('events-geo-foundation-unmeasured')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(counts.at(-1)).toBeNull();
  });

  it('shows the error state, still settles and reports no count when the read fails', async () => {
    await render(new Error('boom'));

    expect(query('events-geo-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(counts.at(-1)).toBeNull();
  });

  it('holds the skeleton without reading or settling until a foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getEventsGeography).not.toHaveBeenCalled();
    expect(query('events-geo-loading')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);
    expect(counts.every((count) => count === null)).toBe(true);
  });
});
