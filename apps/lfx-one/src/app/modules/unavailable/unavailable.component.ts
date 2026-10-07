// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformServer, Location } from '@angular/common';
import { Component, inject, PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ServerRequestContext } from '@lfx-one/shared/interfaces';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';

@Component({
  selector: 'lfx-unavailable',
  imports: [CardComponent, ButtonComponent, RouterLink],
  templateUrl: './unavailable.component.html',
})
export class UnavailableComponent {
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly reqContext = inject(REQUEST_CONTEXT, { optional: true }) as ServerRequestContext | null;
  private readonly retryUrl: string | undefined;

  public constructor() {
    // Capture while navigation is active: skipLocationChange keeps the previous SPA address.
    const retryUrl = this.router.getCurrentNavigation()?.extras.state?.['retryUrl'];
    this.retryUrl = typeof retryUrl === 'string' ? retryUrl : undefined;
    if (isPlatformServer(this.platformId) && this.reqContext) {
      this.reqContext.unavailable = true;
    }
  }

  public retry(): void {
    const path = this.retryUrl ?? this.location.path(true);
    void this.router.navigateByUrl(!path || path.startsWith('/unavailable') ? '/' : path);
  }
}
