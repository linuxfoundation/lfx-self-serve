// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FocusMonitor } from '@angular/cdk/a11y';
import { hasModifierKey } from '@angular/cdk/keycodes';
import { ConnectedPosition, Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { afterNextRender, ComponentRef, DestroyRef, Directive, ElementRef, inject, input, PLATFORM_ID, TemplateRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UiHoverCardSide, UiPopoverPadding } from '@lfx-one/shared/interfaces';
import { Subscription, take } from 'rxjs';

import { UiHoverCardPanelComponent } from './hover-card-panel.component';

let nextId = 0;

/**
 * Shows a card of your own content above its host on hover and keyboard focus, such as the details behind a badge or a
 * project tile. Put it on the focusable element and pass an `<ng-template>`:
 *
 * ```html
 * <a href="..." [lfxUiHoverCard]="details" [lfxUiHoverCardWidth]="280">Kubernetes</a>
 * <ng-template #details>...</ng-template>
 * ```
 *
 * It opens after a short delay and closes on Escape, on blur, or once the pointer has left both the host and the card; it stays open
 * while the pointer is over the card. It prefers the top and flips to the bottom when it does not fit, ignores touch, and does
 * nothing on the server. While open, the host is described by the card, so a screen reader reads it on focus. It is supplementary:
 * anything the user must act on belongs in the page, or in `lfxUiPopover`, not here.
 */
@Directive({
  selector: '[lfxUiHoverCard]',
  host: {
    '(pointerenter)': 'onPointerEnter($event)',
    '(pointerleave)': 'onPointerLeave($event)',
  },
})
export class UiHoverCardDirective {
  /** The content, an `<ng-template>`. With none, nothing opens. */
  public readonly template = input<TemplateRef<unknown> | null | undefined>(null, { alias: 'lfxUiHoverCard' });
  /** Fixed width in px. Without it the card is as wide as its content. */
  public readonly width = input<number | null>(null, { alias: 'lfxUiHoverCardWidth' });
  /** `none` removes the card's 16px padding, for content that paints its own background. */
  public readonly padding = input<UiPopoverPadding>('default', { alias: 'lfxUiHoverCardPadding' });
  /** The side it tries first. */
  public readonly side = input<UiHoverCardSide>('top', { alias: 'lfxUiHoverCardSide' });
  /** Milliseconds before it opens. */
  public readonly delay = input<number>(200, { alias: 'lfxUiHoverCardDelay' });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly overlay = inject(Overlay);
  private readonly focusMonitor = inject(FocusMonitor);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly panelId = `ui-hover-card-${nextId++}`;
  // Distance between the host and the card, in px.
  private readonly gap = 8;
  // Milliseconds the pointer may spend crossing the gap between the host and the card before it closes.
  private readonly graceMs = 120;

  private overlayRef: OverlayRef | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private keyboardFocused = false;
  private focusSubscription: Subscription | null = null;

  public constructor() {
    afterNextRender(() => {
      // Hover covers the pointer; only keyboard focus opens it, so a click does not flash a card.
      this.focusSubscription = this.focusMonitor.monitor(this.host, true).subscribe((origin) => {
        this.keyboardFocused = origin === 'keyboard';
        if (this.keyboardFocused) {
          this.cancelHide();
          this.scheduleShow();
        } else if (origin === null) this.hide();
      });
    });
    this.destroyRef.onDestroy(() => {
      this.focusSubscription?.unsubscribe();
      this.focusMonitor.stopMonitoring(this.host);
      this.hide();
    });
  }

  protected onPointerEnter(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    this.cancelHide();
    this.scheduleShow();
  }

  protected onPointerLeave(event: PointerEvent): void {
    if (event.pointerType !== 'touch') this.scheduleHide();
  }

  private scheduleShow(): void {
    if (!this.isBrowser || this.overlayRef || this.showTimer !== null || !this.template()) return;
    this.document.addEventListener('keydown', this.onKeydown, true);
    this.showTimer = setTimeout(() => {
      this.showTimer = null;
      this.show();
    }, this.delay());
  }

  private scheduleHide(): void {
    // Keyboard focus keeps it open; blur closes it.
    if (this.keyboardFocused) return;
    this.clearShowTimer();
    if (!this.overlayRef) {
      this.document.removeEventListener('keydown', this.onKeydown, true);
      return;
    }
    this.cancelHide();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!this.keyboardFocused) this.hide();
    }, this.graceMs);
  }

  // Capture phase, so on an open card the key stops here and an enclosing dialog does not also close.
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || hasModifierKey(event) || event.isComposing) return;
    if (this.overlayRef) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.keyboardFocused = false;
    this.hide();
  };

  private show(): void {
    const template = this.template();
    if (!template) return;
    const overlayRef = this.overlay.create({
      positionStrategy: this.overlay.position().flexibleConnectedTo(this.host).withFlexibleDimensions(false).withPush(true).withPositions(this.positions()),
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      disposeOnNavigation: true,
    });
    this.overlayRef = overlayRef;
    const panel: ComponentRef<UiHoverCardPanelComponent> = overlayRef.attach(new ComponentPortal(UiHoverCardPanelComponent));
    panel.setInput('template', template);
    panel.setInput('panelId', this.panelId);
    panel.setInput('width', this.width());
    panel.setInput('padding', this.padding());
    this.setDescribedBy(true);
    // The CDK can dispose the overlay itself, such as on navigation; drop the stale reference when it does.
    overlayRef
      .detachments()
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.overlayRef !== overlayRef) return;
        this.overlayRef = null;
        this.cancelHide();
        this.setDescribedBy(false);
        this.document.removeEventListener('keydown', this.onKeydown, true);
      });
    // It stays open while the pointer is over it (WCAG 1.4.13 hoverable).
    const panelElement: HTMLElement = panel.location.nativeElement;
    panelElement.addEventListener('pointerenter', (event) => {
      if ((event as PointerEvent).pointerType !== 'touch') this.cancelHide();
    });
    panelElement.addEventListener('pointerleave', (event) => {
      if ((event as PointerEvent).pointerType !== 'touch') this.scheduleHide();
    });
  }

  private hide(): void {
    this.clearShowTimer();
    this.cancelHide();
    this.document.removeEventListener('keydown', this.onKeydown, true);
    const overlayRef = this.overlayRef;
    if (!overlayRef) return;
    this.overlayRef = null;
    this.setDescribedBy(false);
    overlayRef.dispose();
  }

  private clearShowTimer(): void {
    if (this.showTimer === null) return;
    clearTimeout(this.showTimer);
    this.showTimer = null;
  }

  private cancelHide(): void {
    if (this.hideTimer === null) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  // Adds or removes the card's id among the host's own `aria-describedby` ids, keeping any the host already had.
  private setDescribedBy(open: boolean): void {
    const ids = (this.host.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id && id !== this.panelId);
    if (open) ids.push(this.panelId);
    if (ids.length) this.host.setAttribute('aria-describedby', ids.join(' '));
    else this.host.removeAttribute('aria-describedby');
  }

  private positions(): ConnectedPosition[] {
    const top: ConnectedPosition = { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -this.gap };
    const bottom: ConnectedPosition = { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: this.gap };
    return this.side() === 'top' ? [top, bottom] : [bottom, top];
  }
}
