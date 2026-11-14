// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { EMPTY_ORG_EVENTS_RESPONSE, ORG_EVENTS_PARTICIPATION_UPCOMING_NOTE } from '@lfx-one/shared/constants';
import type { Account, OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { EventsService } from '@services/events.service';
import { IntercomService } from '@services/intercom.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { MessageService } from 'primeng/api';
import { NEVER, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrgEventsDashboardComponent } from './org-events-dashboard.component';

async function render(
  state: OrgLensEmptyStateName | null,
  {
    settled = true,
    query = {} as Record<string, string>,
    summaryFails = false,
    listMode = 'ok' as 'ok' | 'pending' | 'error',
    foundations = [{ id: 'foundation-a', name: 'Foundation A' }],
  } = {}
) {
  const pageState = signal<OrgLensEmptyStateName | null>(state);
  const selectedAccount = signal<Account>({ accountId: 'acc-1', accountName: 'Acme Motors, Inc.', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });
  const eventsService = {
    getOrgEventsSummary: vi.fn(() => (summaryFails ? throwError(() => new Error('summary down')) : of({ totalEvents: 0, upcomingEvents: 0, pastEvents: 0 }))),
    getOrgEvents: vi.fn(() => {
      if (listMode === 'pending') return NEVER;
      if (listMode === 'error') return throwError(() => new Error('list down'));
      return of(EMPTY_ORG_EVENTS_RESPONSE);
    }),
    getOrgEventFoundations: vi.fn(() => of({ data: foundations })),
  };

  await TestBed.configureTestingModule({
    imports: [OrgEventsDashboardComponent],
    providers: [
      provideNoopAnimations(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap(query)), snapshot: { queryParamMap: convertToParamMap(query) } } },
      { provide: AccountContextService, useValue: { selectedAccount } },
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
  return { el: fixture.nativeElement as HTMLElement, eventsService, component: fixture.componentInstance, fixture };
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

  it('keeps a picked foundation when the options come back empty (an upstream failure proves nothing)', async () => {
    const { component, eventsService } = await render(null, { query: { foundation: 'foundation-a' }, foundations: [] });

    expect(component.filterForm.controls.foundation.value).toBe('foundation-a');
    const [, params] = eventsService.getOrgEvents.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(params).toMatchObject({ foundation: 'foundation-a' });
  });
});
