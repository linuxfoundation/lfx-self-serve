// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { AnalyticsService } from '@services/analytics.service';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EventDetailDrawerComponent } from '../event-detail-drawer/event-detail-drawer.component';

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
  async function render(events: EventRosterRow[], slug: string | undefined, eventsSplit: 'attendance' | 'sponsorship' | null = null): Promise<void> {
    const response: EventRosterResponse = { projectId: 'proj-1', events };
    getEventRoster = vi.fn().mockReturnValue(of(response));

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EventRosterSectionComponent],
      providers: [{ provide: AnalyticsService, useValue: { getEventRoster, getEventDetail: () => of(null) } }, provideNoopAnimations(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(EventRosterSectionComponent);
    fixture.componentRef.setInput('foundationSlug', slug);
    fixture.componentRef.setInput('eventsSplit', eventsSplit);
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

    it('caps the bar width at 100% when actuals exceed the goal', async () => {
      await render([row({ eventId: 'evt-1', registrations: { actual: 2500, goal: 1000 } })], 'tlf');

      const bar = fixture.nativeElement.querySelector('[data-testid="event-roster-b2c-evt-1"] [style*="width"]');
      expect((bar as HTMLElement).style.width).toBe('100%');
    });

    // The figures reach assistive technology through the button's own name, not a nested
    // progressbar: these bars live inside a native button, whose descendants are flattened out of
    // the accessible name, so a role there is announced to no one.
    it('exposes the actual and goal in the cell button name', async () => {
      await render([row({ eventId: 'evt-1', eventName: 'KubeCon', registrations: { actual: 750, goal: 1000 } })], 'tlf');

      const label = fixture.nativeElement.querySelector('[data-testid="event-roster-b2c-evt-1"]')?.getAttribute('aria-label') ?? '';
      expect(label).toContain('KubeCon');
      // Compact form, matching the visible cell — the name should read what the sighted user sees.
      expect(label).toContain('750');
      expect(label).toContain('1K');
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

  // An outage and an empty roster both leave the table with no rows; only one of them should
  // tell the user something went wrong.
  it('distinguishes a load failure from an empty roster', async () => {
    getEventRoster = vi.fn().mockReturnValue(throwError(() => new Error('boom')));

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EventRosterSectionComponent],
      providers: [{ provide: AnalyticsService, useValue: { getEventRoster, getEventDetail: () => of(null) } }, provideNoopAnimations(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(EventRosterSectionComponent);
    fixture.componentRef.setInput('foundationSlug', 'tlf');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="event-roster-error"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="event-roster-empty"]')).toBeNull();
  });

  // The drawer bails to an empty state without a slug (`if (!open || !id || !slug)`), so a missing
  // binding here means every roster click opens a blank panel and never issues the detail request
  // — silent, and invisible to a test that only checks the drawer opened.
  it('passes the foundation and the focus through to the detail drawer', async () => {
    await render([row({ eventId: 'evt-9' })], 'tlf');

    fixture.componentInstance['openFocused']('evt-9', 'b2b');
    await fixture.whenStable();
    fixture.detectChanges();

    const drawer = fixture.debugElement.query(By.directive(EventDetailDrawerComponent));
    expect(drawer).toBeTruthy();
    expect(drawer.componentInstance.foundationSlug()).toBe('tlf');
    expect(drawer.componentInstance.eventId()).toBe('evt-9');
    expect(drawer.componentInstance.focus()).toBe('b2b');
  });

  // Nested interactive elements: the cell buttons sit inside a row that also opens the drawer,
  // and a native button turns Enter into a click. If the cell does not stop the keydown it also
  // reaches the row's keydown.enter, which opens the row's default b2c focus — landing a
  // sponsorship activation on the attendance story.
  //
  // Driven through the row rather than the cell: dispatching on the cell cannot reproduce the
  // browser's implicit Enter-to-click in jsdom, so this asserts the outcome that actually matters
  // — an Enter originating in the sponsorship cell must not leave the drawer on b2c.
  it('keeps a sponsorship-cell Enter from opening the row default focus', async () => {
    await render([row({ eventId: 'evt-9' })], 'tlf');

    const cell = fixture.nativeElement.querySelector('[data-testid="event-roster-b2b-evt-9"]') as HTMLElement;
    expect(cell).toBeTruthy();

    // The click is what the browser would synthesise; the keydown is what must not bubble past it.
    cell.click();
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    const drawer = fixture.debugElement.query(By.directive(EventDetailDrawerComponent));
    expect(drawer.componentInstance.focus()).toBe('b2b');
  });

  // The split hides the opposite metric column and changes which drawer story a row opens. Only
  // the unsplit state was covered, so both halves could regress with the suite still green.
  describe('events split', () => {
    it('hides the sponsorship column under the attendance split', async () => {
      await render([row({ eventId: 'evt-1' })], 'tlf', 'attendance');

      expect(fixture.nativeElement.querySelector('[data-testid="event-roster-b2c-evt-1"]')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('[data-testid="event-roster-b2b-evt-1"]')).toBeNull();
    });

    it('hides the registrations column under the sponsorship split', async () => {
      await render([row({ eventId: 'evt-1' })], 'tlf', 'sponsorship');

      expect(fixture.nativeElement.querySelector('[data-testid="event-roster-b2b-evt-1"]')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('[data-testid="event-roster-b2c-evt-1"]')).toBeNull();
    });

    // A row click carries the split through to the drawer, so the sponsorship view opens the
    // revenue story rather than the b2c default.
    // The subtitle names the columns on screen. Left combined, the attendance view claimed
    // sponsorship was present right after hiding it, and vice versa.
    it('describes only the columns the split renders', async () => {
      await render([row({ eventId: 'evt-1' })], 'tlf', 'attendance');
      expect(text()).toContain('Registrations vs goal');
      expect(text()).not.toContain('sponsorship vs goal');

      await render([row({ eventId: 'evt-1' })], 'tlf', 'sponsorship');
      expect(text()).toContain('Sponsorship revenue vs goal');

      await render([row({ eventId: 'evt-1' })], 'tlf', null);
      expect(text()).toContain('Registrations and sponsorship vs goal');
    });

    it('opens the drawer on the story matching the split', async () => {
      await render([row({ eventId: 'evt-1' })], 'tlf', 'sponsorship');

      rowEls()[0].click();
      await fixture.whenStable();
      fixture.detectChanges();

      const drawer = fixture.debugElement.query(By.directive(EventDetailDrawerComponent));
      expect(drawer.componentInstance.focus()).toBe('b2b');
    });
  });

  it('refetches when the past-events toggle changes', async () => {
    await render([row()], 'tlf');
    expect(getEventRoster).toHaveBeenCalledWith('tlf', false, undefined);

    fixture.componentInstance['toggleIncludePast'](true);
    await fixture.whenStable();

    expect(getEventRoster).toHaveBeenCalledWith('tlf', true, undefined);
  });
});
