// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeetingRegistrant, PastMeetingParticipant, RsvpResponse } from '@lfx-one/shared/interfaces';
import { describe, expect, it, vi } from 'vitest';

import { MeetingAttendeeGridComponent } from './meeting-attendee-grid.component';

function registrant(index: number, response: RsvpResponse | null): MeetingRegistrant {
  return {
    uid: `r-${index}`,
    first_name: `Person${String(index).padStart(2, '0')}`,
    last_name: 'Doe',
    email: `r-${index}@example.org`,
    avatar_url: null,
    rsvp: response ? ({ response_type: response } as MeetingRegistrant['rsvp']) : null,
  } as MeetingRegistrant;
}

const registrants = (count: number): MeetingRegistrant[] => Array.from({ length: count }, (_, index) => registrant(index, index % 2 ? 'accepted' : null));

describe('MeetingAttendeeGridComponent', () => {
  const render = async (people: readonly (MeetingRegistrant | PastMeetingParticipant)[], inputs: Record<string, unknown> = {}) => {
    const fixture: ComponentFixture<MeetingAttendeeGridComponent> = TestBed.createComponent(MeetingAttendeeGridComponent);
    fixture.componentRef.setInput('people', people);
    Object.entries(inputs).forEach(([name, value]) => fixture.componentRef.setInput(name, value));
    await fixture.whenStable();
    return fixture;
  };
  const queryAll = (fixture: ComponentFixture<MeetingAttendeeGridComponent>, testId: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${testId}"]`));

  it('shows the stats line in status order and a dot per avatar', async () => {
    const fixture = await render([registrant(1, null), registrant(2, 'maybe'), registrant(3, 'accepted'), registrant(4, 'declined')]);

    const stats = Array.from(queryAll(fixture, 'meeting-attendee-grid-stats')[0].children).map((stat) => stat.textContent?.replace(/\s+/g, ' ').trim());
    expect(stats).toEqual(['Yes 1', 'Maybe 1', 'No 1', 'No response 1']);
    expect(queryAll(fixture, 'meeting-attendee-grid-label').map((cell) => cell.getAttribute('aria-label'))).toEqual([
      'Person03 Doe · Yes',
      'Person02 Doe · Maybe',
      'Person04 Doe · No',
      'Person01 Doe · No response',
    ]);
    expect(queryAll(fixture, 'meeting-attendee-grid-dot').map((dot) => dot.className.match(/bg-\S+/)?.[0])).toEqual([
      'bg-emerald-500',
      'bg-amber-500',
      'bg-red-500',
      'bg-gray-400',
    ]);
  });

  it('uses 9 fixed 28px columns by default and no fade when two rows are exactly full', async () => {
    const fixture = await render(registrants(18));

    expect(queryAll(fixture, 'meeting-attendee-grid-list')[0].style.gridTemplateColumns).toBe('repeat(9, 28px)');
    expect(queryAll(fixture, 'meeting-attendee-grid-person')).toHaveLength(18);
    expect(queryAll(fixture, 'meeting-attendee-grid-fade')).toHaveLength(0);
    expect(queryAll(fixture, 'meeting-attendee-grid-view-all')).toHaveLength(0);
  });

  it('caps fluid columns at two rows, fades and emits View all with the total', async () => {
    const fixture = await render(registrants(20), { columns: 8, fluid: true, showStats: false, viewAllVariant: 'tertiary-accent', viewAllSize: 'large' });
    const viewAll = vi.fn();
    fixture.componentInstance.viewAll.subscribe(viewAll);

    expect(queryAll(fixture, 'meeting-attendee-grid-list')[0].style.gridTemplateColumns).toBe('repeat(8, minmax(0, 1fr))');
    expect(queryAll(fixture, 'meeting-attendee-grid-stats')).toHaveLength(0);
    expect(queryAll(fixture, 'meeting-attendee-grid-person')).toHaveLength(16);
    expect(queryAll(fixture, 'meeting-attendee-grid-fade')).toHaveLength(1);
    const button = queryAll(fixture, 'meeting-attendee-grid-view-all')[0];
    expect(button.textContent?.trim()).toBe('View all 20');
    button.querySelector('button')?.click();
    expect(viewAll).toHaveBeenCalledTimes(1);
  });

  it('keeps the fade but hides View all when the parent turns it off', async () => {
    const fixture = await render(registrants(19), { showViewAll: false });

    expect(queryAll(fixture, 'meeting-attendee-grid-fade')).toHaveLength(1);
    expect(queryAll(fixture, 'meeting-attendee-grid-view-all')).toHaveLength(0);
  });

  it('reads attendance for a past meeting', async () => {
    const people = [
      { uid: 'p-1', first_name: 'Ana', last_name: 'B', email: 'a@example.org', is_attended: false },
      { uid: 'p-2', first_name: 'Ben', last_name: 'C', email: 'b@example.org', is_attended: true },
    ] as PastMeetingParticipant[];
    const fixture = await render(people, { past: true });

    expect(queryAll(fixture, 'meeting-attendee-grid-label').map((cell) => cell.getAttribute('aria-label'))).toEqual(['Ben C · Attended', 'Ana B · Absent']);
  });
});
