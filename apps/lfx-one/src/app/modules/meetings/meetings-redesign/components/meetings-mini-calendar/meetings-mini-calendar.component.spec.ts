// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingHomeRow, MeetingMiniCalendarDay } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { MeetingsMiniCalendarComponent } from './meetings-mini-calendar.component';

const NOW = new Date(2026, 9, 10, 12);

const row = (key: string, start: Date, title = key): MeetingHomeRow => ({
  key,
  meeting: { id: key } as Meeting,
  occurrence: null,
  title,
  occurrenceId: null,
  startTime: start.toISOString(),
  durationMinutes: 60,
});

describe('MeetingsMiniCalendarComponent', () => {
  const render = async (upcoming: MeetingHomeRow[] = [], past: MeetingHomeRow[] = []): Promise<ComponentFixture<MeetingsMiniCalendarComponent>> => {
    const fixture = TestBed.createComponent(MeetingsMiniCalendarComponent);
    fixture.componentRef.setInput('upcomingRows', upcoming);
    fixture.componentRef.setInput('pastRows', past);
    fixture.componentRef.setInput('now', NOW);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingsMiniCalendarComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const day = (fixture: ComponentFixture<MeetingsMiniCalendarComponent>, key: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-day="${key}"]`);

  it('shows the month as a group of full weeks, with today filled', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.getAttribute('role')).toBe('group');
    expect(fixture.nativeElement.getAttribute('aria-label')).toBe('Meetings by day');
    expect(query(fixture, 'meetings-mini-calendar-title')?.textContent?.trim()).toBe('October 2026');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="meetings-mini-calendar-week"]')).toHaveLength(5);
    const today = day(fixture, '2026-10-10')?.querySelector('[data-testid="meetings-mini-calendar-day-number"]');
    expect(today?.className).toContain('bg-blue-500');
    expect(day(fixture, '2026-10-10')?.getAttribute('aria-current')).toBe('date');
    expect(day(fixture, '2026-10-11')?.getAttribute('aria-current')).toBeNull();
    expect(day(fixture, '2026-09-27')?.querySelector('span')?.className).toContain('text-gray-300');
    expect(day(fixture, '2026-10-12')?.querySelector('span')?.className).toContain('text-gray-400');
  });

  it('turns days with upcoming or past meetings into buttons with up to three dots', async () => {
    const upcoming = [1, 2, 3, 4].map((hour) => row(`u${hour}`, new Date(2026, 9, 20, 8 + hour)));
    const fixture = await render(upcoming, [row('p1', new Date(2026, 9, 5, 9))]);

    const busy = day(fixture, '2026-10-20');
    expect(busy?.tagName).toBe('BUTTON');
    expect(busy?.getAttribute('aria-label')).toBe('Tue, Oct 20: 4 meetings');
    expect(busy?.querySelectorAll('[data-testid="meetings-mini-calendar-dot"]')).toHaveLength(3);
    expect(day(fixture, '2026-10-05')?.getAttribute('aria-label')).toBe('Mon, Oct 5: 1 meeting');
    expect(day(fixture, '2026-10-06')?.tagName).toBe('SPAN');
  });

  it('never makes a day of the neighbouring months interactive', async () => {
    const fixture = await render([], [row('september', new Date(2026, 8, 28, 9))]);

    expect(day(fixture, '2026-09-28')?.tagName).toBe('SPAN');
    expect(day(fixture, '2026-09-28')?.querySelector('[data-testid="meetings-mini-calendar-dot"]')).toBeNull();
  });

  it('shows placeholders for the grid while the meetings load', async () => {
    const fixture = await render([row('a', new Date(2026, 9, 20, 9))]);
    fixture.componentRef.setInput('loading', true);
    await fixture.whenStable();

    expect(query(fixture, 'meetings-mini-calendar-loading')?.getAttribute('role')).toBe('status');
    expect(query(fixture, 'meetings-mini-calendar-week')).toBeNull();
    expect(query(fixture, 'meetings-mini-calendar-title')?.textContent?.trim()).toBe('October 2026');
  });

  it('pages between months, asking for past meetings back to the start of an older month', async () => {
    const fixture = await render([row('november', new Date(2026, 10, 3, 9))]);
    const older: string[] = [];
    fixture.componentInstance.olderMonthShown.subscribe((value) => older.push(value));

    query(fixture, 'meetings-mini-calendar-next')?.querySelector('button')?.click();
    await fixture.whenStable();
    expect(query(fixture, 'meetings-mini-calendar-title')?.textContent?.trim()).toBe('November 2026');
    expect(day(fixture, '2026-11-03')?.tagName).toBe('BUTTON');

    query(fixture, 'meetings-mini-calendar-previous')?.querySelector('button')?.click();
    query(fixture, 'meetings-mini-calendar-previous')?.querySelector('button')?.click();
    await fixture.whenStable();
    expect(query(fixture, 'meetings-mini-calendar-title')?.textContent?.trim()).toBe('September 2026');
    expect(older).toEqual(['2026-09-01']);
  });

  it('lists a day’s meetings on hover in time order, six at most', async () => {
    const hours = [15, 9, 10, 11, 12, 13, 14, 16];
    const fixture = await render(hours.map((hour) => row(`m${hour}`, new Date(2026, 9, 20, hour), `Meeting ${hour}`)));

    day(fixture, '2026-10-20')?.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();

    const tooltip = query(fixture, 'meetings-mini-calendar-tooltip');
    expect(tooltip?.getAttribute('role')).toBe('tooltip');
    expect(tooltip?.firstElementChild?.textContent?.trim()).toBe('Tue, Oct 20');
    const items = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('[data-testid="meetings-mini-calendar-tooltip-item"]')).map((item) =>
      Array.from(item.children).map((part) => part.textContent?.trim())
    );
    expect(items).toEqual([
      ['9:00 AM', 'Meeting 9'],
      ['10:00 AM', 'Meeting 10'],
      ['11:00 AM', 'Meeting 11'],
      ['12:00 PM', 'Meeting 12'],
      ['1:00 PM', 'Meeting 13'],
      ['2:00 PM', 'Meeting 14'],
    ]);
    expect(query(fixture, 'meetings-mini-calendar-tooltip-more')?.textContent?.trim()).toBe('+2 more');
    // Titles wrap: the tooltip is the only place that shows them in full.
    expect(query(fixture, 'meetings-mini-calendar-tooltip-item')?.lastElementChild?.className).not.toContain('truncate');

    day(fixture, '2026-10-20')?.dispatchEvent(new MouseEvent('mouseleave'));
    await fixture.whenStable();
    expect(query(fixture, 'meetings-mini-calendar-tooltip')).toBeNull();
  });

  it('emits the clicked day with the tab that lists it', async () => {
    const fixture = await render([row('later', new Date(2026, 9, 20, 9))], [row('earlier', new Date(2026, 9, 5, 9))]);
    const selected: MeetingMiniCalendarDay[] = [];
    fixture.componentInstance.daySelected.subscribe((value) => selected.push(value));

    day(fixture, '2026-10-05')?.click();
    day(fixture, '2026-10-20')?.click();

    expect(selected.map((value) => [value.key, value.tab])).toEqual([
      ['2026-10-05', 'past'],
      ['2026-10-20', 'upcoming'],
    ]);
  });
});
