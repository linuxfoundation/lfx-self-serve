// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { Account, OrgActiveMembership, OrgActiveMembershipsResponse, OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgLensMembershipsService } from '@services/org-lens-memberships.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrgMembershipsComponent } from './org-memberships.component';

function membershipRow(orgProjects: number): OrgActiveMembership {
  return {
    foundationId: 'cncf',
    foundationName: 'Cloud Native Computing Foundation (CNCF)',
    foundationSlug: 'cncf',
    foundationLogo: null,
    projectCount: 238,
    memberCount: 725,
    membershipTier: 'Silver Membership',
    tierStartDate: '2026-10-01',
    tierEndDate: '2027-09-30',
    memberSince: '2026-10-01',
    boardMembers: 0,
    committeeMembers: 0,
    orgProjects,
  };
}

function activeResponse(memberships: OrgActiveMembership[] = []): OrgActiveMembershipsResponse {
  return {
    accountId: 'acc-1',
    summary: { activeMemberships: memberships.length, renewingWithin90Days: 0, governanceRoles: 0 },
    memberships,
  };
}

async function render(memberships: OrgActiveMembership[] = []) {
  const pageState = signal<OrgLensEmptyStateName | null>(null);
  const settled = signal(true);
  const selectedAccount = signal<Account>({ accountId: 'acc-1', accountName: 'Acme Motors, Inc.', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [OrgMembershipsComponent],
    providers: [
      provideRouter([]),
      // The Org Projects side panel is a p-drawer, which binds synthetic animation listeners.
      provideNoopAnimations(),
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
          employerName: signal(null),
          pageReady: signal(true),
          settled,
          retrying: signal(false),
          retry: vi.fn(),
        },
      },
      {
        provide: OrgLensMembershipsService,
        useValue: {
          getActiveMemberships: () => of(activeResponse(memberships)),
          getExpiredMemberships: vi.fn(),
          getDiscoverOpportunities: vi.fn(),
          getFoundationProjects: () =>
            of({
              accountId: 'acc-1',
              foundationId: 'cncf',
              projects: [
                {
                  projectId: 'p-1',
                  projectSlug: 'k8s',
                  projectName: 'Kubernetes',
                  isLfProject: true,
                  influence: 'Leading',
                  maintainers: 2,
                  contributors: 9,
                  collaborators: 4,
                  commits: 120,
                },
                {
                  projectId: 'p-2',
                  projectSlug: 'envoy',
                  projectName: 'Envoy',
                  isLfProject: true,
                  influence: 'Silent',
                  maintainers: 0,
                  contributors: 1,
                  collaborators: 0,
                  commits: 3,
                },
              ],
            }),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(OrgMembershipsComponent);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, pageState, settled, selectedAccount };
}

function has(fixture: ComponentFixture<OrgMembershipsComponent>, testid: string): boolean {
  return !!fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
}

/** p-drawer renders its content outside the component tree, so the panel is looked up on the document. */
function hasInDocument(testid: string): boolean {
  return !!document.querySelector(`[data-testid="${testid}"]`);
}

/** The active-memberships fetch sits behind a 300ms debounce on the search term; wait it out, then flush. */
async function settleActiveFetch(fixture: ComponentFixture<OrgMembershipsComponent>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fixture.whenStable();
  fixture.detectChanges();
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

  it('renders a non-zero Org Projects count as a control that opens the projects side panel', async () => {
    const { fixture } = await render([membershipRow(3)]);
    await settleActiveFetch(fixture);

    const trigger = fixture.nativeElement.querySelector('[data-testid="memberships-org-projects-cncf"]') as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger!.tagName).toBe('BUTTON');
    expect(trigger!.textContent?.trim()).toBe('3');
    expect(hasInDocument('membership-projects-drawer-title')).toBe(false);

    trigger!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(hasInDocument('membership-projects-drawer-title')).toBe(true);
    expect(document.querySelector('[data-testid="membership-projects-drawer-subtitle"]')?.textContent).toContain('Cloud Native Computing Foundation (CNCF)');
  });

  it("announces the loaded project count in the panel's live region", async () => {
    const { fixture } = await render([membershipRow(3)]);
    await settleActiveFetch(fixture);

    (fixture.nativeElement.querySelector('[data-testid="memberships-org-projects-cncf"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // afterNextRender gates the real text, so the first paint is deliberately empty.
    await new Promise((resolve) => setTimeout(resolve, 50));
    fixture.detectChanges();

    const status = document.querySelector('[data-testid="membership-projects-drawer-status"]');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent?.trim()).toBe('2 projects loaded.');
  });

  it('closes the projects side panel when the selected organization changes', async () => {
    const { fixture, selectedAccount } = await render([membershipRow(3)]);
    await settleActiveFetch(fixture);

    (fixture.nativeElement.querySelector('[data-testid="memberships-org-projects-cncf"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(hasInDocument('membership-projects-drawer-title')).toBe(true);

    selectedAccount.set({ accountId: 'acc-2', accountName: 'Other Co', membershipTier: '', uid: 'org-uid-2', slug: 'other' });
    await settleActiveFetch(fixture);

    expect(hasInDocument('membership-projects-drawer-title')).toBe(false);
  });

  it('leaves a zero Org Projects count non-interactive', async () => {
    const { fixture } = await render([membershipRow(0)]);
    await settleActiveFetch(fixture);

    expect(has(fixture, 'memberships-org-projects-cncf')).toBe(false);
  });
});
