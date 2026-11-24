// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import {
  ACCOUNT_SETTINGS_DESCRIPTION,
  ACCOUNT_SETTINGS_NAV,
  ACCOUNT_SETTINGS_TITLE,
  IMPERSONATION_BANNER_HEIGHT_PX,
  NAVBAR_MOBILE_TOP_BAR_HEIGHT_PX,
  NAVBAR_MOBILE_TOP_BAR_MEDIA_QUERY,
} from '@lfx-one/shared/constants';
import { AccountSettingsNavGroup } from '@lfx-one/shared/interfaces';
import { AccountUnsavedChangesService } from '@services/account-unsaved-changes.service';
import { LinkedEmailSupportToastComponent } from '@components/linked-email-support-toast/linked-email-support-toast.component';
import { NavbarCollapseService } from '@services/navbar-collapse.service';
import { ProfileAuthReturnService } from '@services/profile-auth-return.service';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { injectIsMobileViewport } from '@shared/utils/mobile-viewport.util';

/**
 * The Account & Settings shell (#6067, behind the profile redesign flag): a sticky header, a grouped 240px left nav and
 * the page outlet. It takes over the Profile & Account hub's account tabs, and with them the Flow C return handling.
 */
@Component({
  selector: 'lfx-account-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LinkedEmailSupportToastComponent, UiButtonComponent],
  providers: [ProfileAuthReturnService],
  templateUrl: './account-layout.component.html',
  // Negative margins cancel main-layout's page padding, so the white page and its sticky header run edge to edge.
  host: { class: 'block -mx-5 -my-6 md:-mx-8', '(window:scroll)': 'onScroll()', '(window:resize)': 'measureHeader()' },
})
export class AccountLayoutComponent {
  private readonly userService = inject(UserService);
  private readonly navbarCollapse = inject(NavbarCollapseService);
  private readonly authReturn = inject(ProfileAuthReturnService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly belowLg = injectIsMobileViewport(NAVBAR_MOBILE_TOP_BAR_MEDIA_QUERY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly header = viewChild<ElementRef<HTMLElement>>('header');
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly title = ACCOUNT_SETTINGS_TITLE;
  protected readonly description = ACCOUNT_SETTINGS_DESCRIPTION;
  protected readonly navGroups: AccountSettingsNavGroup[] = ACCOUNT_SETTINGS_NAV;
  protected readonly impersonating = this.userService.impersonating;
  /** The shown page's unsaved changes, for the header save bar. */
  protected readonly unsavedChanges = inject(AccountUnsavedChangesService);
  /** True on the landing page at `/account`, which lists every page itself and so drops the left nav and header rule. */
  protected readonly isLanding: Signal<boolean> = this.initIsLanding();
  /** Hidden while impersonating, when editing is disabled. */
  protected readonly showSaveBar = computed(() => this.unsavedChanges.dirty() && !this.impersonating());
  /** Whether keyboard focus is on a save bar button, so it can be moved before the bar goes away. */
  protected saveBarHasFocus = false;

  /** Shows the fade under the header once the page has scrolled. */
  protected readonly scrolled = signal(false);
  // Measured in the browser; the fallback approximates the header's rendered height before hydration.
  private readonly headerHeightPx = signal(96);

  /** Where the header pins: under the impersonation banner and, on a touch device below lg, the layout's top bar. */
  protected readonly headerTopPx: Signal<number> = this.initHeaderTopPx();
  /** Where the left nav pins: 20px under the header. */
  protected readonly navTopPx: Signal<number> = computed(() => this.headerTopPx() + this.headerHeightPx() + 20);

  public constructor() {
    // A profile save stashed before a Flow C redirect is only written by the hub's edit drawer, which returns to the hub,
    // so nothing here shows it; the save itself still lands.
    this.authReturn.listen(() => undefined);
    // Save or Revert clears the changes and the bar goes with the button that had focus; focus moves to the heading rather
    // than falling back to the page body.
    toObservable(this.showSaveBar)
      .pipe(takeUntilDestroyed())
      .subscribe((shown) => {
        if (shown || !this.saveBarHasFocus) return;
        this.saveBarHasFocus = false;
        afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
      });
    afterNextRender(() => {
      this.measureHeader();
      this.onScroll();
      // The header grows when its description wraps, such as beside the save bar, so the nav's offset follows its size.
      const header = this.header()?.nativeElement;
      if (header && typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => this.measureHeader());
        observer.observe(header);
        this.destroyRef.onDestroy(() => observer.disconnect());
      }
    });
  }

  protected onSaveBarFocusOut(event: FocusEvent): void {
    this.saveBarHasFocus = event.currentTarget instanceof Element && event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget);
  }

  protected onScroll(): void {
    if (isPlatformBrowser(this.platformId)) this.scrolled.set(window.scrollY > 2);
  }

  protected measureHeader(): void {
    const header = this.header()?.nativeElement;
    if (header) this.headerHeightPx.set(header.offsetHeight);
  }

  private initIsLanding(): Signal<boolean> {
    // The landing page is the shell's empty-path child. The child's snapshot is only assigned once it activates, after this
    // layout is built, so it may be missing at first; each NavigationEnd reads it again.
    const atLanding = () => this.route.firstChild?.snapshot?.routeConfig?.path === '';
    return toSignal(
      this.router.events.pipe(
        filter((event) => event instanceof NavigationEnd),
        map(() => atLanding())
      ),
      { initialValue: atLanding() }
    );
  }

  private initHeaderTopPx(): Signal<number> {
    return computed(
      () =>
        (this.impersonating() ? IMPERSONATION_BANNER_HEIGHT_PX : 0) +
        (this.belowLg() && !this.navbarCollapse.railAtAnyWidth() ? NAVBAR_MOBILE_TOP_BAR_HEIGHT_PX : 0)
    );
  }
}
