// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { afterRenderEffect, ChangeDetectionStrategy, Component, ElementRef, inject, PLATFORM_ID, viewChild } from '@angular/core';

import { OpenIntercomDirective } from '../../directives/open-intercom.directive';
import { ChunkLoadRecoveryService } from '../../services/chunk-load-recovery.service';
import { UiButtonComponent } from '../../uikit/button/button.component';

/** Eager root-level recovery UI: never replaces the current route or destroys unsaved forms. */
@Component({
  selector: 'lfx-chunk-load-recovery',
  imports: [UiButtonComponent, OpenIntercomDirective],
  templateUrl: './chunk-load-recovery.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChunkLoadRecoveryComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly recoveryPanel = viewChild<ElementRef<HTMLElement>>('recoveryPanel');
  protected readonly recovery = inject(ChunkLoadRecoveryService);

  public constructor() {
    // Run after the layout releases its trap. Never steal an edit or focus a destructive action:
    // a key intended for the previous control must not become an accidental page reload.
    afterRenderEffect(() => {
      if (isPlatformBrowser(this.platformId) && this.recovery.needsReload()) {
        const panel = this.recoveryPanel()?.nativeElement;
        if (this.shouldRecoverFocus()) panel?.focus({ preventScroll: true });
      }
    });
  }

  private shouldRecoverFocus(): boolean {
    const active = this.document.activeElement;
    const inert = !!active?.closest('[inert]');
    const editing = !!active?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    // An editable control inside the drawer is still an edit worth preserving. The trap is
    // released independently, so Tab can reach recovery without moving focus out of the field.
    if (editing && !inert) return false;
    return !active || active === this.document.body || inert || !!active.closest('[data-testid="mobile-sidebar-drawer"]');
  }
}
