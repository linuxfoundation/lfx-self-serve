// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformServer } from '@angular/common';
import { Component, inject, PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ServerRequestContext } from '@lfx-one/shared/interfaces';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';

@Component({
  selector: 'lfx-not-found',
  imports: [CardComponent, ButtonComponent, RouterLink, OpenIntercomDirective],
  templateUrl: './not-found.component.html',
})
export class NotFoundComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly reqContext = inject(REQUEST_CONTEXT, { optional: true }) as ServerRequestContext | null;

  public constructor() {
    // Signal the SSR handler to emit a real HTTP 404 at the originally-requested path (no redirect).
    if (isPlatformServer(this.platformId) && this.reqContext) {
      this.reqContext.notFound = true;
    }
  }
}
