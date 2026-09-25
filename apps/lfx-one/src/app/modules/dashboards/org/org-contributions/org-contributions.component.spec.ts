// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { EMPTY_ORG_CONTRIBUTIONS_RESPONSE } from '@lfx-one/shared/constants';
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

async function render(state: OrgLensEmptyStateName | null, { settled = true } = {}) {
  const pageState = signal<OrgLensEmptyStateName | null>(state);
  const selectedAccount = signal<Account>({ accountId: 'acc-1', accountName: 'Acme Motors, Inc.', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });

  await TestBed.configureTestingModule({
    imports: [OrgContributionsComponent],
    providers: [
      provideRouter([]),
      MessageService,
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
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

  const fixture = TestBed.createComponent(OrgContributionsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('OrgContributionsComponent', () => {
  it('replaces the page with the contractor-no-grant state and renders none of its data sections', async () => {
    const el = await render('contractor-no-grant');

    expect(el.querySelector('[data-testid="org-contributions-no-access-state"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-kpis"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-content-card"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-no-company-empty-state"]')).toBeNull();
  });

  it('shows a skeleton instead of a blank area while the org context is still settling', async () => {
    const el = await render(null, { settled: false });

    expect(el.querySelector('[data-testid="org-contributions-skeleton"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-kpis"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-content-card"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-no-company-empty-state"]')).toBeNull();
  });
});
