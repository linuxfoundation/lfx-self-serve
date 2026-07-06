// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { LensSwitcherComponent } from '@components/lens-switcher/lens-switcher.component';
import { SidebarComponent } from '@components/sidebar/sidebar.component';
import { LensService } from '@services/lens.service';
import { SidebarNavService } from '@services/sidebar-nav.service';
import { filter, map, startWith } from 'rxjs';

import { DocsSidebarNavComponent } from '../../modules/docs/components/docs-sidebar-nav/docs-sidebar-nav.component';
import { UserService } from '../../shared/services/user.service';

/**
 * Auth-aware shell for the public-facing user documentation portal (`/docs/**`).
 *
 * Renders one of two side-rails depending on `UserService.authenticated`:
 *
 *   - Authenticated → mounts the slim rail (`LensSwitcherComponent` with
 *     `[showLensButtons]="false"` — lens switching now lives in the sidebar
 *     tabs) alongside the full lens-driven `<lfx-sidebar>` built by
 *     `SidebarNavService` (FR-009a). The previously-active lens tab stays
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
 * Note on chrome reuse: the authenticated shell reuses the same rail +
 * lens-driven sidebar as `MainLayoutComponent` (via `SidebarNavService`),
 * so the lens navigation stays consistent across the app. The sidebar's
 * role under `/docs` is to keep the selected lens visible and offer a way
 * back to it — no menu item is active on a `/docs` route.
 */
@Component({
  selector: 'lfx-docs-layout',
  standalone: true,
  imports: [NgClass, RouterModule, LensSwitcherComponent, SidebarComponent, DocsSidebarNavComponent],
  templateUrl: './docs-layout.component.html',
  styleUrl: './docs-layout.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class DocsLayoutComponent {
  protected readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly lensService = inject(LensService);
  private readonly sidebarNavService = inject(SidebarNavService);

  protected readonly isAuthenticated = computed(() => this.userService.authenticated());

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
