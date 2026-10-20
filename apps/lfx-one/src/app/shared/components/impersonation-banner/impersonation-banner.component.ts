// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { ImpersonationDialogComponent } from '@components/impersonation-dialog/impersonation-dialog.component';
import { ImpersonationService } from '@services/impersonation.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { finalize, take } from 'rxjs';

@Component({
  selector: 'lfx-impersonation-banner',
  imports: [ButtonComponent],
  templateUrl: './impersonation-banner.component.html',
})
export class ImpersonationBannerComponent {
  private readonly impersonationService = inject(ImpersonationService);
  private readonly dialogService = inject(DialogService);
  protected readonly userService = inject(UserService);
  protected readonly stoppingImpersonation = signal(false);

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
