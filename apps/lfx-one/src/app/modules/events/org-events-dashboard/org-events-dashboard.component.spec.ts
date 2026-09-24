// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { EMPTY_ORG_EVENTS_RESPONSE } from '@lfx-one/shared/constants';
import type { Account, OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { EventsService } from '@services/events.service';
import { IntercomService } from '@services/intercom.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrgEventsDashboardComponent } from './org-events-dashboard.component';

async function render(state: OrgLensEmptyStateName | null) {
  const pageState = signal<OrgLensEmptyStateName | null>(state);
  const selectedAccount = signal<Account>({ accountId: 'acc-1', accountName: 'Acme Motors, Inc.', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });
  const eventsService = {
    getOrgEventsSummary: vi.fn(() => of({ upcomingEvents: 0, pastEvents: 0 })),
    getOrgEvents: vi.fn(() => of(EMPTY_ORG_EVENTS_RESPONSE)),
  };

  await TestBed.configureTestingModule({
    imports: [OrgEventsDashboardComponent],
    providers: [
      provideNoopAnimations(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})), snapshot: { queryParamMap: convertToParamMap({}) } } },
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
          settled: signal(true),
          retrying: signal(false),
          retry: vi.fn(),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(OrgEventsDashboardComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, eventsService };
}

describe('OrgEventsDashboardComponent', () => {
  it('renders the page when there is no page-level state', async () => {
    const { el, eventsService } = await render(null);

    expect(el.querySelector('[data-testid="org-events-no-access-state"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-events-stat-strip"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-events-title"]')?.textContent).toContain('Acme Motors, Inc.');
    expect(eventsService.getOrgEventsSummary).toHaveBeenCalledWith('acc-1');
  });

  it('replaces the page with the contractor-no-grant state and neither names the organization nor reads its events', async () => {
    const { el, eventsService } = await render('contractor-no-grant');

    expect(el.querySelector('[data-testid="org-events-no-access-state"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-events-stat-strip"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-events-main-card"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-events-title"]')?.textContent).not.toContain('Acme Motors, Inc.');
    expect(eventsService.getOrgEventsSummary).not.toHaveBeenCalled();
  });
});
