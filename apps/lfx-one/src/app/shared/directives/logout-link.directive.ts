// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, HostListener, inject } from '@angular/core';
import { IntercomService } from '@services/intercom.service';

// Shuts Intercom down when a full-page logout link is clicked, before the browser leaves the page —
// /logout is a server redirect, so no app code runs after the click. This is Intercom's documented
// logout call; the server's /logout also expires the `intercom-` cookies (clearIntercomCookies),
// which covers what shutdown leaves behind and pages that never booted the widget.
// The click's default navigation is left untouched.
@Directive({
  selector: '[lfxLogoutLink]',
})
export class LogoutLinkDirective {
  private readonly intercomService = inject(IntercomService);

  @HostListener('click')
  public onClick(): void {
    this.intercomService.shutdown();
  }
}
