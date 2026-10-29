// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator, FocusMonitor } from '@angular/cdk/a11y';
import { ConnectedPosition, Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { afterNextRender, ComponentRef, DestroyRef, Directive, effect, ElementRef, inject, input, PLATFORM_ID } from '@angular/core';

import { UiTooltipPanelComponent } from './tooltip-panel.component';

/**
 * Shows a short label next to the host on hover and keyboard focus. Add it to the element the user points at:
 * `<button lfxUiTooltip="Copy link" aria-label="Copy link">`. The tooltip opens after a short delay and closes on Escape, on blur,
 * or once the pointer has left both the host and the tooltip. It stays open while the pointer is over the tooltip. It flips to the opposite side when it does not fit, and does nothing on the server.
 * A disabled button gets no pointer events, so put the directive on a wrapper element around it.
 */
@Directive({
  selector: '[lfxUiTooltip]',
  host: {
    '(mouseenter)': 'onHostEnter()',
    '(mouseleave)': 'scheduleHide()',
  },
})
export class UiTooltipDirective {
  /** The tooltip text. With `lfxUiTooltipTitle` set it becomes the description line. An empty value shows nothing. */
  public readonly text = input<string>('', { alias: 'lfxUiTooltip' });
  /** Bold first line for the rich layout (metric definitions, short explanations). */
  public readonly title = input<string>('', { alias: 'lfxUiTooltipTitle' });
  /** Keys shown as key caps after the text, such as `['⌘', 'C']`. */
  public readonly shortcut = input<string[]>([], { alias: 'lfxUiTooltipShortcut' });
  /** Preferred side. The tooltip sits 6px from the host and flips to the opposite side, then the other two, if it would leave the window. */
  public readonly side = input<'top' | 'right' | 'bottom' | 'left'>('top', { alias: 'lfxUiTooltipSide' });
  /** Milliseconds between hover or keyboard focus and the tooltip appearing. Closing is immediate. */
  public readonly delay = input<number>(300, { alias: 'lfxUiTooltipDelay' });
  /** Turns the tooltip off without removing the directive. */
  public readonly disabled = input<boolean>(false, { alias: 'lfxUiTooltipDisabled' });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly overlay = inject(Overlay);
  private readonly focusMonitor = inject(FocusMonitor);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly panelId = inject(_IdGenerator).getId('lfx-ui-tooltip-');
  // Distance between the host and the tooltip, in px.
  private readonly gap = 6;
  // Milliseconds the pointer may spend crossing the gap between the host and the tooltip before it closes.
  private readonly graceMs = 100;

  private overlayRef: OverlayRef | null = null;
  private panel: ComponentRef<UiTooltipPanelComponent> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private keyboardFocused = false;

  public constructor() {
    afterNextRender(() => {
      // Hover covers the pointer; only keyboard focus opens it, so a click-focus does not flash a tooltip.
      this.focusMonitor
        .monitor(this.host, true)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((origin) => {
          this.keyboardFocused = origin === 'keyboard';
          if (origin === 'keyboard') this.scheduleShow();
          else if (origin === null) this.hide();
        });
    });
    this.destroyRef.onDestroy(() => {
      this.focusMonitor.stopMonitoring(this.host);
      this.hide();
    });
    effect(() => {
      const text = this.text();
      const title = this.title();
      const shortcut = this.shortcut();
      if (this.disabled() || !(text || title)) {
        this.hide();
        return;
      }
      this.panel?.setInput('text', text);
      this.panel?.setInput('heading', title);
      this.panel?.setInput('shortcut', shortcut);
    });
  }

  protected onHostEnter(): void {
    this.cancelHide();
    this.scheduleShow();
  }

  protected scheduleHide(): void {
    this.clearShowTimer();
    // Keyboard focus keeps it open; blur closes it.
    if (!this.overlayRef || this.keyboardFocused) return;
    this.cancelHide();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.hide();
    }, this.graceMs);
  }

  protected scheduleShow(): void {
    if (!this.isBrowser || this.overlayRef || this.timer !== null || this.disabled() || !(this.text() || this.title())) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.show();
    }, this.delay());
  }

  protected hide(): void {
    this.clearShowTimer();
    this.cancelHide();
    if (!this.overlayRef) return;
    this.overlayRef.dispose();
    this.overlayRef = null;
    this.panel = null;
    this.removeDescribedBy();
  }

  private clearShowTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private cancelHide(): void {
    if (this.hideTimer === null) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  private show(): void {
    const overlayRef = this.overlay.create({
      positionStrategy: this.overlay.position().flexibleConnectedTo(this.host).withFlexibleDimensions(false).withPush(false).withPositions(this.positions()),
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      disposeOnNavigation: true,
    });
    this.overlayRef = overlayRef;
    this.panel = overlayRef.attach(new ComponentPortal(UiTooltipPanelComponent));
    this.panel.setInput('id', this.panelId);
    this.panel.setInput('text', this.text());
    this.panel.setInput('heading', this.title());
    this.panel.setInput('shortcut', this.shortcut());
    this.addDescribedBy();
    // The tooltip stays open while the pointer is over it (WCAG 1.4.13 hoverable).
    const panelElement: HTMLElement = this.panel.location.nativeElement;
    panelElement.addEventListener('mouseenter', () => this.cancelHide());
    panelElement.addEventListener('mouseleave', () => this.scheduleHide());
    overlayRef.keydownEvents().subscribe((event) => {
      if (event.key === 'Escape') this.hide();
    });
  }

  private positions(): ConnectedPosition[] {
    const gap = this.gap;
    const all: Record<'top' | 'right' | 'bottom' | 'left', ConnectedPosition> = {
      top: { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -gap },
      bottom: { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: gap },
      left: { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -gap },
      right: { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: gap },
    };
    const order = {
      top: ['top', 'bottom', 'left', 'right'],
      bottom: ['bottom', 'top', 'left', 'right'],
      left: ['left', 'right', 'top', 'bottom'],
      right: ['right', 'left', 'top', 'bottom'],
    } as const;
    return order[this.side()].map((side) => all[side]);
  }

  private addDescribedBy(): void {
    const ids = (this.host.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    this.host.setAttribute('aria-describedby', [...ids, this.panelId].join(' '));
  }

  private removeDescribedBy(): void {
    const ids = (this.host.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id && id !== this.panelId);
    if (ids.length) this.host.setAttribute('aria-describedby', ids.join(' '));
    else this.host.removeAttribute('aria-describedby');
  }
}
