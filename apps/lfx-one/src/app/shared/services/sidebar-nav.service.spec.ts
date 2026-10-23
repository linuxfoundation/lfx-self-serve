// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AKRITES_ENABLED_FLAG,
  COMMITTEE_LABEL,
  CROWDFUNDING_ATTRIBUTION_STEP_FLAG,
  FORMATION_ENABLED_FLAG,
  GATEWAZE_EMBED_ENABLED_FLAG,
  GW_EMBED_FOUNDATION_NEWSLETTERS_LINK,
  GW_EMBED_PROJECT_NEWSLETTERS_LINK,
  MAILING_LIST_LABEL,
  MENTORSHIP_ENABLED_FLAG,
  MKTG_OS_AGENTS_ENABLED_FLAG,
  MKTG_OS_AGENTS_LABEL,
  ORG_LENS_CLA_M3_ENABLED_FLAG,
  ORG_LENS_ROI_ENABLED_FLAG,
  MARKETING_OPS_FGA_ENABLED_FLAG,
} from '@lfx-one/shared/constants';
import { Lens, SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { AnalyticsService } from '@services/analytics.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { WriterGrantsService } from '@services/writer-grants.service';
import { Observable, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarNavService } from './sidebar-nav.service';

describe('SidebarNavService', () => {
  const activeLens = signal<Lens>('foundation');
  const mktgOsEnabled = signal(false);
  const orgEasyclaEnabled = signal(false);
  const orgRoiEnabled = signal(false);
  const orgSegment = signal<string | null>(null);
  const mentorshipEnabled = signal(false);
  const akritesEnabled = signal(false);
  const formationEnabled = signal(false);
  const activeProjectStage = signal<string | null>(null);
  const activeProjectStageResolved = signal(true);
  const formationOverviewAllowedSlug = signal<string | null>(null);
  const hasFullFoundationAccess = signal(true);
  const currentPersona = signal('executive-director');
  const isAuditor = signal(false);
  const gatewazeEmbedEnabled = signal(false);
  const crowdfundingAttributionEnabled = signal(false);
  const canWrite = signal(false);
  const selectedOrgUid = signal<string | null>(null);
  const orgWriterSet = signal(new Set<string>());
  const claManagerOrgSet = signal(new Set<string>());
  /** Settable so the Gatewaze embed's tenant gate can be exercised; the embed is AAIF-only. */
  const selectedProject = signal<{ slug: string } | null>(null);
  const selectedFoundation = signal<{ slug: string } | null>(null);
  const personaLoaded = signal(true);
  const personaLookupFailed = signal(false);
  const marketingOpsEnabled = signal(false);
  const authenticated = signal(false);
  const writerGrantsResolved = signal(true);
  const grantsByScope = signal<ReadonlyMap<string | null, { isCampaignManager: boolean; isMarketingAuditor: boolean }>>(new Map());
  const writerLookupFailed = signal(false);
  let retrySummary = vi.fn((): Observable<void> => of(undefined));
  let refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>(() => of({}));

  const labels = (items: SidebarMenuItem[]): string[] => items.map((item) => item.label);

  const findByLink = (items: SidebarMenuItem[], routerLink: string): SidebarMenuItem | undefined => items.find((item) => item.routerLink === routerLink);

  /** The whole project-lens sidebar for a Formation-stage project (#2754, #3059), in order. */
  const formationStageLabels = ['Formation', 'Meetings', MAILING_LIST_LABEL.plural, COMMITTEE_LABEL.plural];

  const sectionItems = (items: SidebarMenuItem[], label: string): SidebarMenuItem[] =>
    items.find((item) => item.isSection && item.label === label)?.items ?? [];

  beforeEach(() => {
    activeLens.set('foundation');
    selectedProject.set(null);
    selectedFoundation.set(null);
    mktgOsEnabled.set(false);
    orgEasyclaEnabled.set(false);
    orgRoiEnabled.set(false);
    orgSegment.set(null);
    mentorshipEnabled.set(false);
    akritesEnabled.set(false);
    formationEnabled.set(false);
    activeProjectStage.set(null);
    activeProjectStageResolved.set(true);
    formationOverviewAllowedSlug.set(null);
    hasFullFoundationAccess.set(true);
    currentPersona.set('executive-director');
    isAuditor.set(false);
    gatewazeEmbedEnabled.set(false);
    crowdfundingAttributionEnabled.set(false);
    canWrite.set(false);
    selectedOrgUid.set(null);
    orgWriterSet.set(new Set());
    claManagerOrgSet.set(new Set());
    personaLoaded.set(true);
    personaLookupFailed.set(false);
    marketingOpsEnabled.set(false);
    authenticated.set(false);
    writerGrantsResolved.set(true);
    grantsByScope.set(new Map());
    writerLookupFailed.set(false);
    retrySummary = vi.fn((): Observable<void> => of(undefined));
    refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>(() => of({}));

    TestBed.configureTestingModule({
      providers: [
        SidebarNavService,
        {
          provide: FeatureFlagService,
          useValue: {
            getBooleanFlag: vi.fn((key: string) => {
              if (key === MKTG_OS_AGENTS_ENABLED_FLAG) return mktgOsEnabled;
              if (key === ORG_LENS_CLA_M3_ENABLED_FLAG) return orgEasyclaEnabled;
              if (key === ORG_LENS_ROI_ENABLED_FLAG) return orgRoiEnabled;
              if (key === MENTORSHIP_ENABLED_FLAG) return mentorshipEnabled;
              if (key === AKRITES_ENABLED_FLAG) return akritesEnabled;
              if (key === FORMATION_ENABLED_FLAG) return formationEnabled;
              if (key === GATEWAZE_EMBED_ENABLED_FLAG) return gatewazeEmbedEnabled;
              if (key === CROWDFUNDING_ATTRIBUTION_STEP_FLAG) return crowdfundingAttributionEnabled;
              if (key === MARKETING_OPS_FGA_ENABLED_FLAG) return marketingOpsEnabled;
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
            grantsByScope,
            marketingGrantSlug: signal(null),
            isMarketingAuditor: signal(false),
            isCampaignManager: signal(false),
            isAuditor,
            personaLoaded,
            personaLookupFailed,
            // Late-bound so a case can swap in a probe that stays in flight.
            refreshEnrichedPersonas: (force?: boolean, slug?: string) => refreshEnrichedPersonas(force, slug),
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            selectedFoundation,
            selectedProject,
            canWrite,
            activeProjectStage,
            activeProjectStageResolved,
            formationOverviewAllowedSlug,
          },
        },
        { provide: UserService, useValue: { authenticated } },
        {
          provide: WriterGrantsService,
          useValue: {
            hasWriterFoundation: signal(false),
            summaryResolved: writerGrantsResolved,
            lookupFailed: writerLookupFailed,
            retrySummary: (...args: []) => retrySummary(...args),
          },
        },
        {
          provide: AnalyticsService,
          useValue: { getFoundationProjectsDetailGrouped: vi.fn(() => of({ totalCount: 0 })) },
        },
        // Spec 050 US2: Org Lens items address the selected organization. Most cases assert the tree
        // shape, so the builder is stubbed to the legacy form; `orgSegment` names an organization for
        // the cases that assert the org-scoped form.
        { provide: OrgLensNavigationService, useValue: { orgLensPath: (page: string) => (orgSegment() ? `/org/${orgSegment()}/${page}` : `/org/${page}`) } },
        { provide: AccountContextService, useValue: { selectedAccount: () => ({ accountId: '', accountName: 'Acme', uid: selectedOrgUid() }) } },
        { provide: OrgRoleGrantsService, useValue: { writerSet: orgWriterSet, claManagerOrgSet } },
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

  it('keeps the project-lens Marketing OS entry after Participating organizations and before Governance', () => {
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
    expect(itemLabels.indexOf(MKTG_OS_AGENTS_LABEL.nav)).toBe(itemLabels.indexOf('Participating organizations') + 1);
    expect(itemLabels.indexOf('Governance')).toBe(itemLabels.indexOf(MKTG_OS_AGENTS_LABEL.nav) + 1);
  });

  it('shows Initiatives after the Documents-anchored entries on the project and foundation lenses only for writers with the flag on', () => {
    const service = TestBed.inject(SidebarNavService);

    for (const lens of ['project', 'foundation'] as const) {
      activeLens.set(lens);

      crowdfundingAttributionEnabled.set(false);
      canWrite.set(true);
      expect(findByLink(service.sidebarItems(), `/${lens}/initiatives`)).toBeUndefined();

      crowdfundingAttributionEnabled.set(true);
      canWrite.set(false);
      expect(findByLink(service.sidebarItems(), `/${lens}/initiatives`)).toBeUndefined();

      canWrite.set(true);
      const items = service.sidebarItems();
      const itemLabels = labels(items);
      expect(findByLink(items, `/${lens}/initiatives`)).toEqual(
        expect.objectContaining({ label: 'Crowdfunding Initiatives', testId: `sidebar-${lens}-initiatives` })
      );
      // On the project lens Participating organizations sits between Documents and Initiatives.
      const anchor = lens === 'project' ? 'Participating organizations' : 'Documents';
      expect(itemLabels.indexOf('Crowdfunding Initiatives')).toBe(itemLabels.indexOf(anchor) + 1);
    }
  });

  it('shows Participating organizations right after Documents on the project lens, for non-writers too, and not on the foundation lens', () => {
    const service = TestBed.inject(SidebarNavService);
    activeLens.set('project');
    canWrite.set(false);

    const items = service.sidebarItems();
    const itemLabels = labels(items);
    expect(findByLink(items, '/project/participating-orgs')).toEqual(
      expect.objectContaining({ label: 'Participating organizations', testId: 'sidebar-project-participating-orgs' })
    );
    expect(itemLabels.indexOf('Participating organizations')).toBe(itemLabels.indexOf('Documents') + 1);

    activeLens.set('foundation');
    expect(findByLink(service.sidebarItems(), '/project/participating-orgs')).toBeUndefined();
  });

  it('keeps the full project-lens nav without Formation when the flag is off, even for a Formation-stage project', () => {
    activeLens.set('project');
    formationEnabled.set(false);
    activeProjectStage.set('Formation - Exploratory');

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(findByLink(items, '/project/formation')).toBeUndefined();
    expect(labels(items)).toEqual(expect.arrayContaining(['Dashboard', 'Meetings', 'Governance']));
  });

  it('keeps the full project-lens nav without Formation when the flag is on but the project is not in a Formation stage', () => {
    activeLens.set('project');
    formationEnabled.set(true);
    activeProjectStage.set('Active');

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(findByLink(items, '/project/formation')).toBeUndefined();
    expect(labels(items)).toEqual(expect.arrayContaining(['Dashboard', 'Meetings', 'Governance']));
  });

  it('keeps the full project-lens nav without Formation for a disengaged formation project', () => {
    activeLens.set('project');
    formationEnabled.set(true);
    activeProjectStage.set('Formation - Disengaged');

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(findByLink(items, '/project/formation')).toBeUndefined();
    expect(labels(items)).toEqual(expect.arrayContaining(['Dashboard', 'Meetings', 'Governance']));
  });

  it('reduces the project-lens nav to Formation, Meetings, Mailing Lists and Groups when the flag is on and the project is in a Formation stage', () => {
    activeLens.set('project');
    formationEnabled.set(true);
    activeProjectStage.set('Formation - Exploratory');

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(items).toEqual([
      expect.objectContaining({
        label: 'Formation',
        routerLink: '/project/formation',
        testId: 'sidebar-project-formation',
      }),
      expect.objectContaining({ label: 'Meetings', routerLink: '/project/meetings' }),
      expect.objectContaining({ label: MAILING_LIST_LABEL.plural, routerLink: '/project/mailing-lists' }),
      expect.objectContaining({ label: COMMITTEE_LABEL.plural, routerLink: '/project/groups' }),
    ]);
  });

  it('keeps the formation-stage nav for a Formation-stage project even when every other project-lens gate is open', () => {
    activeLens.set('project');
    formationEnabled.set(true);
    activeProjectStage.set('Formation - Engaged');
    mktgOsEnabled.set(true);
    canWrite.set(true);
    currentPersona.set('executive-director');
    hasFullFoundationAccess.set(true);

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(labels(items)).toEqual(formationStageLabels);
  });

  it('renders no project-lens items while the stage is still resolving with the flag on, rather than a nav that then collapses', () => {
    activeLens.set('project');
    formationEnabled.set(true);
    activeProjectStageResolved.set(false);
    activeProjectStage.set(null);

    expect(TestBed.inject(SidebarNavService).sidebarItems()).toEqual([]);
  });

  it('keeps the full project-lens nav for a Formation-stage project whose dashboard the redirect guard let stand, so a late flag cannot collapse it under that page', () => {
    activeLens.set('project');
    formationEnabled.set(true);
    selectedProject.set({ slug: 'forming' });
    activeProjectStage.set('Formation - Exploratory');
    formationOverviewAllowedSlug.set('forming');

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(findByLink(items, '/project/formation')).toBeUndefined();
    expect(labels(items)).toEqual(expect.arrayContaining(['Dashboard', 'Meetings', 'Governance']));
  });

  it("still reduces to the formation-stage nav when the redirect guard's fail-open was for a different project", () => {
    activeLens.set('project');
    formationEnabled.set(true);
    selectedProject.set({ slug: 'forming' });
    activeProjectStage.set('Formation - Exploratory');
    formationOverviewAllowedSlug.set('other-project');

    expect(labels(TestBed.inject(SidebarNavService).sidebarItems())).toEqual(formationStageLabels);
  });

  it('keeps the full project-lens nav while the stage is still resolving when the flag is off', () => {
    activeLens.set('project');
    formationEnabled.set(false);
    activeProjectStageResolved.set(false);
    activeProjectStage.set(null);

    expect(labels(TestBed.inject(SidebarNavService).sidebarItems())).toEqual(expect.arrayContaining(['Dashboard', 'Meetings', 'Governance']));
  });

  it('hides My Formations from the Me lens while formation-enabled is off', () => {
    activeLens.set('me');

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(findByLink(sectionItems(items, 'My Engagement'), '/formations')).toBeUndefined();
    expect(findByLink(items, '/formations')).toBeUndefined();
  });

  it('appends My Formations as the last My Engagement item on the Me lens when formation-enabled is on', () => {
    activeLens.set('me');
    formationEnabled.set(true);

    const items = TestBed.inject(SidebarNavService).sidebarItems();
    const engagementLinks = sectionItems(items, 'My Engagement').map((item) => item.routerLink);

    expect(findByLink(sectionItems(items, 'My Engagement'), '/formations')).toEqual(
      expect.objectContaining({ label: 'My Formations', routerLink: '/formations', testId: 'sidebar-my-formations' })
    );
    expect(engagementLinks[engagementLinks.length - 1]).toBe('/formations');
    expect(engagementLinks).not.toContain('/documents');
    expect(engagementLinks.indexOf('/formations')).toBe(engagementLinks.indexOf('/surveys') + 1);
    // The section gates keep filtering independently of the new item gate.
    expect(labels(items)).not.toContain('Security');
    expect(labels(items)).not.toContain('Mentorship');
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

  it('puts the Security section last on the Me lens when its flag is on', () => {
    activeLens.set('me');
    akritesEnabled.set(true);
    mentorshipEnabled.set(true);

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(items[items.length - 1]).toEqual(expect.objectContaining({ label: 'Security', isSection: true }));
    expect(findByLink(sectionItems(items, 'Security'), '/akrites')).toEqual(expect.objectContaining({ label: 'Akrites Program' }));
  });

  it('renders no EasyCLA entry on the org lens while the M3 flag is off', () => {
    activeLens.set('org');

    const items = TestBed.inject(SidebarNavService).sidebarItems();

    expect(labels(items)).not.toContain('EasyCLA');
    expect(findByLink(items, '/org/easycla')).toBeUndefined();
    expect(labels(sectionItems(items, 'Organization Engagement'))).not.toContain('EasyCLA');
  });

  it('places EasyCLA as a top-level item directly before Organization Profile, under the org-admin divider', () => {
    activeLens.set('org');
    orgEasyclaEnabled.set(true);

    const items = TestBed.inject(SidebarNavService).sidebarItems();
    const itemLabels = labels(items);
    const easycla = findByLink(items, '/org/easycla');

    expect(easycla).toEqual(
      expect.objectContaining({ label: 'EasyCLA', icon: 'fa-light fa-file-signature', testId: 'sidebar-org-easycla', dividerBefore: true })
    );
    expect(easycla?.isSection).toBeFalsy();
    expect(itemLabels.indexOf('EasyCLA')).toBe(itemLabels.indexOf('Organization Engagement') + 1);
    expect(itemLabels.indexOf('Organization Profile')).toBe(itemLabels.indexOf('EasyCLA') + 1);
    expect(items.find((item) => item.label === 'Organization Profile')?.dividerBefore).toBe(false);
    expect(labels(sectionItems(items, 'Organization Engagement'))).toEqual([
      'People',
      'Code Contributions',
      'Events',
      'Training & Certification',
      'Meetings',
      COMMITTEE_LABEL.plural,
    ]);
  });

  it('opts only EasyCLA into subpath highlighting across the Org Lens tree', () => {
    activeLens.set('org');
    orgEasyclaEnabled.set(true);
    orgRoiEnabled.set(true);

    const flatten = (items: SidebarMenuItem[]): SidebarMenuItem[] => items.flatMap((item) => [item, ...flatten(item.items ?? [])]);
    const optedIn = flatten(TestBed.inject(SidebarNavService).sidebarItems()).filter((item) => item.activeOnSubpaths);

    expect(labels(optedIn)).toEqual(['EasyCLA']);
  });

  it('aliases only EasyCLA, to the leftover /org/easycla mount, so an addressed link still highlights there', () => {
    activeLens.set('org');
    orgEasyclaEnabled.set(true);
    orgRoiEnabled.set(true);
    orgSegment.set('acme-inc');

    const flatten = (items: SidebarMenuItem[]): SidebarMenuItem[] => items.flatMap((item) => [item, ...flatten(item.items ?? [])]);
    const aliased = flatten(TestBed.inject(SidebarNavService).sidebarItems()).filter((item) => item.activeAliases);

    expect(aliased).toEqual([expect.objectContaining({ label: 'EasyCLA', routerLink: '/org/acme-inc/easycla', activeAliases: ['/org/easycla'] })]);
  });

  it('keeps ROI after Projects and EasyCLA above Organization Profile when both flags are on', () => {
    activeLens.set('org');
    orgEasyclaEnabled.set(true);
    orgRoiEnabled.set(true);

    const itemLabels = labels(TestBed.inject(SidebarNavService).sidebarItems());

    // The two flags are independent: EasyCLA must not displace ROI's slot, or vice versa.
    expect(itemLabels.indexOf('ROI Metrics')).toBe(itemLabels.indexOf('Projects') + 1);
    expect(itemLabels.indexOf('Organization Profile')).toBe(itemLabels.indexOf('EasyCLA') + 1);
  });

  describe('a CLA-only organization (M3)', () => {
    const CLA_ONLY_UID = '0014100000ClaOnlyA';

    beforeEach(() => {
      activeLens.set('org');
      orgSegment.set(CLA_ONLY_UID);
      selectedOrgUid.set(CLA_ONLY_UID);
      claManagerOrgSet.set(new Set([CLA_ONLY_UID]));
    });

    it('shows the EasyCLA item and nothing else', () => {
      orgEasyclaEnabled.set(true);
      orgRoiEnabled.set(true);
      crowdfundingAttributionEnabled.set(true);

      const items = TestBed.inject(SidebarNavService).sidebarItems();

      expect(items).toEqual([expect.objectContaining({ label: 'EasyCLA', routerLink: `/org/${CLA_ONLY_UID}/easycla` })]);
      expect(items[0].dividerBefore).toBeFalsy();
    });

    it('keeps the full org sidebar for any other selected organization', () => {
      orgEasyclaEnabled.set(true);
      selectedOrgUid.set('0014100000OtherOrg');

      expect(labels(TestBed.inject(SidebarNavService).sidebarItems())).toContain('Dashboard');
    });

    it('applies nothing while org-lens-cla-m3-enabled is off', () => {
      const itemLabels = labels(TestBed.inject(SidebarNavService).sidebarItems());

      expect(itemLabels).toContain('Dashboard');
      expect(itemLabels).not.toContain('EasyCLA');
    });
  });

  it('addresses every Org Lens item to the selected organization and still places ROI and EasyCLA by their neighbours', () => {
    activeLens.set('org');
    orgEasyclaEnabled.set(true);
    orgRoiEnabled.set(true);
    orgSegment.set('acme-inc');

    const items = TestBed.inject(SidebarNavService).sidebarItems();
    const engagement = sectionItems(items, 'Organization Engagement');
    const itemLabels = labels(items);

    expect(findByLink(items, '/org/acme-inc/overview')).toEqual(expect.objectContaining({ label: 'Dashboard' }));
    expect(findByLink(items, '/org/acme-inc/roi')).toEqual(expect.objectContaining({ label: 'ROI Metrics', testId: 'sidebar-org-roi' }));
    expect(findByLink(engagement, '/org/acme-inc/people')).toEqual(expect.objectContaining({ label: 'People' }));
    // Phase 2 (lfx-self-serve#2743): EasyCLA is addressed like every other Org Lens item.
    expect(findByLink(items, '/org/acme-inc/easycla')).toEqual(expect.objectContaining({ label: 'EasyCLA', testId: 'sidebar-org-easycla' }));
    const orgLinks = [...items, ...engagement].map((item) => item.routerLink).filter((link): link is string => !!link);
    expect(orgLinks.filter((link) => !link.startsWith('/org/acme-inc/'))).toEqual([]);
    expect(itemLabels.indexOf('ROI Metrics')).toBe(itemLabels.indexOf('Projects') + 1);
    expect(itemLabels.indexOf('Organization Profile')).toBe(itemLabels.indexOf('EasyCLA') + 1);
  });

  it('shows Initiatives after Projects and ROI on the org lens only for a direct writer on the selected organization with the flag on', () => {
    const orgUid = '001000000000000AAA';
    activeLens.set('org');
    orgSegment.set('acme-inc');
    selectedOrgUid.set(orgUid);
    orgRoiEnabled.set(true);
    const service = TestBed.inject(SidebarNavService);

    orgWriterSet.set(new Set([orgUid]));
    expect(findByLink(service.sidebarItems(), '/org/acme-inc/initiatives')).toBeUndefined();

    crowdfundingAttributionEnabled.set(true);
    orgWriterSet.set(new Set(['001000000000000BBB']));
    expect(findByLink(service.sidebarItems(), '/org/acme-inc/initiatives')).toBeUndefined();

    orgWriterSet.set(new Set([orgUid]));
    const items = service.sidebarItems();
    const itemLabels = labels(items);
    expect(findByLink(items, '/org/acme-inc/initiatives')).toEqual(
      expect.objectContaining({ label: 'Crowdfunding Initiatives', testId: 'sidebar-org-initiatives' })
    );
    expect(itemLabels.indexOf('ROI Metrics')).toBe(itemLabels.indexOf('Projects') + 1);
    expect(itemLabels.indexOf('Crowdfunding Initiatives')).toBe(itemLabels.indexOf('ROI Metrics') + 1);
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

  describe('project-lens Newsletters (Gatewaze embed pilot)', () => {
    beforeEach(() => {
      activeLens.set('project');
      // The embed is gated on tenant as well as flag — Gatewaze serves one tenant's content, so
      // every "flag on" case below also has to be in the allowed foundation to be meaningful.
      selectedProject.set({ slug: 'agentic-ai-foundation' } as never);
    });

    it('lists Newsletters directly after Mailing Lists, with no Communications section', () => {
      const items = TestBed.inject(SidebarNavService).sidebarItems();
      const itemLabels = labels(items);

      expect(itemLabels).not.toContain('Communications');
      expect(itemLabels.indexOf('Newsletters')).toBe(itemLabels.indexOf(MAILING_LIST_LABEL.plural) + 1);
      expect(findByLink(items, '/project/newsletters')).toEqual(expect.objectContaining({ testId: 'sidebar-project-newsletters' }));
    });

    it("points Newsletters at LFX's own page when the embed flag is off", () => {
      // The embed's routes only MATCH while the flag is on — linking to them unconditionally sent
      // every ED and writer to the dashboard and took LFX's newsletters page out of the sidebar.
      const items = TestBed.inject(SidebarNavService).sidebarItems();

      expect(findByLink(items, '/project/newsletters')).toBeDefined();
      expect(findByLink(items, GW_EMBED_PROJECT_NEWSLETTERS_LINK)).toBeUndefined();
    });

    it('offers no Broadcasts entry when the embed flag is off, since LFX has no such page', () => {
      const items = TestBed.inject(SidebarNavService).sidebarItems();

      expect(labels(items)).not.toContain('Broadcasts');
    });

    it('keeps the embed out of a foundation Gatewaze cannot serve, even with the flag on', () => {
      // Data isolation, not rollout: showing it here would render AAIF's newsletters inside
      // another foundation's chrome.
      gatewazeEmbedEnabled.set(true);
      selectedProject.set({ slug: 'tlf' } as never);

      const items = TestBed.inject(SidebarNavService).sidebarItems();

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

      const items = TestBed.inject(SidebarNavService).sidebarItems();

      expect(findByLink(items, '/project/newsletters')).toBeDefined();
      expect(findByLink(items, GW_EMBED_PROJECT_NEWSLETTERS_LINK)).toBeUndefined();
      expect(labels(items)).not.toContain('Broadcasts');
    });

    it('keeps the embed out when the project context is not yet known', () => {
      gatewazeEmbedEnabled.set(true);
      selectedProject.set(null as never);

      const items = TestBed.inject(SidebarNavService).sidebarItems();

      expect(findByLink(items, GW_EMBED_PROJECT_NEWSLETTERS_LINK)).toBeUndefined();
    });

    it('points Newsletters at the embed and adds Broadcasts when the flag is on', () => {
      gatewazeEmbedEnabled.set(true);

      const items = TestBed.inject(SidebarNavService).sidebarItems();

      expect(findByLink(items, GW_EMBED_PROJECT_NEWSLETTERS_LINK)).toBeDefined();
      // Broadcasts is out of pilot scope (#2260/#2261), so the embed being on must not add it.
      expect(items.some((i) => i.label === 'Broadcasts')).toBe(false);
    });

    it('hides Newsletters from a non-ED without write access, even with the flag on', () => {
      // The flag decides where the links POINT, never who may see them — both mounts are guarded by
      // newsletterAccessGuard, so a widened sidebar would only ever offer a dead end.
      currentPersona.set('contributor');
      gatewazeEmbedEnabled.set(true);

      expect(labels(TestBed.inject(SidebarNavService).sidebarItems())).not.toContain('Newsletters');
    });

    it('keeps the persona gate when the flag is off', () => {
      currentPersona.set('contributor');

      expect(labels(TestBed.inject(SidebarNavService).sidebarItems())).not.toContain('Newsletters');
    });

    it('shows Newsletters to a non-ED who has write access — the other half of the gate', () => {
      // canSeeNewsletters() is ED *or* canWrite(); every other positive case here goes through the
      // ED branch, so without this the writer half is never exercised.
      currentPersona.set('contributor');
      canWrite.set(true);
      gatewazeEmbedEnabled.set(true);

      const items = TestBed.inject(SidebarNavService).sidebarItems();

      expect(labels(TestBed.inject(SidebarNavService).sidebarItems())).toContain('Newsletters');
      expect(findByLink(items, GW_EMBED_PROJECT_NEWSLETTERS_LINK)).toBeDefined();
    });

    it('shows Newsletters to an ED with the flag on', () => {
      currentPersona.set('executive-director');
      gatewazeEmbedEnabled.set(true);

      expect(labels(TestBed.inject(SidebarNavService).sidebarItems())).toContain('Newsletters');
    });

    it('leaves the Foundation Lens gate untouched', () => {
      activeLens.set('foundation');
      currentPersona.set('contributor');
      gatewazeEmbedEnabled.set(true);

      expect(labels(TestBed.inject(SidebarNavService).sidebarItems())).not.toContain('Communications');
    });
  });

  describe('sidebarItemsPending', () => {
    it('is pending until persona detection has loaded', () => {
      personaLoaded.set(false);
      const service = TestBed.inject(SidebarNavService);

      expect(service.sidebarItemsPending()).toBe(true);
      personaLoaded.set(true);
      expect(service.sidebarItemsPending()).toBe(false);
    });

    it('waits for the writer grants on the foundation lens only', () => {
      writerGrantsResolved.set(false);
      const service = TestBed.inject(SidebarNavService);

      expect(service.sidebarItemsPending()).toBe(true);
      activeLens.set('me');
      expect(service.sidebarItemsPending()).toBe(false);
      activeLens.set('foundation');
      writerGrantsResolved.set(true);
      expect(service.sidebarItemsPending()).toBe(false);
    });

    it('reports a failed writer lookup on the foundation lens, and retry reruns it before settling', () => {
      writerLookupFailed.set(true);
      const service = TestBed.inject(SidebarNavService);

      expect(service.menuLookupFailed()).toBe(true);
      activeLens.set('me');
      expect(service.menuLookupFailed()).toBe(false);
      activeLens.set('foundation');

      const summary = new Subject<void>();
      retrySummary = vi.fn(() => summary);
      service.retryMenuLookups();
      expect(retrySummary).toHaveBeenCalledTimes(1);
      expect(service.sidebarItemsPending()).toBe(true);

      writerLookupFailed.set(false);
      summary.next();
      summary.complete();
      expect(service.sidebarItemsPending()).toBe(false);
      expect(service.menuLookupFailed()).toBe(false);
    });

    it('waits for the foundation-lens auditor probe until it settles', () => {
      const probe = new Subject<unknown>();
      refreshEnrichedPersonas = vi.fn(() => probe);
      authenticated.set(true);
      const service = TestBed.inject(SidebarNavService);
      TestBed.tick();

      expect(service.sidebarItemsPending()).toBe(true);

      probe.next({});
      probe.complete();
      expect(service.sidebarItemsPending()).toBe(false);
    });

    it('waits for the scoped marketing-grant probe of the selected foundation', () => {
      const probe = new Subject<unknown>();
      refreshEnrichedPersonas = vi.fn(() => probe);
      marketingOpsEnabled.set(true);
      authenticated.set(true);
      selectedFoundation.set({ slug: 'cncf' });
      const service = TestBed.inject(SidebarNavService);
      TestBed.tick();

      expect(service.sidebarItemsPending()).toBe(true);

      // The same stubbed probe also answers the foundation-lens auditor probe, which waits for completion.
      probe.next({});
      probe.complete();
      expect(service.sidebarItemsPending()).toBe(false);
    });

    it('reports a failed lookup, and holds the menu pending while a retry refresh runs', () => {
      personaLookupFailed.set(true);
      const service = TestBed.inject(SidebarNavService);
      expect(service.menuLookupFailed()).toBe(true);

      const retry = new Subject<unknown>();
      refreshEnrichedPersonas = vi.fn(() => retry);
      service.retryMenuLookups();
      expect(refreshEnrichedPersonas).toHaveBeenCalledTimes(1);
      expect(service.sidebarItemsPending()).toBe(true);

      // A second click while it runs doesn't stack another refresh.
      service.retryMenuLookups();
      expect(refreshEnrichedPersonas).toHaveBeenCalledTimes(1);

      personaLookupFailed.set(false);
      retry.next({});
      retry.complete();
      expect(service.sidebarItemsPending()).toBe(false);
      expect(service.menuLookupFailed()).toBe(false);
    });

    it('flags a failed scoped marketing probe on its own, and a scoped retry re-runs only the scoped request', () => {
      const firstScoped = new Subject<unknown>();
      refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>((...[, slug]) => (slug ? firstScoped : of({})));
      marketingOpsEnabled.set(true);
      authenticated.set(true);
      selectedFoundation.set({ slug: 'cncf' });
      const service = TestBed.inject(SidebarNavService);
      TestBed.tick();

      // The scoped probe fails while the root lookup is fine.
      firstScoped.next(null);
      firstScoped.complete();
      expect(service.menuLookupFailed()).toBe(true);

      // The scoped answer also refreshes personas and ROOT grants, so no parallel ROOT-only request runs:
      // its ROOT-only marketing grants would otherwise land over the scoped ones.
      const scoped = new Subject<unknown>();
      refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>(() => scoped);
      service.retryMenuLookups();
      expect(refreshEnrichedPersonas).toHaveBeenCalledTimes(1);
      expect(refreshEnrichedPersonas).toHaveBeenCalledWith(false, 'cncf');
      expect(service.sidebarItemsPending()).toBe(true);

      scoped.next({ error: null });
      scoped.complete();
      expect(service.sidebarItemsPending()).toBe(false);
      expect(service.menuLookupFailed()).toBe(false);
    });

    it('keeps a late retry result for a previous scope from overwriting the selected scope', () => {
      const failingCncf = new Subject<unknown>();
      refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>((...[, slug]) =>
        slug === 'cncf' ? failingCncf : of({ error: null })
      );
      marketingOpsEnabled.set(true);
      authenticated.set(true);
      selectedFoundation.set({ slug: 'cncf' });
      const service = TestBed.inject(SidebarNavService);
      TestBed.tick();
      failingCncf.next(null);
      failingCncf.complete();
      expect(service.menuLookupFailed()).toBe(true);

      // Retry for cncf is still running when the user switches to aaif, whose probe succeeds.
      const retryCncf = new Subject<unknown>();
      refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>((...[, slug]) =>
        slug === 'cncf' ? retryCncf : of({ error: null })
      );
      service.retryMenuLookups();
      selectedFoundation.set({ slug: 'aaif' });
      TestBed.tick();
      expect(service.menuLookupFailed()).toBe(false);

      // cncf's late failure lands — aaif stays clean.
      retryCncf.next(null);
      retryCncf.complete();
      expect(service.menuLookupFailed()).toBe(false);
    });

    it('flags a scoped probe whose answer arrived but whose grant checks could not be verified', () => {
      refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>((...[, slug]) =>
        slug ? of({ error: null, marketingGrantCheckFailed: true }) : of({})
      );
      marketingOpsEnabled.set(true);
      authenticated.set(true);
      selectedFoundation.set({ slug: 'cncf' });
      const service = TestBed.inject(SidebarNavService);
      TestBed.tick();
      expect(service.menuLookupFailed()).toBe(true);

      // Retry: the checks answer this time.
      refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>(() => of({ error: null, marketingGrantCheckFailed: false }));
      service.retryMenuLookups();
      expect(service.menuLookupFailed()).toBe(false);
    });

    it("hides the previous scope's marketing grant while the new scope's probe is in flight", () => {
      // A campaign_manager-only viewer: no ED persona, no executive dashboards.
      currentPersona.set('contributor');
      hasFullFoundationAccess.set(false);
      grantsByScope.set(new Map([['cncf', { isCampaignManager: true, isMarketingAuditor: false }]]));
      marketingOpsEnabled.set(true);
      authenticated.set(true);
      selectedFoundation.set({ slug: 'cncf' });
      const service = TestBed.inject(SidebarNavService);
      TestBed.tick();
      const showsCampaigns = (): boolean => JSON.stringify(service.sidebarItems()).includes('sidebar-marketing-campaigns');
      expect(showsCampaigns()).toBe(true);

      // Switch to aaif (no grant) while its probe is still in flight.
      const aaifProbe = new Subject<unknown>();
      refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>(() => aaifProbe);
      selectedFoundation.set({ slug: 'aaif' });
      TestBed.tick();
      expect(showsCampaigns()).toBe(false);

      aaifProbe.next({ error: null });
      aaifProbe.complete();
      expect(showsCampaigns()).toBe(false);
    });

    it("keeps showing a ROOT marketing grant while the new scope's probe is in flight", () => {
      currentPersona.set('contributor');
      hasFullFoundationAccess.set(false);
      grantsByScope.set(new Map([[null, { isCampaignManager: true, isMarketingAuditor: false }]]));
      marketingOpsEnabled.set(true);
      authenticated.set(true);
      selectedFoundation.set({ slug: 'cncf' });
      const service = TestBed.inject(SidebarNavService);
      TestBed.tick();
      const showsCampaigns = (): boolean => JSON.stringify(service.sidebarItems()).includes('sidebar-marketing-campaigns');
      expect(showsCampaigns()).toBe(true);

      refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>(() => new Subject<unknown>());
      selectedFoundation.set({ slug: 'aaif' });
      TestBed.tick();
      expect(showsCampaigns()).toBe(true);
    });

    it('reports a running retry only for the scope it started on', () => {
      personaLookupFailed.set(true);
      selectedFoundation.set({ slug: 'cncf' });
      const service = TestBed.inject(SidebarNavService);
      const retry = new Subject<unknown>();
      refreshEnrichedPersonas = vi.fn(() => retry);
      service.retryMenuLookups();
      expect(service.menuRetryPending()).toBe(true);

      selectedFoundation.set({ slug: 'aaif' });
      expect(service.menuRetryPending()).toBe(false);

      selectedFoundation.set({ slug: 'cncf' });
      expect(service.menuRetryPending()).toBe(true);
      retry.next({});
      retry.complete();
      expect(service.menuRetryPending()).toBe(false);
    });

    it("doesn't hold another scope's menu pending or block its retry while an older scope's retry runs", () => {
      personaLookupFailed.set(true);
      selectedFoundation.set({ slug: 'cncf' });
      const service = TestBed.inject(SidebarNavService);
      const cncfRetry = new Subject<unknown>();
      refreshEnrichedPersonas = vi.fn(() => cncfRetry);
      service.retryMenuLookups();
      expect(service.sidebarItemsPending()).toBe(true);

      // Switch to aaif: its menu isn't held by cncf's retry, and it can retry on its own.
      selectedFoundation.set({ slug: 'aaif' });
      expect(service.sidebarItemsPending()).toBe(false);
      const aaifRetry = new Subject<unknown>();
      refreshEnrichedPersonas = vi.fn(() => aaifRetry);
      service.retryMenuLookups();
      expect(refreshEnrichedPersonas).toHaveBeenCalled();
      expect(service.menuRetryPending()).toBe(true);

      // cncf's retry settles late: it must not end aaif's.
      cncfRetry.next({});
      cncfRetry.complete();
      expect(service.menuRetryPending()).toBe(true);
      aaifRetry.next({});
      aaifRetry.complete();
      expect(service.menuRetryPending()).toBe(false);
    });

    it('keeps a grant already confirmed for the scope on screen while its probe re-runs (A → B → A)', () => {
      currentPersona.set('contributor');
      hasFullFoundationAccess.set(false);
      grantsByScope.set(new Map([['cncf', { isCampaignManager: true, isMarketingAuditor: false }]]));
      marketingOpsEnabled.set(true);
      authenticated.set(true);
      selectedFoundation.set({ slug: 'cncf' });
      const service = TestBed.inject(SidebarNavService);
      TestBed.tick();
      const showsCampaigns = (): boolean => JSON.stringify(service.sidebarItems()).includes('sidebar-marketing-campaigns');
      selectedFoundation.set({ slug: 'aaif' });
      TestBed.tick();

      // Back to cncf with its probe in flight: the cached cncf grant still counts.
      refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>(() => new Subject<unknown>());
      selectedFoundation.set({ slug: 'cncf' });
      TestBed.tick();
      expect(showsCampaigns()).toBe(true);
    });

    it('keeps a retry pending for its own scope after another scope starts and finishes one', () => {
      personaLookupFailed.set(true);
      selectedFoundation.set({ slug: 'cncf' });
      const service = TestBed.inject(SidebarNavService);
      const cncfRetry = new Subject<unknown>();
      refreshEnrichedPersonas = vi.fn(() => cncfRetry);
      service.retryMenuLookups();

      selectedFoundation.set({ slug: 'aaif' });
      refreshEnrichedPersonas = vi.fn(() => of({}));
      service.retryMenuLookups();

      // Back on cncf: its run is still in flight, so it reads pending and a second click doesn't stack.
      selectedFoundation.set({ slug: 'cncf' });
      expect(service.menuRetryPending()).toBe(true);
      refreshEnrichedPersonas = vi.fn(() => of({}));
      service.retryMenuLookups();
      expect(refreshEnrichedPersonas).not.toHaveBeenCalled();
      cncfRetry.next({});
      cncfRetry.complete();
      expect(service.menuRetryPending()).toBe(false);
    });

    it('keeps an older retry from overwriting a newer probe for the same scope after A → B → A', () => {
      refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>((...[, slug]) =>
        slug === 'cncf' ? of(null) : of({ error: null })
      );
      marketingOpsEnabled.set(true);
      authenticated.set(true);
      selectedFoundation.set({ slug: 'cncf' });
      const service = TestBed.inject(SidebarNavService);
      TestBed.tick();
      expect(service.menuLookupFailed()).toBe(true);

      // Retry for cncf: its scoped probe succeeds at once, the root refresh stays pending.
      const root = new Subject<unknown>();
      refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>((...[, slug]) => {
        if (!slug) return root;
        return of({ error: null });
      });
      service.retryMenuLookups();

      // cncf → aaif → cncf: the newer automatic cncf probe fails.
      selectedFoundation.set({ slug: 'aaif' });
      TestBed.tick();
      refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>((...[, slug]) =>
        slug === 'cncf' ? of(null) : of({ error: null })
      );
      selectedFoundation.set({ slug: 'cncf' });
      TestBed.tick();
      expect(service.menuLookupFailed()).toBe(true);

      // The older retry settles last — its success must not clear the newer failure.
      root.next({});
      root.complete();
      expect(service.menuLookupFailed()).toBe(true);
    });

    it("keeps a late successful retry for a previous scope from clearing the selected scope's failure", () => {
      const failingCncf = new Subject<unknown>();
      refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>((...[, slug]) =>
        slug === 'cncf' ? failingCncf : of({ error: null })
      );
      marketingOpsEnabled.set(true);
      authenticated.set(true);
      selectedFoundation.set({ slug: 'cncf' });
      const service = TestBed.inject(SidebarNavService);
      TestBed.tick();
      failingCncf.next(null);
      failingCncf.complete();
      expect(service.menuLookupFailed()).toBe(true);

      // Retry for cncf is still running when the user switches to aaif, whose own probe fails.
      const retryCncf = new Subject<unknown>();
      refreshEnrichedPersonas = vi.fn<(force?: boolean, slug?: string) => Observable<unknown>>((...[, slug]) => {
        if (slug === 'cncf') return retryCncf;
        return slug === 'aaif' ? of(null) : of({ error: null });
      });
      service.retryMenuLookups();
      selectedFoundation.set({ slug: 'aaif' });
      TestBed.tick();
      expect(service.menuLookupFailed()).toBe(true);

      // cncf's late success lands — aaif keeps its retryable error.
      retryCncf.next({ error: null });
      retryCncf.complete();
      expect(service.menuLookupFailed()).toBe(true);
    });
  });
});
