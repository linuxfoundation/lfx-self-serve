// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, isPlatformServer, Location } from '@angular/common';
import { Component, inject, PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ServerRequestContext } from '@lfx-one/shared/interfaces';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';

@Component({
  selector: 'lfx-not-found',
  imports: [CardComponent, ButtonComponent, RouterLink],
  templateUrl: './not-found.component.html',
})
export class NotFoundComponent {
  private readonly location = inject(Location);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly reqContext = inject(REQUEST_CONTEXT, { optional: true }) as ServerRequestContext | null;

  public constructor() {
    // Signal the SSR handler to emit a real HTTP 404 at the originally-requested path (no redirect).
    if (isPlatformServer(this.platformId) && this.reqContext) {
      this.reqContext.notFound = true;
    }
  }

  protected goBack(): void {
    if (isPlatformBrowser(this.platformId) && window.history.length > 1) {
      this.location.back();
    } else {
      void this.router.navigate(['/']);
    }
  }
}
