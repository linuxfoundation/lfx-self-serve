// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { Account, OrgActiveMembership, OrgActiveMembershipsResponse, OrgLensEmptyStateName, OrgMembershipProject } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgLensMembershipsService } from '@services/org-lens-memberships.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrgMembershipsComponent } from './org-memberships.component';

const ROLL_UP = 'family-001000000000000AAA';
const PARENT_ORG = { accountId: '001000000000000AAA', name: 'Parent Co' };
const SUBSIDIARY_ORG = { accountId: '001000000000001AAA', name: 'Subsidiary Co' };

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

function project(projectId: string, projectSlug: string, overrides: Partial<OrgMembershipProject> = {}): OrgMembershipProject {
  return {
    projectId,
    projectSlug,
    projectName: projectSlug,
    isLfProject: true,
    influence: 'Leading',
    maintainers: 2,
    contributors: 9,
    collaborators: 4,
    commits: 120,
    ...overrides,
  };
}

const DEFAULT_PROJECTS: OrgMembershipProject[] = [
  project('p-1', 'k8s', { projectName: 'Kubernetes' }),
  project('p-2', 'envoy', { projectName: 'Envoy', influence: 'Silent', maintainers: 0, contributors: 1, collaborators: 0, commits: 3 }),
];

interface RenderOptions {
  rollUp?: { response: OrgActiveMembershipsResponse };
}

