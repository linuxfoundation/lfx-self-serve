// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { hasModifierKey } from '@angular/cdk/keycodes';
import { ConnectedPosition, Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, Directive, ElementRef, inject, PLATFORM_ID } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  HEALTH_METRICS_TRUNCATION_TIP_DELAY_MS,
  HEALTH_METRICS_TRUNCATION_TIP_GAP_PX,
  HEALTH_METRICS_TRUNCATION_TIP_GRACE_MS,
  HEALTH_METRICS_TRUNCATION_TIP_TOLERANCE_PX,
} from '@lfx-one/shared/constants';
import { UiTooltipPanelComponent } from '@shared/uikit/tooltip/tooltip-panel.component';
import { take } from 'rxjs';

/**
 * Put once on a container (the page column, a drawer or dialog body): hovering or focusing cut-off text inside it shows the
 * full text in the standard dark tooltip. Visual only, since the text is already in the DOM; browser only, and touch is ignored.
 */
@Directive({ selector: '[lfxHealthMetricsTruncationTip]' })
export class HealthMetricsTruncationTipDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly overlay = inject(Overlay);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // The element the tooltip is pending or open for.
  private target: HTMLElement | null = null;
  // Closed with Escape; stays closed until the pointer leaves it.
  private dismissed: HTMLElement | null = null;
  private overlayRef: OverlayRef | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    if (!this.isBrowser) return;
    this.host.addEventListener('pointerover', this.onPointerOver);
    this.host.addEventListener('pointerout', this.onPointerOut);
    this.host.addEventListener('focusin', this.onFocusIn);
    this.host.addEventListener('focusout', this.onFocusOut);
    this.destroyRef.onDestroy(() => {
      this.host.removeEventListener('pointerover', this.onPointerOver);
      this.host.removeEventListener('pointerout', this.onPointerOut);
      this.host.removeEventListener('focusin', this.onFocusIn);
      this.host.removeEventListener('focusout', this.onFocusOut);
      this.hide();
    });
  }

  private readonly onPointerOver = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    const candidate = this.truncatedFrom(event.target);
    // Leaving the current target is handled on pointerout.
    if (!candidate || candidate === this.dismissed) return;
    if (candidate === this.target) {
      this.cancelHide();
      return;
    }
    // Keyboard focus owns the tip until it moves; hovering other cut-off text doesn't take it over.
    if (this.targetFocused()) return;
    this.hide();
    this.scheduleShow(candidate);
  };

  private readonly onPointerOut = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    const next = event.relatedTarget as Node | null;
    if (this.dismissed && !this.dismissed.contains(next)) this.dismissed = null;
    // Moving between the target's own children is not leaving it.
    if (!this.target || !this.target.contains(event.target as Node) || this.target.contains(next)) return;
    // Focus is the other trigger: a focused target keeps its tooltip until it blurs (WCAG 1.4.13).
    if (this.targetFocused()) return;
    this.scheduleHide();
  };

  private readonly onFocusIn = (event: FocusEvent): void => {
    const focused = event.target;
    if (focused === this.target || !(focused instanceof HTMLElement) || !this.isTruncated(focused)) return;
    this.hide();
    this.dismissed = null;
    this.scheduleShow(focused);
  };

  private readonly onFocusOut = (event: FocusEvent): void => {
    // Blur only ends the focus trigger; a pointer still over the target keeps it open.
    if (this.target && event.target === this.target && !this.target.matches(':hover')) this.hide();
  };

  // Held from the start of the delay until the tooltip is gone, as in the uikit tooltip. Capture phase, so that on an open
  // tooltip Escape stops here and an enclosing dialog does not also close.
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || hasModifierKey(event)) return;
    // An Escape that cancels an IME composition is the input method's.
    if (event.isComposing || event.keyCode === 229) return;
    if (this.overlayRef) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.dismissed = this.target;
    this.hide();
  };

  // Captured, so a native scroller in the page counts too: a hover tip closes, while a focused target's tip follows its text,
  // since focusing it can scroll it into view.
  private readonly onScroll = (): void => {
    if (this.targetFocused()) this.overlayRef?.updatePosition();
    else this.hide();
  };

  /** The nearest element from `start` up to the host whose text is cut off. */
  private truncatedFrom(start: EventTarget | null): HTMLElement | null {
    let element = start instanceof Element ? start : null;
    while (element) {
      if (element instanceof HTMLElement && this.isTruncated(element)) return element;
      if (element === this.host) return null;
      element = element.parentElement;
    }
    return null;
  }

  private isTruncated(element: HTMLElement): boolean {
    // Layout is read first, so the costlier computed style is only taken for overflowing elements.
    if (element.scrollWidth - element.clientWidth <= HEALTH_METRICS_TRUNCATION_TIP_TOLERANCE_PX) return false;
    const style = this.document.defaultView?.getComputedStyle(element);
    if (!style) return false;
    if (style.textOverflow === 'ellipsis') return true;
    return style.whiteSpace === 'nowrap' && (style.overflowX === 'hidden' || style.overflowX === 'clip');
  }

  private fullText(element: HTMLElement): string {
    return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  private scheduleShow(element: HTMLElement): void {
    if (!this.fullText(element)) return;
    this.target = element;
    this.document.addEventListener('keydown', this.onKeydown, true);
    this.document.addEventListener('scroll', this.onScroll, true);
    this.showTimer = setTimeout(() => {
      this.showTimer = null;
      this.show(element);
    }, HEALTH_METRICS_TRUNCATION_TIP_DELAY_MS);
  }

  private scheduleHide(): void {
    if (!this.overlayRef) {
      this.hide();
      return;
    }
    this.cancelHide();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!this.targetFocused()) this.hide();
    }, HEALTH_METRICS_TRUNCATION_TIP_GRACE_MS);
  }

  private targetFocused(): boolean {
    return this.target !== null && this.document.activeElement === this.target;
  }

  private cancelHide(): void {
    if (this.hideTimer === null) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  private hide(): void {
    if (this.showTimer !== null) clearTimeout(this.showTimer);
    this.showTimer = null;
    this.cancelHide();
    this.document.removeEventListener('keydown', this.onKeydown, true);
    this.document.removeEventListener('scroll', this.onScroll, true);
    this.target = null;
    const overlayRef = this.overlayRef;
    if (!overlayRef) return;
    this.overlayRef = null;
    overlayRef.dispose();
  }

  // The uikit tooltip's overlay and panel, anchored to the cut-off element. Scrolls are handled in `onScroll`.
  private show(element: HTMLElement): void {
    const overlayRef = this.overlay.create({
      positionStrategy: this.overlay.position().flexibleConnectedTo(element).withFlexibleDimensions(false).withPush(true).withPositions(this.positions()),
      scrollStrategy: this.overlay.scrollStrategies.noop(),
      disposeOnNavigation: true,
    });
    this.overlayRef = overlayRef;
    const panel = overlayRef.attach(new ComponentPortal(UiTooltipPanelComponent));
    panel.setInput('text', this.fullText(element));
    const panelElement: HTMLElement = panel.location.nativeElement;
    // Visual only: screen readers already read the full text in place.
    panelElement.setAttribute('aria-hidden', 'true');
    // The tooltip stays open while the pointer is over it (WCAG 1.4.13 hoverable).
    panelElement.addEventListener('pointerenter', (event) => {
      if ((event as PointerEvent).pointerType !== 'touch') this.cancelHide();
    });
    panelElement.addEventListener('pointerleave', (event) => {
      if ((event as PointerEvent).pointerType !== 'touch') this.scheduleHide();
    });
    // The CDK disposes the overlay itself on navigation; drop the stale state when it does.
    overlayRef
      .detachments()
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.overlayRef === overlayRef) this.hide();
      });
  }

  private positions(): ConnectedPosition[] {
    const gap = HEALTH_METRICS_TRUNCATION_TIP_GAP_PX;
    return [
      { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -gap },
      { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: gap },
      { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -gap },
      { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: gap },
    ];
  }
}
