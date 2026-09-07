// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  FORMATION_ENABLED_FLAG,
  MENTORSHIP_ENABLED_FLAG,
  MKTG_OS_AGENTS_ENABLED_FLAG,
  MKTG_OS_AGENTS_LABEL,
  ORG_LENS_CLA_M3_ENABLED_FLAG,
  ORG_LENS_ENABLED_FLAG,
  ORG_LENS_ROI_ENABLED_FLAG,
} from '@lfx-one/shared/constants';
import { Lens, SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { AnalyticsService } from '@services/analytics.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { WriterGrantsService } from '@services/writer-grants.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarNavService } from './sidebar-nav.service';

describe('SidebarNavService', () => {
  const activeLens = signal<Lens>('foundation');
  const mktgOsEnabled = signal(false);
  const orgLensEnabled = signal(false);
  const orgEasyclaEnabled = signal(false);
  const orgRoiEnabled = signal(false);
  const mentorshipEnabled = signal(false);
  const formationEnabled = signal(false);
  const activeProjectStage = signal<string | null>(null);
  const hasFullFoundationAccess = signal(true);
  const currentPersona = signal('executive-director');
  const isAuditor = signal(false);

  const labels = (items: SidebarMenuItem[]): string[] => items.map((item) => item.label);

  const findByLink = (items: SidebarMenuItem[], routerLink: string): SidebarMenuItem | undefined => items.find((item) => item.routerLink === routerLink);

  const sectionItems = (items: SidebarMenuItem[], label: string): SidebarMenuItem[] =>
    items.find((item) => item.isSection && item.label === label)?.items ?? [];

  beforeEach(() => {
    activeLens.set('foundation');
    mktgOsEnabled.set(false);
    orgLensEnabled.set(false);
    orgEasyclaEnabled.set(false);
    orgRoiEnabled.set(false);
    mentorshipEnabled.set(false);
    formationEnabled.set(false);
    activeProjectStage.set(null);
    hasFullFoundationAccess.set(true);
    currentPersona.set('executive-director');
    isAuditor.set(false);

    TestBed.configureTestingModule({
      providers: [
        SidebarNavService,
        {
          provide: FeatureFlagService,
          useValue: {
            getBooleanFlag: vi.fn((key: string) => {
              if (key === MKTG_OS_AGENTS_ENABLED_FLAG) return mktgOsEnabled;
              if (key === ORG_LENS_ENABLED_FLAG) return orgLensEnabled;
              if (key === ORG_LENS_CLA_M3_ENABLED_FLAG) return orgEasyclaEnabled;
              if (key === ORG_LENS_ROI_ENABLED_FLAG) return orgRoiEnabled;
              if (key === MENTORSHIP_ENABLED_FLAG) return mentorshipEnabled;
              if (key === FORMATION_ENABLED_FLAG) return formationEnabled;
              return signal(false);
            }),
          },
        },
        { provide: LensService, useValue: { activeLens } },
        {
          provide: PersonaService,
          useValue: {
            hasBoardRole: signal(false),
            isRootWriter: hasFullFoundationAccess,
            isLFStaff: signal(false),
            canViewExecutiveDashboards: hasFullFoundationAccess,
            currentPersona,
            grantsByScope: signal(new Map()),
            marketingGrantSlug: signal(null),
            isMarketingAuditor: signal(false),
            isCampaignManager: signal(false),
            isAuditor,
            refreshEnrichedPersonas: vi.fn(() => of({})),
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            selectedFoundation: signal(null),
            selectedProject: signal(null),
            canWrite: signal(false),
            activeProjectStage,
          },
        },
        { provide: UserService, useValue: { authenticated: signal(false) } },
        { provide: WriterGrantsService, useValue: { hasWriterFoundation: signal(false) } },
        {
          provide: AnalyticsService,
          useValue: { getFoundationProjectsDetailGrouped: vi.fn(() => of({ totalCount: 0 })) },
        },
      ],
    });
  });

  it('hides Marketing OS on foundation lens when the flag is off', () => {
    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(findByLink(items, '/foundation/mktg-os-agents')).toBeUndefined();
    expect(findByLink(items, '/project/mktg-os-agents')).toBeUndefined();
    expect(labels(items)).not.toContain(MKTG_OS_AGENTS_LABEL.nav);
  });

  it('inserts Marketing OS between Documents and Governance on foundation lens when the flag is on', () => {
    mktgOsEnabled.set(true);

    const items = TestBed.inject(SidebarNavService).sidebarItems();
    const itemLabels = labels(items);
    const documents = itemLabels.indexOf('Documents');
    const marketingOs = itemLabels.indexOf(MKTG_OS_AGENTS_LABEL.nav);
    const governance = itemLabels.indexOf('Governance');

    expect(findByLink(items, '/foundation/mktg-os-agents')).toEqual(
      expect.objectContaining({
        label: MKTG_OS_AGENTS_LABEL.nav,
        routerLink: '/foundation/mktg-os-agents',
        testId: 'sidebar-foundation-mktg-os-agents',
      })
    );
    expect(findByLink(items, '/project/mktg-os-agents')).toBeUndefined();
    expect(documents).toBeGreaterThanOrEqual(0);
    expect(marketingOs).toBe(documents + 1);
    expect(governance).toBe(marketingOs + 1);
  });

  it('still shows Marketing OS for users without full foundation sidebar access when the flag is on', () => {
    mktgOsEnabled.set(true);
    hasFullFoundationAccess.set(false);
    currentPersona.set('contributor');

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(findByLink(items, '/foundation/mktg-os-agents')).toEqual(
      expect.objectContaining({
        label: MKTG_OS_AGENTS_LABEL.nav,
        routerLink: '/foundation/mktg-os-agents',
      })
    );
    expect(labels(items)).not.toContain('Documents');
    expect(labels(items)).not.toContain('Governance');
  });

  it('keeps the project-lens Marketing OS entry between Documents and Governance', () => {
    activeLens.set('project');
    mktgOsEnabled.set(true);

    const items = TestBed.inject(SidebarNavService).sidebarItems();
    const itemLabels = labels(items);

    expect(findByLink(items, '/project/mktg-os-agents')).toEqual(
      expect.objectContaining({
        label: MKTG_OS_AGENTS_LABEL.nav,
        routerLink: '/project/mktg-os-agents',
        testId: 'sidebar-project-mktg-os-agents',
      })
    );
    expect(findByLink(items, '/foundation/mktg-os-agents')).toBeUndefined();
    expect(itemLabels.indexOf(MKTG_OS_AGENTS_LABEL.nav)).toBe(itemLabels.indexOf('Documents') + 1);
    expect(itemLabels.indexOf('Governance')).toBe(itemLabels.indexOf(MKTG_OS_AGENTS_LABEL.nav) + 1);
  });

  it('hides Formation on project lens when the flag is off, even for a Formation-stage project', () => {
    activeLens.set('project');
    formationEnabled.set(false);
    activeProjectStage.set('Formation - Exploratory');

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(findByLink(items, '/project/formation')).toBeUndefined();
  });

  it('hides Formation on project lens when the flag is on but the project is not in a Formation stage', () => {
    activeLens.set('project');
    formationEnabled.set(true);
    activeProjectStage.set('Active');

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(findByLink(items, '/project/formation')).toBeUndefined();
  });

  it('inserts Formation directly under Dashboard on project lens when the flag is on and the project is in a Formation stage', () => {
    activeLens.set('project');
    formationEnabled.set(true);
    activeProjectStage.set('Formation - Exploratory');

    const items = TestBed.inject(SidebarNavService).sidebarItems();
    const itemLabels = labels(items);

    expect(findByLink(items, '/project/formation')).toEqual(
      expect.objectContaining({
        label: 'Formation',
        routerLink: '/project/formation',
        testId: 'sidebar-project-formation',
      })
    );
    expect(itemLabels.indexOf('Formation')).toBe(itemLabels.indexOf('Dashboard') + 1);
    expect(itemLabels.indexOf('Meetings')).toBe(itemLabels.indexOf('Formation') + 1);
  });

  it('hides the Mentorship section from the Me lens while its flag is off', () => {
    activeLens.set('me');

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(labels(items)).not.toContain('Mentorship');
    expect(findByLink(sectionItems(items, 'Mentorship'), '/mentorship/admin')).toBeUndefined();
  });

  it('shows the Mentorship section on the Me lens when its flag is on', () => {
    activeLens.set('me');
    mentorshipEnabled.set(true);

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    // Akrites stays off here: the two dark-launch gates on this lens must filter independently.
    expect(labels(items)).not.toContain('Security');
    expect(findByLink(sectionItems(items, 'Mentorship'), '/mentorship/admin')).toEqual(
      expect.objectContaining({ label: 'Admin', routerLink: '/mentorship/admin' })
    );
  });

  it('hides EasyCLA from the org lens while the M3 flag is off', () => {
    activeLens.set('org');
    orgLensEnabled.set(true);

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(findByLink(items, '/org/easycla')).toBeUndefined();
    expect(labels(sectionItems(items, 'Organization Engagement'))).not.toContain('EasyCLA');
  });

  it('puts EasyCLA between Code Contributions and Events inside Organization Engagement', () => {
    activeLens.set('org');
    orgLensEnabled.set(true);
    orgEasyclaEnabled.set(true);

    const items = TestBed.inject(SidebarNavService).sidebarItems();
    const engagement = sectionItems(items, 'Organization Engagement');
    const engagementLabels = labels(engagement);

    // The M3 prototype nests it in the section — a top-level entry beside Memberships/Projects is wrong.
    expect(findByLink(items, '/org/easycla')).toBeUndefined();
    expect(findByLink(engagement, '/org/easycla')).toEqual(
      expect.objectContaining({ label: 'EasyCLA', routerLink: '/org/easycla', testId: 'sidebar-org-easycla' })
    );
    expect(engagementLabels.indexOf('EasyCLA')).toBe(engagementLabels.indexOf('Code Contributions') + 1);
    expect(engagementLabels.indexOf('Events')).toBe(engagementLabels.indexOf('EasyCLA') + 1);
  });

  it('keeps ROI after Projects while EasyCLA stays in the section when both flags are on', () => {
    activeLens.set('org');
    orgLensEnabled.set(true);
    orgEasyclaEnabled.set(true);
    orgRoiEnabled.set(true);

    const items = TestBed.inject(SidebarNavService).sidebarItems();
    const itemLabels = labels(items);
    const engagementLabels = labels(sectionItems(items, 'Organization Engagement'));

    // The two flags are independent: EasyCLA must not displace ROI's slot, or vice versa.
    expect(itemLabels.indexOf('ROI Metrics')).toBe(itemLabels.indexOf('Projects') + 1);
    expect(engagementLabels.indexOf('EasyCLA')).toBe(engagementLabels.indexOf('Code Contributions') + 1);
  });

  it('inserts Formations between Events and Mailing Lists on foundation lens for a full-access user when the flag is on', () => {
    formationEnabled.set(true);

    const items = TestBed.inject(SidebarNavService).sidebarItems();
    const itemLabels = labels(items);

    expect(findByLink(items, '/foundation/formations')).toEqual(
      expect.objectContaining({
        label: 'Formations',
        routerLink: '/foundation/formations',
        testId: 'sidebar-foundation-formations',
      })
    );
    expect(itemLabels.indexOf('Formations')).toBe(itemLabels.indexOf('Events') + 1);
    expect(itemLabels.indexOf('Mailing Lists')).toBe(itemLabels.indexOf('Formations') + 1);
  });

  it('still shows Formations for an auditor without full foundation sidebar access when the flag is on', () => {
    formationEnabled.set(true);
    hasFullFoundationAccess.set(false);
    currentPersona.set('contributor');
    isAuditor.set(true);

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(findByLink(items, '/foundation/formations')).toEqual(
      expect.objectContaining({
        label: 'Formations',
        routerLink: '/foundation/formations',
      })
    );
    expect(labels(items)).not.toContain('Dashboard');
  });

  it('hides Formations on foundation lens when the flag is off, even for an auditor', () => {
    formationEnabled.set(false);
    isAuditor.set(true);

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(findByLink(items, '/foundation/formations')).toBeUndefined();
  });

  it('hides Formations on foundation lens for a user who is neither auditor nor root-writer, even when the flag is on', () => {
    formationEnabled.set(true);
    hasFullFoundationAccess.set(false);
    currentPersona.set('contributor');
    isAuditor.set(false);

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(findByLink(items, '/foundation/formations')).toBeUndefined();
  });
});
