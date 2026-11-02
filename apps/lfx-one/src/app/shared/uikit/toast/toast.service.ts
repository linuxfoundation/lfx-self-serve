// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { afterNextRender, DestroyRef, inject, Injectable, Injector, signal, Signal } from '@angular/core';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UiToastConfig, UiToastItem, UiToastRef } from '@lfx-one/shared/interfaces';

import { UiToastRegionComponent } from './toast-region.component';

/**
 * Puts short messages on screen in a stack at the bottom-right, newest on top. Each toast dismisses itself (5s, 8s with actions,
 * never for errors) and waits while the pointer or focus is on it. The stack lives in a CDK overlay that the service creates after
 * its first render, a polite live region that stays in place, so inject the service ahead of the first `show` for the first message
 * to be announced reliably. On the server nothing is rendered. A toast shown over an open modal sits outside the modal's focus trap,
 * so its buttons are out of keyboard reach until the modal closes: keep every toast action available elsewhere too.
 *
 * ```ts
 * this.toast.show({ message: 'Committee created.', actions: [{ label: 'Undo', run: () => this.undo() }] });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class UiToastService {
  private readonly overlay = inject(Overlay);
  private readonly ids = inject(_IdGenerator);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly items = signal<readonly UiToastItem[]>([]);
  private overlayRef: OverlayRef | null = null;

  /** The toasts on screen, newest first. */
  public readonly toasts: Signal<readonly UiToastItem[]> = this.items.asReadonly();

  public constructor() {
    // afterNextRender only runs in the browser, which is also the only place an overlay makes sense.
    afterNextRender(() => this.attachRegion(), { injector: this.injector });
    this.destroyRef.onDestroy(() => this.overlayRef?.dispose());
  }

  /** Shows a toast and returns a handle to dismiss it early. */
  public show(config: UiToastConfig): UiToastRef {
    const id = this.ids.getId('lfx-ui-toast-');
    this.items.update((items) => [{ ...config, id }, ...items]);
    return { id, dismiss: () => this.dismiss(id) };
  }

  /** Removes one toast. Does nothing if it is already gone. */
  public dismiss(id: string): void {
    this.items.update((items) => items.filter((item) => item.id !== id));
  }

  /** Removes every toast. */
  public dismissAll(): void {
    this.items.set([]);
  }

  private attachRegion(): void {
    // 16px from the window edge, matching the toast's `100vw - 32px` maximum width.
    const overlayRef = this.overlay.create({
      positionStrategy: this.overlay.position().global().bottom('16px').right('16px'),
      disposeOnNavigation: false,
    });
    // shortcut: 1001 sits above the 1000 of every other CDK overlay, so a toast shows over an open modal. revisit: when the overlay container moves to --ui-z-* tokens, give toasts their own layer above CDK panes.
    overlayRef.hostElement.style.zIndex = '1001';
    const region = overlayRef.attach(new ComponentPortal(UiToastRegionComponent));
    region.setInput('source', this.toasts);
    outputToObservable(region.instance.dismissed)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((id) => this.dismiss(id));
    this.overlayRef = overlayRef;
  }
}
