// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { EMPTY_ORG_CERTIFICATIONS_RESPONSE, EMPTY_ORG_TRAININGS_RESPONSE } from '@lfx-one/shared/constants';
import type { Account, OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgLensEmptyStateService } from '@shared/services/org-lens-empty-state.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { OrgRoleGrantsService } from '@shared/services/org-role-grants.service';
import { PersonDetailDrawerService } from '@shared/services/person-detail-drawer.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrgTrainingComponent } from './org-training.component';

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
    imports: [OrgTrainingComponent],
    providers: [
      provideRouter([]),
      MessageService,
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) }, queryParamMap: of(convertToParamMap({})) } },
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
      {
        provide: OrgLensTrainingService,
        useValue: {
          getTrainingStats: () => of(null),
          getOrgCertifications: () => of(EMPTY_ORG_CERTIFICATIONS_RESPONSE),
          getOrgTrainings: () => of(EMPTY_ORG_TRAININGS_RESPONSE),
        },
      },
      { provide: PersonDetailDrawerService, useValue: personDrawerStub() },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(OrgTrainingComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('OrgTrainingComponent', () => {
  it('replaces the page with the contractor-no-grant state and renders none of its data sections or the org name', async () => {
    const el = await render('contractor-no-grant');

    expect(el.querySelector('[data-testid="org-training-no-access-state"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-training-stats"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-training-content-card"]')).toBeNull();
    expect(el.textContent).not.toContain('Acme Motors, Inc.');
  });

  it('shows a skeleton instead of a blank area while the org context is still settling, without naming the org', async () => {
    const el = await render(null, { settled: false });

    expect(el.querySelector('[data-testid="org-training-skeleton"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-training-stats"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-training-content-card"]')).toBeNull();
    expect(el.textContent).not.toContain('Acme Motors, Inc.');
  });
});
