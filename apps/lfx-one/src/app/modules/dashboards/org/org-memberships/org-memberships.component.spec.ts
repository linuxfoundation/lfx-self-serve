// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Account, OrgActiveMembershipsResponse, OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgLensMembershipsService } from '@services/org-lens-memberships.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrgMembershipsComponent } from './org-memberships.component';

function activeResponse(): OrgActiveMembershipsResponse {
  return { accountId: 'acc-1', summary: { activeMemberships: 0, renewingWithin90Days: 0, governanceRoles: 0 }, memberships: [] };
}

async function render() {
  const pageState = signal<OrgLensEmptyStateName | null>(null);
  const settled = signal(true);
  const selectedAccount = signal<Account>({ accountId: 'acc-1', accountName: 'Acme Motors, Inc.', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [OrgMembershipsComponent],
    providers: [
      provideRouter([]),
      // lfxOpenIntercom (the empty state's contact-support link) injects the app-root MessageService.
      MessageService,
      { provide: AccountContextService, useValue: { selectedAccount } },
      { provide: OrgLensNavigationService, useValue: { orgLensLink: (...segments: string[]) => ['/org', ...segments] } },
      { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
      {
        provide: OrgLensEmptyStateService,
        useValue: {
          pageState,
          hasPageState: computed(() => pageState() !== null),
          pageReady: signal(true),
          settled,
          retrying: signal(false),
          retry: vi.fn(),
        },
      },
      {
        provide: OrgLensMembershipsService,
        useValue: { getActiveMemberships: () => of(activeResponse()), getExpiredMemberships: vi.fn(), getDiscoverOpportunities: vi.fn() },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(OrgMembershipsComponent);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, pageState, settled };
}

function has(fixture: ComponentFixture<OrgMembershipsComponent>, testid: string): boolean {
  return !!fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
}

describe('OrgMembershipsComponent', () => {
  it('replaces the whole page, organization-naming title included, with the contractor-no-grant state', async () => {
    const { fixture, pageState } = await render();
    expect(has(fixture, 'memberships-page-title')).toBe(true);

    pageState.set('contractor-no-grant');
    fixture.detectChanges();

    expect(has(fixture, 'org-memberships-no-access-state')).toBe(true);
    expect(has(fixture, 'memberships-page-title')).toBe(false);
    expect(has(fixture, 'active-memberships-summary')).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Acme Motors');
  });

  it('shows a skeleton, and no organization-naming content, while the classifier is settling', async () => {
    const { fixture, settled } = await render();

    settled.set(false);
    fixture.detectChanges();

    expect(has(fixture, 'memberships-skeleton')).toBe(true);
    expect(has(fixture, 'memberships-page-title')).toBe(false);
    expect(has(fixture, 'memberships-tab-bar')).toBe(false);
    expect(has(fixture, 'active-memberships-summary')).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Acme Motors');
  });
});
