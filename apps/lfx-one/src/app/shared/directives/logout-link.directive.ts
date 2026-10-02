// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, HostListener, inject } from '@angular/core';
import { IntercomService } from '@services/intercom.service';

// Shuts Intercom down when a full-page logout link is clicked, before the browser leaves the page.
// Intercom keeps the visitor's identity in its own first-party cookie, which only
// Intercom('shutdown') clears — /logout is a server redirect, so no app code runs after the click
// and the next visitor on the same browser would otherwise inherit the messenger session.
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
