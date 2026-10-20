// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { ImpersonationDialogComponent } from '@components/impersonation-dialog/impersonation-dialog.component';
import { ImpersonationService } from '@services/impersonation.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

@Component({
  selector: 'lfx-impersonation-banner',
  imports: [ButtonComponent],
  templateUrl: './impersonation-banner.component.html',
})
export class ImpersonationBannerComponent {
  private readonly impersonationService = inject(ImpersonationService);
  private readonly dialogService = inject(DialogService);
  protected readonly userService = inject(UserService);
  protected readonly transitioning = computed(() => this.impersonationService.transition() !== null);

  protected openSwitchDialog(): void {
    this.dialogService.open(ImpersonationDialogComponent, {
      header: 'Switch Impersonated User',
      width: '400px',
      modal: true,
      draggable: false,
      resizable: false,
      data: { switching: true },
    });
  }

  protected stopImpersonation(): void {
    if (this.transitioning()) {
      return;
    }

    // The transition stays set after success so the page-level overlay covers the reload; the service clears it on error.
    this.impersonationService
      .stopImpersonation()
      .pipe(take(1))
      .subscribe({
        next: () => {
          if (typeof window !== 'undefined') {
            window.location.reload();
          }
        },
      });
  }
}
