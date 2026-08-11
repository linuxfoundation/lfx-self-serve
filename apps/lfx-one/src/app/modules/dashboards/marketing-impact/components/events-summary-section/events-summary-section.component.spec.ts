// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { EventsOverviewMetric, EventsOverviewSummaryResponse } from '@lfx-one/shared/interfaces';

import { EventsSummarySectionComponent } from './events-summary-section.component';

/**
 * Covers the tile view-model the component derives from the summary endpoint: the
 * dash fallback when a metric is absent, currency vs count formatting, and the YoY
 * delta sign/trend. These are the parts that silently misreport numbers to an ED if
 * they regress — a wrong delta direction reads as growth when it is decline.
 */
describe('EventsSummarySectionComponent', () => {
  const metric = (value: number, changeFraction: number | null = null): EventsOverviewMetric => ({ value, changeFraction });

  const response = (overrides: Partial<EventsOverviewSummaryResponse> = {}): EventsOverviewSummaryResponse => ({
    projectId: 'p1',
    registrations: metric(1200, 0.52),
    attendees: metric(800, -0.25),
    events: metric(12, 0),
    speakers: metric(60),
    organizations: metric(45),
    countries: metric(30),
    sponsorship: metric(1500000),
    ...overrides,
  });

  let fixture: ComponentFixture<EventsSummarySectionComponent>;
  let getEventsOverviewSummary: ReturnType<typeof vi.fn>;

  // `slug` is deliberately not a defaulted parameter — passing an explicit `undefined`
  // must mean "no foundation", which a default value would silently override.
  async function render(summary: EventsOverviewSummaryResponse | null, slug: string | undefined): Promise<void> {
    getEventsOverviewSummary = vi.fn().mockReturnValue(of(summary));

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EventsSummarySectionComponent],
      providers: [{ provide: AnalyticsService, useValue: { getEventsOverviewSummary } }],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsSummarySectionComponent);
    fixture.componentRef.setInput('foundationSlug', slug);
    fixture.componentRef.setInput('foundationName', 'The Linux Foundation');
    fixture.componentRef.setInput('selectedPeriod', 'YTD');
    await fixture.whenStable();
  }

  function tile(id: string): HTMLElement {
    const el = fixture.nativeElement.querySelector(`[data-testid="events-summary-tile-${id}"]`);
    if (!el) throw new Error(`no tile rendered for ${id}`);
    return el as HTMLElement;
  }

  function valueOf(id: string): string {
    return tile(id).querySelector('.text-2xl')?.textContent?.trim() ?? '';
  }

  // The delta is the only direct span after the value; the label also carries
  // .text-xs.font-medium, so select by position rather than class.
  function deltaOf(id: string): string | null {
    const spans = tile(id).querySelectorAll(':scope > span');
    const last = spans[spans.length - 1];
    if (!last || last.classList.contains('text-2xl')) return null;
    return last.textContent?.trim() ?? null;
  }

  it('renders one tile per metric once loaded', async () => {
    await render(response(), 'tlf');

    expect(fixture.nativeElement.querySelectorAll('[data-testid^="events-summary-tile-"]')).toHaveLength(7);
    expect(fixture.nativeElement.querySelector('[data-testid="events-summary-skeleton"]')).toBeNull();
  });

  // Counts use compact notation; sponsorship additionally carries the currency symbol.
  it('formats sponsorship as currency and counts compactly', async () => {
    await render(response(), 'tlf');

    expect(valueOf('registrations')).toBe('1.2K');
    expect(valueOf('events')).toBe('12');
    expect(valueOf('sponsorship')).toBe('$1.5M');
  });

  // A null response must not render as zero — zero is a measurement, "—" is the
  // absence of one, and conflating them misreports a data outage as real decline.
  it('falls every tile back to a dash when the endpoint returns null', async () => {
    await render(null, 'tlf');

    expect(valueOf('registrations')).toBe('—');
    expect(valueOf('sponsorship')).toBe('—');
    expect(deltaOf('registrations')).toBeNull();
  });

  it('derives the YoY delta direction from the change fraction', async () => {
    await render(response(), 'tlf');

    expect(deltaOf('registrations')).toBe('▲ 52% YoY');
    expect(deltaOf('attendees')).toBe('▼ 25% YoY');
    expect(deltaOf('events')).toBe('— vs LY');
  });

  // Sponsorship has no modeled YoY baseline (changeFraction null), so it must show no
  // delta at all rather than a misleading 0%.
  it('omits the delta when a metric has no prior baseline', async () => {
    await render(response(), 'tlf');

    expect(deltaOf('sponsorship')).toBeNull();
    expect(deltaOf('speakers')).toBeNull();
  });

  // Without a foundation there is nothing to scope the query to, so the component must
  // not fire an unscoped request — it renders dashes instead.
  it('does not call the endpoint until a foundation slug is present', async () => {
    await render(response(), undefined);

    expect(getEventsOverviewSummary).not.toHaveBeenCalled();
    expect(valueOf('registrations')).toBe('—');
  });

  it('stops showing the skeleton once a slug-less render settles', async () => {
    await render(response(), undefined);

    expect(fixture.nativeElement.querySelector('[data-testid="events-summary-skeleton"]')).toBeNull();
  });

  it('scopes the request to the selected foundation', async () => {
    await render(response(), 'tlf');

    expect(getEventsOverviewSummary).toHaveBeenCalledWith('tlf');
  });
});
