// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { ImpersonationService } from '@services/impersonation.service';
import { UserService } from '@services/user.service';
import { finalize, take } from 'rxjs';

@Component({
  selector: 'lfx-impersonation-banner',
  imports: [ButtonComponent],
  templateUrl: './impersonation-banner.component.html',
})
export class ImpersonationBannerComponent {
  private readonly impersonationService = inject(ImpersonationService);
  protected readonly userService = inject(UserService);
  protected readonly stoppingImpersonation = signal(false);

  protected stopImpersonation(): void {
    if (this.stoppingImpersonation()) {
      return;
    }

    this.stoppingImpersonation.set(true);
    this.impersonationService
      .stopImpersonation()
      .pipe(
        take(1),
        finalize(() => this.stoppingImpersonation.set(false))
      )
      .subscribe({
        next: () => {
          if (typeof window !== 'undefined') {
            window.location.reload();
          }
        },
      });
  }
}
