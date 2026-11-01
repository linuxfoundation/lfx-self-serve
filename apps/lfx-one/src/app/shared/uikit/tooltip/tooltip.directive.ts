// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AriaDescriber, FocusMonitor, InputModalityDetector } from '@angular/cdk/a11y';
import { hasModifierKey } from '@angular/cdk/keycodes';
import { ConnectedPosition, Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  booleanAttribute,
  ComponentRef,
  computed,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  Injector,
  input,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { UiTooltipSide } from '@lfx-one/shared/interfaces';
import { toSpokenKeys } from '@lfx-one/shared/utils';
import { Subscription, take } from 'rxjs';

import { UiTooltipPanelComponent } from './tooltip-panel.component';

/**
 * Shows a short label next to the host on hover and keyboard focus. Add it to the element the user points at:
 * `<button lfxUiTooltip="Copy link" aria-label="Copy link">`. The tooltip opens after a short delay and closes on Escape, on blur,
 * or once the pointer has left both the host and the tooltip. It stays open while the pointer is over the tooltip. It flips to the
 * opposite side when it does not fit, ignores touch, and does nothing on the server. The text is also registered as the host's
 * accessible description, so screen readers read it on focus; it is skipped when it equals the host's `aria-label`.
 * Put it on the focusable element itself, such as a native `<button>`: on a component that wraps a button the description lands on the
 * wrapper, which screen readers do not read when the inner button is focused. `lfx-ui-button` is the exception: the directive never
 * attaches to it, and the button forwards `lfxUiTooltip` to its inner `<button>`. `lfx-ui-menu-item` is the other: it carries the
 * directive itself and exposes it as `disabledReason`, so a template attribute never attaches a second one. A disabled button gets no pointer events, so wrap it
 * in an element that carries the directive and `tabindex="0"`.
 */
@Directive({
  selector: '[lfxUiTooltip]:not(lfx-ui-button):not(lfx-ui-menu-item)',
  host: {
    '(pointerenter)': 'onPointerEnter($event)',
    '(pointerleave)': 'onPointerLeave($event)',
  },
})
export class UiTooltipDirective {
  /* eslint-disable @angular-eslint/no-input-rename -- the aliases are the public attribute names; the `:not()` in the selector hides them from the rule's selector match. */
  /** The tooltip text. With `lfxUiTooltipTitle` set it becomes the description line. An empty value shows nothing. */
  public readonly text = input<string>('', { alias: 'lfxUiTooltip' });
  /** Bold first line for the rich layout (metric definitions, short explanations). */
  public readonly title = input<string>('', { alias: 'lfxUiTooltipTitle' });
  /** Keys shown as key caps after the text, such as `['⌘', 'C']`. */
  public readonly shortcut = input<string[]>([], { alias: 'lfxUiTooltipShortcut' });
  /** Preferred side. The tooltip sits 6px from the host and flips to the opposite side, then the other two, if it would leave the window. */
  public readonly side = input<UiTooltipSide>('top', { alias: 'lfxUiTooltipSide' });
  /** Milliseconds between hover or keyboard focus and the tooltip appearing. Escape and blur close it at once; leaving with the pointer waits a short grace period. */
  public readonly delay = input<number>(300, { alias: 'lfxUiTooltipDelay' });
  /** Turns the tooltip off without removing the directive. */
  public readonly disabled = input<boolean, unknown>(false, { alias: 'lfxUiTooltipDisabled', transform: booleanAttribute });
  /* eslint-enable @angular-eslint/no-input-rename */
  /** For a component that carries this directive as a host directive and knows when its own tooltip applies, such as a locked menu item. Template users keep `lfxUiTooltipDisabled`. */
  public readonly hostDisabled = signal(false);
  /** For a host component that knows where its tooltip must not go, such as a menu item, whose neighbours sit above and below. Overrides `lfxUiTooltipSide`. */
  public readonly hostSide = signal<UiTooltipSide | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly overlay = inject(Overlay);
  private readonly focusMonitor = inject(FocusMonitor);
  private readonly inputModality = inject(InputModalityDetector);
  private readonly ariaDescriber = inject(AriaDescriber);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  // Distance between the host and the tooltip, in px.
  private readonly gap = 6;
  // Milliseconds the pointer may spend crossing the gap between the host and the tooltip before it closes.
  private readonly graceMs = 100;
  private readonly config = computed(() => ({
    text: this.text(),
    title: this.title(),
    shortcut: this.shortcut(),
    disabled: this.disabled() || this.hostDisabled(),
  }));

  private overlayRef: OverlayRef | null = null;
  private panel: ComponentRef<UiTooltipPanelComponent> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private keyboardFocused = false;
  private description = '';
  private focusSubscription: Subscription | null = null;
  private rendered = false;
  private hasContent = false;

  public constructor() {
    afterNextRender(() => {
      this.rendered = true;
      this.syncFocusMonitor();
    });
    toObservable(this.config)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((config) => this.apply(config));
    this.destroyRef.onDestroy(() => {
      this.stopFocusMonitor();
      this.hide();
      this.describe('');
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

  // Every lfx-ui-button instantiates this directive, so the focus monitor runs only while there is something to show.
  private syncFocusMonitor(): void {
    if (!this.rendered) return;
    if (!this.hasContent) this.stopFocusMonitor();
    else if (!this.focusSubscription) {
      // Hover covers the pointer; only keyboard focus opens it, so a click-focus does not flash a tooltip.
      this.focusSubscription = this.focusMonitor.monitor(this.host, true).subscribe((origin) => {
        this.keyboardFocused = origin === 'keyboard';
        if (origin === 'keyboard') {
          this.cancelHide();
          this.scheduleShow();
        } else if (origin === null) this.hide();
      });
      // A menu opened by key hands focus to its first item before this subscription exists, so the focus event was missed.
      if (this.host.contains(this.document.activeElement) && this.inputModality.mostRecentModality === 'keyboard') {
        this.keyboardFocused = true;
        this.scheduleShow();
      }
    }
  }

  private stopFocusMonitor(): void {
    if (!this.focusSubscription) return;
    this.focusSubscription.unsubscribe();
    this.focusSubscription = null;
    this.focusMonitor.stopMonitoring(this.host);
    this.keyboardFocused = false;
  }

  private apply(config: { text: string; title: string; shortcut: string[]; disabled: boolean }): void {
    this.hasContent = !!(config.text || config.title);
    this.syncFocusMonitor();
    const empty = config.disabled || !(config.text || config.title);
    this.describe(empty ? '' : this.descriptionOf(config));
    if (empty) {
      this.hide();
      return;
    }
    if (!this.panel) return;
    this.panel.setInput('text', config.text);
    this.panel.setInput('heading', config.title);
    this.panel.setInput('shortcut', config.shortcut);
    // The new content may be taller or wider, so place it again once it has rendered.
    afterNextRender(() => this.overlayRef?.updatePosition(), { injector: this.injector });
  }

  // The visible shortcut is spoken too. When the text only repeats the host's aria-label, the shortcut is all that adds.
  private descriptionOf(config: { text: string; title: string; shortcut: string[] }): string {
    const body = [config.title, config.text].filter(Boolean).join('. ');
    const spoken = toSpokenKeys(config.shortcut);
    return [body === this.host.getAttribute('aria-label')?.trim() ? '' : body, spoken].filter(Boolean).join('. ');
  }

  // The CDK skips a description that equals the host's aria-label, so it is not read twice.
  private describe(message: string): void {
    if (!this.isBrowser || message === this.description) return;
    if (this.description) this.ariaDescriber.removeDescription(this.host, this.description);
    if (message) this.ariaDescriber.describe(this.host, message);
    this.description = message;
  }

  private scheduleHide(): void {
    // Keyboard focus keeps it open, or keeps a pending show alive; blur closes it.
    if (this.keyboardFocused) return;
    this.clearShowTimer();
    if (!this.overlayRef) {
      this.stopListeningForEscape();
      return;
    }
    this.cancelHide();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!this.keyboardFocused) this.hide();
    }, this.graceMs);
  }

  private scheduleShow(): void {
    if (!this.isBrowser || this.overlayRef || this.timer !== null || this.disabled() || this.hostDisabled() || !(this.text() || this.title())) return;
    this.listenForEscape();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.show();
    }, this.delay());
  }

  // Held from the start of the delay until the tooltip is gone, so Escape cancels a pending show and dismisses an open tooltip. It runs
  // in the capture phase so that, on an open tooltip, the key stops here and an enclosing dialog does not also close. The CDK overlay
  // keyboard dispatcher is not used: subscribing to it would make this overlay the only one to receive every other key.
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || hasModifierKey(event)) return;
    if (this.overlayRef) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.dismiss();
  };

  private listenForEscape(): void {
    this.document.addEventListener('keydown', this.onKeydown, true);
  }

  private stopListeningForEscape(): void {
    this.document.removeEventListener('keydown', this.onKeydown, true);
  }

  private dismiss(): void {
    this.keyboardFocused = false;
    this.hide();
  }

  private hide(): void {
    this.clearShowTimer();
    this.cancelHide();
    this.stopListeningForEscape();
    const overlayRef = this.overlayRef;
    if (!overlayRef) return;
    this.overlayRef = null;
    this.panel = null;
    overlayRef.dispose();
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
      positionStrategy: this.overlay.position().flexibleConnectedTo(this.host).withFlexibleDimensions(false).withPush(true).withPositions(this.positions()),
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      disposeOnNavigation: true,
    });
    this.overlayRef = overlayRef;
    const panel = overlayRef.attach(new ComponentPortal(UiTooltipPanelComponent));
    this.panel = panel;
    panel.setInput('text', this.text());
    panel.setInput('heading', this.title());
    panel.setInput('shortcut', this.shortcut());
    // The CDK can dispose the overlay itself, such as on navigation; drop the stale reference when it does.
    overlayRef
      .detachments()
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.overlayRef !== overlayRef) return;
        this.overlayRef = null;
        this.panel = null;
        this.cancelHide();
        this.stopListeningForEscape();
      });
    // The tooltip stays open while the pointer is over it (WCAG 1.4.13 hoverable).
    const panelElement: HTMLElement = panel.location.nativeElement;
    panelElement.addEventListener('pointerenter', (event) => {
      if ((event as PointerEvent).pointerType !== 'touch') this.cancelHide();
    });
    panelElement.addEventListener('pointerleave', (event) => {
      if ((event as PointerEvent).pointerType !== 'touch') this.scheduleHide();
    });
  }

  private positions(): ConnectedPosition[] {
    const gap = this.gap;
    const all: Record<UiTooltipSide, ConnectedPosition> = {
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
    return order[this.hostSide() ?? this.side()].map((side) => all[side]);
  }
}
