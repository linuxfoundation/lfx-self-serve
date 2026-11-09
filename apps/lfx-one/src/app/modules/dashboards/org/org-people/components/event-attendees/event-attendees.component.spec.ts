// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideRouter, Router } from '@angular/router';
import { EMPTY_ORG_EVENT_ATTENDEES_RESPONSE, ORG_EVENTS_ATTRIBUTION_CAPTION_PHRASE } from '@lfx-one/shared/constants';
import type { OrgDropdownOption, OrgEventAttendeeDetailRow, OrgEventAttendeesResponse } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { of, throwError } from 'rxjs';
import { describe, expect, it, type Mock, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from '../../../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { EventAttendeesService } from '../../services/event-attendees.service';
import { EventAttendeesComponent } from './event-attendees.component';

const ORG = SYNTHETIC_ORG_ACCOUNT_ID;

function detail(participantRef: number, eventId: string, overrides: Partial<OrgEventAttendeeDetailRow> = {}): OrgEventAttendeeDetailRow {
  return {
    participantRef,
    personKey: `p-${participantRef}`,
    displayName: `Person ${participantRef}`,
    jobTitle: null,
    eventId,
    eventName: eventId,
    eventLocation: null,
    eventCity: null,
    eventCountry: null,
    eventUrl: null,
    foundationId: 'lf',
    foundationName: 'lf',
    eventStartDate: '2026-01-10',
    eventEndDate: '2026-01-11',
    isSpeaker: false,
    ...overrides,
  };
}

const RESPONSE: OrgEventAttendeesResponse = {
  ...EMPTY_ORG_EVENT_ATTENDEES_RESPONSE,
  accountId: ORG,
  details: [detail(1, 'event-a'), detail(1, 'event-b'), detail(2, 'event-a', { personKey: null, displayName: 'Registered attendee' })],
  summary: { attendeesCount: 5, speakersCount: 0, eventsCount: 2, foundationsCount: 1 },
  foundationOptions: [{ foundationId: 'lf', foundationName: 'lf' }],
  eventOptions: [
    { eventId: 'event-a', eventName: 'event-a' },
    { eventId: 'event-b', eventName: 'event-b' },
  ],
};

describe('EventAttendeesComponent — Events filters (lfx-self-serve#4598)', () => {
  let fixture: ComponentFixture<EventAttendeesComponent>;
  let getEventAttendees: Mock;

  const form = (): FormGroup => (fixture.componentInstance as unknown as { filterForm: FormGroup }).filterForm;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const testId = (id: string): Element | null => el().querySelector(`[data-testid="${id}"]`);

  async function settle(): Promise<void> {
    // Past the form's 150ms debounce.
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function mount(initialUrl: string, response: OrgEventAttendeesResponse = RESPONSE): Promise<void> {
    getEventAttendees = vi.fn(() => of(response));
    await TestBed.configureTestingModule({
      imports: [EventAttendeesComponent],
      providers: [
        provideRouter([]),
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG, accountName: SYNTHETIC_ORG_NAME }) } },
        { provide: EventAttendeesService, useValue: { getEventAttendees } },
        { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    await TestBed.inject(Router).navigateByUrl(initialUrl);
    fixture = TestBed.createComponent(EventAttendeesComponent);
    await settle();
  }

  it('reads with the defaults and drops them from the URL', async () => {
    await mount('/?tab=events');

    expect(getEventAttendees).toHaveBeenCalledWith(ORG, { range: '730d', attribution: 'verified', participation: 'all' });
    expect(TestBed.inject(Router).url).not.toContain('participation');
    expect(TestBed.inject(Router).url).not.toContain('attribution');
  });

  it('offers All as the first Count option and Employee match, Self-reported only, All as the Counted by options', async () => {
    await mount('/?tab=events');
    const component = fixture.componentInstance as unknown as {
      participationOptions: { label: string; value: string }[];
      attributionOptions: { label: string; value: string }[];
    };

    expect(component.participationOptions.map((option) => option.label)).toEqual(['All', 'Registered', 'Attended']);
    expect(component.attributionOptions).toEqual([
      { label: 'Employee match', value: 'verified' },
      { label: 'Self-reported only', value: 'self_reported' },
      { label: 'All', value: 'all' },
    ]);
    expect(form().controls['participation'].value).toBe('all');
    expect(form().controls['attribution'].value).toBe('verified');
  });

  it('restores Count and Counted by from the URL and reads with them', async () => {
    await mount('/?tab=events&range=90d&participation=attended&attribution=self_reported');

    expect(form().controls['participation'].value).toBe('attended');
    expect(form().controls['attribution'].value).toBe('self_reported');
    expect(getEventAttendees).toHaveBeenCalledWith(ORG, { range: '90d', attribution: 'self_reported', participation: 'attended' });
    expect(testId('org-people-event-attendees-attendees-caption')?.textContent).toContain(ORG_EVENTS_ATTRIBUTION_CAPTION_PHRASE.self_reported);
  });

  // lfx-self-serve#5315 retired Company email and Account on registration: an old link reads with the default instead.
  it.each(['company_email', 'account'])('falls back to Employee match for the retired ?attribution=%s', async (retired) => {
    await mount(`/?tab=events&attribution=${retired}`);

    expect(form().controls['attribution'].value).toBe('verified');
    expect(getEventAttendees).toHaveBeenCalledWith(ORG, { range: '730d', attribution: 'verified', participation: 'all' });
    expect(getEventAttendees).not.toHaveBeenCalledWith(ORG, expect.objectContaining({ attribution: retired }));
  });

  it('writes a non-default pick to the URL and refetches, then drops it again at the default', async () => {
    await mount('/?tab=events');

    form().controls['participation'].setValue('attended');
    await settle();
    expect(TestBed.inject(Router).url).toContain('participation=attended');
    expect(getEventAttendees).toHaveBeenLastCalledWith(ORG, { range: '730d', attribution: 'verified', participation: 'attended' });

    form().controls['participation'].setValue('registered');
    await settle();
    expect(TestBed.inject(Router).url).toContain('participation=registered');
    expect(getEventAttendees).toHaveBeenLastCalledWith(ORG, { range: '730d', attribution: 'verified', participation: 'registered' });

    form().controls['participation'].setValue('all');
    await settle();
    expect(TestBed.inject(Router).url).not.toContain('participation');
    expect(getEventAttendees).toHaveBeenLastCalledWith(ORG, { range: '730d', attribution: 'verified', participation: 'all' });

    form().controls['attribution'].setValue('all');
    await settle();
    expect(TestBed.inject(Router).url).toContain('attribution=all');
    expect(getEventAttendees).toHaveBeenLastCalledWith(ORG, { range: '730d', attribution: 'all', participation: 'all' });

    form().controls['attribution'].setValue('verified');
    await settle();
    expect(TestBed.inject(Router).url).not.toContain('attribution');
  });

  it('keeps Counted by behind "More filters", counting a non-default pick on the link', async () => {
    await mount('/?tab=events&attribution=all');

    const row = testId('org-people-event-attendees-more-filters');
    expect(row?.classList.contains('hidden')).toBe(true);
    expect(testId('org-people-event-attendees-more-filters-toggle')?.textContent).toContain('More filters (1)');

    (testId('org-people-event-attendees-more-filters-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(row?.classList.contains('hidden')).toBe(false);
  });

  it('offers every event the server returned, applying no range filter of its own', async () => {
    await mount('/?tab=events&range=30d');
    const values = (fixture.componentInstance as unknown as { eventOptions: () => OrgDropdownOption[] }).eventOptions().map((option) => option.value);

    expect(values).toEqual(['', 'event-a', 'event-b']);
    expect(testId('org-people-event-attendees-row-1')).not.toBeNull();
  });

  it('groups the rows by participantRef and makes people without a person key non-clickable', async () => {
    await mount('/?tab=events');

    expect(testId('org-people-event-attendees-row-1')).not.toBeNull();
    expect(testId('org-people-event-attendees-row-2')).not.toBeNull();
    expect(testId('org-people-event-attendees-row-1-name')?.tagName).toBe('BUTTON');
    expect(testId('org-people-event-attendees-row-2-name')?.tagName).toBe('DIV');
    expect(testId('org-people-event-attendees-row-2-name')?.textContent).toContain('Registered attendee');
  });

  it('shows the summary tiles unfiltered and the rows once filtered, with no "counted, not listed" note anywhere', async () => {
    await mount('/?tab=events');
    expect(testId('org-people-event-attendees-stat-attendees')?.textContent).toContain('5');
    expect(testId('org-people-event-attendees-not-listed')).toBeNull();
    expect(el().textContent).not.toContain('not listed');

    form().patchValue({ event: 'event-b' });
    await settle();
    expect(testId('org-people-event-attendees-stat-attendees')?.textContent).toContain('1');
    expect(el().textContent).not.toContain('not listed');
  });

  // All four tiles show the summary's own numbers (which can include speaker-only people absent from the rows) until the rows are narrowed, so the
  // tiles agree with each other and with the All Employees Event Attendees tile.
  it('shows the four summary tiles unfiltered and the row counts once a foundation narrows the rows', async () => {
    await mount('/?tab=events', {
      ...RESPONSE,
      details: [detail(1, 'event-a', { isSpeaker: true }), detail(1, 'event-b'), detail(2, 'event-a', { personKey: null, displayName: 'Registered attendee' })],
      summary: { attendeesCount: 5, speakersCount: 9, eventsCount: 7, foundationsCount: 4 },
    });
    const tile = (name: string): string | undefined => testId(`org-people-event-attendees-stat-${name}`)?.firstElementChild?.textContent?.trim();

    expect([tile('speakers'), tile('attendees'), tile('events'), tile('foundations')]).toEqual(['9', '5', '7', '4']);

    form().patchValue({ foundation: 'lf' });
    await settle();

    expect([tile('speakers'), tile('events'), tile('foundations')]).toEqual(['1', '2', '1']);
    expect(tile('attendees')).toBe('2');
  });

  it('clears a picked event the new response no longer offers', async () => {
    await mount('/?tab=events');
    form().patchValue({ event: 'event-b' });
    await settle();

    getEventAttendees.mockReturnValue(of({ ...RESPONSE, eventOptions: [{ eventId: 'event-a', eventName: 'event-a' }] }));
    form().controls['participation'].setValue('attended');
    await settle();

    expect(form().controls['event'].value).toBe('');
  });

  it('keeps the picked event and foundation when a refetch fails, so Retry starts from the same narrowing', async () => {
    await mount('/?tab=events');
    form().patchValue({ event: 'event-b', foundation: 'lf' });
    await settle();

    getEventAttendees.mockReturnValue(throwError(() => new Error('warehouse down')));
    form().controls['participation'].setValue('attended');
    await settle();

    expect(form().controls['event'].value).toBe('event-b');
    expect(form().controls['foundation'].value).toBe('lf');
  });

  it('dates a start-only event by its start in Last attended, Most recent event and the expanded order', async () => {
    const newerStartOnly = detail(1, 'newer-start-only', { eventStartDate: '2026-03-01', eventEndDate: null });
    const olderEnded = detail(1, 'older-ended', { eventStartDate: '2026-02-01', eventEndDate: '2026-02-02' });
    await mount('/?tab=events', { ...RESPONSE, details: [olderEnded, newerStartOnly] });

    const component = fixture.componentInstance as unknown as {
      viewRows: () => { participantRef: number; lastAttendedTs: string | null; mostRecentEventName: string | null }[];
      expandedRowsMap: () => Record<number, { eventId: string }[]>;
    };
    const [person] = component.viewRows();
    expect(person.lastAttendedTs).toBe('2026-03-01');
    expect(person.mostRecentEventName).toBe('newer-start-only');
    expect(component.expandedRowsMap()[1].map((row) => row.eventId)).toEqual(['newer-start-only', 'older-ended']);
  });

  it('opens the person drawer for the range the tab lists the person in, and not for a person without a key', async () => {
    await mount('/?tab=events&range=90d');
    const open = (TestBed.inject(PersonDetailDrawerService) as unknown as { open: Mock }).open;
    const onPersonClick = (row: object): void =>
      (fixture.componentInstance as unknown as { onPersonClick(row: object, event: Event): void }).onPersonClick(row, new Event('click'));

    onPersonClick({ participantRef: 2, personKey: null, name: 'Registered attendee', title: null, initials: 'RA', avatarColorClass: '' });
    expect(open).not.toHaveBeenCalled();

    onPersonClick({ participantRef: 1, personKey: 'p-1', name: 'Person 1', title: null, initials: 'P1', avatarColorClass: '' });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ personKey: 'p-1', defaultTab: 'events', range: '90d' }));
  });

  // The filter values lag the form by a debounce, so for that long they still name the foundation the new response dropped; the rows and tiles must not follow it.
  it('keeps rows and tiles populated while a foundation the new response no longer offers is being cleared', async () => {
    await mount('/?tab=events&range=all');
    form().patchValue({ foundation: 'lf' });
    await settle();
    expect(testId('org-people-event-attendees-row-1')).not.toBeNull();

    // The refreshed rows belong to another foundation, so a filter still naming 'lf' would match none of them and empty the table.
    getEventAttendees.mockReturnValue(
      of({
        ...RESPONSE,
        details: RESPONSE.details.map((row) => ({ ...row, foundationId: 'other', foundationName: 'other' })),
        foundationOptions: [{ foundationId: 'other', foundationName: 'other' }],
      })
    );
    form().controls['timeRange'].setValue('30d');
    // The response has applied; the filter form's own debounce has not.
    await Promise.resolve();
    fixture.detectChanges();
    expect(testId('org-people-event-attendees-row-1')).not.toBeNull();
    expect(testId('org-people-event-attendees-empty')).toBeNull();
    expect(testId('org-people-event-attendees-stat-attendees')?.firstElementChild?.textContent?.trim()).toBe('5');

    await settle();
    expect(form().controls['foundation'].value).toBe('');
    expect(testId('org-people-event-attendees-row-1')).not.toBeNull();
  });
});
