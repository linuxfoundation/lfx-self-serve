// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ORG_EVENTS_PAGE_COPY, ORG_EVENTS_ROLL_UP_PAGE_COPY } from '@lfx-one/shared/constants';
import type { OrgEvent, OrgEventsResponse } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { OrgEventsTableComponent } from './org-events-table.component';

const EVENT: OrgEvent = {
  eventId: 'event-one',
  eventName: 'Open Source Summit',
  eventUrl: null,
  eventRegistrationUrl: null,
  foundation: 'Foundation A',
  eventStartDate: '2027-03-01',
  eventEndDate: '2027-03-03',
  eventCity: 'Denver',
  eventCountry: 'United States',
  eventLocation: null,
  orgAttendeeCount: 3,
  eventRegistrationsGoal: null,
  orgSpeakerAcceptedCount: 0,
  orgSpeakerSubmittedCount: 0,
  isOrgSponsor: true,
};

async function render({ rollUp = false, loadFailed = false, events = [EVENT] }: { rollUp?: boolean; loadFailed?: boolean; events?: OrgEvent[] } = {}) {
  await TestBed.configureTestingModule({
    imports: [OrgEventsTableComponent],
    providers: [provideNoopAnimations()],
  }).compileComponents();

  const fixture = TestBed.createComponent(OrgEventsTableComponent);
  const response: OrgEventsResponse = { data: events, total: events.length, pageSize: 10, offset: 0 };
  fixture.componentRef.setInput('eventsResponse', response);
  fixture.componentRef.setInput('rollUp', rollUp);
  fixture.componentRef.setInput('loadFailed', loadFailed);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('OrgEventsTableComponent', () => {
  it('has no Company column and credits attendees to My Company on a single organization', async () => {
    const el = await render();

    expect(el.querySelector('[data-testid="org-events-company-header"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-event-company-event-one"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-events-attendees-owner"]')?.textContent?.trim()).toBe('My Company');
    expect(el.querySelector('[data-testid="org-event-sponsor-event-one"]')?.textContent?.trim()).toBe('Yes');
  });

  it("follows Event Name with a Company column, one row per company, repeating the event's details", async () => {
    const el = await render({
      rollUp: true,
      events: [
        { ...EVENT, organization: { accountId: 'acc-a', name: 'Acme Motors, Inc.' }, isOrgSponsor: false },
        { ...EVENT, organization: { accountId: 'acc-b', name: 'Acme Robotics' } },
      ],
    });

    const headers = Array.from(el.querySelectorAll('thead th')).map((th) => th.textContent?.trim() ?? '');
    expect(headers.indexOf('Company')).toBe(headers.findIndex((text) => text.startsWith('Event Name')) + 1);
    expect(el.querySelector('[data-testid="org-events-company-header"] button')).toBeNull();
    expect(el.querySelector('[data-testid="org-event-company-event-one-acc-a"]')?.textContent?.trim()).toBe('Acme Motors, Inc.');
    expect(el.querySelector('[data-testid="org-event-company-event-one-acc-b"]')?.textContent?.trim()).toBe('Acme Robotics');
    expect(el.querySelector('[data-testid="org-event-name-event-one-acc-b"]')?.textContent?.trim()).toBe('Open Source Summit');
  });

  it("reads each company's own Event Sponsor flag", async () => {
    const el = await render({
      rollUp: true,
      events: [
        { ...EVENT, organization: { accountId: 'acc-a', name: 'Acme Motors, Inc.' }, isOrgSponsor: false },
        { ...EVENT, organization: { accountId: 'acc-b', name: 'Acme Robotics' } },
      ],
    });

    expect(el.querySelector('[data-testid="org-event-sponsor-event-one-acc-a"]')?.textContent?.trim()).toBe('No');
    expect(el.querySelector('[data-testid="org-event-sponsor-event-one-acc-b"]')?.textContent?.trim()).toBe('Yes');
  });

  it("credits each row's attendees to that company in a roll-up", async () => {
    const el = await render({ rollUp: true, events: [{ ...EVENT, organization: { accountId: 'acc-a', name: 'Acme Motors, Inc.' } }] });

    expect(el.querySelector('[data-testid="org-events-attendees-owner"]')?.textContent?.trim()).toBe(ORG_EVENTS_ROLL_UP_PAGE_COPY.attendeesOwner);
  });

  it("says it could not read the companies' events in a roll-up, and the company's otherwise", async () => {
    const rollUp = await render({ rollUp: true, loadFailed: true, events: [] });
    expect(rollUp.querySelector('[data-testid="org-events-load-error"]')?.textContent).toContain(ORG_EVENTS_ROLL_UP_PAGE_COPY.loadError);
    TestBed.resetTestingModule();

    const single = await render({ loadFailed: true, events: [] });
    expect(single.querySelector('[data-testid="org-events-load-error"]')?.textContent).toContain(ORG_EVENTS_PAGE_COPY.loadError);
  });
});
