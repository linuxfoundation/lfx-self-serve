// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { AppService } from '@app/shared/services/app.service';
import { FeatureFlagService } from '@app/shared/services/feature-flag.service';
import { SidebarComponent } from '@components/sidebar/sidebar.component';
import { environment } from '@environments/environment';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { filter } from 'rxjs';

@Component({
  selector: 'lfx-main-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, SidebarComponent],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class MainLayoutComponent {
  private readonly router = inject(Router);
  private readonly appService = inject(AppService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly personaService = inject(PersonaService);
  private readonly projectContextService = inject(ProjectContextService);

  // Expose mobile sidebar state from service
  protected readonly selectedProject = this.projectContextService.selectedProject;
  protected readonly showMobileSidebar = this.appService.showMobileSidebar;

  // Feature flags
  private readonly showProjectsInSidebar = this.featureFlagService.getBooleanFlag('sidebar-projects', false);
  private readonly enableProfileClick = this.featureFlagService.getBooleanFlag('sidebar-profile', false);

  // Base sidebar navigation items - matching React NavigationSidebar design
  private readonly baseSidebarItems: SidebarMenuItem[] = [
    {
      label: 'Overview',
      icon: 'fa-light fa-grid-2',
      routerLink: '/',
    },
    {
      label: 'Meetings',
      icon: 'fa-light fa-calendar',
      routerLink: '/meetings',
    },
    {
      label: COMMITTEE_LABEL.plural,
      icon: 'fa-light fa-users',
      routerLink: '/groups',
    },
    {
      label: 'Projects',
      icon: 'fa-light fa-folder-open',
      routerLink: '/projects',
    },
  ];

  // Computed sidebar items based on feature flags
  protected readonly sidebarItems = computed(() => {
    let items = [...this.baseSidebarItems];

    // Filter out Projects if feature flag is disabled
    if (!this.showProjectsInSidebar()) {
      items = items.filter((item) => item.label !== 'Projects');
    }

    if (this.personaService.currentPersona() === 'board-member') {
      items = items.filter((item) => item.label !== COMMITTEE_LABEL.plural);
    }

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

  public closeMobileSidebar(): void {
    this.appService.closeMobileSidebar();
  }
}
