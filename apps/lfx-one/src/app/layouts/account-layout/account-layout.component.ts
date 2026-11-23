// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, computed, ElementRef, inject, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import {
  ACCOUNT_SETTINGS_DESCRIPTION,
  ACCOUNT_SETTINGS_NAV,
  ACCOUNT_SETTINGS_TITLE,
  IMPERSONATION_BANNER_HEIGHT_PX,
  NAVBAR_MOBILE_TOP_BAR_HEIGHT_PX,
  NAVBAR_MOBILE_TOP_BAR_MEDIA_QUERY,
} from '@lfx-one/shared/constants';
import { AccountSettingsNavGroup } from '@lfx-one/shared/interfaces';
import { LinkedEmailSupportToastComponent } from '@components/linked-email-support-toast/linked-email-support-toast.component';
import { NavbarCollapseService } from '@services/navbar-collapse.service';
import { ProfileAuthReturnService } from '@services/profile-auth-return.service';
import { UserService } from '@services/user.service';
import { injectIsMobileViewport } from '@shared/utils/mobile-viewport.util';

/**
 * The Account & Settings shell (#6067, behind the profile redesign flag): a sticky header, a grouped 240px left nav and
 * the page outlet. It takes over the Profile & Account hub's account tabs, and with them the Flow C return handling.
 */
@Component({
  selector: 'lfx-account-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LinkedEmailSupportToastComponent],
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
  private readonly header = viewChild<ElementRef<HTMLElement>>('header');

  protected readonly title = ACCOUNT_SETTINGS_TITLE;
  protected readonly description = ACCOUNT_SETTINGS_DESCRIPTION;
  protected readonly navGroups: AccountSettingsNavGroup[] = ACCOUNT_SETTINGS_NAV;
  protected readonly impersonating = this.userService.impersonating;

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
    afterNextRender(() => {
      this.measureHeader();
      this.onScroll();
    });
  }

  protected onScroll(): void {
    if (isPlatformBrowser(this.platformId)) this.scrolled.set(window.scrollY > 2);
  }

  protected measureHeader(): void {
    const header = this.header()?.nativeElement;
    if (header) this.headerHeightPx.set(header.offsetHeight);
  }

  private initHeaderTopPx(): Signal<number> {
    return computed(
      () =>
        (this.impersonating() ? IMPERSONATION_BANNER_HEIGHT_PX : 0) +
        (this.belowLg() && !this.navbarCollapse.railAtAnyWidth() ? NAVBAR_MOBILE_TOP_BAR_HEIGHT_PX : 0)
    );
  }
}
