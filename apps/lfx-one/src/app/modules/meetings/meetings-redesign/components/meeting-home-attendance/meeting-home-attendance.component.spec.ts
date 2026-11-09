// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeetingHomeAttendance } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { MeetingHomeAttendanceComponent } from './meeting-home-attendance.component';

const UPCOMING: MeetingHomeAttendance = {
  label: '12 of 16 attending · 75%',
  ariaLabel: 'Yes 12, Maybe 2, No 0, No response 2',
  segments: [
    { kind: 'yes', percent: 75 },
    { kind: 'maybe', percent: 12.5 },
  ],
  answers: [
    { kind: 'yes', label: 'Yes', count: 12 },
    { kind: 'maybe', label: 'Maybe', count: 2 },
    { kind: 'no', label: 'No', count: 0 },
  ],
  noResponse: 2,
  poor: false,
};

const PAST: MeetingHomeAttendance = {
  label: '9 of 20 attended · 45%',
  ariaLabel: '9 of 20 attended · 45%',
  segments: [{ kind: 'attended', percent: 45 }],
  answers: [],
  noResponse: null,
  poor: true,
};

describe('MeetingHomeAttendanceComponent', () => {
  const render = async (attendance: MeetingHomeAttendance, variant: 'card' | 'row'): Promise<ComponentFixture<MeetingHomeAttendanceComponent>> => {
    const fixture = TestBed.createComponent(MeetingHomeAttendanceComponent);
    fixture.componentRef.setInput('attendance', attendance);
    fixture.componentRef.setInput('variant', variant);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingHomeAttendanceComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('shows the count, a labelled bar with one segment per answer, and the legend on a card', async () => {
    const fixture = await render(UPCOMING, 'card');

    expect(query(fixture, 'meetings-home-attendance-label')?.textContent?.trim()).toBe('12 of 16 attending · 75%');
    const bar = query(fixture, 'meetings-home-attendance-bar');
    expect(bar?.getAttribute('role')).toBe('img');
    expect(bar?.getAttribute('aria-label')).toBe('Yes 12, Maybe 2, No 0, No response 2');
    const segments = [...(bar?.querySelectorAll<HTMLElement>(':scope > span') ?? [])];
    expect(segments.map((segment) => segment.style.width)).toEqual(['75%', '12.5%']);
    expect(segments[0].classList).toContain('bg-blue-500');
    expect(segments[1].classList).toContain('bg-amber-500');
    expect(query(fixture, 'meetings-home-attendance-legend')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Yes 12 Maybe 2 No 0');
    expect(query(fixture, 'meetings-home-attendance-poor')).toBeNull();
  });

  it('labels the bar on a row with no legend and no focus stop of its own', async () => {
    const fixture = await render(UPCOMING, 'row');

    expect(query(fixture, 'meetings-home-attendance-bar')?.getAttribute('aria-label')).toBe('Yes 12, Maybe 2, No 0, No response 2');
    expect(query(fixture, 'meetings-home-attendance-bar')?.hasAttribute('tabindex')).toBe(false);
    expect(query(fixture, 'meetings-home-attendance-legend')).toBeNull();
  });

  it.each(['card', 'row'] as const)('shows the poorly-attended note under a past %s bar, with no legend', async (variant) => {
    const fixture = await render(PAST, variant);

    expect(query(fixture, 'meetings-home-attendance-label')?.textContent?.trim()).toBe('9 of 20 attended · 45%');
    expect(query(fixture, 'meetings-home-attendance-poor')?.textContent?.trim()).toBe('This meeting was poorly attended');
    expect(query(fixture, 'meetings-home-attendance-legend')).toBeNull();
  });
});
