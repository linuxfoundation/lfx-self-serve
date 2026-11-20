// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  EMPTY_ORG_EVENTS_RESPONSE,
  ORG_EVENTS_PARTICIPATION_UPCOMING_NOTE,
  ORG_EVENTS_ROLL_UP_EXCLUDED_NOTICE,
  ORG_EVENTS_ROLL_UP_INCOMPLETE_NOTICE,
} from '@lfx-one/shared/constants';
import type { Account, OrgEvent, OrgEventsResponse, OrgEventsSummary, OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { EventsService } from '@services/events.service';
import { IntercomService } from '@services/intercom.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { MessageService } from 'primeng/api';
import { NEVER, Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EventAttendeesDrawerComponent } from './components/event-attendees-drawer/event-attendees-drawer.component';
import { EventSpeakersDrawerComponent } from './components/event-speakers-drawer/event-speakers-drawer.component';
import { OrgEventsDashboardComponent } from './org-events-dashboard.component';

const ROLL_UP_KEY = 'family-0010000000ROOTAAA';
const ROLL_UP_ORGANIZATIONS = [
  { accountId: 'acc-a', name: 'Acme Motors, Inc.' },
  { accountId: 'acc-b', name: 'Acme Robotics' },
];

function companiesSent(mock: { mock: { calls: unknown[][] } }): unknown[] {
  return paramSent(mock, 'company');
}

function paramSent(mock: { mock: { calls: unknown[][] } }, key: string): unknown[] {
  return mock.mock.calls.map((call) => (call[1] as Record<string, unknown>)[key]);
}

const ROW: OrgEvent = {
  eventId: 'event-one',
  eventName: 'Open Source Summit',
  foundation: null,
  eventStartDate: '2027-03-01',
  eventEndDate: null,
  eventLocation: null,
  eventCity: null,
  eventCountry: null,
  eventUrl: null,
  eventRegistrationUrl: null,
  orgAttendeeCount: 2,
  orgSpeakerAcceptedCount: 1,
  orgSpeakerSubmittedCount: 1,
  isOrgSponsor: false,
  organization: { accountId: 'acc-b', name: 'Acme Robotics' },
};

async function render(
  state: OrgLensEmptyStateName | null,
  {
    settled = true,
    query = {} as Record<string, string>,
    summaryFails = false,
    listMode = 'ok' as 'ok' | 'pending' | 'error' | 'manual',
    summaries = [] as Observable<OrgEventsSummary>[],
    foundations = [{ id: 'foundation-a', name: 'Foundation A' }],
    foundationsFail = false,
    rollUp = false,
    coverage = { complete: true, excludedCount: 0 },
  } = {}
) {
  const pageState = signal<OrgLensEmptyStateName | null>(state);
  const selectedAccount = signal<Account>(
    rollUp
      ? { accountId: ROLL_UP_KEY, accountName: 'Acme Group', membershipTier: '', uid: ROLL_UP_KEY, slug: ROLL_UP_KEY }
      : { accountId: 'acc-1', accountName: 'Acme Motors, Inc.', membershipTier: '', uid: 'org-uid-1', slug: 'acme' }
  );
  const summary: OrgEventsSummary = rollUp
    ? { totalEvents: 0, upcomingEvents: 0, pastEvents: 0, organizations: ROLL_UP_ORGANIZATIONS, rollUp: coverage }
    : { totalEvents: 0, upcomingEvents: 0, pastEvents: 0 };
  const lists: Subject<OrgEventsResponse>[] = [];
  const eventsService = {
    getOrgEventsSummary: vi.fn(() => summaries.shift() ?? (summaryFails ? throwError(() => new Error('summary down')) : of(summary))),
    getOrgEvents: vi.fn((): Observable<OrgEventsResponse> => {
      if (listMode === 'manual') {
        const list = new Subject<OrgEventsResponse>();
        lists.push(list);
        return list;
      }
      if (listMode === 'pending') return NEVER;
      if (listMode === 'error') return throwError(() => new Error('list down'));
      return of(EMPTY_ORG_EVENTS_RESPONSE);
    }),
    getOrgEventFoundations: vi.fn(() => (foundationsFail ? throwError(() => new Error('foundations down')) : of({ data: foundations }))),
    getEventAttendees: vi.fn(() => of({ eventId: 'event-one', eventName: 'Open Source Summit', total: 0, data: [] })),
    getEventSpeakers: vi.fn(() => of({ eventId: 'event-one', eventName: 'Open Source Summit', acceptedCount: 0, submittedCount: 0, data: [] })),
  };

  await TestBed.configureTestingModule({
    imports: [OrgEventsDashboardComponent],
    providers: [
      provideNoopAnimations(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap(query)), snapshot: { queryParamMap: convertToParamMap(query) } } },
      { provide: AccountContextService, useValue: { selectedAccount, isRollUp: signal(rollUp) } },
      { provide: EventsService, useValue: eventsService },
      MessageService,
      { provide: IntercomService, useValue: { show: vi.fn() } },
      { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
      {
        provide: OrgLensEmptyStateService,
        useValue: {
          pageState,
          hasPageState: computed(() => pageState() !== null),
          pageReady: signal(true),
          settled: signal(settled),
          retrying: signal(false),
          retry: vi.fn(),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(OrgEventsDashboardComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  // The events pipeline starts one macrotask later (debounceTime(0) batches the filter signals into a single read).
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, eventsService, component: fixture.componentInstance, fixture, summary, lists };
}

describe('OrgEventsDashboardComponent', () => {
  it('renders the page when there is no page-level state', async () => {
    const { el, eventsService } = await render(null);

    expect(el.querySelector('[data-testid="org-events-no-access-state"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-events-stat-strip"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-events-title"]')?.textContent).toContain('Acme Motors, Inc.');
    expect(eventsService.getOrgEventsSummary).toHaveBeenCalledWith('acc-1', {
      eventScope: 'activity',
      foundation: '',
      range: '730d',
      company: '',
    });
  });

  it('replaces the page with the contractor-no-grant state and neither names the organization nor reads its events', async () => {
    const { el, eventsService } = await render('contractor-no-grant');

    expect(el.querySelector('[data-testid="org-events-no-access-state"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-events-stat-strip"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-events-main-card"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-events-title"]')?.textContent).not.toContain('Acme Motors, Inc.');
    expect(eventsService.getOrgEventsSummary).not.toHaveBeenCalled();
  });

  it('shows a skeleton instead of a blank area while the org context is still settling, without naming the org or reading its events', async () => {
    const { el, eventsService } = await render(null, { settled: false });

    expect(el.querySelector('[data-testid="org-events-skeleton"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-events-stat-strip"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-events-main-card"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-events-title"]')?.textContent).not.toContain('Acme Motors, Inc.');
    expect(eventsService.getOrgEventsSummary).not.toHaveBeenCalled();
  });

  it('reads the Upcoming tab with the defaults, registrations only and no range', async () => {
    const { eventsService } = await render(null);

    expect(eventsService.getOrgEvents).toHaveBeenCalledTimes(1);
    const [, params] = eventsService.getOrgEvents.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(params).toMatchObject({ isPast: false, participation: 'registered', eventScope: 'activity', foundation: '' });
    expect(params['range']).toBeUndefined();
  });

  it('restores the filters from the URL and sends them on the Past tab', async () => {
    const { eventsService } = await render(null, {
      query: { tab: 'past', range: '90d', participation: 'attended', eventScope: 'all', foundation: 'foundation-a' },
    });

    const [, params] = eventsService.getOrgEvents.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(params).toMatchObject({
      isPast: true,
      range: '90d',
      participation: 'attended',
      eventScope: 'all',
      foundation: 'foundation-a',
    });
    expect(eventsService.getOrgEventsSummary).toHaveBeenCalledWith('acc-1', {
      eventScope: 'all',
      foundation: 'foundation-a',
      range: '90d',
      company: '',
    });
  });

  it('defaults Count to All, and sends a Count of All on the Past tab', async () => {
    const { component, eventsService } = await render(null, { query: { tab: 'past' } });

    expect(component.filterForm.controls.participation.value).toBe('all');
    expect(component.participationOptions[0]).toEqual({ label: 'All', value: 'all' });
    const [, params] = eventsService.getOrgEvents.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(params).toMatchObject({ isPast: true, participation: 'all' });
  });

  it('shows Range only on the Past tab', async () => {
    const upcoming = await render(null);
    expect(upcoming.el.querySelector('[data-test="org-events-time-range-filter"]')).toBeNull();
    TestBed.resetTestingModule();

    const past = await render(null, { query: { tab: 'past' } });
    expect(past.el.querySelector('[data-test="org-events-time-range-filter"]')).not.toBeNull();
  });

  it('disables Count on the Upcoming tab and says why, keeping a picked value for the Past tab', async () => {
    const { el, component } = await render(null, { query: { participation: 'attended' } });

    expect(component.filterForm.controls.participation.disabled).toBe(true);
    expect(component.filterForm.controls.participation.value).toBe('attended');
    expect(el.querySelector('[data-testid="org-events-participation-filter"]')?.getAttribute('title')).toBe(ORG_EVENTS_PARTICIPATION_UPCOMING_NOTE);
  });

  it('offers Clear filters only when a filter is not at its default', async () => {
    const defaults = await render(null);
    expect(defaults.el.querySelector('[data-testid="org-events-clear-filters"]')).toBeNull();
    TestBed.resetTestingModule();

    const picked = await render(null, { query: { eventScope: 'all' } });
    expect(picked.el.querySelector('[data-testid="org-events-clear-filters"]')).not.toBeNull();
    TestBed.resetTestingModule();

    const registered = await render(null, { query: { participation: 'registered' } });
    expect(registered.el.querySelector('[data-testid="org-events-clear-filters"]')).not.toBeNull();
  });

  it('clears a picked foundation the loaded options do not offer', async () => {
    const { component } = await render(null, { query: { foundation: 'foundation-gone' } });

    expect(component.filterForm.controls.foundation.value).toBe('');
  });

  it('says the event counts could not load instead of showing numbers when the summary read fails', async () => {
    const { el } = await render(null, { summaryFails: true });

    expect(el.querySelector('[data-testid="org-events-stat-error"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-events-stat-upcoming"]')?.textContent).not.toMatch(/\d/);
  });

  it('shows a load error with Retry, not the empty state, when the list read fails, and Retry reads again', async () => {
    const { el, eventsService, fixture } = await render(null, { listMode: 'error' });

    expect(el.querySelector('[data-testid="org-events-load-error"]')).not.toBeNull();
    expect(el.textContent).not.toContain('No upcoming events');
    const listCalls = eventsService.getOrgEvents.mock.calls.length;
    const summaryCalls = eventsService.getOrgEventsSummary.mock.calls.length;
    const foundationCalls = eventsService.getOrgEventFoundations.mock.calls.length;

    (el.querySelector('[data-testid="org-events-retry"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(eventsService.getOrgEvents.mock.calls.length).toBe(listCalls + 1);
    expect(eventsService.getOrgEventsSummary.mock.calls.length).toBe(summaryCalls + 1);
    expect(eventsService.getOrgEventFoundations.mock.calls.length).toBe(foundationCalls + 1);
  });

  it('keeps the empty state when the organization has no events', async () => {
    const { el } = await render(null);

    expect(el.querySelector('[data-testid="org-events-load-error"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-events-stat-error"]')).toBeNull();
    expect(el.textContent).toContain('No upcoming events');
  });

  it('keeps a picked foundation and offers All Foundations when the options read fails', async () => {
    const { component } = await render(null, { query: { foundation: 'foundation-a' }, foundationsFail: true });

    expect(component.filterForm.controls.foundation.value).toBe('foundation-a');
    expect(component.foundationOptions()).toEqual([{ label: 'All Foundations', value: '' }]);
  });

  it('keeps a picked foundation when the options come back empty', async () => {
    const { component, eventsService } = await render(null, { query: { foundation: 'foundation-a' }, foundations: [] });

    expect(component.filterForm.controls.foundation.value).toBe('foundation-a');
    const [, params] = eventsService.getOrgEvents.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(params).toMatchObject({ foundation: 'foundation-a' });
  });

  describe('family roll-up', () => {
    it('offers no Company filter on a single organization and drops a `?company=` without sending it', async () => {
      const { el, component, eventsService } = await render(null, { query: { company: 'acc-b' } });

      expect(el.querySelector('[data-test="org-events-company-filter"]')).toBeNull();
      expect(component.filterForm.controls.company.value).toBe('');
      expect(companiesSent(eventsService.getOrgEvents).every((company) => !company)).toBe(true);
    });

    it('offers All Companies and each organization the roll-up serves', async () => {
      const { el, component } = await render(null, { rollUp: true });

      expect(el.querySelector('[data-test="org-events-company-filter"]')).not.toBeNull();
      expect(component.companyOptions()).toEqual([
        { label: 'All Companies', value: '' },
        { label: 'Acme Motors, Inc.', value: 'acc-a' },
        { label: 'Acme Robotics', value: 'acc-b' },
      ]);
    });

    it('narrows the summary and the list to a served Company from the URL, and offers Clear filters', async () => {
      const { el, eventsService } = await render(null, { rollUp: true, query: { company: 'acc-b' } });

      expect(companiesSent(eventsService.getOrgEventsSummary).at(-1)).toBe('acc-b');
      expect(companiesSent(eventsService.getOrgEvents).at(-1)).toBe('acc-b');
      expect(el.querySelector('[data-testid="org-events-clear-filters"]')).not.toBeNull();
    });

    it('never sends a Company the roll-up does not serve, and clears it', async () => {
      const { component, eventsService } = await render(null, { rollUp: true, query: { company: 'acc-elsewhere' } });

      expect(component.filterForm.controls.company.value).toBe('');
      expect(companiesSent(eventsService.getOrgEventsSummary)).not.toContain('acc-elsewhere');
      expect(companiesSent(eventsService.getOrgEvents)).not.toContain('acc-elsewhere');
    });

    it('reads every organization again when Company goes back to All Companies', async () => {
      const { component, eventsService, fixture } = await render(null, { rollUp: true, query: { company: 'acc-b' } });

      component.filterForm.controls.company.setValue('');
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve));

      expect(companiesSent(eventsService.getOrgEventsSummary).at(-1)).toBe('');
      expect(companiesSent(eventsService.getOrgEvents).at(-1)).toBe('');
    });

    it("hides Show in a roll-up and reads only each company's own activity, whatever the URL says", async () => {
      const { el, eventsService } = await render(null, { rollUp: true, query: { eventScope: 'all' } });

      expect(el.querySelector('[data-test="org-events-scope-filter"]')).toBeNull();
      expect(paramSent(eventsService.getOrgEvents, 'eventScope').every((scope) => scope === 'activity')).toBe(true);
      expect(paramSent(eventsService.getOrgEventsSummary, 'eventScope').every((scope) => scope === 'activity')).toBe(true);
      expect(paramSent(eventsService.getOrgEventFoundations, 'eventScope').every((scope) => scope === 'activity')).toBe(true);
    });

    it('keeps Show on a single organization', async () => {
      const { el, eventsService } = await render(null, { query: { eventScope: 'all' } });

      expect(el.querySelector('[data-test="org-events-scope-filter"]')).not.toBeNull();
      expect(paramSent(eventsService.getOrgEvents, 'eventScope').at(-1)).toBe('all');
    });

    it('never widens the list to the whole family while a picked Company cannot be checked', async () => {
      const { el, eventsService } = await render(null, { rollUp: true, summaryFails: true, query: { company: 'acc-b' } });

      expect(eventsService.getOrgEvents).not.toHaveBeenCalled();
      expect(el.querySelector('[data-testid="org-events-load-error"]')).not.toBeNull();
    });

    it('cancels a whole-family read and shows no rows while a newly picked Company is checked, then reads that Company', async () => {
      const pendingSummary = new Subject<OrgEventsSummary>();
      const { component, eventsService, fixture, summary, lists } = await render(null, { rollUp: true, listMode: 'manual', summaries: [pendingSummary] });
      const rows = () => (component.isPastTab() ? component.pastEvents() : component.upcomingEvents()).data;
      const loading = () => (component.isPastTab() ? component.pastEventsLoading() : component.upcomingEventsLoading());
      expect(companiesSent(eventsService.getOrgEvents)).toEqual(['']);

      component.filterForm.controls.company.setValue('acc-b');
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve));
      lists[0].next({ ...EMPTY_ORG_EVENTS_RESPONSE, data: [ROW], total: 1 });

      expect(lists[0].observed).toBe(false);
      expect(eventsService.getOrgEvents).toHaveBeenCalledTimes(1);
      expect(rows()).toEqual([]);
      expect(loading()).toBe(true);

      pendingSummary.next(summary);
      pendingSummary.complete();
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve));
      lists.at(-1)?.next({ ...EMPTY_ORG_EVENTS_RESPONSE, data: [ROW], total: 1 });
      lists.at(-1)?.complete();

      expect(companiesSent(eventsService.getOrgEvents)).toEqual(['', 'acc-b']);
      expect(rows()).toEqual([ROW]);
      expect(loading()).toBe(false);
    });

    it('shows no card figures for the whole family while a Company from the URL is checked', async () => {
      const familySummary = new Subject<OrgEventsSummary>();
      const companySummary = new Subject<OrgEventsSummary>();
      const { component, fixture, summary } = await render(null, { rollUp: true, query: { company: 'acc-b' }, summaries: [familySummary, companySummary] });

      familySummary.next({ ...summary, upcomingEvents: 5 });
      familySummary.complete();
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve));

      expect(component.eventsSummary()).toBeNull();
      expect(component.tabPillOptions().map((tab) => tab.label)).not.toContain('Upcoming (5)');

      companySummary.next({ ...summary, upcomingEvents: 2 });
      companySummary.complete();

      expect(component.eventsSummary()?.upcomingEvents).toBe(2);
    });

    it("opens a row's drawers for that row's company", async () => {
      const { component, fixture } = await render(null, { rollUp: true });

      component.onAttendeesClick(ROW);
      fixture.detectChanges();
      const attendees = fixture.debugElement.query(By.directive(EventAttendeesDrawerComponent)).componentInstance as EventAttendeesDrawerComponent;
      expect([attendees.company(), attendees.companyLabel()]).toEqual(['acc-b', 'Acme Robotics']);

      component.onSpeakersClick(ROW);
      fixture.detectChanges();
      const speakers = fixture.debugElement.query(By.directive(EventSpeakersDrawerComponent)).componentInstance as EventSpeakersDrawerComponent;
      expect([speakers.company(), speakers.companyLabel()]).toEqual(['acc-b', 'Acme Robotics']);
    });

    it('says when organizations are left out, without saying how many', async () => {
      const { el } = await render(null, { rollUp: true, coverage: { complete: true, excludedCount: 2 } });

      const notices = el.querySelector('[data-testid="org-events-roll-up-notice"]')?.textContent ?? '';
      expect(notices).toContain(ORG_EVENTS_ROLL_UP_EXCLUDED_NOTICE);
      expect(notices).not.toContain(ORG_EVENTS_ROLL_UP_INCOMPLETE_NOTICE);
      expect(notices).not.toMatch(/\d/);
    });

    it('says when the family could not all be loaded', async () => {
      const { el } = await render(null, { rollUp: true, coverage: { complete: false, excludedCount: 0 } });

      const notices = el.querySelector('[data-testid="org-events-roll-up-notice"]')?.textContent ?? '';
      expect(notices).toContain(ORG_EVENTS_ROLL_UP_INCOMPLETE_NOTICE);
      expect(notices).not.toContain(ORG_EVENTS_ROLL_UP_EXCLUDED_NOTICE);
    });

    it("describes the organizations' footprint and says no events were found for your organizations", async () => {
      const { el } = await render(null, { rollUp: true });

      expect(el.querySelector('[data-testid="org-events-subtitle"]')?.textContent?.trim()).toBe("Your organizations' event footprint across LF events.");
      expect(el.textContent).toContain('No upcoming events were found for your organizations.');
    });

    it("keeps the company's description and empty state on a single organization", async () => {
      const { el } = await render(null);

      expect(el.querySelector('[data-testid="org-events-subtitle"]')?.textContent?.trim()).toBe("Your company's event footprint across LF events.");
      expect(el.textContent).toContain('No upcoming events were found for your company.');
    });

    it('shows no notice when every organization in the family is included', async () => {
      const { el } = await render(null, { rollUp: true });

      expect(el.querySelector('[data-testid="org-events-roll-up-notice"]')).toBeNull();
    });
  });
});