async function render(memberships: OrgActiveMembership[] = [], projects: OrgMembershipProject[] = DEFAULT_PROJECTS, options: RenderOptions = {}) {
  const pageState = signal<OrgLensEmptyStateName | null>(null);
  const settled = signal(true);
  const selectedAccount = signal<Account>(
    options.rollUp
      ? { accountId: ROLL_UP, accountName: 'All Parent Co Organizations', membershipTier: '', uid: ROLL_UP, slug: null }
      : { accountId: 'acc-1', accountName: 'Acme Motors, Inc.', membershipTier: '', uid: 'org-uid-1', slug: 'acme' }
  );
  const isRollUp = signal(!!options.rollUp);
  const getActiveMemberships = vi.fn(() => of(options.rollUp?.response ?? activeResponse(memberships)));
  const getFoundationProjects = vi.fn(() => of({ accountId: 'acc-1', foundationId: 'cncf', projects }));

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [OrgMembershipsComponent],
    providers: [
      provideRouter([]),
      // The Org Projects side panel is a p-drawer, which binds synthetic animation listeners.
      provideNoopAnimations(),
      // The empty state no longer carries a support link (#5447); MessageService stays provided for the page's other controls.
      MessageService,
      { provide: AccountContextService, useValue: { selectedAccount, isRollUp } },
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
        useValue: {
          getActiveMemberships,
          getExpiredMemberships: vi.fn(),
          getDiscoverOpportunities: vi.fn(),
          getFoundationProjects,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(OrgMembershipsComponent);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, pageState, settled, selectedAccount, getActiveMemberships, getFoundationProjects };
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

async function openProjectsPanel(fixture: ComponentFixture<OrgMembershipsComponent>): Promise<void> {
  (fixture.nativeElement.querySelector('[data-testid="memberships-org-projects-cncf"]') as HTMLButtonElement).click();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function maintainerRolesText(projectSlug: string): string {
  return document.querySelector(`[data-testid="membership-project-${projectSlug}-maintainer-roles"] > span`)?.textContent?.trim() ?? '';
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

  it('shows LF maintainer roles per project, and a dash, not zero, for unavailable roles or a non-LF project (lfx-self-serve#4482)', async () => {
    const { fixture } = await render(
      [membershipRow(3)],
      [
        project('p-1', 'k8s', { maintainers: 1234 }),
        project('p-2', 'envoy', { maintainers: 0 }),
        project('p-3', 'unavailable', { maintainers: null }),
        project('p-4', 'non-lf', { isLfProject: false, maintainers: 0 }),
      ]
    );
    await settleActiveFetch(fixture);
    await openProjectsPanel(fixture);

    expect(maintainerRolesText('k8s')).toBe('1,234');
    expect(maintainerRolesText('envoy')).toBe('0');
    expect(maintainerRolesText('unavailable')).toBe('—');
    expect(maintainerRolesText('non-lf')).toBe('—');
  });
  describe('in a family roll-up', () => {
    function rollUpResponse(): OrgActiveMembershipsResponse {
      const row = membershipRow(3);
      return {
        accountId: ROLL_UP,
        summary: { activeMemberships: 2, renewingWithin90Days: 1, governanceRoles: 5 },
        memberships: [
          { ...row, organization: PARENT_ORG },
          { ...row, membershipTier: 'Gold Membership', organization: SUBSIDIARY_ORG },
        ],
        organizations: [PARENT_ORG, SUBSIDIARY_ORG],
      };
    }

    it('adds a Company column naming each row’s organization, and a Company filter', async () => {
      const { fixture } = await render([], DEFAULT_PROJECTS, { rollUp: { response: rollUpResponse() } });
      await settleActiveFetch(fixture);

      expect(has(fixture, 'memberships-active-company-header')).toBe(true);
      expect(has(fixture, 'memberships-company-filter')).toBe(true);
      const cell = (org: { accountId: string }) =>
        fixture.nativeElement.querySelector(`[data-testid="memberships-active-company-cncf-${org.accountId}"]`)?.textContent?.trim();
      expect(cell(PARENT_ORG)).toBe('Parent Co');
      expect(cell(SUBSIDIARY_ORG)).toBe('Subsidiary Co');
    });

    it('titles the page with the roll-up’s name', async () => {
      const { fixture } = await render([], DEFAULT_PROJECTS, { rollUp: { response: rollUpResponse() } });

      expect(fixture.nativeElement.querySelector('[data-testid="memberships-page-title"]')?.textContent).toContain('Membership — All Parent Co Organizations');
    });

    it('shows the server’s cards for the filtered rows', async () => {
      const { fixture } = await render([], DEFAULT_PROJECTS, { rollUp: { response: rollUpResponse() } });
      await settleActiveFetch(fixture);

      const stat = (testid: string) => fixture.nativeElement.querySelector(`[data-testid="${testid}"] p`)?.textContent?.trim();
      expect(stat('memberships-stat-active')).toBe('2');
      expect(stat('memberships-stat-renewing')).toBe('1');
      expect(stat('memberships-stat-governance')).toBe('5');
    });

    it('sends the chosen company with the Active read, and clears it on a switch to another selection', async () => {
      const { fixture, getActiveMemberships, selectedAccount } = await render([], DEFAULT_PROJECTS, { rollUp: { response: rollUpResponse() } });
      await settleActiveFetch(fixture);

      (fixture.componentInstance as unknown as { companyFilterForm: FormGroup }).companyFilterForm.controls['company'].setValue(SUBSIDIARY_ORG.accountId);
      await settleActiveFetch(fixture);
      expect(getActiveMemberships).toHaveBeenLastCalledWith(ROLL_UP, expect.objectContaining({ company: SUBSIDIARY_ORG.accountId }));

      selectedAccount.set({
        accountId: 'family-001000000000009AAA',
        accountName: 'All Other Organizations',
        membershipTier: '',
        uid: 'family-001000000000009AAA',
        slug: null,
      });
      await settleActiveFetch(fixture);
      expect(getActiveMemberships).toHaveBeenLastCalledWith('family-001000000000009AAA', expect.objectContaining({ company: undefined }));
    });

    it('links each row to its own organization’s membership page, leaving the roll-up', async () => {
      const { fixture } = await render([], DEFAULT_PROJECTS, { rollUp: { response: rollUpResponse() } });
      await settleActiveFetch(fixture);

      const hrefs = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="memberships-active-row-link-cncf"]') as NodeListOf<HTMLAnchorElement>).map(
        (a) => (a as HTMLAnchorElement).getAttribute('href')
      );
      expect(hrefs).toEqual([`/org/${PARENT_ORG.accountId}/memberships/cncf`, `/org/${SUBSIDIARY_ORG.accountId}/memberships/cncf`]);
    });

    it('opens the Org Projects panel for the row’s own organization', async () => {
      const { fixture, getFoundationProjects } = await render([], DEFAULT_PROJECTS, { rollUp: { response: rollUpResponse() } });
      await settleActiveFetch(fixture);

      const triggers = fixture.nativeElement.querySelectorAll('[data-testid="memberships-org-projects-cncf"]');
      (triggers[1] as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(getFoundationProjects).toHaveBeenCalledWith(SUBSIDIARY_ORG.accountId, 'cncf');
    });

    it('shows no Company column or filter for a single organization', async () => {
      const { fixture } = await render([membershipRow(3)]);
      await settleActiveFetch(fixture);

      expect(has(fixture, 'memberships-active-company-header')).toBe(false);
      expect(has(fixture, 'memberships-company-filter')).toBe(false);
    });
  });
});
