// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator, FocusMonitor } from '@angular/cdk/a11y';
import { hasModifierKey } from '@angular/cdk/keycodes';
import { ConnectedPosition, FlexibleConnectedPositionStrategy, Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { afterNextRender, ComponentRef, computed, DestroyRef, Directive, ElementRef, inject, Injector, input, PLATFORM_ID, TemplateRef } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { UiHoverCardSide, UiPopoverPadding } from '@lfx-one/shared/interfaces';
import { Subscription, take } from 'rxjs';

import { UiHoverCardPanelComponent } from './hover-card-panel.component';

/**
 * Shows a card of your own content above its host on hover and keyboard focus, such as the details behind a badge or a
 * project tile. Put it on the focusable element and pass an `<ng-template>`:
 *
 * ```html
 * <a href="..." [lfxUiHoverCard]="details" [lfxUiHoverCardWidth]="280">Kubernetes</a>
 * <ng-template #details>...</ng-template>
 * ```
 *
 * On hover it opens after a short delay; on keyboard focus it opens at once and the host is described by the card, so a screen
 * reader reads it with the host. It closes on Escape, on blur, or once the pointer has left both the host and the card, and stays
 * open while the pointer is over the card. It prefers the top and flips to the bottom when it does not fit, ignores touch, and does
 * nothing on the server. It is supplementary:
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
  private readonly injector = inject(Injector);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly panelId = inject(_IdGenerator).getId('lfx-ui-hover-card-');
  // Distance between the host and the card, in px.
  private readonly gap = 8;
  // Milliseconds the pointer may spend crossing the gap between the host and the card before it closes.
  private readonly graceMs = 120;

  private readonly config = computed(() => ({ template: this.template(), width: this.width(), padding: this.padding(), side: this.side() }));

  private overlayRef: OverlayRef | null = null;
  private panel: ComponentRef<UiHoverCardPanelComponent> | null = null;
  private positionStrategy: FlexibleConnectedPositionStrategy | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private keyboardFocused = false;
  private focusSubscription: Subscription | null = null;
  private rendered = false;

  public constructor() {
    afterNextRender(() => {
      this.rendered = true;
      this.syncFocusMonitor();
    });
    // A grid of hosts may pass no card to most of them, so the focus monitor runs only while there is a card to show. An
    // open card follows its inputs, so its details never drift from the host.
    toObservable(this.config)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((config) => {
        this.syncFocusMonitor();
        this.syncOpenCard(config.template, config.width, config.padding);
      });
    this.destroyRef.onDestroy(() => {
      this.stopFocusMonitor();
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

  private syncFocusMonitor(): void {
    if (!this.rendered) return;
    if (!this.template()) {
      this.stopFocusMonitor();
      this.hide();
      return;
    }
    if (this.focusSubscription) return;
    // Hover covers the pointer; only keyboard focus opens it, and at once, so a click does not flash a card.
    this.focusSubscription = this.focusMonitor.monitor(this.host, true).subscribe((origin) => {
      this.keyboardFocused = origin === 'keyboard';
      if (this.keyboardFocused) {
        // At once, even over a pending hover delay, so the description is in place while focus lands.
        this.cancelHide();
        this.clearShowTimer();
        this.open();
      } else if (origin === null) this.hide();
    });
  }

  private stopFocusMonitor(): void {
    if (!this.focusSubscription) return;
    this.focusSubscription.unsubscribe();
    this.focusSubscription = null;
    this.focusMonitor.stopMonitoring(this.host);
    this.keyboardFocused = false;
  }

  private scheduleShow(): void {
    if (!this.isBrowser || this.overlayRef || this.showTimer !== null || !this.template()) return;
    this.document.addEventListener('keydown', this.onKeydown, true);
    this.showTimer = setTimeout(() => {
      this.showTimer = null;
      this.show();
    }, this.delay());
  }

  private open(): void {
    if (!this.isBrowser || this.overlayRef || !this.template()) return;
    this.document.addEventListener('keydown', this.onKeydown, true);
    this.show();
  }

  private syncOpenCard(template: TemplateRef<unknown> | null | undefined, width: number | null, padding: UiPopoverPadding): void {
    if (!this.panel || !template) return;
    this.panel.setInput('template', template);
    this.panel.setInput('width', width);
    this.panel.setInput('padding', padding);
    this.positionStrategy?.withPositions(this.positions());
    // The new content may be taller or wider, so place it again once it has rendered.
    afterNextRender(() => this.overlayRef?.updatePosition(), { injector: this.injector });
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
    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(this.host)
      .withFlexibleDimensions(false)
      .withPush(true)
      .withPositions(this.positions());
    const overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      disposeOnNavigation: true,
    });
    this.overlayRef = overlayRef;
    this.positionStrategy = positionStrategy;
    const panel: ComponentRef<UiHoverCardPanelComponent> = overlayRef.attach(new ComponentPortal(UiHoverCardPanelComponent));
    this.panel = panel;
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
        this.panel = null;
        this.positionStrategy = null;
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
    this.panel = null;
    this.positionStrategy = null;
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
