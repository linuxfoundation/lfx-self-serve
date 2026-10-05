// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { CONTRIBUTIONS_MAX_FILTER_VALUES, EMPTY_ORG_CONTRIBUTIONS_RESPONSE } from '@lfx-one/shared/constants';
import type { Account, OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrgContributionsComponent } from './org-contributions.component';
import { ContributionsService } from './services/contributions.service';

// <lfx-person-detail-drawer /> is mounted unconditionally, so it needs the signal surface it reads.
function personDrawerStub() {
  return {
    isOpen: signal(false),
    activeContext: signal(null),
    activeTab: signal('events'),
    loading: signal(false),
    error: signal(false),
    emailError: signal(false),
    identityUnavailable: signal(false),
    companyEmailsResolved: signal(false),
    detail: signal(null),
    companyEmails: signal([]),
    open: vi.fn(),
    close: vi.fn(),
    setTab: vi.fn(),
  };
}

async function render(state: OrgLensEmptyStateName | null, { settled = true, queryParams = {} as Record<string, string> } = {}) {
  const pageState = signal<OrgLensEmptyStateName | null>(state);
  const selectedAccount = signal<Account>({ accountId: 'acc-1', accountName: 'Acme Motors, Inc.', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });

  await TestBed.configureTestingModule({
    imports: [OrgContributionsComponent],
    providers: [
      provideRouter([]),
      MessageService,
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      { provide: AccountContextService, useValue: { selectedAccount } },
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
      { provide: ContributionsService, useValue: { getContributions: () => of(EMPTY_ORG_CONTRIBUTIONS_RESPONSE) } },
      { provide: PersonDetailDrawerService, useValue: personDrawerStub() },
    ],
  }).compileComponents();

  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(OrgContributionsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, navigate };
}

describe('OrgContributionsComponent', () => {
  it('replaces the page with the contractor-no-grant state and renders none of its data sections', async () => {
    const el = (await render('contractor-no-grant')).fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="org-contributions-no-access-state"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-kpis"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-content-card"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-no-company-empty-state"]')).toBeNull();
  });

  it('shows a skeleton instead of a blank area while the org context is still settling', async () => {
    const el = (await render(null, { settled: false })).fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="org-contributions-skeleton"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-kpis"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-content-card"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-no-company-empty-state"]')).toBeNull();
  });

  it('trims an over-cap filter selection (e.g. keyboard select-all past selectionLimit) to the cap in the form itself', async () => {
    const { fixture } = await render(null);
    const { projects, employees } = fixture.componentInstance['filterForm'].controls;
    const overCap = Array.from({ length: CONTRIBUTIONS_MAX_FILTER_VALUES + 10 }, (_, i) => `value-${i}`);

    projects.setValue(overCap);
    employees.setValue(overCap);

    expect(projects.value).toEqual(overCap.slice(0, CONTRIBUTIONS_MAX_FILTER_VALUES));
    expect(employees.value).toEqual(overCap.slice(0, CONTRIBUTIONS_MAX_FILTER_VALUES));
  });

  it('rewrites an oversized deep link to the trimmed filters so the URL matches the form and request', async () => {
    const overCap = Array.from({ length: CONTRIBUTIONS_MAX_FILTER_VALUES + 10 }, (_, i) => `value-${i}`);
    const { fixture, navigate } = await render(null, { queryParams: { projects: overCap.join(',') } });
    const capped = overCap.slice(0, CONTRIBUTIONS_MAX_FILTER_VALUES);

    expect(fixture.componentInstance['filterForm'].controls.projects.value).toEqual(capped);
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ projects: capped.join(',') }), replaceUrl: true })
    );
  });

  it('leaves an already-canonical deep link untouched on load', async () => {
    const { navigate } = await render(null, { queryParams: { projects: 'alpha,beta' } });

    expect(navigate).not.toHaveBeenCalled();
  });
});
