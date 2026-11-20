// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingCalendarDialogData, MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsCalendarDialogComponent } from './meetings-calendar-dialog.component';

const NOW = new Date(2026, 9, 10, 12);

const row = (key: string, start: Date, type = 'Board', durationMinutes = 60): MeetingHomeRow => ({
  key,
  meeting: { id: key, meeting_type: type } as Meeting,
  occurrence: null,
  title: `Meeting ${key}`,
  occurrenceId: null,
  startTime: start.toISOString(),
  durationMinutes,
});

describe('MeetingsCalendarDialogComponent', () => {
  let close: ReturnType<typeof vi.fn>;
  let openMeeting: ReturnType<typeof vi.fn<(row: MeetingHomeRow) => void>>;
  let upcoming: ReturnType<typeof signal<MeetingHomeRow[]>>;
  let past: ReturnType<typeof signal<MeetingHomeRow[]>>;
  let showPastFrom: ReturnType<typeof vi.fn<(day: string) => void>>;
  let month: Date | undefined;
  let pastFailed: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    close = vi.fn();
    openMeeting = vi.fn<(row: MeetingHomeRow) => void>();
    upcoming = signal<MeetingHomeRow[]>([]);
    past = signal<MeetingHomeRow[]>([]);
    showPastFrom = vi.fn<(day: string) => void>();
    month = undefined;
    pastFailed = signal(false);
  });

  const configure = (): void => {
    const data: MeetingCalendarDialogData = {
      upcomingRows: upcoming,
      pastRows: past,
      now: signal(NOW),
      name: 'Synthetic Foundation',
      logoUrl: '',
      openMeeting,
      showPastFrom,
      pastFailed,
      month,
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: { id: 'calendar-dialog', close } },
      ],
    });
  };

  const render = async (): Promise<ComponentFixture<MeetingsCalendarDialogComponent>> => {
    configure();
    const fixture = TestBed.createComponent(MeetingsCalendarDialogComponent);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingsCalendarDialogComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const all = (fixture: ComponentFixture<MeetingsCalendarDialogComponent>, testId: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${testId}"]`));
  const click = async (fixture: ComponentFixture<MeetingsCalendarDialogComponent>, testId: string): Promise<void> => {
    const host = query(fixture, testId);
    (host?.querySelector('button') ?? host)?.click();
    await fixture.whenStable();
  };

  it('names the project, titles the dialog and lists the type legend', async () => {
    const fixture = await render();

    expect(query(fixture, 'meetings-calendar-dialog-context')?.textContent?.trim()).toBe('Synthetic Foundation');
    expect(query(fixture, 'meetings-calendar-dialog-title')?.id).toBe('calendar-dialog-title');
    expect(query(fixture, 'meetings-calendar-dialog-legend')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Board Maintainers Marketing Technical Legal Other'
    );
    expect(query(fixture, 'meetings-calendar-dialog-period')?.textContent?.trim()).toBe('October 2026');

    await click(fixture, 'meetings-calendar-dialog-close');
    expect(close).toHaveBeenCalled();
  });

  it('shows three chips per day and "+N more", including days outside the month, with upcoming and past colours', async () => {
    upcoming.set([12, 13, 14, 15].map((hour) => row(`u${hour}`, new Date(2026, 9, 20, hour))));
    past.set([row('p', new Date(2026, 8, 28, 9), 'Technical')]);
    const fixture = await render();

    const day = fixture.nativeElement.querySelector('[data-testid="meetings-calendar-dialog-day"][data-day="2026-10-20"]') as HTMLElement;
    expect(
      Array.from(day.querySelectorAll('[data-testid="meetings-calendar-dialog-chip"]')).map((chip) =>
        Array.from(chip.children, (part) => part.textContent?.trim())
          .filter(Boolean)
          .join(' ')
      )
    ).toEqual(['12:00 PM Meeting u12', '1:00 PM Meeting u13', '2:00 PM Meeting u14']);
    const more = day.querySelector('[data-testid="meetings-calendar-dialog-more"]');
    expect(more?.textContent?.trim()).toBe('+1 more');
    expect(more?.getAttribute('aria-label')).toBe('Show all 4 meetings on Tue, Oct 20');
    const chip = day.querySelector<HTMLElement>('[data-testid="meetings-calendar-dialog-chip"]');
    expect(chip?.style.background).toContain('color-mix(in srgb, var(--ui-danger-500) 16%, var(--ui-white))');

    const outside = fixture.nativeElement.querySelector('[data-testid="meetings-calendar-dialog-day"][data-day="2026-09-28"]') as HTMLElement;
    expect(outside.className).toContain('bg-gray-50');
    const pastChip = outside.querySelector<HTMLElement>('[data-testid="meetings-calendar-dialog-chip"]');
    expect(pastChip?.style.background).toContain('color-mix(in srgb, var(--ui-feature-500) 7%, var(--ui-white))');
  });

  it('pages months and offers Today only while today is out of view', async () => {
    const fixture = await render();
    expect(query(fixture, 'meetings-calendar-dialog-today')).toBeNull();

    await click(fixture, 'meetings-calendar-dialog-next');
    expect(query(fixture, 'meetings-calendar-dialog-period')?.textContent?.trim()).toBe('November 2026');

    await click(fixture, 'meetings-calendar-dialog-today');
    expect(query(fixture, 'meetings-calendar-dialog-period')?.textContent?.trim()).toBe('October 2026');
    expect(query(fixture, 'meetings-calendar-dialog-today')).toBeNull();
  });

  it('opens the day’s week at 8 AM from "+N more", with events placed by time in lanes', async () => {
    upcoming.set([
      row('a', new Date(2026, 9, 20, 9), 'Board', 120),
      row('b', new Date(2026, 9, 20, 9, 30)),
      row('c', new Date(2026, 9, 20, 10, 30)),
      row('d', new Date(2026, 9, 20, 15)),
    ]);
    const fixture = await render();

    fixture.nativeElement.querySelector('[data-day="2026-10-20"] [data-testid="meetings-calendar-dialog-more"]')?.click();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(query(fixture, 'meetings-calendar-dialog-period')?.textContent?.trim()).toBe('Oct 18 – 24, 2026');
    expect(query(fixture, 'meetings-calendar-dialog-body')?.scrollTop).toBe(376);
    const events = all(fixture, 'meetings-calendar-dialog-event');
    expect(events.map((event) => [event.style.top, event.style.height, event.style.left, event.style.width])).toEqual([
      ['432px', '94px', 'calc(0% + 2px)', 'calc(50% - 4px)'],
      ['456px', '46px', 'calc(50% + 2px)', 'calc(50% - 4px)'],
      ['504px', '46px', 'calc(50% + 2px)', 'calc(50% - 4px)'],
      ['720px', '46px', 'calc(0% + 2px)', 'calc(100% - 4px)'],
    ]);
    expect(query(fixture, 'meetings-calendar-dialog-today')).toBeTruthy();
  });

  it('switches between Month and Week, and the week header carries each date', async () => {
    const fixture = await render();

    query(fixture, 'meetings-calendar-dialog-view')?.querySelectorAll('input')[1]?.click();
    await fixture.whenStable();

    expect(query(fixture, 'meetings-calendar-dialog-week')).toBeTruthy();
    expect(query(fixture, 'meetings-calendar-dialog-period')?.textContent?.trim()).toBe('Oct 4 – 10, 2026');
    expect(all(fixture, 'meetings-calendar-dialog-week-day').map((day) => day.getAttribute('data-day'))).toHaveLength(7);
  });

  it('shows one tooltip per chip and opens the meeting on click', async () => {
    const meeting = row('a', new Date(2026, 9, 1, 10));
    past.set([meeting]);
    const fixture = await render();
    const chip = query(fixture, 'meetings-calendar-dialog-chip');

    chip?.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    expect(Array.from(query(fixture, 'meetings-calendar-dialog-tooltip')?.children ?? [], (line) => line.textContent?.trim())).toEqual([
      'Meeting a',
      'Thu, Oct 1 · 10:00 AM · Board · Past',
    ]);

    chip?.click();
    await fixture.whenStable();
    expect(openMeeting).toHaveBeenCalledWith(meeting);
    expect(query(fixture, 'meetings-calendar-dialog-tooltip')).toBeNull();
  });

  it('fades under the header once the body scrolls', async () => {
    const fixture = await render();
    expect(query(fixture, 'meetings-calendar-dialog-fade')?.className).toContain('opacity-0');

    const body = query(fixture, 'meetings-calendar-dialog-body') as HTMLElement;
    body.scrollTop = 40;
    body.dispatchEvent(new Event('scroll'));
    await fixture.whenStable();

    expect(query(fixture, 'meetings-calendar-dialog-fade')?.className).not.toContain('opacity-0');
  });

  it('opens on the month it was given and asks for past meetings from the first day shown, as it pages back', async () => {
    month = new Date(2026, 8, 15);
    const fixture = await render();

    expect(query(fixture, 'meetings-calendar-dialog-period')?.textContent?.trim()).toBe('September 2026');
    expect(showPastFrom).toHaveBeenLastCalledWith('2026-08-30');

    await click(fixture, 'meetings-calendar-dialog-previous');
    expect(showPastFrom).toHaveBeenLastCalledWith('2026-07-26');

    query(fixture, 'meetings-calendar-dialog-view')?.querySelectorAll('input')[1]?.click();
    await fixture.whenStable();
    // The week of Aug 1 starts on Sunday Jul 26; its Saturday before can run past midnight into it.
    expect(showPastFrom).toHaveBeenLastCalledWith('2026-07-25');
    const calls = showPastFrom.mock.calls.length;

    // A month after today holds no past meetings to ask for.
    await click(fixture, 'meetings-calendar-dialog-today');
    query(fixture, 'meetings-calendar-dialog-view')?.querySelectorAll('input')[0]?.click();
    await fixture.whenStable();
    showPastFrom.mockClear();
    await click(fixture, 'meetings-calendar-dialog-next');
    expect(showPastFrom).not.toHaveBeenCalled();
    expect(calls).toBeGreaterThan(0);
  });

  it('goes back to the top when switching from Week to Month', async () => {
    const fixture = await render();
    const body = query(fixture, 'meetings-calendar-dialog-body') as HTMLElement;
    query(fixture, 'meetings-calendar-dialog-view')?.querySelectorAll('input')[1]?.click();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(body.scrollTop).toBe(376);

    query(fixture, 'meetings-calendar-dialog-view')?.querySelectorAll('input')[0]?.click();
    await fixture.whenStable();

    expect(body.scrollTop).toBe(0);
  });

  it('keeps a chip tooltip inside the window', async () => {
    past.set([row('a', new Date(2026, 9, 4, 10))]);
    const fixture = await render();
    const chip = query(fixture, 'meetings-calendar-dialog-chip') as HTMLElement;
    vi.spyOn(chip, 'getBoundingClientRect').mockReturnValue({ top: 300, bottom: 320, left: 20, right: 60, width: 40, height: 20, x: 20, y: 300 } as DOMRect);

    chip.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();

    expect(query(fixture, 'meetings-calendar-dialog-tooltip')?.style.left).toBe('152px');
  });

  it('names each week column after its day', async () => {
    const fixture = await render();
    query(fixture, 'meetings-calendar-dialog-view')?.querySelectorAll('input')[1]?.click();
    await fixture.whenStable();

    const columns = all(fixture, 'meetings-calendar-dialog-week-day');
    expect(columns[0].getAttribute('role')).toBe('group');
    expect(columns.map((column) => column.getAttribute('aria-label'))).toEqual([
      'Sun, Oct 4',
      'Mon, Oct 5',
      'Tue, Oct 6',
      'Wed, Oct 7',
      'Thu, Oct 8',
      'Fri, Oct 9',
      'Sat, Oct 10',
    ]);
  });

  it('says when older meetings failed to load, and retries them from the first day shown', async () => {
    const fixture = await render();
    expect(query(fixture, 'meetings-calendar-dialog-past-failed')).toBeNull();

    pastFailed.set(true);
    await fixture.whenStable();
    expect(query(fixture, 'meetings-calendar-dialog-past-failed')?.textContent).toContain("Couldn't load older meetings.");
    showPastFrom.mockClear();

    await click(fixture, 'meetings-calendar-dialog-past-retry');
    expect(showPastFrom).toHaveBeenCalledWith('2026-09-27');
  });
});
