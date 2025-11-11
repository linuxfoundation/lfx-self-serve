// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { AppService } from '@app/shared/services/app.service';
import { SidebarComponent } from '@components/sidebar/sidebar.component';
import { SidebarMenuItem } from '@lfx-one/shared/interfaces';
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

  // Expose mobile sidebar state from service
  protected readonly showMobileSidebar = this.appService.showMobileSidebar;

  // Sidebar navigation items
  protected readonly sidebarItems: SidebarMenuItem[] = [
    {
      label: 'Home',
      icon: 'fa-light fa-house',
      routerLink: '/',
    },
    {
      label: 'Meetings',
      icon: 'fa-light fa-video',
      routerLink: '/meetings',
    },
  ];

  // Sidebar footer items
  protected readonly sidebarFooterItems: SidebarMenuItem[] = [
    {
      label: 'Documentation',
      icon: 'fa-light fa-file-lines',
      url: 'https://docs.lfx.linuxfoundation.org',
      disabled: true,
    },
    {
      label: 'Submit a Ticket',
      icon: 'fa-light fa-circle-question',
      url: 'https://jira.linuxfoundation.org/plugins/servlet/theme/portal/4',
    },
    {
      label: 'Changelog',
      icon: 'fa-light fa-rectangle-history',
      routerLink: '/changelog',
      disabled: true,
    },
    {
      label: 'Settings',
      icon: 'fa-light fa-gear',
      routerLink: '/settings',
      disabled: true,
    },
    {
      label: 'Profile',
      icon: 'fa-light fa-user',
      routerLink: '/profile',
    },
  ];

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
