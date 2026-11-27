// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MeetingCalendarGridEntry } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { MeetingsCalendarGridComponent } from './meetings-calendar-grid.component';

const NOW = new Date(2026, 9, 10, 12);

const entry = (key: string, start: Date, type: string | null, past = false): MeetingCalendarGridEntry => ({
  key,
  title: `Meeting ${key}`,
  type,
  startTime: start.toISOString(),
  durationMinutes: 60,
  past,
});

describe('MeetingsCalendarGridComponent', () => {
  it('draws neutral entries as chips coloured by type and emits the clicked entry', async () => {
    const fixture = TestBed.createComponent(MeetingsCalendarGridComponent);
    const legal = entry('b', new Date(2026, 9, 20, 9), 'Legal');
    fixture.componentRef.setInput('entries', [entry('a', new Date(2026, 9, 20, 14), null, true), legal]);
    fixture.componentRef.setInput('now', NOW);
    fixture.componentRef.setInput('focus', NOW);
    const clicked: MeetingCalendarGridEntry[] = [];
    fixture.componentInstance.entryClick.subscribe((value) => clicked.push(value));
    await fixture.whenStable();

    const chips = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('[data-day="2026-10-20"] [data-testid="meetings-calendar-grid-chip"]'));
    expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual([
      'Meeting b, Tue, Oct 20 · 9:00 AM · Legal',
      'Meeting a, Tue, Oct 20 · 2:00 PM · Other · Past',
    ]);
    expect(chips[0].style.background).toContain('var(--ui-warning-500) 16%');

    chips[0].click();
    expect(clicked).toEqual([legal]);
  });

  it('starts a grid that opens on the week at 8 AM', async () => {
    const fixture = TestBed.createComponent(MeetingsCalendarGridComponent);
    fixture.componentRef.setInput('entries', []);
    fixture.componentRef.setInput('now', NOW);
    fixture.componentRef.setInput('focus', NOW);
    fixture.componentRef.setInput('view', 'week');
    fixture.componentRef.setInput('layout', 'page');
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect((fixture.nativeElement.querySelector('[data-testid="meetings-calendar-grid-body"]') as HTMLElement).scrollTop).toBe(376);
  });
});
