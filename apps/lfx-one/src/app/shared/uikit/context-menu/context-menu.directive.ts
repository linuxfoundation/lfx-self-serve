// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkContextMenuTrigger, MENU_STACK } from '@angular/cdk/menu';
import { DOCUMENT } from '@angular/common';
import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

/**
 * Opens a `lfx-ui-menu` where the user right-clicks the host, long-presses it on a touch screen, or uses the keyboard with Shift+F10 or the
 * Menu (context menu) key while the host or something inside it has focus. Put the menu in an `<ng-template>` and pass it to the directive. The menu opens at the
 * pointer, flips to stay inside the window, and takes focus on its first item. Arrow keys, Home, End, type-ahead and Escape work as in `lfx-ui-menu`.
 * With several nested hosts, only the innermost enabled one opens.
 * On touch, a long press can also start the browser's text selection on a host that holds text; add `select-none` to the host if that gets in the way.
 *
 * A context menu is a shortcut, never the only way to an action: mirror the actions of the object's ⋯ menu. Keyboard users need a focusable
 * host, such as a row or card with `tabindex="0"`, so give it one.
 *
 * ```html
 * <div tabindex="0" [lfxUiContextMenu]="actions">Kubernetes</div>
 * <ng-template #actions>
 *   <lfx-ui-menu ariaLabel="Project actions">
 *     <lfx-ui-menu-item icon="fa-light fa-pen-to-square">Edit</lfx-ui-menu-item>
 *   </lfx-ui-menu>
 * </ng-template>
 * ```
 *
 * Inputs and outputs from the CDK context menu trigger, under these names: `lfxUiContextMenu` (the menu template),
 * `lfxUiContextMenuDisabled` (boolean, leaves the browser's own menu alone), `lfxUiContextMenuOpened` and `lfxUiContextMenuClosed`.
 */
