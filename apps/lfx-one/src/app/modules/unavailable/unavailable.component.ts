// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformServer, Location } from '@angular/common';
import { Component, DestroyRef, inject, PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ServerRequestContext } from '@lfx-one/shared/interfaces';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ProjectRecoveryService } from '@shared/services/project-recovery.service';

@Component({
  selector: 'lfx-unavailable',
  imports: [CardComponent, ButtonComponent, RouterLink],
  templateUrl: './unavailable.component.html',
})
export class UnavailableComponent {
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly projectRecoveryService = inject(ProjectRecoveryService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly reqContext = inject(REQUEST_CONTEXT, { optional: true }) as ServerRequestContext | null;
  private readonly destroyRef = inject(DestroyRef);

  public constructor() {
    this.destroyRef.onDestroy(() => {
      this.projectRecoveryService.retryUrl = undefined;
    });
    if (isPlatformServer(this.platformId) && this.reqContext) {
      this.reqContext.unavailable = true;
    }
  }

  public retry(): void {
    const path = this.projectRecoveryService.retryUrl ?? this.location.path(true);
    void this.router.navigateByUrl(!path || path.startsWith('/unavailable') ? '/' : path);
  }
}
