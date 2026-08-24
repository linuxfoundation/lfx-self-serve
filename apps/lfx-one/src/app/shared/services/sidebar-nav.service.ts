// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { environment } from '@environments/environment';
import {
  AKRITES_ENABLED_FLAG,
  COMMITTEE_LABEL,
  DOCUMENT_LABEL,
  MAILING_LIST_LABEL,
  MARKETING_OPS_FGA_ENABLED_FLAG,
  MKTG_OS_AGENTS_LABEL,
  ORG_LENS_ENABLED_FLAG,
  ORG_LENS_ROI_ENABLED_FLAG,
  SURVEY_LABEL,
  VOTE_LABEL,
} from '@lfx-one/shared/constants';
import { SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { AnalyticsService } from '@services/analytics.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { WriterGrantsService } from '@services/writer-grants.service';
import { map, of, startWith, switchMap } from 'rxjs';

/**
 * Builds the lens-aware sidebar menu items. Extracted from MainLayoutComponent so both the main
 * layout and the docs shell can render the same lens navigation. In the docs shell the previously
 * active lens tab stays selected and no menu item is active (there is no lens route under /docs).
 */
@Injectable({
  providedIn: 'root',
})
export class SidebarNavService {
  private readonly personaService = inject(PersonaService);
  private readonly lensService = inject(LensService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly userService = inject(UserService);
  private readonly writerGrantsService = inject(WriterGrantsService);

  /** Dark-launch gate; falls back to Me Lens nav when off. */
  private readonly isOrgLensEnabled = this.featureFlagService.getBooleanFlag(ORG_LENS_ENABLED_FLAG, false);
  /** Dark-launch gate for the Akrites admin dashboard; hides the Security nav section when off. */
  private readonly isAkritesEnabled = this.featureFlagService.getBooleanFlag(AKRITES_ENABLED_FLAG, false);
  /** TODO(mktg-os GA): flag gate bypassed for now (Joan, 2026-08-19) — restore getBooleanFlag(MKTG_OS_AGENTS_ENABLED_FLAG, false) before GA. */
  private readonly isMktgOsAgentsEnabled: Signal<boolean> = computed(() => true);
  /** Dark-launch gate for the Org Lens ROI Metrics page; hides its org-lens nav entry when off. */
  private readonly isOrgLensRoiEnabled = this.featureFlagService.getBooleanFlag(ORG_LENS_ROI_ENABLED_FLAG, false);
  /** Dual-gated with `ServerFeatureFlag.MarketingOpsFga` — unlocks Marketing nav for marketing_auditor/campaign_manager grants (LFXV2-2235/LFXV2-2236). */
  private readonly isMarketingOpsFgaEnabled = this.featureFlagService.getBooleanFlag(MARKETING_OPS_FGA_ENABLED_FLAG, false);

  /**
   * True when the user has non-marketing foundation access (board role, root-writer, LF-staff, or
   * writer grant on a foundation). Marketing FGA grants alone do NOT set this flag — those users
   * still reach the foundation lens but should only see the marketing-specific nav items, not the
   * full foundation sidebar (Dashboard, Meetings, Governance, etc.).
   */
  private readonly hasFullFoundationAccess = computed(
    () =>
      this.personaService.hasBoardRole() ||
      this.personaService.isRootWriter() ||
      this.personaService.isLFStaff() ||
      this.writerGrantsService.hasWriterFoundation()
  );

  private readonly activeLens = this.lensService.activeLens;

  // Newsletter nav visibility: ED persona always sees it; non-ED users see it
  // when they have writer (or owner-equivalent) permission on the currently
  // active foundation/project. canWrite() is reactive to context changes.
  private readonly canSeeNewsletters: Signal<boolean> = this.initCanSeeNewsletters();

  // Lens-aware sidebar items
  public readonly sidebarItems = computed((): SidebarMenuItem[] => {
    switch (this.activeLens()) {
      case 'foundation':
        return this.foundationLensItems();
      case 'project': {
        // Governance (Votes / Surveys / Permissions) is always surfaced under Project lens —
        // matching Foundation lens behavior. Authorization for write actions (add user,
        // edit role, remove, etc.) is enforced server-side and by per-page UI gating where
        // implemented; pre-existing gaps in those gates are tracked separately.
        // Mktg OS agents is dark-launched: when its flag is on, the entry is inserted between
        // Documents (last of projectLensItems) and the Governance section in the project sidebar.
        const mktgOsItems = this.isMktgOsAgentsEnabled() ? [this.mktgOsAgentsNavItem] : [];
        const base = [...this.projectLensItems, ...mktgOsItems, this.projectGovernanceSection];
        return this.canSeeNewsletters() ? [...base, this.projectCommunicationsSection] : base;
      }
      case 'org':
        return this.isOrgLensEnabled() ? this.visibleOrgLensItems() : this.visibleMeLensItems();
      default:
        return this.visibleMeLensItems();
    }
  });

  private readonly visibleOrgLensItems = computed((): SidebarMenuItem[] => {
    if (!this.isOrgLensRoiEnabled()) return this.orgLensItems;
    const projectsIndex = this.orgLensItems.findIndex((item) => item.routerLink === '/org/projects');
    // Append rather than prepend if Projects ever goes away, so ROI can't silently jump to the top.
    if (projectsIndex === -1) return [...this.orgLensItems, this.orgRoiNavItem];
    const afterProjects = projectsIndex + 1;
    return [...this.orgLensItems.slice(0, afterProjects), this.orgRoiNavItem, ...this.orgLensItems.slice(afterProjects)];
  });

  // Me Lens nav with feature-flagged sections stripped (Security/Akrites is dark-launched).
  private readonly visibleMeLensItems = computed((): SidebarMenuItem[] =>
    this.isAkritesEnabled() ? this.meLensItems : this.meLensItems.filter((item) => item.label !== 'Security')
  );

  // --- Me Lens Items ---
  // Crowdfunding is a top-level section (peer of My Engagement / My Growth), with its
  // sub-pages as section children. Security/Akrites is filtered out reactively in visibleMeLensItems.
  private readonly meLensItems: SidebarMenuItem[] = [
    {
      label: 'My Dashboard',
      icon: 'fa-light fa-grid-2',
      routerLink: '/',
    },
    {
      label: 'My Engagement',
      isSection: true,
      expanded: true,
      items: [
        {
          label: 'My Meetings',
          icon: 'fa-light fa-calendar',
          routerLink: '/meetings',
        },
        {
          label: 'My Events',
          icon: 'fa-light fa-ticket',
          routerLink: '/events',
        },
        {
          label: 'My Meetups',
          icon: 'fa-light fa-handshake',
          routerLink: '/meetups',
        },
        {
          label: 'My ' + COMMITTEE_LABEL.plural,
          icon: 'fa-light fa-users-rectangle',
          routerLink: '/groups',
        },
        {
          label: 'My ' + MAILING_LIST_LABEL.plural,
          icon: 'fa-light fa-envelope',
          routerLink: '/mailing-lists',
        },
        {
          label: 'My Newsletters',
          icon: 'fa-light fa-paper-plane',
          routerLink: '/newsletters/my',
          testId: 'sidebar-my-newsletters',
        },
        {
          label: 'My ' + VOTE_LABEL.plural,
          icon: 'fa-light fa-check-to-slot',
          routerLink: '/votes',
        },
        {
          label: 'My ' + SURVEY_LABEL.plural,
          icon: 'fa-light fa-clipboard-list',
          routerLink: '/surveys',
        },
        {
          label: 'My ' + DOCUMENT_LABEL.plural,
          icon: 'fa-light fa-folder-open',
          routerLink: '/documents',
        },
      ],
    },
    {
      label: 'Security',
      isSection: true,
      expanded: true,
      items: [
        {
          label: 'Akrites Program',
          icon: 'fa-light fa-shield-halved',
          routerLink: '/akrites',
        },
      ],
    },
    {
      label: 'My Growth',
      isSection: true,
      expanded: true,
      items: [
        {
          label: 'Training & Certifications',
          icon: 'fa-light fa-graduation-cap',
          routerLink: '/me/training',
        },
        {
          label: 'Badges',
          icon: 'fa-light fa-award',
          routerLink: '/badges',
        },
      ],
    },
    {
      label: 'Crowdfunding',
      isSection: true,
      expanded: true,
      items: [
        {
          label: 'My Initiatives',
          icon: 'fa-light fa-box-dollar',
          routerLink: '/crowdfunding/initiatives',
        },
        {
          label: 'My Donations',
          icon: 'fa-light fa-hand-heart',
          routerLink: '/crowdfunding/donations',
        },
      ],
    },
  ];

  // Whether the currently selected foundation has project-level data in Snowflake.
  // Drives the conditional "Projects" sidebar entry — hidden when the foundation has no rows.
  // `startWith(false)` inside the inner pipe clears the previous value while the next
  // foundation's request is in flight, so the nav doesn't momentarily show "Projects"
  // for a foundation that hasn't been verified yet.
  private readonly foundationHasProjects: Signal<boolean> = toSignal(
    toObservable(
      computed(() => {
        // Only query when an authenticated user is actually on the foundation lens — this signal
        // only drives the foundation "Projects" entry. DocsLayoutComponent injects this service
        // even on public /docs pages, so an ungated query would fire (and 401) for anonymous visitors.
        if (!this.userService.authenticated() || this.activeLens() !== 'foundation') {
          return '';
        }
        return this.projectContextService.selectedFoundation()?.slug ?? '';
      })
    ).pipe(
      switchMap((slug) => {
        if (!slug) {
          return of(false);
        }
        return this.analyticsService.getFoundationProjectsDetail(slug).pipe(
          // Use totalCount (response-level aggregate) rather than projects.length
          // so the sidebar decision is decoupled from how many rows happen to be
          // included in the `projects` array.
          map((response) => response.totalCount > 0),
          startWith(false)
        );
      })
    ),
    { initialValue: false }
  );

  // Keeps isMarketingAuditor/isCampaignManager in sync with the active foundation — the root-scoped
  // fetch alone misses a per-project grant (LFXV2-2235 review finding). Read in canSeeMarketing below
  // to register the dependency; the refreshed value lives on PersonaService's own signals.
  // For project-lens-only marketing users, `selectedFoundation` is never populated because
  // foundation rows that the sidebar shows under the project lens are stored in `selectedProject`
  // (sidebar.component.ts:188-200). Fall back to selectedProject so the scoped probe fires as soon
  // as they pick any context, bootstrapping their first-session foundation grant.
  private readonly marketingPersonaSlug: Signal<string> = toSignal(
    toObservable(
      computed(() => {
        if (!this.isMarketingOpsFgaEnabled() || !this.userService.authenticated()) {
          return '';
        }
        return this.projectContextService.selectedFoundation()?.slug ?? this.projectContextService.selectedProject()?.slug ?? '';
      })
    ).pipe(
      switchMap((slug) => {
        if (!slug) {
          return of('');
        }
        return this.personaService.refreshEnrichedPersonas(false, slug).pipe(map(() => slug));
      })
    ),
    { initialValue: '' }
  );

  // --- Foundation Lens Items ---
  private readonly foundationLensItems = computed((): SidebarMenuItem[] => {
    // Marketing-only FGA users (marketing_auditor / campaign_manager with no board, root-writer,
    // LF-staff, or foundation-writer access) reach this lens via hasMarketingGrant but must only
    // see marketing-specific items. The full foundation sidebar (Dashboard, Meetings, Governance,
    // etc.) is only surfaced when the user has broader foundation-level access.
    const items: SidebarMenuItem[] = [];

    if (this.hasFullFoundationAccess()) {
      items.push({
        label: 'Dashboard',
        icon: 'fa-light fa-grid-2',
        routerLink: '/foundation/overview',
      });

      if (this.foundationHasProjects()) {
        items.push({
          label: 'Projects',
          icon: 'fa-light fa-diagram-project',
          routerLink: '/foundation/projects',
          testId: 'sidebar-foundation-projects',
        });
      }

      items.push(
        {
          label: 'Meetings',
          icon: 'fa-light fa-calendar',
          routerLink: '/foundation/meetings',
        },
        {
          label: 'Events',
          icon: 'fa-light fa-ticket',
          routerLink: '/foundation/events',
        },
        {
          label: MAILING_LIST_LABEL.plural,
          icon: 'fa-light fa-envelope',
          routerLink: '/foundation/mailing-lists',
        },
        {
          label: COMMITTEE_LABEL.plural,
          icon: 'fa-light fa-users-rectangle',
          routerLink: '/foundation/groups',
        },
        {
          label: DOCUMENT_LABEL.plural,
          icon: 'fa-light fa-folder-open',
          routerLink: '/foundation/documents',
        },
        {
          label: 'Governance',
          isSection: true,
          expanded: true,
          items: [
            {
              label: VOTE_LABEL.plural,
              icon: 'fa-light fa-check-to-slot',
              routerLink: '/foundation/votes',
            },
            {
              label: SURVEY_LABEL.plural,
              icon: 'fa-light fa-clipboard-list',
              routerLink: '/foundation/surveys',
            },
            {
              label: 'Permissions',
              icon: 'fa-light fa-shield',
              routerLink: '/foundation/settings',
            },
          ],
        }
      );

      if (this.canSeeNewsletters()) {
        items.push({
          label: 'Communications',
          isSection: true,
          expanded: true,
          items: [
            {
              label: 'Newsletters',
              icon: 'fa-light fa-paper-plane',
              routerLink: '/foundation/newsletters',
              testId: 'sidebar-foundation-newsletters',
            },
          ],
        });
      }

      if (this.personaService.canViewExecutiveDashboards()) {
        const metricsItems: SidebarMenuItem[] = [
          {
            label: 'Health Metrics',
            icon: 'fa-light fa-chart-line-up',
            routerLink: '/foundation/health-metrics',
            testId: 'sidebar-metrics-health-metrics',
          },
        ];

        const foundationSfid = this.projectContextService.selectedFoundationSfid();
        if (foundationSfid) {
          const pccBaseUrl = environment.urls.pcc;
          const baseUrl = pccBaseUrl.endsWith('/') ? pccBaseUrl.slice(0, -1) : pccBaseUrl;
          metricsItems.push({
            label: 'Social Listening',
            icon: 'fa-light fa-ear-listen',
            url: `${baseUrl}/project/${foundationSfid}/reports/social-listening`,
            target: '_blank',
            rel: 'noopener noreferrer',
            testId: 'sidebar-metrics-social-listening',
          });
        }

        items.push({
          label: 'Metrics',
          isSection: true,
          expanded: true,
          items: metricsItems,
        });
      }
    }

    // Marketing section visibility is independent of Metrics: while marketing-ops-fga-enabled is
    // on, a root/project-scoped marketing_auditor grant also unlocks Campaign Impact, and a
    // campaign_manager grant unlocks Campaigns — neither implies the other, so each item is built
    // independently and the section itself only appears once it has at least one item. LF Staff see
    // Campaign Impact via canViewExecutiveDashboards() the same as Metrics, but are restricted to the
    // Social Listening tab once inside — full Marketing Impact access is ED/marketing_auditor only
    // (LFXV2-2236 gap-analysis G4). Never widen the Metrics section itself for marketing_auditor.
    this.marketingPersonaSlug();
    const marketingItems: SidebarMenuItem[] = [];

    const canSeeMarketingImpact =
      this.personaService.canViewExecutiveDashboards() || (this.isMarketingOpsFgaEnabled() && this.personaService.isMarketingAuditor());
    if (canSeeMarketingImpact) {
      marketingItems.push({
        label: 'Campaign Impact',
        icon: 'fa-light fa-bullhorn',
        routerLink: '/foundation/marketing-impact',
        testId: 'sidebar-marketing-impact',
      });
    }

    // Campaigns needs ED, or — while marketing-ops-fga-enabled is on — a campaign_manager grant.
    // A campaign_manager-only user (no ED, no marketing_auditor, not LF Staff) must still see this
    // item, so it cannot be nested inside the Campaign Impact check above.
    const canSeeCampaigns =
      this.personaService.currentPersona() === 'executive-director' || (this.isMarketingOpsFgaEnabled() && this.personaService.isCampaignManager());
    if (canSeeCampaigns) {
      marketingItems.push({
        label: 'Campaigns',
        icon: 'fa-light fa-megaphone',
        routerLink: '/foundation/campaigns',
        testId: 'sidebar-marketing-campaigns',
      });
    }

    if (marketingItems.length > 0) {
      items.push({
        label: 'Marketing',
        isSection: true,
        expanded: true,
        items: marketingItems,
      });
    }

    return items;
  });

  // --- Project Lens Items (base) ---
  private readonly projectLensItems: SidebarMenuItem[] = [
    {
      label: 'Dashboard',
      icon: 'fa-light fa-grid-2',
      routerLink: '/project/overview',
    },
    {
      label: 'Meetings',
      icon: 'fa-light fa-calendar',
      routerLink: '/project/meetings',
    },
    {
      label: MAILING_LIST_LABEL.plural,
      icon: 'fa-light fa-envelope',
      routerLink: '/project/mailing-lists',
    },
    {
      label: COMMITTEE_LABEL.plural,
      icon: 'fa-light fa-users-rectangle',
      routerLink: '/project/groups',
    },
    {
      label: DOCUMENT_LABEL.plural,
      icon: 'fa-light fa-folder-open',
      routerLink: '/project/documents',
    },
  ];

  // --- Project Lens — Mktg OS agents (dark-launched; inserted directly under Documents in sidebarItems()) ---
  private readonly mktgOsAgentsNavItem: SidebarMenuItem = {
    label: MKTG_OS_AGENTS_LABEL.nav,
    icon: 'fa-light fa-robot',
    routerLink: '/project/mktg-os-agents',
    testId: 'sidebar-project-mktg-os-agents',
  };

  // --- Project Lens — Governance section (always surfaced under the Project lens) ---
  private readonly projectGovernanceSection: SidebarMenuItem = {
    label: 'Governance',
    isSection: true,
    expanded: true,
    items: [
      {
        label: VOTE_LABEL.plural,
        icon: 'fa-light fa-check-to-slot',
        routerLink: '/project/votes',
      },
      {
        label: SURVEY_LABEL.plural,
        icon: 'fa-light fa-clipboard-list',
        routerLink: '/project/surveys',
      },
      {
        label: 'Permissions',
        icon: 'fa-light fa-shield',
        routerLink: '/project/settings',
      },
    ],
  };

  // Project-lens Communications section (ED-only); appended dynamically in sidebarItems().
  private readonly projectCommunicationsSection: SidebarMenuItem = {
    label: 'Communications',
    isSection: true,
    expanded: true,
    items: [
      {
        label: 'Newsletters',
        icon: 'fa-light fa-paper-plane',
        routerLink: '/project/newsletters',
        testId: 'sidebar-project-newsletters',
      },
    ],
  };

  private readonly orgRoiNavItem: SidebarMenuItem = {
    label: 'ROI Metrics',
    icon: 'fa-light fa-chart-mixed-up-circle-dollar',
    routerLink: '/org/roi',
    testId: 'sidebar-org-roi',
  };

  private readonly orgLensItems: SidebarMenuItem[] = [
    {
      label: 'Dashboard',
      icon: 'fa-light fa-grid-2',
      routerLink: '/org/overview',
    },
    {
      label: 'Memberships',
      icon: 'fa-light fa-folder-bookmark',
      routerLink: '/org/memberships',
    },
    {
      label: 'Projects',
      icon: 'fa-light fa-folder',
      routerLink: '/org/projects',
    },
    // INFO: Future Epic implementation — the Governance page is hidden until built. Restore as a
    // top-level item or a section when re-enabled.
    {
      label: 'Organization Engagement',
      isSection: true,
      expanded: true,
      items: [
        {
          label: 'People',
          icon: 'fa-light fa-people-group',
          routerLink: '/org/people',
        },
        {
          label: 'Code Contributions',
          icon: 'fa-light fa-code',
          routerLink: '/org/contributions',
        },
        {
          label: 'Events',
          icon: 'fa-light fa-ticket',
          routerLink: '/org/events',
        },
        {
          label: 'Training & Certification',
          icon: 'fa-light fa-graduation-cap',
          routerLink: '/org/training',
        },
        { label: 'Meetings', icon: 'fa-light fa-video', routerLink: '/org/meetings' },
        { label: COMMITTEE_LABEL.plural, icon: 'fa-light fa-users-rectangle', routerLink: '/org/groups' },
      ],
    },
    // Org admin — divider only (no section label); Profile sits under it.
    {
      label: 'Organization Profile',
      icon: 'fa-light fa-memo',
      routerLink: '/org/profile',
      dividerBefore: true,
    },
  ];

  private initCanSeeNewsletters(): Signal<boolean> {
    return computed(() => this.personaService.currentPersona() === 'executive-director' || this.projectContextService.canWrite());
  }
}
