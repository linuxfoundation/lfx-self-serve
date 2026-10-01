// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { ChartComponent } from '@components/chart/chart.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { hexToRgba } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventsRegistrationsGrowthComponent } from './events-registrations-growth.component';

import type { ChartData } from 'chart.js';
import type {
  HealthMetricsEventsRegistrationsGrowth,
  HealthMetricsEventsRegistrationsGrowthYear,
  HealthMetricsEventsSectionKey,
} from '@lfx-one/shared/interfaces';

/** Chart.js needs a canvas jsdom does not have; the stub only records the datasets it is handed. */
@Component({ selector: 'lfx-chart', template: '<div data-testid="chart-stub"></div>' })
class ChartStubComponent {
  public readonly type = input<string>('');
  public readonly data = input<ChartData<'bar'> | null>(null);
  public readonly options = input<unknown>({});
  public readonly height = input<string>('');
}

function year(overrides: Partial<HealthMetricsEventsRegistrationsGrowthYear> = {}): HealthMetricsEventsRegistrationsGrowthYear {
  return {
    year: 2019,
    isPartialYear: false,
    totalRegistrations: 1200,
    inPersonRegistrations: 1200,
    virtualRegistrations: 0,
    totalAttendees: 900,
    inPersonAttendees: 900,
    virtualAttendees: 0,
    ...overrides,
  };
}

/** 2021 is a gap between recorded years; 2026 is the partial current year. */
function growth(): HealthMetricsEventsRegistrationsGrowth {
  return {
    years: [
      year(),
      year({
        year: 2020,
        totalRegistrations: 5000,
        inPersonRegistrations: 1000,
        virtualRegistrations: 4000,
        totalAttendees: 3000,
        inPersonAttendees: 800,
        virtualAttendees: 2200,
      }),
      year({ year: 2022, totalRegistrations: 2400, inPersonRegistrations: 2000, virtualRegistrations: 400, totalAttendees: 1800 }),
      year({ year: 2026, isPartialYear: true, totalRegistrations: 700, inPersonRegistrations: 700, totalAttendees: 500 }),
    ],
  };
}

