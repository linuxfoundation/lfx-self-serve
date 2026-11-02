// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideRouter, Router } from '@angular/router';
import { EMPTY_ORG_EVENT_ATTENDEES_RESPONSE } from '@lfx-one/shared/constants';
import type { OrgDropdownOption, OrgEventAttendeeDetailRow, OrgEventAttendeesResponse } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { of } from 'rxjs';
import { describe, expect, it, type Mock, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from '../../../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { EventAttendeesService } from '../../services/event-attendees.service';
import { EventAttendeesComponent } from './event-attendees.component';

const ORG = SYNTHETIC_ORG_ACCOUNT_ID;

/** `YYYY-MM-DD`, `days` from today (UTC). */
function daysFromToday(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function detail(eventId: string, eventEndDate: string): OrgEventAttendeeDetailRow {
  return {
    personKey: 'p-1',
    eventId,
    eventName: eventId,
    eventLocation: null,
    eventCity: null,
    eventCountry: null,
    eventUrl: null,
    foundationId: 'lf',
    foundationName: 'lf',
    eventStartDate: eventEndDate,
    eventEndDate,
    isSpeaker: false,
    isPastEvent: true,
  };
}

const RESPONSE: OrgEventAttendeesResponse = {
  ...EMPTY_ORG_EVENT_ATTENDEES_RESPONSE,
  accountId: ORG,
  attendees: [{ personKey: 'p-1', lfid: null, cdpMemberId: null, name: 'Ada Lovelace', title: null, email: null }],
  details: [detail('upcoming', daysFromToday(30)), detail('recent', daysFromToday(-5)), detail('old', daysFromToday(-400))],
  foundationOptions: [{ foundationId: 'lf', foundationName: 'lf' }],
  eventOptions: [
    { eventId: 'upcoming', eventName: 'upcoming' },
    { eventId: 'recent', eventName: 'recent' },
    { eventId: 'old', eventName: 'old' },
  ],
};

describe('EventAttendeesComponent — event dropdown follows the range (lfx-self-serve#4159)', () => {
  let fixture: ComponentFixture<EventAttendeesComponent>;

  const form = (): FormGroup => (fixture.componentInstance as unknown as { filterForm: FormGroup }).filterForm;
  const eventValues = (): string[] =>
    (fixture.componentInstance as unknown as { eventOptions: () => OrgDropdownOption[] }).eventOptions().map((option) => option.value);

  async function settle(): Promise<void> {
    // Past the form's 150ms debounce.
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function mount(initialUrl: string, response: OrgEventAttendeesResponse = RESPONSE): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [EventAttendeesComponent],
      providers: [
        provideRouter([]),
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG, accountName: SYNTHETIC_ORG_NAME }) } },
        { provide: EventAttendeesService, useValue: { getEventAttendees: vi.fn(() => of(response)) } },
        { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    await TestBed.inject(Router).navigateByUrl(initialUrl);
    fixture = TestBed.createComponent(EventAttendeesComponent);
    await settle();
  }

  it('offers only events with a registration the range counts', async () => {
    await mount('/?tab=events&range=30d');
    expect(eventValues()).toEqual(['', 'recent']);

    form().controls['timeRange'].setValue('all');
    await settle();
    expect(eventValues()).toEqual(['', 'recent', 'old']);
  });

  it('clears a picked event the new range no longer offers', async () => {
    await mount('/?tab=events&range=all');
    form().patchValue({ event: 'old' });
    await settle();

    form().controls['timeRange'].setValue('30d');
    await settle();

    expect(form().controls['event'].value).toBe('');
  });

  // The control's clear goes through the 150ms filter debounce after the range has applied; the table must not filter on
  // the dropped event in between (it would render the empty state for one debounce cycle).
  it('never renders the table empty while a dropped event is being cleared', async () => {
    const row = (): Element | null => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="org-people-event-attendees-row-p-1"]');
    await mount('/?tab=events&range=all');
    form().patchValue({ event: 'old' });
    await settle();
    expect(row()).not.toBeNull();

    form().controls['timeRange'].setValue('30d');
    for (let elapsed = 0; elapsed < 400; elapsed += 25) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      fixture.detectChanges();
      expect(row()).not.toBeNull();
    }
    expect(form().controls['event'].value).toBe('');
  });

  // An event with no end date is dated by its start everywhere: Last attended, Most recent event and the expanded order agree.
  it('dates a start-only event by its start in Last attended, Most recent event and the expanded order', async () => {
    const newerStartOnly: OrgEventAttendeeDetailRow = { ...detail('newer-start-only', daysFromToday(-3)), eventEndDate: null };
    const olderEnded = detail('older-ended', daysFromToday(-10));
    await mount('/?tab=events&range=all', { ...RESPONSE, details: [olderEnded, newerStartOnly] });

    const component = fixture.componentInstance as unknown as {
      viewRows: () => { personKey: string; lastAttendedTs: string | null; mostRecentEventName: string | null }[];
      expandedRowsMap: () => Record<string, { eventId: string }[]>;
    };
    const [ada] = component.viewRows();
    expect(ada.lastAttendedTs).toBe(daysFromToday(-3));
    expect(ada.mostRecentEventName).toBe('newer-start-only');
    expect(component.expandedRowsMap()['p-1'].map((row) => row.eventId)).toEqual(['newer-start-only', 'older-ended']);
  });

  it('opens the person drawer for the range the tab lists the person in', async () => {
    await mount('/?tab=events&range=90d');
    const open = (TestBed.inject(PersonDetailDrawerService) as unknown as { open: Mock }).open;

    (fixture.componentInstance as unknown as { onPersonClick(row: object, event: Event): void }).onPersonClick(
      { personKey: 'p-1', name: 'Ada Lovelace', title: null, initials: 'AL', avatarColorClass: '' },
      new Event('click')
    );

    expect(open).toHaveBeenCalledWith(expect.objectContaining({ personKey: 'p-1', defaultTab: 'events', range: '90d' }));
  });
});
