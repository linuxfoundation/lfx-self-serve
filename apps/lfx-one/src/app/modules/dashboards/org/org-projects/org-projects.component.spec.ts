// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { DEFAULT_ORG_PROJECTS_WORKSPACE_ID, DEFAULT_ORG_PROJECTS_WORKSPACE_NAME, ORG_SCOPE_PROJECTS_NOTE } from '@lfx-one/shared/constants';
import type { OrgLensEmptyStateName, OrgLensProject, OrgScopeFilter } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { OrgEditAccessService } from '@services/org-edit-access.service';
import { OrgLensOrgScopeService } from '@services/org-lens-org-scope.service';
import { OrgLensProjectsService } from '@services/org-lens-projects.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { MessageService } from 'primeng/api';
import { NEVER, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgProjectsComponent } from './org-projects.component';

describe('OrgProjectsComponent', () => {
  const pageState = signal<OrgLensEmptyStateName | null>(null);
  const pageReady = signal(true);
  const settled = signal(true);
  let fixture: ComponentFixture<OrgProjectsComponent>;

  beforeEach(async () => {
    pageState.set(null);
    pageReady.set(true);
    settled.set(true);

    await TestBed.configureTestingModule({
      imports: [OrgProjectsComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: '001Dn00000ExAmPleA', accountName: 'Acme' }) } },
        { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
        { provide: OrgEditAccessService, useValue: { canEditSelected: signal(false) } },
        // The org list never finishes loading, as for an admitted contractor with no switcher access (#2961).
        { provide: OrgNavigationService, useValue: { loaded: signal(false) } },
        { provide: OrgLensNavigationService, useValue: { orgLensLink: vi.fn(() => []) } },
        { provide: OrgLensOrgScopeService, useValue: { current: signal(null), retryFailedRead: () => undefined } },
        { provide: OrgLensProjectsService, useValue: { getWorkspaces: () => of({ workspaces: [] }), getProjects: () => NEVER } },
        {
          provide: OrgLensEmptyStateService,
          useValue: {
            pageState,
            hasPageState: computed(() => pageState() !== null),
            pageReady,
            settled,
            retrying: signal(false),
            retry: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgProjectsComponent);
  });

  function has(testid: string): boolean {
    return !!(fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testid}"]`);
  }

  function title(): string {
    return (fixture.nativeElement as HTMLElement).querySelector('[data-testid="org-projects-title"]')?.textContent ?? '';
  }

  it('shows the loading skeleton, no projects content and no organization name until the page is ready', async () => {
    pageReady.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(has('org-projects-loading')).toBe(true);
    expect(has('org-projects-table-card')).toBe(false);
    expect(title()).not.toContain('Acme');
  });

  it('renders the projects content and names the organization once the page is ready, even though the org list never loads', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(has('org-projects-table-card')).toBe(true);
    expect(has('org-projects-loading')).toBe(false);
    expect(title()).toContain('Acme');
  });

  it('replaces the projects content with the page-level state for a contractor without a grant, without naming the organization', async () => {
    pageState.set('contractor-no-grant');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(has('org-projects-no-access-state')).toBe(true);
    expect(has('org-projects-table-card')).toBe(false);
    expect(has('org-projects-loading')).toBe(false);
    expect(title()).not.toContain('Acme');
  });
});

const makeProject = (name: string, overrides: Partial<OrgLensProject> = {}): OrgLensProject => ({
  slug: name.toLowerCase(),
  name,
  logoUrl: '',
  foundation: { slug: 'cncf', name: 'CNCF', logoUrl: '' },
  health: 'excellent',
  healthOverallScore: 88,
  healthMaxScore: 100,
  healthCoveredCategoryCount: 3,
  healthMaintainer: 35,
  healthSecurity: 30,
  healthDevelopment: 23,
  technicalInfluence: 'leading',
  ecosystemInfluence: 'leading',
  influenceScore: 90,
  priorYearScore: 80,
  // An empty series renders the flat placeholder instead of a chart, which jsdom cannot draw.
  trend: { deltaPct: 0, technicalDeltaPct: 0, ecosystemDeltaPct: 0, direction: 'flat', series: [] },
  maintainers: [],
  contributors: [],
  participants: [],
  commits1y: 0,
  changeDriver: { label: 'Not calculated yet', direction: 'flat' },
  description: '',
  metricsState: 'full',
  ...overrides,
});

