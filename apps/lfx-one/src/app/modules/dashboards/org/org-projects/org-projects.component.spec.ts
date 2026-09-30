// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { DEFAULT_ORG_PROJECTS_WORKSPACE_ID, DEFAULT_ORG_PROJECTS_WORKSPACE_NAME } from '@lfx-one/shared/constants';
import type { OrgLensEmptyStateName, OrgLensProject } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { OrgEditAccessService } from '@services/org-edit-access.service';
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

/**
 * The health badge label, its accessible name and its CSV cell come from one rule (IN-1390): the band
 * with an asterisk glued to it for a partial score, the bare band for a full one, and `Unavailable`
 * never marked. Rows are ordered by name because every row ties on the default contributors sort.
 */
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
        {
          provide: OrgLensProjectsService,
          useValue: {
            getWorkspaces: () =>
              of({
                workspaces: [
                  { id: DEFAULT_ORG_PROJECTS_WORKSPACE_ID, name: DEFAULT_ORG_PROJECTS_WORKSPACE_NAME, projectSlugs: PROJECTS.map((project) => project.slug) },
                ],
              }),
            getProjects: () => of({ orgSlug: 'acme-test', orgName: 'Acme', dataUpdatedAt: '2026-09-30T00:00:00Z', projects: PROJECTS }),
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
    const [header, ...lines] = (await csvBlob.text())
      .replace('﻿', '')
      .split('\r\n')
      .map((line) => line.split(','));
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
});