@Directive({
  selector: '[lfxUiContextMenu]',
  hostDirectives: [
    {
      directive: CdkContextMenuTrigger,
      inputs: ['cdkContextMenuTriggerFor: lfxUiContextMenu', 'cdkContextMenuDisabled: lfxUiContextMenuDisabled'],
      outputs: ['cdkContextMenuOpened: lfxUiContextMenuOpened', 'cdkContextMenuClosed: lfxUiContextMenuClosed'],
    },
  ],
  host: {
    '(keydown)': 'onKeydown($event)',
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'onPointerUp()',
    '(pointercancel)': 'cancelLongPress()',
    '(contextmenu)': 'onContextMenu()',
    // The host answers a long press with this menu, so drop the iOS link and image callout while it is enabled; text selection is left to the host.
    class: 'data-[enabled]:[-webkit-touch-callout:none]',
    '[attr.data-enabled]': 'enabledAttr()',
    'data-testid': 'ui-context-menu-trigger',
  },
})
export class UiContextMenuDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly trigger = inject(CdkContextMenuTrigger);
  private readonly menuStackId = inject(MENU_STACK).id;
  private readonly document = inject(DOCUMENT);
  private opener: HTMLElement | null = null;
  private readonly longPressMs = 500;
  // Finger drift in px that turns a press into a scroll or drag.
  private readonly longPressTolerance = 10;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private pressX = 0;
  private pressY = 0;
  private openedByLongPress = false;
  // Time in ms after a long press is released in which the tap's own `click` is still expected.
  private readonly releaseClickMs = 300;
  private releaseClickTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    this.trigger.opened.pipe(takeUntilDestroyed()).subscribe(() => {
      this.opener = this.document.activeElement as HTMLElement | null;
      this.document.addEventListener('contextmenu', this.onDocumentContextMenu, true);
      this.document.addEventListener('click', this.onDocumentClick, true);
      this.document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
    });
    this.trigger.closed.pipe(takeUntilDestroyed()).subscribe(() => {
      this.document.removeEventListener('contextmenu', this.onDocumentContextMenu, true);
      this.document.removeEventListener('click', this.onDocumentClick, true);
      this.document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
      this.openedByLongPress = false;
      this.returnFocus();
    });
    inject(DestroyRef).onDestroy(() => {
      this.cancelLongPress();
      this.clearReleaseClick();
      this.document.removeEventListener('contextmenu', this.onDocumentContextMenu, true);
      this.document.removeEventListener('click', this.onDocumentClick, true);
      this.document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    const isMenuKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
    if (!isMenuKey || this.trigger.disabled) return;
    // Browsers differ on whether these keys raise `contextmenu` (macOS never does), so raise it here for the CDK trigger to handle.
    event.preventDefault();
    event.stopPropagation();
    // Below the focused element and start-aligned, where a ⋯ menu would open. `button: 0` tells the CDK it came from the keyboard.
    const { left, bottom } = (event.target as HTMLElement).getBoundingClientRect();
    this.host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0, clientX: left, clientY: bottom }));
  }

  protected onPointerDown(event: PointerEvent): void {
    // Only the first finger can start a long press; another one is a pinch or a scroll, and says nothing about the press that is down.
    if (!event.isPrimary) {
      this.cancelLongPress();
      return;
    }
    this.openedByLongPress = false;
    if (event.pointerType !== 'touch' || this.trigger.disabled) return;
    const { clientX, clientY } = event;
    const target = event.target as Element;
    this.pressX = clientX;
    this.pressY = clientY;
    // Safari on iOS never raises `contextmenu`, so raise it from the press point; from the touched element, so the innermost enabled host takes it.
    this.document.addEventListener('pointerdown', this.onAnotherFinger, true);
    this.longPressTimer = setTimeout(() => {
      this.cancelLongPress();
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX, clientY }));
      this.openedByLongPress = this.trigger.isOpen();
    }, this.longPressMs);
  }

  // The browser raised its own `contextmenu` (Android does on a long press) before our timer, so the CDK trigger opens the menu and ours must not.
  protected onContextMenu(): void {
    if (this.longPressTimer === null) return;
    this.cancelLongPress();
    this.openedByLongPress = true;
  }

  protected onPointerUp(): void {
    this.cancelLongPress();
    if (!this.openedByLongPress) return;
    // Some browsers send the tap's `click` once the finger lifts; the CDK would read it as an outside click and close the menu.
    this.releaseClickTimer = setTimeout(() => (this.releaseClickTimer = null), this.releaseClickMs);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.longPressTimer !== null && Math.hypot(event.clientX - this.pressX, event.clientY - this.pressY) > this.longPressTolerance) this.cancelLongPress();
  }

  protected cancelLongPress(): void {
    if (this.longPressTimer === null) return;
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    this.document.removeEventListener('pointerdown', this.onAnotherFinger, true);
  }

  protected enabledAttr(): string | null {
    return this.trigger.disabled ? null : '';
  }

  private clearReleaseClick(): void {
    if (this.releaseClickTimer === null) return;
    clearTimeout(this.releaseClickTimer);
    this.releaseClickTimer = null;
  }

  // A second finger anywhere on the page, not only on the host, makes the press a pinch or a scroll.
  private readonly onAnotherFinger = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' && !event.isPrimary) this.cancelLongPress();
  };

  // Any new press means the click that follows is a real tap, not the release of the long press.
  private readonly onDocumentPointerDown = (): void => this.clearReleaseClick();

  // Swallows the click that follows a long press, in the capture phase of the document so it beats the CDK's outside-click handler on the body.
  private readonly onDocumentClick = (event: Event): void => {
    if (this.releaseClickTimer === null) return;
    this.clearReleaseClick();
    event.preventDefault();
    event.stopPropagation();
  };

  // Runs while the menu is open, in the capture phase of the document so it beats the CDK's outside-click handler on the body.
  private readonly onDocumentContextMenu = (event: Event): void => {
    const target = event.target as Element | null;
    // Windows Chromium raises `contextmenu` for the Menu key on keyup, after focus is in our menu, so cancel it or the browser menu opens on top.
    // The CDK tags every panel of this trigger's menu stack with its id, so another menu on the page keeps its browser menu.
    if (target?.closest?.(`[data-cdk-menu-stack-id="${this.menuStackId}"]`)) {
      event.preventDefault();
      return;
    }
    // After a long press, the browser's own `contextmenu` on the host would make the CDK close and reopen the menu, so swallow it.
    if (this.openedByLongPress && target && this.host.contains(target)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  // Escape or a chosen item takes the focused menu item away with the menu, so hand focus back to where it was. A click that already moved focus elsewhere stays.
  private returnFocus(): void {
    if (this.opener && this.document.activeElement?.closest('[role="menu"]')) this.opener.focus();
  }
}
