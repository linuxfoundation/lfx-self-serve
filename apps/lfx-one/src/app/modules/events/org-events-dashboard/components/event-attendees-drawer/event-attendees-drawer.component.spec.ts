// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgEventsAttribution, OrgEventsParticipation } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { EventsService } from '@services/events.service';
import { of, throwError } from 'rxjs';
import { describe, expect, it, type Mock, vi } from 'vitest';

import { EventAttendeesDrawerComponent } from './event-attendees-drawer.component';

async function open(
  participation: OrgEventsParticipation,
  failing = false,
  attribution?: OrgEventsAttribution
): Promise<{ fixture: ComponentFixture<EventAttendeesDrawerComponent>; getEventAttendees: Mock }> {
  const getEventAttendees = vi.fn(() =>
    failing
      ? throwError(() => new Error('boom'))
      : of({
          eventId: 'event-1',
          eventName: 'Event One',
          total: 2,
          data: [
            { contactId: '0', name: 'Jane Doe', jobTitle: null },
            { contactId: '1', name: 'Roster Employee', jobTitle: 'Analyst' },
          ],
        })
  );
  await TestBed.configureTestingModule({
    imports: [EventAttendeesDrawerComponent],
    providers: [
      provideNoopAnimations(),
      { provide: EventsService, useValue: { getEventAttendees } },
      { provide: AccountContextService, useValue: { selectedAccount: signal({ accountId: 'acc-1', accountName: 'Acme Motors' }) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(EventAttendeesDrawerComponent);
  fixture.componentRef.setInput('eventId', 'event-1');
  fixture.componentRef.setInput('eventName', 'Event One');
  fixture.componentRef.setInput('participation', participation);
  if (attribution) fixture.componentRef.setInput('attribution', attribution);
  fixture.componentRef.setInput('attendeeCount', 7);
  fixture.detectChanges();
  fixture.componentRef.setInput('visible', true);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, getEventAttendees };
}

describe('EventAttendeesDrawerComponent', () => {
  it('labels each row Registered when Count is Registered', async () => {
    const { fixture } = await open('registered');

    expect(document.body.querySelector('[data-testid="event-attendee-status"]')?.textContent?.trim()).toBe('Registered');
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('labels each row Registered or attended when Count is All, and requests everyone who registered or attended', async () => {
    const { getEventAttendees } = await open('all');

    expect(getEventAttendees).toHaveBeenCalledWith('acc-1', 'event-1', expect.objectContaining({ participation: 'all' }));
    expect(document.body.querySelector('[data-testid="event-attendee-status"]')?.textContent?.trim()).toBe('Registered or attended');
  });

  it('labels each row Attended when Count is Attended, and requests attended people', async () => {
    const { getEventAttendees } = await open('attended');

    expect(getEventAttendees).toHaveBeenCalledWith('acc-1', 'event-1', expect.objectContaining({ participation: 'attended' }));
    expect(document.body.querySelector('[data-testid="event-attendee-status"]')?.textContent?.trim()).toBe('Attended');
    expect(document.body.querySelector('[data-testid="event-attendees-drawer-subtitle"]')?.textContent).toContain('2 counted');
  });

  it('refetches while open when Count changes, so the rows and the badge describe the same selection', async () => {
    const { fixture, getEventAttendees } = await open('registered');

    fixture.componentRef.setInput('participation', 'attended');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getEventAttendees).toHaveBeenLastCalledWith('acc-1', 'event-1', expect.objectContaining({ participation: 'attended' }));
    expect(document.body.querySelector('[data-testid="event-attendee-status"]')?.textContent?.trim()).toBe('Attended');
  });

  it('lists everyone the response sends, by name and any title it carries, and never shows a "counted, not listed" note (lfx-self-serve#5158)', async () => {
    await open('all');

    const rows = Array.from(document.body.querySelectorAll('[data-testid="event-attendees-list"] > li'));
    expect(rows.map((row) => row.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringContaining('Jane Doe'),
      expect.stringMatching(/Roster Employee\s*Analyst/),
    ]);
    expect(document.body.querySelector('[data-testid="event-attendees-not-listed"]')).toBeNull();
    expect(document.body.textContent ?? '').not.toContain('not listed');
  });

  it('requests the per-event Self-reported only rows when Counted by is Self-reported only', async () => {
    const { getEventAttendees } = await open('all', false, 'self_reported');

    expect(getEventAttendees).toHaveBeenCalledWith('acc-1', 'event-1', { attribution: 'self_reported', participation: 'all' });
  });

  it('keeps the opener count and says the load failed, never "0 counted", when the read fails', async () => {
    await open('registered', true);

    expect(document.body.querySelector('[data-testid="event-attendees-error"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="event-attendees-drawer-subtitle"]')?.textContent).toContain('7 counted');
  });
});
