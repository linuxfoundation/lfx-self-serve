// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, effect, inject, model, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import { ImpersonationBannerComponent } from '@components/impersonation-banner/impersonation-banner.component';
import { LensSwitcherComponent } from '@components/lens-switcher/lens-switcher.component';
import { SidebarComponent } from '@components/sidebar/sidebar.component';
import { ALL_LENSES } from '@lfx-one/shared/constants';
import { Lens } from '@lfx-one/shared/interfaces';
import { AppService } from '@services/app.service';
import { LensService } from '@services/lens.service';
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

  /**
   * A route lens that {@link LensService.setLens} refused, held for retry.
   *
   * The allowed lens set is partly derived from `writer` grants, which arrive after hydration
   * (LFXV2-2754), so a deep link or hard refresh onto a lens-prefixed route can run before the
   * grants land. Dropping the refusal there would strand the user on a `/foundation/...` URL with
   * the lens still `me` — `activeContext` would then resolve the wrong slot and the page would act
   * on the wrong project. Retried by the effect below once the set widens.
   */
  private readonly pendingRouteLens = signal<Lens | null>(null);

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

    // Re-assert a refused route lens when the allowed set widens. Reading `availableLenses`
    // registers the dependency, so this re-runs exactly when the grants resolve. The set only
    // ever widens, so this settles after one successful pass and cannot loop.
    effect(() => {
      this.lensService.availableLenses();
      const pending = this.pendingRouteLens();
      if (pending && this.lensService.setLens(pending)) {
        this.pendingRouteLens.set(null);
      }
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
      // Hold a refusal for retry rather than dropping it — the allowed set may still be widening.
      this.pendingRouteLens.set(this.lensService.setLens(lens) ? null : lens);
    }
  }
}
