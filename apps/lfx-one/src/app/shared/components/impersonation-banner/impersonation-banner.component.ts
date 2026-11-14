// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Dialog } from '@angular/cdk/dialog';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { ImpersonationDialogComponent } from '@components/impersonation-dialog/impersonation-dialog.component';
import { IMPERSONATION_BANNER_HEIGHT_PX, IMPERSONATION_TRANSITION_MESSAGES } from '@lfx-one/shared/constants';
import { ImpersonationService } from '@services/impersonation.service';
import { UserService } from '@services/user.service';
import { updateTruncatedKeys } from '@shared/utils/truncation.util';
import { DialogService } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { take } from 'rxjs';

@Component({
  selector: 'lfx-impersonation-banner',
  imports: [ButtonComponent, TooltipModule],
  templateUrl: './impersonation-banner.component.html',
})
export class ImpersonationBannerComponent {
  private readonly impersonationService = inject(ImpersonationService);
  private readonly dialogService = inject(DialogService);
  private readonly cdkDialog = inject(Dialog);
  protected readonly userService = inject(UserService);
  protected readonly truncatedLabels = signal<ReadonlySet<string>>(new Set());
  protected readonly transitioning = computed(() => this.impersonationService.transition() !== null);
  protected readonly transitionMessage = computed(() => {
    const transition = this.impersonationService.transition();
    return transition ? IMPERSONATION_TRANSITION_MESSAGES[transition] : null;
  });

  public constructor() {
    const root = inject(DOCUMENT).documentElement;
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    // Overlays such as the drawer read the banner height to stay clear of it.
    toObservable(this.userService.impersonating)
      .pipe(takeUntilDestroyed())
      .subscribe((impersonating) => root.style.setProperty('--lfx-banner-height', `${impersonating ? IMPERSONATION_BANNER_HEIGHT_PX : 0}px`));
  }

  protected openSwitchDialog(): void {
    // The picker opens under CDK overlays such as drawers, and switching reloads the page anyway.
    this.cdkDialog.closeAll();
    this.dialogService.open(ImpersonationDialogComponent, {
      header: 'Switch Impersonated User',
      width: '400px',
      modal: true,
      draggable: false,
      resizable: false,
      data: { switching: true },
    });
  }

  /** Records whether a banner label is cut off, so its tooltip only shows when it adds something. */
  protected onLabelEnter(key: string, event: Event): void {
    this.truncatedLabels.set(updateTruncatedKeys(this.truncatedLabels(), key, event.currentTarget as HTMLElement));
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
