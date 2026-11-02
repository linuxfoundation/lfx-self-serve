// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { afterNextRender, computed, DestroyRef, inject, Injectable, Injector, signal, Signal } from '@angular/core';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UI_TOAST_PANE_CLASS } from '@lfx-one/shared/constants';
import { UiToastConfig, UiToastItem, UiToastPosition, UiToastRef } from '@lfx-one/shared/interfaces';

import { UiToastRegionComponent } from './toast-region.component';

/**
 * Puts short messages on screen in a stack at the bottom-right, newest on top; `dark` toasts, and any with `position: 'bottom-center'`,
 * stack at the bottom centre instead. Each toast dismisses itself (5s, 3s for `dark`, 8s with actions, never for errors) and waits while
 * the pointer or focus is on it. Each stack lives in its own CDK overlay that the service creates after its first render, a polite live
 * region that stays in place, so inject the service ahead of the first `show` for the first message to be announced reliably. On the server nothing is rendered. A toast shown over an open modal sits outside the modal's focus trap,
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
  private readonly overlayRefs: OverlayRef[] = [];

  /** The toasts on screen, newest first. */
  public readonly toasts: Signal<readonly UiToastItem[]> = this.items.asReadonly();

  public constructor() {
    // afterNextRender only runs in the browser, which is also the only place an overlay makes sense.
    afterNextRender(() => this.attachRegions(), { injector: this.injector });
    this.destroyRef.onDestroy(() => this.overlayRefs.forEach((ref) => ref.dispose()));
  }

  /** Shows a toast and returns a handle to dismiss it early. */
  public show(config: UiToastConfig): UiToastRef {
    const id = this.ids.getId('lfx-ui-toast-');
    const position = config.position ?? (config.variant === 'dark' ? 'bottom-center' : 'bottom-right');
    this.items.update((items) => [{ ...config, id, position }, ...items]);
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

  private attachRegions(): void {
    this.attachRegion('bottom-right');
    this.attachRegion('bottom-center');
  }

  private attachRegion(position: UiToastPosition): void {
    // 16px from the window edge, matching the toast's `100vw - 32px` maximum width.
    const place = this.overlay.position().global().bottom('16px');
    const overlayRef = this.overlay.create({
      positionStrategy: position === 'bottom-right' ? place.right('16px') : place.centerHorizontally(),
      // Marks the stack for code that must not treat a click on it as an outside click, such as the popover.
      panelClass: UI_TOAST_PANE_CLASS,
      disposeOnNavigation: false,
    });
    // shortcut: 1001 sits above the 1000 of every other CDK overlay, so a toast shows over an open modal. revisit: when the overlay container moves to --ui-z-* tokens, give toasts their own layer above CDK panes.
    overlayRef.hostElement.style.zIndex = '1001';
    const region = overlayRef.attach(new ComponentPortal(UiToastRegionComponent));
    region.setInput(
      'source',
      computed(() => this.items().filter((item) => item.position === position))
    );
    outputToObservable(region.instance.dismissed)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((id) => this.dismiss(id));
    this.overlayRefs.push(overlayRef);
  }
}
