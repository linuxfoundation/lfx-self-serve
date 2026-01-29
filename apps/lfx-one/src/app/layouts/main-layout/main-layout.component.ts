// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { SidebarComponent } from '@components/sidebar/sidebar.component';
import { environment } from '@environments/environment';
import { COMMITTEE_LABEL, MAILING_LIST_LABEL, MY_ACTIVITY_LABEL, SURVEY_LABEL, VOTE_LABEL } from '@lfx-one/shared/constants';
import { SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { AppService } from '@services/app.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonaService } from '@services/persona.service';
import { DrawerModule } from 'primeng/drawer';
import { filter } from 'rxjs';

import { DevToolbarComponent } from '../dev-toolbar/dev-toolbar.component';

@Component({
  selector: 'lfx-main-layout',
  imports: [NgClass, RouterModule, SidebarComponent, DrawerModule, DevToolbarComponent],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class MainLayoutComponent {
  private readonly router = inject(Router);
  private readonly appService = inject(AppService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly personaService = inject(PersonaService);

  // Expose mobile sidebar state from service (writable for two-way binding with p-drawer)
  protected readonly showMobileSidebar = this.appService.showMobileSidebar;

  // Feature flags
  private readonly showProjectsInSidebar = this.featureFlagService.getBooleanFlag('sidebar-projects', false);
  private readonly enableProfileClick = this.featureFlagService.getBooleanFlag('sidebar-profile', false);
  protected readonly showDevToolbar = this.featureFlagService.getBooleanFlag('dev-toolbar', true);

  // Governance section items - full list for maintainers
  // Order: Meetings, Mailing Lists, Groups, Votes, Surveys
  private readonly governanceSectionItems: SidebarMenuItem[] = [
    {
      label: 'Meetings',
      icon: 'fa-light fa-calendar',
      routerLink: '/meetings',
    },
    {
      label: MAILING_LIST_LABEL.plural,
      icon: 'fa-light fa-envelope',
      routerLink: '/mailing-lists',
    },
    {
      label: COMMITTEE_LABEL.plural,
      icon: 'fa-light fa-users',
      routerLink: '/groups',
    },
    {
      label: VOTE_LABEL.plural,
      icon: 'fa-light fa-check-to-slot',
      routerLink: '/votes',
    },
    {
      label: SURVEY_LABEL.plural,
      icon: 'fa-light fa-clipboard-list',
      routerLink: '/surveys',
    },
  ];

  // Board member governance items - excludes Votes and Surveys
  // Order: Meetings, Mailing Lists, Groups
  private readonly boardMemberGovernanceItems: SidebarMenuItem[] = [
    {
      label: 'Meetings',
      icon: 'fa-light fa-calendar',
      routerLink: '/meetings',
    },
    {
      label: MAILING_LIST_LABEL.plural,
      icon: 'fa-light fa-envelope',
      routerLink: '/mailing-lists',
    },
    {
      label: COMMITTEE_LABEL.plural,
      icon: 'fa-light fa-users',
      routerLink: '/groups',
    },
  ];

  // Computed sidebar items based on feature flags and persona
  protected readonly sidebarItems = computed(() => {
    const items: SidebarMenuItem[] = [];
    const isBoardMember = this.personaService.currentPersona() === 'board-member';

    // Always show Dashboard first
    items.push({
      label: 'Dashboard',
      icon: 'fa-light fa-grid-2',
      routerLink: '/',
    });

    // Add Projects if feature flag is enabled
    if (this.showProjectsInSidebar()) {
      items.push({
        label: 'Projects',
        icon: 'fa-light fa-folder-open',
        routerLink: '/projects',
      });
    }

    // For board members: Meetings, Mailing Lists, Groups, My Activity, then divider + Insights
    // For maintainers: Governance section with Meetings, Mailing Lists, Groups, Votes, Surveys, then divider + Insights
    if (isBoardMember) {
      // Add governance items directly (Meetings, Mailing Lists, Groups - excludes Votes/Surveys)
      items.push(...this.boardMemberGovernanceItems);

      // Add My Activity for board members
      items.push({
        label: MY_ACTIVITY_LABEL.singular,
        icon: 'fa-light fa-clipboard-list',
        routerLink: '/my-activity',
      });
    } else {
      // Governance section for maintainers (Meetings, Mailing Lists, Groups, Votes, Surveys)
      items.push({
        label: 'Governance',
        isSection: true,
        expanded: true,
        items: this.governanceSectionItems,
      });
    }

    // Insights URL - always shown below governance with a divider
    items.push({
      label: 'Insights',
      icon: 'fa-light fa-chart-column',
      url: 'https://insights.linuxfoundation.org/',
      target: '_blank',
      rel: 'noopener noreferrer',
      dividerBefore: true,
    });

    return items;
  });

  // Sidebar footer items - matching React NavigationSidebar design
  protected readonly sidebarFooterItems = computed(() => [
    {
      label: 'Profile',
      icon: 'fa-light fa-user',
      routerLink: '/profile',
      disabled: !this.enableProfileClick(), // Disable when feature flag is false
    },
    {
      label: 'Support',
      icon: 'fa-light fa-question-circle',
      url: environment.urls.support,
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    {
      label: 'Permissions',
      icon: 'fa-light fa-shield',
      routerLink: '/settings',
    },
    {
      label: 'Logout',
      icon: 'fa-light fa-sign-out',
      url: '/logout',
      target: '_self',
      rel: '',
    },
  ]);

  public constructor() {
    // Close mobile sidebar on navigation
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        this.appService.closeMobileSidebar();
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
}
