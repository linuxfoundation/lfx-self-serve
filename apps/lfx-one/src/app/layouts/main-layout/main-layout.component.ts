// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, CUSTOM_ELEMENTS_SCHEMA, inject, model, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import { LensSwitcherComponent } from '@components/lens-switcher/lens-switcher.component';
import { SidebarComponent } from '@components/sidebar/sidebar.component';
import { ALL_LENSES, COMMITTEE_LABEL, DOCUMENT_LABEL, MAILING_LIST_LABEL, ORG_LENS_ENABLED_FLAG, SURVEY_LABEL, VOTE_LABEL } from '@lfx-one/shared/constants';
import { Lens, SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { AnalyticsService } from '@services/analytics.service';
import { AppService } from '@services/app.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { ImpersonationService } from '@services/impersonation.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { DrawerModule } from 'primeng/drawer';
import { filter, map, of, startWith, switchMap, take } from 'rxjs';

import { environment } from '@environments/environment';

import { ButtonComponent } from '@components/button/button.component';

@Component({
  selector: 'lfx-main-layout',
  imports: [NgClass, RouterModule, SidebarComponent, DrawerModule, LensSwitcherComponent, ButtonComponent],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class MainLayoutComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly appService = inject(AppService);
  private readonly personaService = inject(PersonaService);
  private readonly lensService = inject(LensService);
  private readonly impersonationService = inject(ImpersonationService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly featureFlagService = inject(FeatureFlagService);
  protected readonly userService = inject(UserService);

  /** Dark-launch gate; falls back to Me Lens nav when off. */
  private readonly isOrgLensEnabled = this.featureFlagService.getBooleanFlag(ORG_LENS_ENABLED_FLAG, false);

  // Expose mobile sidebar state from service (writable for two-way binding with p-drawer)
  protected readonly showMobileSidebar = this.appService.showMobileSidebar;

  // Project/foundation selector panel open state (drives the main-content backdrop)
  protected readonly selectorPanelOpen = model(false);

  // Active lens from service
  protected readonly activeLens = this.lensService.activeLens;

  // Newsletter nav visibility: ED persona always sees it; non-ED users see it
  // when they have writer (or owner-equivalent) permission on the currently
  // active foundation/project. canWrite() is reactive to context changes.
  private readonly canSeeNewsletters: Signal<boolean> = this.initCanSeeNewsletters();

  // Lens-aware sidebar items
  protected readonly sidebarItems = computed((): SidebarMenuItem[] => {
    switch (this.activeLens()) {
      case 'foundation':
        return this.foundationLensItems();
      case 'project': {
        // Governance (Votes / Surveys / Permissions) is always surfaced under Project lens —
        // matching Foundation lens behavior. Authorization for write actions (add user,
        // edit role, remove, etc.) is enforced server-side and by per-page UI gating where
        // implemented; pre-existing gaps in those gates are tracked separately.
        const base = this.projectLensItemsWithGovernance;
        return this.canSeeNewsletters() ? [...base, this.projectCommunicationsSection] : base;
      }
      case 'org':
        return this.isOrgLensEnabled() ? this.orgLensItems : this.meLensItems;
      default:
        return this.meLensItems;
    }
  });

  // --- Me Lens Items ---
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
          label: 'Mentorships',
          icon: 'fa-light fa-chalkboard-teacher',
          url: environment.urls.mentorship,
        },
        {
          label: 'Crowdfunding',
          icon: 'fa-light fa-circle-dollar',
          url: environment.urls.crowdfunding,
        },
        {
          label: 'Badges',
          icon: 'fa-light fa-award',
          routerLink: '/badges',
        },
      ],
    },
    {
      label: 'My Account',
      isSection: true,
      expanded: true,
      items: [
        {
          label: 'Profile',
          icon: 'fa-light fa-user',
          routerLink: '/profile',
        },
        {
          label: 'Settings',
          icon: 'fa-light fa-gear',
          routerLink: '/settings',
        },
        {
          label: 'Transactions',
          icon: 'fa-light fa-receipt',
          routerLink: '/me/transactions',
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
    toObservable(computed(() => this.projectContextService.selectedFoundation()?.slug ?? '')).pipe(
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

  // --- Foundation Lens Items ---
  private readonly foundationLensItems = computed((): SidebarMenuItem[] => {
    const items: SidebarMenuItem[] = [
      {
        label: 'Dashboard',
        icon: 'fa-light fa-grid-2',
        routerLink: '/foundation/overview',
      },
    ];

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

    if (this.personaService.currentPersona() === 'executive-director') {
      const metricsItems: SidebarMenuItem[] = [
        {
          label: 'Health Metrics',
          icon: 'fa-light fa-chart-line-up',
          routerLink: '/foundation/health-metrics',
          testId: 'sidebar-metrics-health-metrics',
        },
        {
          label: 'Marketing Impact',
          icon: 'fa-light fa-bullhorn',
          routerLink: '/foundation/marketing-impact',
          testId: 'sidebar-metrics-marketing-impact',
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

  // --- Project Lens Items with Governance (for non-board personas) ---
  private readonly projectLensItemsWithGovernance: SidebarMenuItem[] = [
    ...this.projectLensItems,
    {
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
    },
  ];

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

  private readonly orgLensItems: SidebarMenuItem[] = [
    {
      label: 'Org Overview',
      icon: 'fa-light fa-grid-2',
      routerLink: '/org/overview',
    },
    {
      label: 'Org Foundations',
      isSection: true,
      expanded: true,
      items: [
        {
          label: 'Memberships',
          icon: 'fa-light fa-display',
          routerLink: '/org/memberships',
        },
        {
          label: 'Projects',
          icon: 'fa-light fa-folder',
          routerLink: '/org/projects',
        },
        {
          label: 'ROI',
          icon: 'fa-light fa-chart-line-up',
          routerLink: '/org/roi',
        },
        {
          label: 'Governance',
          icon: 'fa-light fa-layer-group',
          routerLink: '/org/governance',
        },
      ],
    },
    {
      label: 'Org Engagement',
      isSection: true,
      expanded: true,
      items: [
        {
          label: 'People',
          icon: 'fa-light fa-users',
          routerLink: '/org/people',
        },
        {
          label: 'Code Contributions',
          icon: 'fa-light fa-code',
          routerLink: '/org/contributions',
        },
        {
          label: 'Events',
          icon: 'fa-light fa-calendar',
          routerLink: '/org/events',
        },
        {
          label: 'Training & Certification',
          icon: 'fa-light fa-graduation-cap',
          routerLink: '/org/training',
        },
        {
          label: 'Meetings',
          icon: 'fa-light fa-video',
          routerLink: '/org/meetings',
        },
        {
          label: COMMITTEE_LABEL.plural,
          icon: 'fa-light fa-users-rectangle',
          routerLink: '/org/groups',
        },
      ],
    },
    {
      label: 'Org Admin',
      isSection: true,
      expanded: true,
      items: [
        {
          label: 'Profile',
          icon: 'fa-light fa-file',
          routerLink: '/org/profile',
        },
      ],
    },
  ];

  public constructor() {
    // Close mobile sidebar and sync lens from route data on navigation
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        this.appService.closeMobileSidebar();
        this.selectorPanelOpen.set(false);
        this.syncLensFromRoute();
      });
  }

  public toggleMobileSidebar(): void {
    this.appService.toggleMobileSidebar();
  }

  public onDrawerVisibilityChange(visible: boolean): void {
    if (!visible) {
      this.appService.closeMobileSidebar();
    }
  }

  protected stopImpersonation(): void {
    this.impersonationService
      .stopImpersonation()
      .pipe(take(1))
      .subscribe(() => {
        window.location.reload();
      });
  }

  private initCanSeeNewsletters(): Signal<boolean> {
    return computed(() => this.personaService.currentPersona() === 'executive-director' || this.projectContextService.canWrite());
  }

  /**
   * Sync the active lens from the current route's data.lens property.
   * Ensures deep links and hard refreshes activate the correct lens.
   */
  private syncLensFromRoute(): void {
    let currentRoute = this.route;
    let lens: Lens | undefined = currentRoute.snapshot.data['lens'];
    while (currentRoute.firstChild) {
      currentRoute = currentRoute.firstChild;
      lens = currentRoute.snapshot.data['lens'] ?? lens;
    }
    if (lens && lens in ALL_LENSES) {
      this.lensService.setLens(lens);
    }
  }
}