const UNSCORED: Partial<OrgLensProject> = {
  health: 'unavailable',
  healthOverallScore: null,
  healthMaxScore: null,
  healthMaintainer: null,
  healthSecurity: null,
  healthDevelopment: null,
};

// Badge label, accessible name and CSV cell share one rule: `*` on a partial band, never on Unavailable.
describe('OrgProjectsComponent — health label', () => {
  const PROJECTS: OrgLensProject[] = [
    // Partial, Maintainer Health uncovered: 21 of a capped 60.
    makeProject('Alpha', {
      health: 'concerning',
      healthOverallScore: 21,
      healthMaxScore: 60,
      healthCoveredCategoryCount: 2,
      healthMaintainer: null,
      healthSecurity: 12,
      healthDevelopment: 9,
    }),
    // Partial, Security & Supply Chain uncovered: 52 of a capped 65.
    makeProject('Bravo', {
      health: 'healthy',
      healthOverallScore: 52,
      healthMaxScore: 65,
      healthCoveredCategoryCount: 2,
      healthMaintainer: 30,
      healthSecurity: null,
      healthDevelopment: 22,
    }),
    makeProject('Charlie'),
    makeProject('Delta', { ...UNSCORED, healthCoveredCategoryCount: null }),
    // A stray covered count of 2 on an unscored row must not mark it.
    makeProject('Echo', { ...UNSCORED, healthCoveredCategoryCount: 2 }),
  ];
  let responseExtra: { maintainerRolesUnavailable?: true } = {};

  let fixture: ComponentFixture<OrgProjectsComponent>;
  let component: OrgProjectsComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrgProjectsComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: '001Dn00000ExAmPleA', accountName: 'Acme' }) } },
        { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
        { provide: OrgEditAccessService, useValue: { canEditSelected: signal(false) } },
        { provide: OrgNavigationService, useValue: { loaded: signal(true) } },
        { provide: OrgLensNavigationService, useValue: { orgLensLink: vi.fn(() => []) } },
        { provide: OrgLensOrgScopeService, useValue: { current: signal(null), retryFailedRead: () => undefined } },
        {
          provide: OrgLensProjectsService,
          useValue: {
            getWorkspaces: () =>
              of({
                workspaces: [
                  { id: DEFAULT_ORG_PROJECTS_WORKSPACE_ID, name: DEFAULT_ORG_PROJECTS_WORKSPACE_NAME, projectSlugs: PROJECTS.map((project) => project.slug) },
                ],
              }),
            getProjects: () => of({ orgSlug: 'acme-test', orgName: 'Acme', dataUpdatedAt: '2026-09-30T00:00:00Z', projects: PROJECTS, ...responseExtra }),
          },
        },
        {
          provide: OrgLensEmptyStateService,
          useValue: {
            pageState: signal(null),
            hasPageState: computed(() => false),
            pageReady: signal(true),
            settled: signal(true),
            retrying: signal(false),
            retry: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgProjectsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  const badge = (slug: string): HTMLElement => {
    const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-testid="org-projects-health-${slug}"]`);
    if (!el) {
      throw new Error(`no health badge rendered for ${slug}`);
    }
    return el;
  };

  // Runs exportCsv() through the real downloadCsv() and reads back the Blob it hands to the browser.
  const exportedHealthByProject = async (): Promise<Record<string, string>> => {
    let csvBlob: Blob | undefined;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      csvBlob = blob;
      return 'blob:mock-url';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    try {
      component['exportCsv']();
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }

    if (!csvBlob) {
      throw new Error('exportCsv() did not trigger a download');
    }
    // Project names and health labels carry no commas or quotes, so a plain split keeps the columns aligned.
    const [header, ...lines] = (await csvBlob.text()).split('\r\n').map((line) => line.split(','));
    const nameColumn = header.indexOf('Project');
    const healthColumn = header.indexOf('Health Score');
    return Object.fromEntries(lines.map((cells) => [cells[nameColumn], cells[healthColumn]]));
  };

  it.each([
    { case: 'glues an asterisk to the band of a partial Concerning score', name: 'Alpha', label: 'Concerning*' },
    { case: 'glues an asterisk to the band of a partial Healthy score', name: 'Bravo', label: 'Healthy*' },
    { case: 'leaves a full score as the bare band', name: 'Charlie', label: 'Excellent' },
    { case: 'shows Unavailable for an unscored project', name: 'Delta', label: 'Unavailable' },
    { case: 'never marks Unavailable, even with a covered count of 2', name: 'Echo', label: 'Unavailable' },
  ])('healthLabelFor $case', ({ name, label }) => {
    const project = PROJECTS.find((p) => p.name === name) as OrgLensProject;

    expect(component['healthLabelFor'](project)).toBe(label);
  });

  it('healthLabelFor never marks an out-of-enum band, even with a covered count of 2', () => {
    expect(component['healthLabelFor'](makeProject('Foxtrot', { health: 'bogus' as never, healthCoveredCategoryCount: 2 }))).toBe('Unavailable');
  });

  it('renders the same label on the badge, and spells a partial score out in its accessible name', () => {
    expect(badge('alpha').textContent?.trim()).toBe('Concerning*');
    expect(badge('alpha').getAttribute('aria-label')).toBe(
      'Health: Concerning, partial score (21/60). Maintainer Health -/40, Security & Supply Chain 12/35, Development Activity 9/25.'
    );
    expect(badge('charlie').textContent?.trim()).toBe('Excellent');
    expect(badge('charlie').getAttribute('aria-label')).toBe(
      'Health: Excellent (88/100). Maintainer Health 35/40, Security & Supply Chain 30/35, Development Activity 23/25.'
    );
    ['delta', 'echo'].forEach((slug) => {
      expect(badge(slug).textContent?.trim()).toBe('Unavailable');
      expect(badge(slug).getAttribute('aria-label')).toBe('Health: Unavailable.');
    });
  });

  it('exports the badge label in the Health Score column', async () => {
    const exported = await exportedHealthByProject();

    expect(exported).toEqual({ Alpha: 'Concerning*', Bravo: 'Healthy*', Charlie: 'Excellent', Delta: 'Unavailable', Echo: 'Unavailable' });
    expect(exported).toEqual(Object.fromEntries(PROJECTS.map((project) => [project.name, badge(project.slug).textContent?.trim()])));
  });

  it('notes that maintainer data is unavailable only when the response flags it', async () => {
    const note = (): Element | null => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="org-projects-maintainer-roles-unavailable"]');
    expect(note()).toBeNull();

    responseExtra = { maintainerRolesUnavailable: true };
    try {
      component['reload'].update((n: number) => n + 1);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(note()?.textContent).toContain('Maintainer data is currently unavailable');
      // The Employees filter still works off contributors and participants.
      expect(component['employeeOptions']()).toEqual([]);
    } finally {
      responseExtra = {};
    }
  });
});

describe('OrgProjectsComponent — Employees filter', () => {
  const ORG_A = { uid: 'org-a', accountName: 'Org A' };
  const ORG_B = { uid: 'org-b', accountName: 'Org B' };
  const PROJECTS_BY_ORG: Record<string, OrgLensProject[]> = {
    [ORG_A.uid]: [
      makeProject('Alpha', { contributors: [{ id: 'p-known', name: 'Known Person', avatarUrl: '' }] }),
      makeProject('Bravo', { participants: [{ id: 'p-other', name: 'Other Person', avatarUrl: '' }] }),
      makeProject('Charlie', { foundation: { slug: 'other-foundation', name: 'Other Foundation', logoUrl: '' } }),
    ],
    [ORG_B.uid]: [makeProject('Delta', { contributors: [{ id: 'p-org-b', name: 'Org B Person', avatarUrl: '' }] }), makeProject('Echo')],
  };
  const selectedAccount = signal<{ uid: string; accountName: string } | null>(ORG_A);

  let fixture: ComponentFixture<OrgProjectsComponent>;
  let component: OrgProjectsComponent;
  let router: Router;

  /** Loads the page from `url`, the way a shared deep link opens it. */
  const open = async (url: string): Promise<void> => {
    router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    fixture = TestBed.createComponent(OrgProjectsComponent);
    component = fixture.componentInstance;
    await settle();
  };

  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const rowNames = (): string[] => component['sortedProjects']().map((p) => p.name);
  const queryParams = (): Record<string, string> => router.parseUrl(router.url).queryParams;

  // Runs exportCsv() through the real downloadCsv() and returns the exported project names.
  const exportedProjectNames = async (): Promise<string[]> => {
    let csvBlob: Blob | undefined;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      csvBlob = blob;
      return 'blob:mock-url';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      component['exportCsv']();
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
    if (!csvBlob) {
      throw new Error('exportCsv() did not trigger a download');
    }
    const [, ...lines] = (await csvBlob.text()).split('\r\n');
    return lines.map((line) => line.split(',')[0]);
  };

  const requestedScopes: OrgScopeFilter[] = [];

  beforeEach(async () => {
    requestedScopes.length = 0;
    selectedAccount.set(ORG_A);
    await TestBed.configureTestingModule({
      imports: [OrgProjectsComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        // `selectedUrlSegment` / `isAddressedSelection` serve the real OrgLensNavigationService in the routed switch test.
        {
          provide: AccountContextService,
          useValue: { selectedAccount, selectedUrlSegment: computed(() => selectedAccount()?.uid ?? null), isAddressedSelection: signal(true) },
        },
        { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
        { provide: OrgEditAccessService, useValue: { canEditSelected: signal(false) } },
        { provide: OrgNavigationService, useValue: { loaded: signal(true) } },
        { provide: OrgLensNavigationService, useValue: { orgLensLink: vi.fn(() => []) } },
        { provide: OrgLensOrgScopeService, useValue: { current: signal(null), retryFailedRead: () => undefined } },
        {
          provide: OrgLensProjectsService,
          useValue: {
            getWorkspaces: (accountUid: string) =>
              of({
                workspaces: [
                  {
                    id: DEFAULT_ORG_PROJECTS_WORKSPACE_ID,
                    name: DEFAULT_ORG_PROJECTS_WORKSPACE_NAME,
                    projectSlugs: PROJECTS_BY_ORG[accountUid].map((project) => project.slug),
                  },
                  // Every project but the first, so for Org A it leaves out the only project listing `p-known`.
                  { id: 'ws-rest', name: 'Rest', projectSlugs: PROJECTS_BY_ORG[accountUid].slice(1).map((project) => project.slug) },
                ],
              }),
            getProjects: (accountUid: string, accountName: string, slugs: string[], orgScope: OrgScopeFilter) => {
              requestedScopes.push(orgScope);
              return of({
                orgSlug: accountUid,
                orgName: accountName,
                dataUpdatedAt: '2026-09-30T00:00:00Z',
                projects: PROJECTS_BY_ORG[accountUid].filter((project) => slugs.includes(project.slug)),
              });
            },
          },
        },
        {
          provide: OrgLensEmptyStateService,
          useValue: {
            pageState: signal(null),
            hasPageState: computed(() => false),
            pageReady: signal(true),
            settled: signal(true),
            retrying: signal(false),
            retry: vi.fn(),
          },
        },
      ],
    }).compileComponents();
  });

  it('shows every project with no employees selected', async () => {
    await open('/');

    expect(rowNames()).toEqual(expect.arrayContaining(['Alpha', 'Bravo', 'Charlie']));
    expect(component['totalRecords']()).toBe(3);
  });

  it('opens a link with only an unknown employee on the explained empty state, with Export disabled', async () => {
    await open('/?employees=p-unknown');

    expect(rowNames()).toEqual([]);
    const page = fixture.nativeElement as HTMLElement;
    expect(page.textContent).toContain('No results for filters');
    expect(page.querySelector('[data-testid="org-projects-export-csv"] button')?.hasAttribute('disabled')).toBe(true);
  });

  it('opens a link with a known and an unknown employee on the known person’s projects only, in the table and the CSV', async () => {
    await open('/?employees=p-known,p-unknown');

    expect(rowNames()).toEqual(['Alpha']);
    expect(await exportedProjectNames()).toEqual(['Alpha']);
  });

  it('offers an unknown selected employee under their id so the picker can show and remove them', async () => {
    await open('/?employees=p-known,p-unknown');

    expect(component['employeeOptions']()).toEqual(expect.arrayContaining([{ value: 'p-unknown', label: 'p-unknown' }]));

    component['filterForm'].controls.employees.setValue(['p-known']);
    await settle();

    expect(component['employeeOptions']()).not.toContainEqual(expect.objectContaining({ value: 'p-unknown' }));
    expect(queryParams()['employees']).toBe('p-known');
  });

  it('keeps the last-seen name of a selected employee the current workspace does not list', async () => {
    await open('/?employees=p-known');

    component['selectWorkspace']('ws-rest');
    await settle();

    expect(rowNames()).toEqual([]);
    expect(component['employeeOptions']()).toContainEqual({ value: 'p-known', label: 'Known Person' });
  });

  // The org selector switches the account, then re-addresses the page through the real navigation service.
  it.each([
    { mount: 'legacy', url: '/org/projects?employees=p-known&utm_source=x' },
    { mount: 'organization-addressed', url: '/org/org-a/projects?employees=p-known&utm_source=x' },
  ])('strips ?employees= when switching organization from the $mount address, and shows the new org’s projects', async ({ url }) => {
    TestBed.overrideProvider(OrgLensNavigationService, { useFactory: () => new OrgLensNavigationService() });
    TestBed.inject(Router).resetConfig([
      { path: 'org/projects', component: OrgProjectsComponent },
      { path: 'org/:orgSegment/projects', component: OrgProjectsComponent },
    ]);
    const harness = await RouterTestingHarness.create(url);
    router = TestBed.inject(Router);
    let page = harness.routeDebugElement?.componentInstance as OrgProjectsComponent;
    expect(page['sortedProjects']().map((p) => p.name)).toEqual(['Alpha']);

    selectedAccount.set(ORG_B);
    TestBed.inject(OrgLensNavigationService).navigateToSelectedOrg('switch');
    await harness.fixture.whenStable();
    harness.detectChanges();
    await harness.fixture.whenStable();

    // The legacy address re-mounts the page under the addressed route, so read the instance again.
    page = harness.routeDebugElement?.componentInstance as OrgProjectsComponent;
    expect(router.url).toBe('/org/org-b/projects?utm_source=x');
    expect(page['filterForm'].controls.employees.value).toEqual([]);
    const names = page['sortedProjects']().map((p) => p.name);
    expect(names.sort()).toEqual(['Delta', 'Echo']);
  });

  it('clears the Employees selection, in the form and the URL, when the organization changes', async () => {
    await open('/?employees=p-known');
    expect(rowNames()).toEqual(['Alpha']);

    selectedAccount.set(ORG_B);
    await settle();

    expect(component['filterForm'].controls.employees.value).toEqual([]);
    expect(queryParams()['employees']).toBeUndefined();
    expect(rowNames()).toEqual(expect.arrayContaining(['Delta', 'Echo']));
  });

  it('does not restore the selection on Back across an organization switch', async () => {
    await open('/?employees=p-known');
    selectedAccount.set(ORG_B);
    await settle();

    // Back: the router returns to org A's pre-switch entry, still carrying its `?employees=`.
    await router.navigateByUrl('/?employees=p-known');
    selectedAccount.set(ORG_A);
    await settle();

    expect(component['filterForm'].controls.employees.value).toEqual([]);
    expect(queryParams()['employees']).toBeUndefined();
    expect(rowNames()).toEqual(expect.arrayContaining(['Alpha', 'Bravo', 'Charlie']));
  });

  it('keeps a deep-linked selection when the organization resolves after the page starts', async () => {
    selectedAccount.set(null);
    await open('/?employees=p-known');

    selectedAccount.set(ORG_A);
    await settle();

    expect(component['filterForm'].controls.employees.value).toEqual(['p-known']);
    expect(queryParams()['employees']).toBe('p-known');
    expect(rowNames()).toEqual(['Alpha']);
  });

  it.each([
    { case: 'writes a filter change once the pending navigation settles', destroy: false },
    { case: 'drops a filter change still waiting on a navigation when the page is destroyed', destroy: true },
  ])('$case', async ({ destroy }) => {
    await open('/');
    const navigate = vi.spyOn(router, 'navigate');

    const pending = router.navigateByUrl('/?elsewhere=1');
    expect(router.getCurrentNavigation()).not.toBeNull();
    component['filterForm'].controls.employees.setValue(['p-known']);
    if (destroy) fixture.destroy();
    await pending;
    await new Promise((resolve) => setTimeout(resolve));

    if (destroy) {
      expect(navigate).not.toHaveBeenCalled();
    } else {
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(queryParams()).toEqual({ elsewhere: '1', employees: 'p-known' });
    }
  });

  it('Reset filters clears the employees, foundation, workspace and page params from the URL in one go', async () => {
    await open('/?employees=p-unknown&foundation=cncf&workspace=ws-gone&page=2');

    component['resetFilters']();
    await settle();

    expect(queryParams()).toEqual({});
    expect(component['filterForm'].getRawValue().employees).toEqual([]);
    expect(rowNames()).toEqual(expect.arrayContaining(['Alpha', 'Bravo', 'Charlie']));
  });

  // lfx-self-serve-ops#1219 — a project's detail links keep All related organizations picked on another page.
  it('carries ?orgScope=all onto the project detail and contributors-drawer links, and nothing at the default', async () => {
    await open('/?orgScope=all');
    expect(component['projectDetailQueryParams']()).toEqual({ orgScope: 'all' });
    expect(component['contributorsDrawerQueryParams']()).toEqual({ orgScope: 'all', card: 'contributors' });
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('a[aria-label="View Alpha project detail"]');
    expect(link?.getAttribute('href')).toContain('orgScope=all');

    await router.navigateByUrl('/?orgScope=insights');
    await settle();
    expect(component['projectDetailQueryParams']()).toEqual({});
  });

  it('asks for the scope in the address, re-reads on a pick, and says the pick changes the Contributors column only', async () => {
    await open('/');
    expect(requestedScopes.at(-1)).toBe('insights');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-test="org-projects-org-scope-filter"]')).not.toBeNull();
    expect(component['orgScopeNote']).toBe(ORG_SCOPE_PROJECTS_NOTE);

    component['scopeForm'].controls.orgScope.setValue('all');
    await settle();
    expect(requestedScopes.at(-1)).toBe('all');
    expect(router.url).toContain('orgScope=all');

    await router.navigateByUrl('/?orgScope=insights');
    await settle();
    expect(requestedScopes.at(-1)).toBe('insights');
  });

  it('starts again on page 1 when the organization scope is picked, keeping the Employees filter', async () => {
    await open('/?employees=p-known&page=2');

    component['scopeForm'].controls.orgScope.setValue('all');
    await settle();

    expect(queryParams()).toEqual({ employees: 'p-known', orgScope: 'all' });
  });

  // lfx-self-serve#4735: the organization scope sits behind "More filters".
  it('keeps the organization scope behind More filters, counted from the address, and Reset filters clears it', async () => {
    await open('/?orgScope=all&employees=p-known');
    const el = fixture.nativeElement as HTMLElement;
    const toggle = (): HTMLButtonElement => el.querySelector('[data-testid="org-projects-more-filters-toggle"]')!;
    const panel = (): HTMLElement => el.querySelector('#org-projects-more-filters')!;

    expect(panel().classList).toContain('hidden');
    expect(panel().querySelector('[data-test="org-projects-org-scope-filter"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-projects-toolbar"] [data-test="org-projects-org-scope-filter"]')).toBeNull();
    expect(toggle().getAttribute('aria-controls')).toBe('org-projects-more-filters');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent?.trim()).toBe('More filters (1)');

    toggle().click();
    await settle();
    expect(panel().classList).not.toContain('hidden');
    expect(toggle().textContent?.trim()).toBe('Fewer filters');

    component['resetFilters']();
    await settle();
    expect(queryParams()).toEqual({});
    expect(component['scopeForm'].controls.orgScope.value).toBe('insights');
    toggle().click();
    await settle();
    expect(toggle().textContent?.trim()).toBe('More filters');
  });
});
