// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EventRosterSectionComponent } from './event-roster-section.component';

import type { EventRosterResponse, EventRosterRow } from '@lfx-one/shared/interfaces';

describe('EventRosterSectionComponent', () => {
  const row = (overrides: Partial<EventRosterRow> = {}): EventRosterRow => ({
    eventId: 'evt-1',
    eventName: 'KubeCon NA',
    startDate: '2026-11-10',
    isPast: false,
    country: 'United States',
    eventUrl: 'https://events.example.org/kubecon',
    registrations: { actual: 900, goal: 1000 },
    sponsorshipRevenue: { actual: 500000, goal: 1000000 },
    vsLastYear: 1.1,
    compScore: 'high',
    cfpStatus: 'Review Complete',
    ...overrides,
  });

  let fixture: ComponentFixture<EventRosterSectionComponent>;
  let getEventRoster: ReturnType<typeof vi.fn>;

  // `slug` is deliberately not a defaulted parameter — passing an explicit `undefined` must mean
  // "no foundation", which a default value would silently override.
  async function render(events: EventRosterRow[], slug: string | undefined): Promise<void> {
    const response: EventRosterResponse = { projectId: 'proj-1', events };
    getEventRoster = vi.fn().mockReturnValue(of(response));

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EventRosterSectionComponent],
      providers: [{ provide: AnalyticsService, useValue: { getEventRoster } }],
    }).compileComponents();

    fixture = TestBed.createComponent(EventRosterSectionComponent);
    fixture.componentRef.setInput('foundationSlug', slug);
    await fixture.whenStable();
  }

  function rowEls(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="event-roster-row-"]'));
  }

  function text(): string {
    return fixture.nativeElement.textContent ?? '';
  }

  // The at-risk marker is an icon distinguished by its label, not a testid.
  function atRiskMarker(): Element | null {
    return fixture.nativeElement.querySelector('[aria-label="Behind registration goal"]');
  }

  it('renders one row per event once loaded', async () => {
    await render([row(), row({ eventId: 'evt-2', eventName: 'Open Source Summit' })], 'tlf');

    expect(rowEls()).toHaveLength(2);
    expect(text()).toContain('KubeCon NA');
    expect(text()).toContain('Open Source Summit');
  });

  it('does not fetch without a foundation slug', async () => {
    await render([], undefined);

    expect(getEventRoster).not.toHaveBeenCalled();
    expect(rowEls()).toHaveLength(0);
  });

  describe('goal bars', () => {
    it('renders no goal bar when the goal is absent or zero', async () => {
      // Both metrics have no goal, so the row must render zero progress bars — a 0% bar would
      // read as "0 of a goal" rather than "no goal set".
      await render([row({ registrations: { actual: 400, goal: 0 }, sponsorshipRevenue: { actual: 0, goal: 0 } })], 'tlf');

      expect(fixture.nativeElement.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
      // The actual value is still shown; only the bar is suppressed.
      expect(text()).toContain('400');
    });

    it('caps the percentage at 100 when actuals exceed the goal', async () => {
      await render([row({ registrations: { actual: 2500, goal: 1000 } })], 'tlf');

      const bars = fixture.nativeElement.querySelectorAll('[role="progressbar"]');
      expect(bars[0].getAttribute('aria-valuenow')).toBe('100');
    });

    it('exposes the completion percentage to assistive technology', async () => {
      await render([row({ registrations: { actual: 750, goal: 1000 } })], 'tlf');

      const bar = fixture.nativeElement.querySelector('[role="progressbar"]');
      expect(bar.getAttribute('aria-valuenow')).toBe('75');
      expect(bar.getAttribute('aria-valuemin')).toBe('0');
      expect(bar.getAttribute('aria-valuemax')).toBe('100');
    });
  });

  describe('at-risk flagging', () => {
    // At-risk requires BOTH conditions; each of the next three cases holds one back.
    it('flags an event that is behind goal and pacing low', async () => {
      await render([row({ registrations: { actual: 200, goal: 1000 }, compScore: 'low' })], 'tlf');

      expect(atRiskMarker()).toBeTruthy();
    });

    it('does not flag an event that is behind goal but pacing well', async () => {
      await render([row({ registrations: { actual: 200, goal: 1000 }, compScore: 'high' })], 'tlf');

      expect(atRiskMarker()).toBeNull();
    });

    it('does not flag an event pacing low but tracking near its goal', async () => {
      await render([row({ registrations: { actual: 900, goal: 1000 }, compScore: 'low' })], 'tlf');

      expect(atRiskMarker()).toBeNull();
    });

    it('does not flag an event with no registration goal', async () => {
      await render([row({ registrations: { actual: 0, goal: 0 }, compScore: 'low' })], 'tlf');

      expect(atRiskMarker()).toBeNull();
    });

    // Boundary: the threshold is "below 50%", so exactly 50% is not yet behind goal.
    it('treats exactly the threshold percentage as on track', async () => {
      await render([row({ registrations: { actual: 500, goal: 1000 }, compScore: 'low' })], 'tlf');

      expect(atRiskMarker()).toBeNull();
    });
  });

  describe('date formatting', () => {
    it('formats a valid ISO date in UTC', async () => {
      await render([row({ startDate: '2026-11-10' })], 'tlf');

      expect(text()).toContain('Nov 10, 2026');
    });

    // A rolled-over date would render as a confident but wrong "Jan 2027"; showing the raw
    // string instead keeps bad warehouse data visible.
    it('falls back to the raw value rather than rolling over an out-of-range month', async () => {
      await render([row({ startDate: '2026-13-10' })], 'tlf');

      expect(text()).toContain('2026-13-10');
      expect(text()).not.toContain('Jan 10, 2027');
    });

    it('falls back to the raw value for a day the month does not have', async () => {
      await render([row({ startDate: '2026-02-30' })], 'tlf');

      expect(text()).toContain('2026-02-30');
    });
  });

  describe('empty states', () => {
    it('distinguishes a search miss from an empty roster', async () => {
      await render([row()], 'tlf');

      fixture.componentInstance['search'].setValue('nonexistent conference');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(rowEls()).toHaveLength(0);
      expect(text()).toContain('No events match your search.');
    });

    // Without a search term the roster must not claim the user's search matched nothing.
    it('reports no upcoming events when the roster is empty and no search is active', async () => {
      await render([], 'tlf');

      expect(text()).toContain('No upcoming events.');
      expect(text()).not.toContain('No events match your search.');
    });
  });

  // The scope toggles are styled buttons, so colour alone conveys the active option — AT needs
  // aria-pressed to announce which scope is selected.
  it('announces which scope toggle is active', async () => {
    await render([row()], 'tlf');

    const upcoming = fixture.nativeElement.querySelector('[data-testid="event-roster-upcoming"]');
    const all = fixture.nativeElement.querySelector('[data-testid="event-roster-all"]');
    expect(upcoming.getAttribute('aria-pressed')).toBe('true');
    expect(all.getAttribute('aria-pressed')).toBe('false');

    fixture.componentInstance['toggleIncludePast'](true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(upcoming.getAttribute('aria-pressed')).toBe('false');
    expect(all.getAttribute('aria-pressed')).toBe('true');
  });

  it('refetches when the past-events toggle changes', async () => {
    await render([row()], 'tlf');
    expect(getEventRoster).toHaveBeenCalledWith('tlf', false);

    fixture.componentInstance['toggleIncludePast'](true);
    await fixture.whenStable();

    expect(getEventRoster).toHaveBeenCalledWith('tlf', true);
  });
});
