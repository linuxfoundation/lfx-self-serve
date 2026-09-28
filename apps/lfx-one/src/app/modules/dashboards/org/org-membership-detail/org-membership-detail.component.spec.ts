// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { Account, OrgLensEmptyStateName, OrgMembershipDetailResponse } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgLensMembershipsService } from '@services/org-lens-memberships.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrgMembershipDetailComponent } from './org-membership-detail.component';

function detailResponse(): OrgMembershipDetailResponse {
  return {
    foundation: {
      foundationId: 'f-1',
      foundationName: 'Cloud Native Computing Foundation',
      foundationLogo: null,
      membershipTier: 'Platinum',
      tierStartDate: '2024-01-01',
      tierEndDate: '2025-01-01',
      memberSince: '2020-01-01',
      status: 'active',
    },
    keyContacts: [],
  };
}

// <lfx-person-detail-drawer /> is unconditionally mounted and reads this full signal surface.
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

async function render() {
  const pageState = signal<OrgLensEmptyStateName | null>(null);
  const selectedAccount = signal<Account>({ accountId: 'acc-1', accountName: 'Acme Motors, Inc.', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [OrgMembershipDetailComponent],
    providers: [
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { fragment: null }, fragment: of(null), paramMap: of(convertToParamMap({ foundationSlug: 'cncf' })) },
      },
      { provide: AccountContextService, useValue: { selectedAccount } },
      { provide: OrgLensNavigationService, useValue: { orgLensLink: (...segments: string[]) => ['/org', ...segments] } },
      { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null), editorSet: signal(new Set<string>()) } },
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
      { provide: OrgLensMembershipsService, useValue: { getMembershipDetail: () => of(detailResponse()) } },
      { provide: PersonDetailDrawerService, useValue: personDrawerStub() },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(OrgMembershipDetailComponent);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, pageState };
}

function has(fixture: ComponentFixture<OrgMembershipDetailComponent>, testid: string): boolean {
  return !!fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
}

describe('OrgMembershipDetailComponent', () => {
  it('replaces the membership detail with the contractor-no-grant state', async () => {
    const { fixture, pageState } = await render();
    expect(has(fixture, 'membership-detail-foundation-name')).toBe(true);

    pageState.set('contractor-no-grant');
    fixture.detectChanges();

    expect(has(fixture, 'org-membership-detail-no-access-state')).toBe(true);
    expect(has(fixture, 'membership-detail-foundation-name')).toBe(false);
    expect(has(fixture, 'membership-detail-back-link')).toBe(false);
    expect(has(fixture, 'membership-detail-loading')).toBe(false);
  });
});
