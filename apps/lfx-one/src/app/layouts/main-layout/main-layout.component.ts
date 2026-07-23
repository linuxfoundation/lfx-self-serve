// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, model } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import { ImpersonationBannerComponent } from '@components/impersonation-banner/impersonation-banner.component';
import { LensSwitcherComponent } from '@components/lens-switcher/lens-switcher.component';
import { SidebarComponent } from '@components/sidebar/sidebar.component';
import { ALL_LENSES } from '@lfx-one/shared/constants';
import { Lens } from '@lfx-one/shared/interfaces';
import { AppService } from '@services/app.service';
import { LensService } from '@services/lens.service';
import { ProjectContextService } from '@services/project-context.service';
import { SidebarNavService } from '@services/sidebar-nav.service';
import { UserService } from '@services/user.service';
import { DrawerModule } from 'primeng/drawer';
import { filter } from 'rxjs';

@Component({
  selector: 'lfx-main-layout',
  imports: [NgClass, RouterModule, SidebarComponent, DrawerModule, LensSwitcherComponent, ImpersonationBannerComponent],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class MainLayoutComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly appService = inject(AppService);
  private readonly lensService = inject(LensService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly sidebarNavService = inject(SidebarNavService);
  protected readonly userService = inject(UserService);

  // Expose mobile sidebar state from service (writable for two-way binding with p-drawer)
  protected readonly showMobileSidebar = this.appService.showMobileSidebar;

  // Project/foundation selector panel open state (drives the main-content backdrop)
  protected readonly selectorPanelOpen = model(false);

  // Active lens from service
  protected readonly activeLens = this.lensService.activeLens;

  // Lens-aware sidebar items (built by SidebarNavService; shared with the docs shell).
  protected readonly sidebarItems = this.sidebarNavService.sidebarItems;

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

  /** Toggle the mobile sidebar drawer from the header control. */
  public toggleMobileSidebar(): void {
    this.appService.toggleMobileSidebar();
  }

  /** Mirror the PrimeNG drawer's visibility back into app state when it closes itself (backdrop, Esc). */
  public onDrawerVisibilityChange(visible: boolean): void {
    if (!visible) {
      this.appService.closeMobileSidebar();
    }
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
    const hasProjectParam = currentRoute.snapshot.queryParamMap.has('project');

    // Clear the context service's route-kind override on routes the guard does not own, so a
    // foundation/project override from a previous route cannot leak into them.
    //
    // `projectQueryParamGuard` is the authoritative setter: it runs on every lens-prefixed route
    // AND every flat write route carrying a `?project=` param, and derives the kind from the route
    // or from the resolved project. This handler runs on NavigationEnd — *after* the guard — so it
    // must not overwrite what the guard just established. It therefore only acts on routes the guard
    // does not touch: no declared lens and no `?project=` param (e.g. `/profile`, `/badges`), where
    // it resets to `null`. On a lens route it re-asserts the value the guard set (idempotent); on a
    // flat `?project=` route it leaves the guard's derived kind alone — clobbering it there is the
    // bug that made a direct hit on `/meetings/create?project=<foundation>` resolve a null context.
    if (lens === 'foundation' || lens === 'project') {
      this.projectContextService.setRouteLensKind(lens);
    } else if (!hasProjectParam) {
      this.projectContextService.setRouteLensKind(null);
    }

    if (lens && lens in ALL_LENSES) {
      this.lensService.setLens(lens);
    }
  }
}
