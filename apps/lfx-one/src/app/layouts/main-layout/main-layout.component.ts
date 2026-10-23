// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, NgClass } from '@angular/common';
import { afterNextRender, Component, ElementRef, HostListener, inject, Injector, linkedSignal, model, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import { ImpersonationBannerComponent } from '@components/impersonation-banner/impersonation-banner.component';
import { AppFooterComponent } from '@components/app-footer/app-footer.component';
import { NavbarComponent } from '@components/navbar/navbar.component';
import { ALL_LENSES } from '@lfx-one/shared/constants';
import { Lens } from '@lfx-one/shared/interfaces';
import { isProfileHubPath } from '@lfx-one/shared/utils';
import { AppService } from '@services/app.service';
import { LensService } from '@services/lens.service';
import { ProjectContextService } from '@services/project-context.service';
import { SidebarNavService } from '@services/sidebar-nav.service';
import { UserService } from '@services/user.service';
import { FocusTrap } from 'primeng/focustrap';
import { distinctUntilChanged, filter, map, skip } from 'rxjs';

@Component({
  selector: 'lfx-main-layout',
  imports: [NgClass, RouterModule, AppFooterComponent, NavbarComponent, FocusTrap, ImpersonationBannerComponent],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss',
})
export class MainLayoutComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly appService = inject(AppService);
  private readonly lensService = inject(LensService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly sidebarNavService = inject(SidebarNavService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  protected readonly userService = inject(UserService);

  private readonly mobileDrawer = viewChild<ElementRef<HTMLElement>>('mobileDrawer');
  private readonly mobileMenuButton = viewChild<ElementRef<HTMLButtonElement>>('mobileMenuButton');

  // Expose mobile sidebar state from service
  protected readonly showMobileSidebar = this.appService.showMobileSidebar;

  // The drawer's navbar mounts on the first open and then stays, so it is never torn down mid-slide and below `lg`
  // only — a desktop session never opens the drawer and never builds a second navbar.
  protected readonly mobileNavbarMounted = linkedSignal<boolean, boolean>({
    source: this.showMobileSidebar,
    computation: (open, previous) => open || (previous?.value ?? false),
  });

  // Project/foundation selector panel open state (drives the main-content backdrop)
  protected readonly selectorPanelOpen = model(false);

  // Active lens from service
  protected readonly activeLens = this.lensService.activeLens;

  // Lens-aware sidebar items (built by SidebarNavService; shared with the docs shell).
  protected readonly sidebarItems = this.sidebarNavService.sidebarItems;

  // True on the /profile hub — drives the 2xl:pr-[300px] right gutter on <main> at 2xl and up so
  // content/footer clear the fixed rail; below 2xl the panel renders inline instead. Only the
  // me-lens /profile route uses ProfileLayoutComponent.
  protected readonly isProfileHub = signal(false);

  /**
   * A route lens that {@link LensService.setLens} refused, held for retry.
   *
   * The allowed lens set is partly derived from `writer` grants, which arrive after hydration
   * (LFXV2-2754), so a deep link or hard refresh onto a lens-prefixed route can run before the
   * grants land. Dropping the refusal there would strand the user on a `/foundation/...` URL with
   * the lens still `me` — `activeContext` would then resolve the wrong slot and the page would act
   * on the wrong project. Retried by the subscription below once the set widens.
   */
  private readonly pendingRouteLens = signal<Lens | null>(null);

  public constructor() {
    // Seed the profile-hub flag from the current URL so the right gutter is correct on the first
    // paint / hard load, before the first NavigationEnd fires.
    this.isProfileHub.set(isProfileHubPath(this.router.url));

    this.initDrawerFocus();

    // Close mobile sidebar and sync lens from route data on navigation
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        // Only a navigation the viewer made closes the mobile drawer. A page rewriting its own address in place —
        // Org Lens writing the default organization into `/org/{page}`, a page syncing its query params — lands with
        // `replaceUrl` and would snap a just-opened drawer shut, which on a phone reads as the menu not opening at
        // all. Back/forward (popstate) also lands with `replaceUrl`, and does close it.
        const navigation = this.router.currentNavigation();
        if (!navigation?.extras.replaceUrl || navigation.trigger === 'popstate') {
          this.appService.closeMobileSidebar();
        }
        this.selectorPanelOpen.set(false);
        this.isProfileHub.set(isProfileHubPath(this.router.url));
        this.syncLensFromRoute();
      });

    // Re-assert a refused route lens when the allowed set changes, i.e. when the writer grants
    // resolve. This terminates because `pendingRouteLens` is cleared on the successful pass and
    // re-armed only by a later navigation — not because the set is monotonic. It isn't: the
    // persona half can narrow when `PersonaService.refreshFromApi()` drops a cookie-claimed role.
    //
    // `availableLenses` is a computed returning a fresh array each recompute, so it re-emits on
    // unrelated persona/flag churn with identical content. Comparing the projected lens ids keeps
    // this to genuine changes — re-running on every churn would re-assert a lens the user may have
    // since changed by another path.
    toObservable(this.lensService.availableLenses)
      .pipe(
        map((lenses) => lenses.map((option) => option.id).join(',')),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        const pending = this.pendingRouteLens();
        if (pending && this.lensService.setLens(pending)) {
          this.pendingRouteLens.set(null);
        }
      });
  }

  /**
   * Open the mobile drawer from the header control. Always opens, never toggles: the open drawer and its
   * backdrop cover the control, so a toggle could only ever fire as a close when the state had drifted.
   */
  public openMobileSidebar(): void {
    this.appService.openMobileSidebar();
  }

  /** Close the mobile drawer from its backdrop. */
  public closeMobileSidebar(): void {
    this.appService.closeMobileSidebar();
  }

  /**
   * Escape closes the mobile drawer — unless an overlay opened above it (a navbar
   * popover or selector panel, a dialog, the What's New drawer, a nav tooltip) is still open: that overlay takes the key.
   * PrimeNG overlays stay in the DOM through their leave animation, and this listener is bound before any tooltip's.
   */
  @HostListener('document:keydown.escape')
  public onEscape(): void {
    const overlayAbove = this.document.querySelector('.p-popover, .p-dialog-mask, .p-drawer, .lfxn-tooltip.is-visible');
    if (!this.showMobileSidebar() || overlayAbove) {
      return;
    }
    this.closeMobileSidebar();
  }

  /**
   * Focus follows the mobile drawer, as a modal dialog's should: into the panel once it has rendered open, and back to
   * the menu button when it closes with focus inside it — or already dropped to <body> by the panel turning inert.
   * The initial closed state is skipped so a page load never moves focus.
   */
  private initDrawerFocus(): void {
    toObservable(this.showMobileSidebar)
      .pipe(distinctUntilChanged(), skip(1), takeUntilDestroyed())
      .subscribe((open) => {
        if (open) {
          afterNextRender(() => this.mobileDrawer()?.nativeElement.focus({ preventScroll: true }), { injector: this.injector });
          return;
        }
        const active = this.document.activeElement;
        if (active === this.document.body || this.mobileDrawer()?.nativeElement.contains(active)) {
          this.mobileMenuButton()?.nativeElement.focus({ preventScroll: true });
        }
      });
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
    // does not touch: no declared lens and no `?project=` param (e.g. `/badges`), where
    // it resets to `null`. On a lens route it re-asserts the value the guard set (idempotent); on a
    // flat `?project=` route it leaves the guard's derived kind alone — clobbering it there is the
    // bug that made a direct hit on `/meetings/create?project=<foundation>` resolve a null context.
    if (lens === 'foundation' || lens === 'project') {
      this.projectContextService.setRouteLensKind(lens);
    } else if (!hasProjectParam) {
      this.projectContextService.setRouteLensKind(null);
    }

    // Assigned on every navigation, including routes that carry no lens, so a pending retry from an
    // earlier route can never outlive it. Without that, switching lens from the switcher (which
    // navigates to a route that may carry no lens data) would leave the old value armed, and the
    // retry below would later clobber the user's explicit choice.
    const pending = lens && lens in ALL_LENSES && !this.lensService.setLens(lens) ? lens : null;
    this.pendingRouteLens.set(pending);
  }
}
