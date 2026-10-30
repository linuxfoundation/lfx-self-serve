// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { AppFooterComponent } from '@components/app-footer/app-footer.component';
import { NavbarComponent } from '@components/navbar/navbar.component';
import { LensService } from '@services/lens.service';
import { NavbarCollapseService } from '@services/navbar-collapse.service';
import { SidebarNavService } from '@services/sidebar-nav.service';
import { filter, map, startWith } from 'rxjs';

import { DocsSidebarNavComponent } from '../../modules/docs/components/docs-sidebar-nav/docs-sidebar-nav.component';
import { UserService } from '../../shared/services/user.service';

/**
 * Auth-aware shell for the public-facing user documentation portal (`/docs/**`).
 *
 * Renders one of two side-rails depending on `UserService.authenticated`:
 *
 *   - Authenticated → mounts the lens-driven `<lfx-navbar>` (lens tabs,
 *     context card, menu built by `SidebarNavService`, account/rail actions)
 *     (FR-009a). The previously-active lens tab stays
 *     selected and no menu item is active on a `/docs` route, so the user
 *     can hop back to `/dashboard`, `/foundation`, etc. without leaving `/docs`.
 *   - Unauthenticated → mounts `DocsSidebarNavComponent` — the public
 *     minimal shell (docs icon + "What's new" + sign-in CTA), no lens
 *     switcher, no avatar (FR-009b).
 *
 * The URL stays identical across auth flips (FR-009c) — only the rendered
 * chrome swaps. Keeping the swap in one component avoids the routing
 * flicker that two parallel route trees would introduce (research R6).
 *
 * Note on chrome reuse: the authenticated shell reuses the same lens-driven
 * navbar as `MainLayoutComponent` (via `SidebarNavService`),
 * so the lens navigation stays consistent across the app. The sidebar's
 * role under `/docs` is to keep the selected lens visible and offer a way
 * back to it — no menu item is active on a `/docs` route.
 */
@Component({
  selector: 'lfx-docs-layout',
  standalone: true,
  imports: [NgClass, RouterModule, AppFooterComponent, NavbarComponent, DocsSidebarNavComponent],
  templateUrl: './docs-layout.component.html',
  styleUrl: './docs-layout.component.scss',
})
export class DocsLayoutComponent {
  protected readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly lensService = inject(LensService);
  private readonly sidebarNavService = inject(SidebarNavService);
  protected readonly navbarCollapse = inject(NavbarCollapseService);

  protected readonly isAuthenticated = computed(() => this.userService.authenticated());

  /** Left gutter: the lens navbar's docked width (288px open, 56px on its rail), or the public docs rail's. */
  protected readonly mainGutterClass = computed(() => {
    return this.isAuthenticated() ? this.navbarCollapse.gutterClass() : 'lg:ml-16';
  });

  // Shared lens nav — the previously-active lens tab stays selected in the docs shell (no menu item is active on a /docs route) so the user can return to their last lens.
  protected readonly activeLens = this.lensService.activeLens;
  protected readonly sidebarItems = this.sidebarNavService.sidebarItems;

  /**
   * `/login?returnTo=<current url>` for the mobile sign-in button. Tracks
   * the active URL via `NavigationEnd` so a visitor on
   * `/docs/meetings/schedule-meeting` lands back there after sign-in,
   * not on `/docs`. `router.events` is cold, so `startWith` seeds the
   * synchronous initial value and `requireSync` lets us skip a redundant
   * `initialValue` literal that would otherwise be dead code.
   */
  protected readonly signInHref = this.initSignInHref();

  private initSignInHref() {
    return toSignal(
      this.router.events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        map((event) => this.buildSignInHref(event.urlAfterRedirects)),
        startWith(this.buildSignInHref(this.router.url || '/docs'))
      ),
      { requireSync: true }
    );
  }

  private buildSignInHref(target: string): string {
    return `/login?returnTo=${encodeURIComponent(target)}`;
  }
}
