// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { afterRenderEffect, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, PLATFORM_ID, signal, viewChild } from '@angular/core';

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
  private readonly destroyRef = inject(DestroyRef);
  private readonly recoveryHome = viewChild<ElementRef<HTMLElement>>('recoveryHome');
  private readonly recoveryPanel = viewChild<ElementRef<HTMLElement>>('recoveryPanel');
  protected readonly recovery = inject(ChunkLoadRecoveryService);
  protected readonly inOverlay = signal(false);

  public constructor() {
    // Run after the layout releases its trap. Never steal an edit or focus a destructive action:
    // a key intended for the previous control must not become an accidental page reload.
    afterRenderEffect((onCleanup) => {
      if (isPlatformBrowser(this.platformId) && this.recovery.needsReload()) {
        const panel = this.recoveryPanel()?.nativeElement;
        const browser = this.document.defaultView;
        if (!panel || !browser) return;
        this.placeRecoveryPanel(panel);
        if (this.shouldRecoverFocus()) panel.focus({ preventScroll: true });
        // PrimeNG dynamic dialogs need not share a DialogService provider with the root.
        // Watch only while recovering, including overlays opened/closed after the failure.
        let frame: number | undefined;
        const observer = new MutationObserver(() => {
          if (frame !== undefined) return;
          frame = browser.requestAnimationFrame(() => {
            frame = undefined;
            if (this.recovery.needsReload()) this.placeRecoveryPanel(panel);
          });
        });
        observer.observe(this.document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-modal', 'inert'],
        });
        onCleanup(() => {
          observer.disconnect();
          if (frame !== undefined) browser.cancelAnimationFrame(frame);
        });
      }
    });
    this.destroyRef.onDestroy(() => {
      // Destruction can remove the owning view's DOM before callbacks run. Do not
      // reattach a destroyed panel; remove it wherever an overlay may be hosting it.
      this.recoveryPanel()?.nativeElement.remove();
    });
  }

  private placeRecoveryPanel(panel: HTMLElement): void {
    const home = this.recoveryHome()?.nativeElement;
    if (!home) return;
    const overlay = this.topOverlay();
    // A CDK container wraps the full-height drawer: a sibling AFTER that sheet
    // falls below the viewport. Keep recovery within the sheet's flex layout as
    // a nonshrinking footer; the body yields height and remains independently scrollable.
    const drawer = overlay?.matches('.cdk-dialog-container') ? overlay.querySelector<HTMLElement>('lfx-ui-drawer') : null;
    const destination = drawer ?? overlay ?? home;
    this.inOverlay.set(!!overlay);
    // PrimeNG's last sentinel wraps Tab: recovery MUST precede it, not follow it.
    const sentinel = destination.querySelector(':scope > [data-pc-section="lastfocusableelement"]');
    if (panel.parentElement === destination && (!sentinel || panel.nextElementSibling === sentinel)) return;
    const active = this.document.activeElement as HTMLElement | null;
    const hadRecoveryFocus = !!active && panel.contains(active);
    destination.insertBefore(panel, sentinel);
    // Moving a focused DOM subtree can blur it. Preserve deliberate action focus, but
    // never take focus from an editable field elsewhere in the open overlay.
    if (hadRecoveryFocus) active?.focus({ preventScroll: true });
    else if (this.shouldRecoverFocus()) panel.focus({ preventScroll: true });
  }

  private topOverlay(): HTMLElement | null {
    let top: HTMLElement | null = null;
    let topStack: number[] = [];
    // These are the actual trap roots, not the component hosts or modal masks.
    for (const overlay of this.document.querySelectorAll<HTMLElement>('.p-drawer, .p-dialog, .cdk-dialog-container')) {
      const stack: number[] = [];
      let visible = true;
      for (let ancestor: HTMLElement | null = overlay; ancestor; ancestor = ancestor.parentElement) {
        const style = this.document.defaultView?.getComputedStyle(ancestor);
        if (
          ancestor.hidden ||
          ancestor.hasAttribute('inert') ||
          ancestor.getAttribute('aria-hidden') === 'true' ||
          style?.display === 'none' ||
          style?.visibility === 'hidden'
        ) {
          visible = false;
          break;
        }
        if (style?.zIndex && style.zIndex !== 'auto') stack.unshift(Number(style.zIndex) || 0);
      }
      if (!visible) continue;
      // Compare ancestor stacking layers first (e.g. CDK's container vs PrimeNG's
      // root z-index), then DOM order for equal layers. Do not select by focus alone.
      let higher = true;
      for (let index = 0; index < Math.max(stack.length, topStack.length); index++) {
        const layer = stack[index] ?? 0;
        const topLayer = topStack[index] ?? 0;
        if (layer === topLayer) continue;
        higher = layer > topLayer;
        break;
      }
      if (!top || higher) {
        top = overlay;
        topStack = stack;
      }
    }
    return top;
  }

  private shouldRecoverFocus(): boolean {
    const active = this.document.activeElement;
    const inert = !!active?.closest('[inert]');
    const editing = !!active?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    // An editable control inside a drawer/dialog is still an edit worth preserving.
    // Recovery is in its trap (or the mobile trap is paused), so Tab can reach it.
    if (editing && !inert) return false;
    return (
      !active || active === this.document.body || active === this.document.documentElement || inert || !!active.closest('[data-testid="mobile-sidebar-drawer"]')
    );
  }
}
