// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ORG_LENS_FOUNDATIONS_EMPTY_RESPONSE } from '@lfx-one/shared/constants';
import type { Account, OrgLensFoundationProject, OrgLensFoundationsAndProjectsResponse } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensFoundationsService } from '@services/org-lens-foundations.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { PlausibleService } from '@services/plausible.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FoundationRowComponent } from './components/foundation-row.component';
import { FoundationsStatStripComponent } from './components/foundations-stat-strip.component';
import { OrgOverviewFoundationsAndProjectsComponent } from './org-overview-foundations-and-projects.component';

function project(projectId: string, overrides: Partial<OrgLensFoundationProject> = {}): OrgLensFoundationProject {
  return {
    projectId,
    projectSlug: projectId,
    projectName: projectId,
    isLfProject: true,
    influence: 'Leading',
    maintainers: 2,
    contributors: 9,
    collaborators: 4,
    commits: 120,
    ...overrides,
  };
}

function response(projects: OrgLensFoundationProject[]): OrgLensFoundationsAndProjectsResponse {
  return {
    ...ORG_LENS_FOUNDATIONS_EMPTY_RESPONSE,
    accountId: 'acc-1',
    accountName: 'Acme Motors',
    rows: [
      {
        foundationId: 'cncf',
        foundationSlug: 'cncf',
        foundationName: 'CNCF',
        foundationLogoUrl: null,
        rowKind: 'member',
        membershipTierClass: 'Platinum',
        membershipTierDisplayName: 'Platinum Membership',
        projectCount: projects.length,
        badges: { orgRole: 'Member', votingStatus: 'Voting', governanceParticipation: 'Active', governanceAttendancePct: 1 },
        projects,
      },
    ],
  };
}

async function render(projects: OrgLensFoundationProject[]): Promise<ComponentFixture<OrgOverviewFoundationsAndProjectsComponent>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [OrgOverviewFoundationsAndProjectsComponent],
    providers: [
      provideRouter([]),
      {
        provide: AccountContextService,
        useValue: { selectedAccount: signal<Account>({ accountId: 'acc-1', accountName: 'Acme Motors', membershipTier: '', uid: 'org-uid-1', slug: 'acme' }) },
      },
      { provide: OrgLensFoundationsService, useValue: { getFoundationsAndProjects: () => of(response(projects)) } },
      { provide: OrgLensNavigationService, useValue: { orgLensLink: (...segments: string[]) => ['/org', ...segments] } },
      { provide: PlausibleService, useValue: { trackEvent: vi.fn() } },
    ],
  }).compileComponents();
  // The foundation row and stat strip are not under test; only the expanded project table is.
  TestBed.overrideComponent(OrgOverviewFoundationsAndProjectsComponent, {
    remove: { imports: [FoundationRowComponent, FoundationsStatStripComponent] },
    add: { schemas: [NO_ERRORS_SCHEMA] },
  });

  const fixture = TestBed.createComponent(OrgOverviewFoundationsAndProjectsComponent);
  await fixture.whenStable();
  (fixture.componentInstance as unknown as { toggleExpansion: (foundationId: string) => void }).toggleExpansion('cncf');
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

describe('OrgOverviewFoundationsAndProjectsComponent maintainer roles (lfx-self-serve#4482)', () => {
  it('shows LF maintainer roles per project, and a dash, not zero, for unavailable roles or a non-LF project', async () => {
    const fixture = await render([
      project('k8s', { maintainers: 1234 }),
      project('envoy', { maintainers: 0 }),
      project('unavailable', { maintainers: null }),
      project('non-lf', { isLfProject: false, maintainers: 0 }),
    ]);
    const maintainers = (projectId: string): string =>
      (fixture.nativeElement as HTMLElement)
        .querySelector(`[data-testid="org-overview-foundations-and-projects-project-${projectId}-maintainers"]`)
        ?.textContent?.trim() ?? '';

    expect(maintainers('k8s')).toBe('1,234');
    expect(maintainers('envoy')).toBe('0');
    expect(maintainers('unavailable')).toBe('—');
    expect(maintainers('non-lf')).toBe('—');
  });
});

describe('OrgOverviewFoundationsAndProjectsComponent project navigation (lfx-self-serve-ops#1219)', () => {
  interface Rows {
    onProjectRowClick: (row: OrgLensFoundationProject) => void;
    onProjectRowKeydown: (event: KeyboardEvent, row: OrgLensFoundationProject) => void;
  }

  async function navigateFrom(url: string, open: (component: Rows, row: OrgLensFoundationProject) => void) {
    const fixture = await render([project('k8s')]);
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    open(fixture.componentInstance as unknown as Rows, project('k8s'));
    return navigate;
  }

  it('carries ?orgScope=all to the project, by click and by keyboard', async () => {
    const clicked = await navigateFrom('/?orgScope=all', (component, row) => component.onProjectRowClick(row));
    expect(clicked).toHaveBeenCalledWith(['/org', 'projects', 'k8s'], { queryParams: { orgScope: 'all' } });

    const keyed = await navigateFrom('/?orgScope=all', (component, row) => component.onProjectRowKeydown(new KeyboardEvent('keydown', { key: 'Enter' }), row));
    expect(keyed).toHaveBeenCalledWith(['/org', 'projects', 'k8s'], { queryParams: { orgScope: 'all' } });
  });

  it('sends no orgScope from the default or an unknown value', async () => {
    for (const url of ['/', '/?orgScope=insights', '/?orgScope=bogus']) {
      const navigate = await navigateFrom(url, (component, row) => component.onProjectRowClick(row));
      expect(navigate).toHaveBeenCalledWith(['/org', 'projects', 'k8s'], { queryParams: {} });
    }
  });
});
