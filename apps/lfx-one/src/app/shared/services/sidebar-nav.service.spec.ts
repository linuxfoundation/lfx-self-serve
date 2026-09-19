// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  FORMATION_ENABLED_FLAG,
  GATEWAZE_EMBED_ENABLED_FLAG,
  GW_EMBED_FOUNDATION_NEWSLETTERS_LINK,
  GW_EMBED_PROJECT_NEWSLETTERS_LINK,
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
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
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
  const orgSegment = signal<string | null>(null);
  const mentorshipEnabled = signal(false);
  const formationEnabled = signal(false);
  const activeProjectStage = signal<string | null>(null);
  const hasFullFoundationAccess = signal(true);
  const currentPersona = signal('executive-director');
  const isAuditor = signal(false);
  const gatewazeEmbedEnabled = signal(false);
  const canWrite = signal(false);
  /** Settable so the Gatewaze embed's tenant gate can be exercised; the embed is AAIF-only. */
  const selectedProject = signal<{ slug: string } | null>(null);
  const selectedFoundation = signal<{ slug: string } | null>(null);

  const labels = (items: SidebarMenuItem[]): string[] => items.map((item) => item.label);

  const findByLink = (items: SidebarMenuItem[], routerLink: string): SidebarMenuItem | undefined => items.find((item) => item.routerLink === routerLink);

  const sectionItems = (items: SidebarMenuItem[], label: string): SidebarMenuItem[] =>
    items.find((item) => item.isSection && item.label === label)?.items ?? [];

  beforeEach(() => {
    activeLens.set('foundation');
    selectedProject.set(null);
    selectedFoundation.set(null);
    mktgOsEnabled.set(false);
    orgLensEnabled.set(false);
    orgEasyclaEnabled.set(false);
    orgRoiEnabled.set(false);
    orgSegment.set(null);
    mentorshipEnabled.set(false);
    formationEnabled.set(false);
    activeProjectStage.set(null);
    hasFullFoundationAccess.set(true);
    currentPersona.set('executive-director');
    isAuditor.set(false);
    gatewazeEmbedEnabled.set(false);
    canWrite.set(false);

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
              if (key === GATEWAZE_EMBED_ENABLED_FLAG) return gatewazeEmbedEnabled;
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
            selectedFoundation,
            selectedProject,
            canWrite,
            activeProjectStage,
          },
        },
        { provide: UserService, useValue: { authenticated: signal(false) } },
        { provide: WriterGrantsService, useValue: { hasWriterFoundation: signal(false) } },
        {
          provide: AnalyticsService,
          useValue: { getFoundationProjectsDetailGrouped: vi.fn(() => of({ totalCount: 0 })) },
        },
        // Spec 050 US2: Org Lens items address the selected organization. Most cases assert the tree
        // shape, so the builder is stubbed to the legacy form; `orgSegment` names an organization for
        // the cases that assert the org-scoped form.
        { provide: OrgLensNavigationService, useValue: { orgLensPath: (page: string) => (orgSegment() ? `/org/${orgSegment()}/${page}` : `/org/${page}`) } },
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

  // The flag-gated items are placed by looking their neighbours up by address; both sides must
  // agree on the org-scoped form or ROI/EasyCLA silently fall to the end of their section.
  it('addresses every Org Lens item to the selected organization and still places ROI and EasyCLA by their neighbours', () => {
    activeLens.set('org');
    orgLensEnabled.set(true);
    orgEasyclaEnabled.set(true);
    orgRoiEnabled.set(true);
    orgSegment.set('acme-inc');

    const items = TestBed.inject(SidebarNavService).sidebarItems();
    const engagement = sectionItems(items, 'Organization Engagement');
    const itemLabels = labels(items);
    const engagementLabels = labels(engagement);

    expect(findByLink(items, '/org/acme-inc/overview')).toEqual(expect.objectContaining({ label: 'Dashboard' }));
    expect(findByLink(items, '/org/acme-inc/roi')).toEqual(expect.objectContaining({ label: 'ROI Metrics', testId: 'sidebar-org-roi' }));
    expect(findByLink(engagement, '/org/acme-inc/people')).toEqual(expect.objectContaining({ label: 'People' }));
    // DR-004: EasyCLA is the one Org Lens item that keeps the legacy address in this release.
    expect(findByLink(engagement, '/org/easycla')).toEqual(expect.objectContaining({ label: 'EasyCLA' }));
    const orgLinks = [...items, ...engagement].map((item) => item.routerLink).filter((link): link is string => !!link);
    expect(orgLinks.filter((link) => !link.startsWith('/org/acme-inc/'))).toEqual(['/org/easycla']);
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
  describe('foundation-lens Communications (Gatewaze embed pilot)', () => {
    // The foundation lens reads `selectedFoundation` ONLY — a project slot holding AAIF while the
    // foundation is something else is not the allowed tenant at this level, and must not open the
    // embed under the wrong foundation's chrome.
    beforeEach(() => {
      activeLens.set('foundation');
      selectedFoundation.set({ slug: 'agentic-ai-foundation' } as never);
    });

    it("points Newsletters at LFX's own page when the embed flag is off", () => {
      const items = sectionItems(TestBed.inject(SidebarNavService).sidebarItems(), 'Communications');

      expect(findByLink(items, '/foundation/newsletters')).toBeDefined();
      expect(findByLink(items, GW_EMBED_FOUNDATION_NEWSLETTERS_LINK)).toBeUndefined();
      expect(labels(items)).not.toContain('Broadcasts');
    });

    it('points Newsletters at the embed and adds Broadcasts when the flag is on', () => {
      gatewazeEmbedEnabled.set(true);

      const items = sectionItems(TestBed.inject(SidebarNavService).sidebarItems(), 'Communications');

      expect(findByLink(items, GW_EMBED_FOUNDATION_NEWSLETTERS_LINK)).toBeDefined();
      // Broadcasts is out of pilot scope (#2260/#2261), so the embed being on must not add it.
      expect(items.some((i) => i.label === 'Broadcasts')).toBe(false);
      expect(findByLink(items, '/foundation/newsletters')).toBeUndefined();
    });

    it('keeps the embed out of a foundation Gatewaze cannot serve, even with the flag on', () => {
      gatewazeEmbedEnabled.set(true);
      selectedFoundation.set({ slug: 'tlf' } as never);

      const items = sectionItems(TestBed.inject(SidebarNavService).sidebarItems(), 'Communications');

      expect(findByLink(items, '/foundation/newsletters')).toBeDefined();
      expect(findByLink(items, GW_EMBED_FOUNDATION_NEWSLETTERS_LINK)).toBeUndefined();
      expect(labels(items)).not.toContain('Broadcasts');
    });

    it('does not let an allowed project slot open the embed under a different foundation', () => {
      gatewazeEmbedEnabled.set(true);
      selectedFoundation.set({ slug: 'tlf' } as never);
      selectedProject.set({ slug: 'agentic-ai-foundation' } as never);

      const items = sectionItems(TestBed.inject(SidebarNavService).sidebarItems(), 'Communications');

      expect(findByLink(items, GW_EMBED_FOUNDATION_NEWSLETTERS_LINK)).toBeUndefined();
    });

    it('keeps the embed out when the foundation context is not yet known', () => {
      gatewazeEmbedEnabled.set(true);
      selectedFoundation.set(null as never);

      const items = sectionItems(TestBed.inject(SidebarNavService).sidebarItems(), 'Communications');

      expect(findByLink(items, GW_EMBED_FOUNDATION_NEWSLETTERS_LINK)).toBeUndefined();
    });
  });

  describe('project-lens Communications (Gatewaze embed pilot)', () => {
    beforeEach(() => {
      activeLens.set('project');
      // The embed is gated on tenant as well as flag — Gatewaze serves one tenant's content, so
      // every "flag on" case below also has to be in the allowed foundation to be meaningful.
      selectedProject.set({ slug: 'agentic-ai-foundation' } as never);
    });

    it("points Newsletters at LFX's own page when the embed flag is off", () => {
      // The embed's routes only MATCH while the flag is on — linking to them unconditionally sent
      // every ED and writer to the dashboard and took LFX's newsletters page out of the sidebar.
      const items = sectionItems(TestBed.inject(SidebarNavService).sidebarItems(), 'Communications');

      expect(findByLink(items, '/project/newsletters')).toBeDefined();
      expect(findByLink(items, GW_EMBED_PROJECT_NEWSLETTERS_LINK)).toBeUndefined();
    });

    it('offers no Broadcasts entry when the embed flag is off, since LFX has no such page', () => {
      const items = sectionItems(TestBed.inject(SidebarNavService).sidebarItems(), 'Communications');

      expect(labels(items)).not.toContain('Broadcasts');
    });

    it('keeps the embed out of a foundation Gatewaze cannot serve, even with the flag on', () => {
      // Data isolation, not rollout: showing it here would render AAIF's newsletters inside
      // another foundation's chrome.
      gatewazeEmbedEnabled.set(true);
      selectedProject.set({ slug: 'tlf' } as never);

      const items = sectionItems(TestBed.inject(SidebarNavService).sidebarItems(), 'Communications');

      expect(findByLink(items, '/project/newsletters')).toBeDefined();
      expect(findByLink(items, GW_EMBED_PROJECT_NEWSLETTERS_LINK)).toBeUndefined();
      expect(labels(items)).not.toContain('Broadcasts');
    });

    it('does not let a stale allowed foundation open the embed for an unrelated project', () => {
      // selectedFoundation persists across lens switches, so visiting AAIF in the Foundation Lens
      // and then opening another project used to retarget Newsletters and add Broadcasts there.
      gatewazeEmbedEnabled.set(true);
      selectedFoundation.set({ slug: 'agentic-ai-foundation' } as never);
      selectedProject.set({ slug: 'tlf' } as never);

      const items = sectionItems(TestBed.inject(SidebarNavService).sidebarItems(), 'Communications');

      expect(findByLink(items, '/project/newsletters')).toBeDefined();
      expect(findByLink(items, GW_EMBED_PROJECT_NEWSLETTERS_LINK)).toBeUndefined();
      expect(labels(items)).not.toContain('Broadcasts');
    });

    it('keeps the embed out when the project context is not yet known', () => {
      gatewazeEmbedEnabled.set(true);
      selectedProject.set(null as never);

      const items = sectionItems(TestBed.inject(SidebarNavService).sidebarItems(), 'Communications');

      expect(findByLink(items, GW_EMBED_PROJECT_NEWSLETTERS_LINK)).toBeUndefined();
    });

    it('points Newsletters at the embed and adds Broadcasts when the flag is on', () => {
      gatewazeEmbedEnabled.set(true);

      const items = sectionItems(TestBed.inject(SidebarNavService).sidebarItems(), 'Communications');

      expect(findByLink(items, GW_EMBED_PROJECT_NEWSLETTERS_LINK)).toBeDefined();
      // Broadcasts is out of pilot scope (#2260/#2261), so the embed being on must not add it.
      expect(items.some((i) => i.label === 'Broadcasts')).toBe(false);
    });

    it('hides the section from a non-ED without write access, even with the flag on', () => {
      // The flag decides where the links POINT, never who may see them — both mounts are guarded by
      // newsletterAccessGuard, so a widened sidebar would only ever offer a dead end.
      currentPersona.set('contributor');
      gatewazeEmbedEnabled.set(true);

      expect(labels(TestBed.inject(SidebarNavService).sidebarItems())).not.toContain('Communications');
    });

    it('keeps the persona gate when the flag is off', () => {
      currentPersona.set('contributor');

      expect(labels(TestBed.inject(SidebarNavService).sidebarItems())).not.toContain('Communications');
    });

    it('shows the section to a non-ED who has write access — the other half of the gate', () => {
      // canSeeNewsletters() is ED *or* canWrite(); every other positive case here goes through the
      // ED branch, so without this the writer half is never exercised.
      currentPersona.set('contributor');
      canWrite.set(true);
      gatewazeEmbedEnabled.set(true);

      const items = sectionItems(TestBed.inject(SidebarNavService).sidebarItems(), 'Communications');

      expect(labels(TestBed.inject(SidebarNavService).sidebarItems())).toContain('Communications');
      expect(findByLink(items, GW_EMBED_PROJECT_NEWSLETTERS_LINK)).toBeDefined();
    });

    it('shows the section to an ED with the flag on', () => {
      currentPersona.set('executive-director');
      gatewazeEmbedEnabled.set(true);

      expect(labels(TestBed.inject(SidebarNavService).sidebarItems())).toContain('Communications');
    });

    it('leaves the Foundation Lens gate untouched', () => {
      activeLens.set('foundation');
      currentPersona.set('contributor');
      gatewazeEmbedEnabled.set(true);

      expect(labels(TestBed.inject(SidebarNavService).sidebarItems())).not.toContain('Communications');
    });
  });
});
