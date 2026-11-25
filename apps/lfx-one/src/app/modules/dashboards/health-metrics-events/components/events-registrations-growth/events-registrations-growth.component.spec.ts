// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventsRegistrationsGrowthComponent } from './events-registrations-growth.component';

import type { HealthMetricsEventsRegistrationsGrowth, HealthMetricsEventsRegistrationsGrowthYear } from '@lfx-one/shared/interfaces';

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
    }).compileComponents();

    fixture = TestBed.createComponent(EventsRegistrationsGrowthComponent);
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe(() => lifecycle.push('settled'));
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

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
  });

  it('reads the foundation once and settles once the years land', async () => {
    await render();

    expect(getEventsRegistrationsGrowth).toHaveBeenCalledTimes(1);
    expect(getEventsRegistrationsGrowth).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(query('events-registrations-growth-loading')).toBeNull();
  });

  it('draws a stacked column per year from the first to the last, with its total and a legend', async () => {
    await render();

    const columns = [...fixture.nativeElement.querySelectorAll('[data-testid^="events-registrations-growth-chart-column-"]')] as HTMLElement[];
    expect(columns.map((column) => column.getAttribute('data-testid')?.split('-').at(-1))).toEqual([
      '2019',
      '2020',
      '2021',
      '2022',
      '2023',
      '2024',
      '2025',
      '2026',
    ]);
    expect(text('events-registrations-growth-chart-total-2020')).toBe('5K');
    expect(query('events-registrations-growth-chart-total-2021')).toBeNull();
    expect([...(query('events-registrations-growth-chart-legend')?.children ?? [])].map((item) => item.textContent?.trim())).toEqual(['In-person', 'Virtual']);
    expect(query('events-registrations-growth-table')).toBeNull();
  });

  it('marks the partial year under its label and names each column with its popup rows', async () => {
    await render();

    expect(text('events-registrations-growth-chart-x')).toContain('2026partial');
    expect(query('events-registrations-growth-chart-column-2020')?.getAttribute('aria-label')).toBe('2020, In-person 1,000, Virtual 4,000, Total 5,000');
    expect(query('events-registrations-growth-chart-column-2021')?.getAttribute('aria-label')).toBe('2021 · no events recorded');
  });

  it('draws attendees when the header switch picks them', async () => {
    await render();

    fixture.componentRef.setInput('metric', 'attendees');
    await settle();

    expect(query('events-registrations-growth-chart-column-2020')?.getAttribute('aria-label')).toBe('2020, In-person 800, Virtual 2,200, Total 3,000');
    expect(getEventsRegistrationsGrowth).toHaveBeenCalledTimes(1);
  });

  it('shows the error state when the read fails, and still settles', async () => {
    await render(new Error('boom'));

    expect(query('events-registrations-growth-error')).not.toBeNull();
    expect(query('events-registrations-growth-chart')).toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('settles empty with no chart for a foundation with no years, so the shell shows its empty state', async () => {
    const verdicts: boolean[] = [];
    getEventsRegistrationsGrowth = vi.fn();
    await render({ years: [] });
    fixture.componentInstance.settled.subscribe((empty) => verdicts.push(empty));
    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(verdicts).toEqual([true]);
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
    expect(query('events-registrations-growth-chart')).not.toBeNull();
  });

  it('renders the skeleton on the server without reading', async () => {
    await render(growth(), 'server');

    expect(getEventsRegistrationsGrowth).not.toHaveBeenCalled();
    expect(query('events-registrations-growth-loading')).not.toBeNull();
    expect(lifecycle).toEqual([]);
  });
});
