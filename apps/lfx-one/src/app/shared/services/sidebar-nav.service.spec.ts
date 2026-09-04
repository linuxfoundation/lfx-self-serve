// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MKTG_OS_AGENTS_ENABLED_FLAG, MKTG_OS_AGENTS_LABEL, ORG_LENS_CLA_M3_ENABLED_FLAG, ORG_LENS_ENABLED_FLAG } from '@lfx-one/shared/constants';
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
  const hasFullFoundationAccess = signal(true);
  const currentPersona = signal('executive-director');

  const labels = (items: SidebarMenuItem[]): string[] => items.map((item) => item.label);

  const findByLink = (items: SidebarMenuItem[], routerLink: string): SidebarMenuItem | undefined => items.find((item) => item.routerLink === routerLink);

  const sectionItems = (items: SidebarMenuItem[], label: string): SidebarMenuItem[] =>
    items.find((item) => item.isSection && item.label === label)?.items ?? [];

  beforeEach(() => {
    activeLens.set('foundation');
    mktgOsEnabled.set(false);
    orgLensEnabled.set(false);
    orgEasyclaEnabled.set(false);
    hasFullFoundationAccess.set(true);
    currentPersona.set('executive-director');

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
            refreshEnrichedPersonas: vi.fn(() => of({})),
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            selectedFoundation: signal(null),
            selectedProject: signal(null),
            canWrite: signal(false),
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
});
