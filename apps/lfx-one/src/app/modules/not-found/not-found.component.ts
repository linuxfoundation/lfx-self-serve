// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, Location } from '@angular/common';
import { Component, inject, PLATFORM_ID } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { HeaderComponent } from '@components/header/header.component';

@Component({
  selector: 'lfx-not-found',
  imports: [HeaderComponent, CardComponent, ButtonComponent, RouterLink],
  templateUrl: './not-found.component.html',
})
export class NotFoundComponent {
  private readonly location = inject(Location);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);

  protected goBack(): void {
    if (isPlatformBrowser(this.platformId) && window.history.length > 1) {
      this.location.back();
    } else {
      void this.router.navigate(['/']);
    }
  }
}