describe('EventsRegistrationsGrowthComponent', () => {
  let fixture: ComponentFixture<EventsRegistrationsGrowthComponent>;
  let getEventsRegistrationsGrowth: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];
  let picked: HealthMetricsEventsSectionKey[];

  async function render(payload: HealthMetricsEventsRegistrationsGrowth | Error = growth(), platform = 'browser'): Promise<void> {
    getEventsRegistrationsGrowth = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [EventsRegistrationsGrowthComponent],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: platform },
        { provide: AnalyticsService, useValue: { getEventsRegistrationsGrowth } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
      ],
    })
      .overrideComponent(EventsRegistrationsGrowthComponent, { remove: { imports: [ChartComponent] }, add: { imports: [ChartStubComponent] } })
      .compileComponents();

    fixture = TestBed.createComponent(EventsRegistrationsGrowthComponent);
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe(() => lifecycle.push('settled'));
    fixture.componentInstance.sectionPicked.subscribe((key) => picked.push(key));
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

  function chartData(): ChartData<'bar'> {
    const chart = fixture.debugElement.query(By.directive(ChartStubComponent)).componentInstance as ChartStubComponent;
    return chart.data() as ChartData<'bar'>;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    picked = [];
  });

  it('reads the foundation once and settles once the years land', async () => {
    await render();

    expect(getEventsRegistrationsGrowth).toHaveBeenCalledTimes(1);
    expect(getEventsRegistrationsGrowth).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(query('events-registrations-growth-loading')).toBeNull();
  });

  it('lists every year from the first to the last, oldest first, with the registration counts', async () => {
    await render();

    const rows = [...fixture.nativeElement.querySelectorAll('[data-testid^="events-registrations-growth-row-"]')] as HTMLElement[];
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(
      [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => `events-registrations-growth-row-${y}`)
    );
    expect(text('events-registrations-growth-year-count')).toBe('8 years');
    expect(text('events-registrations-growth-count-label')).toBe('total registrations');
    expect(text('events-registrations-growth-total-2020')).toBe('5,000');
    expect(text('events-registrations-growth-in-person-2020')).toBe('1,000');
    expect(text('events-registrations-growth-virtual-2020')).toBe('4,000');
  });

  it('dashes a zero virtual count and every figure of a year with no events', async () => {
    await render();

    expect(text('events-registrations-growth-virtual-2019')).toBe('—');
    expect(text('events-registrations-growth-gap-2021')).toBe('no events recorded');
    expect(text('events-registrations-growth-total-2021')).toBe('—');
    expect(text('events-registrations-growth-in-person-2021')).toBe('—');
    expect(query('events-registrations-growth-gap-2020')).toBeNull();
  });

  it('switches the table and chart to attendees from the toggle', async () => {
    await render();

    (query('filter-pill-attendees') as HTMLButtonElement).click();
    await settle();

    expect(text('events-registrations-growth-count-label')).toBe('total attendees');
    expect(text('events-registrations-growth-total-2020')).toBe('3,000');
    expect(text('events-registrations-growth-virtual-2020')).toBe('2,200');
    expect(chartData().datasets[0].data[1]).toBe(3000);
    expect(getEventsRegistrationsGrowth).toHaveBeenCalledTimes(1);
  });

  it('tags the partial year and links its footnote to the forecast', async () => {
    await render();

    expect(text('events-registrations-growth-partial-2026')).toBe('partial');
    expect(query('events-registrations-growth-partial-2022')).toBeNull();
    expect(text('events-registrations-growth-footnote')).toContain('A partial year is still open');

    (query('events-registrations-growth-forecast-link') as HTMLButtonElement).click();

    expect(picked).toEqual(['forecast']);
  });

  it('leaves out the footnote when every year is complete', async () => {
    await render({ years: [year(), year({ year: 2022 })] });

    expect(query('events-registrations-growth-footnote')).toBeNull();
  });

  it('explains the pandemic peak in the selected metric only when a pandemic year was mostly virtual', async () => {
    await render();
    expect(text('events-registrations-growth-pandemic-note')).toContain('2020–21 registrations were mostly virtual');

    (query('filter-pill-attendees') as HTMLButtonElement).click();
    await settle();
    expect(text('events-registrations-growth-pandemic-note')).toContain('2020–21 attendees were mostly virtual');

    TestBed.resetTestingModule();
    lifecycle = [];
    await render({ years: [year({ year: 2019 }), year({ year: 2021 }), year({ year: 2022 })] });
    expect(query('events-registrations-growth-pandemic-note')).toBeNull();
  });

  it('draws Total, In-person and Virtual, leaving a gap year empty and the partial year lighter', async () => {
    await render();
    const data = chartData();

    expect(data.labels).toEqual(['2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026']);
    expect(data.datasets.map((dataset) => dataset.label)).toEqual(['Total', 'In-person', 'Virtual']);
    expect(data.datasets[0].data[2]).toBeNull();
    const colors = data.datasets[0].backgroundColor as string[];
    expect(colors[0]).toBe(lfxColors.blue[500]);
    expect(colors[7]).toBe(hexToRgba(lfxColors.blue[500], 0.4));
  });

  it('shows the error state when the read fails, and still settles', async () => {
    await render(new Error('boom'));

    expect(query('events-registrations-growth-error')).not.toBeNull();
    expect(query('events-registrations-growth-table')).toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('shows the empty state for a foundation with no years', async () => {
    await render({ years: [] });

    expect(query('events-registrations-growth-empty')).not.toBeNull();
    expect(query('events-registrations-growth-chart')).toBeNull();
  });

  it('holds the skeleton without settling until a foundation resolves', async () => {
    selectedFoundation = signal<{ slug: string } | null>(null);
    await render();

    expect(getEventsRegistrationsGrowth).not.toHaveBeenCalled();
    expect(query('events-registrations-growth-loading')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);

    selectedFoundation.set({ slug: 'acme' });
    await settle();

    expect(getEventsRegistrationsGrowth).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
  });

  it('re-reads on a switch to another foundation, clearing an earlier failure and settling again', async () => {
    await render(new Error('boom'));
    expect(query('events-registrations-growth-error')).not.toBeNull();

    getEventsRegistrationsGrowth.mockReturnValue(of(growth()));
    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(getEventsRegistrationsGrowth).toHaveBeenLastCalledWith({ foundationSlug: 'beta' });
    expect(lifecycle).toEqual(['reading', 'settled', 'reading', 'settled']);
    expect(query('events-registrations-growth-error')).toBeNull();
    expect(query('events-registrations-growth-table')).not.toBeNull();
  });

  it('renders the skeleton on the server without reading', async () => {
    await render(growth(), 'server');

    expect(getEventsRegistrationsGrowth).not.toHaveBeenCalled();
    expect(query('events-registrations-growth-loading')).not.toBeNull();
    expect(lifecycle).toEqual([]);
  });
});
