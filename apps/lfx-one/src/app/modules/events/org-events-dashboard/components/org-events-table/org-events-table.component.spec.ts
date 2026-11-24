// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgEvent, OrgEventsResponse } from '@lfx-one/shared/interfaces';
import { OrgLensViewModeService } from '@services/org-lens-view-mode.service';
import { describe, expect, it } from 'vitest';

import { OrgEventsTableComponent } from './org-events-table.component';

const EVENT: OrgEvent = {
  eventId: 'evt-1',
  eventName: 'Summit',
  foundation: 'Foundation A',
  eventStartDate: '2026-12-01',
  eventEndDate: '2026-12-03',
  eventLocation: null,
  eventCity: 'Paris',
  eventCountry: 'France',
  eventUrl: null,
  eventRegistrationUrl: null,
  orgAttendeeCount: 12,
  orgSpeakerAcceptedCount: 2,
  orgSpeakerSubmittedCount: 5,
  isOrgSponsor: false,
};

async function render(employeeView: boolean) {
  await TestBed.configureTestingModule({
    imports: [OrgEventsTableComponent],
    providers: [provideNoopAnimations(), { provide: OrgLensViewModeService, useValue: { isEmployeeView: signal(employeeView) } }],
  }).compileComponents();
  const fixture = TestBed.createComponent(OrgEventsTableComponent);
  const response: OrgEventsResponse = { data: [EVENT], total: 1, pageSize: 10, offset: 0 } as unknown as OrgEventsResponse;
  fixture.componentRef.setInput('eventsResponse', response);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, component: fixture.componentInstance };
}

describe('OrgEventsTableComponent', () => {
  it('makes the attendee and speaker numbers buttons in the full view', async () => {
    const { el } = await render(false);

    expect(el.querySelector('[data-testid="org-event-attendees-evt-1"] button')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-event-speakers-evt-1"] button')).not.toBeNull();
  });

  it('shows the same numbers as plain text, with no button, in the employee view', async () => {
    const { el, component } = await render(true);
    let emitted = 0;
    component.attendeesClick.subscribe(() => emitted++);

    const attendees = el.querySelector('[data-testid="org-event-attendees-evt-1"]');
    const speakers = el.querySelector('[data-testid="org-event-speakers-evt-1"]');
    expect(attendees?.querySelector('button')).toBeNull();
    expect(speakers?.querySelector('button')).toBeNull();
    expect(attendees?.textContent).toContain('12');
    expect(speakers?.textContent).toContain('2 / 5');
    expect(emitted).toBe(0);
  });
});
