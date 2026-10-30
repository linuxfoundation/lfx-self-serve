// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkContextMenuTrigger } from '@angular/cdk/menu';
import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

/**
 * Opens a `lfx-ui-menu` where the user right-clicks the host, or from the keyboard with Shift+F10 or the Menu (context menu) key
 * while the host or something inside it has focus. Put the menu in an `<ng-template>` and pass it to the directive. The menu opens at the
 * pointer, flips to stay inside the window, and takes focus on its first item. Arrow keys, Home, End, type-ahead and Escape work as in `lfx-ui-menu`.
 * With several nested hosts, only the innermost enabled one opens.
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
  host: { '(keydown)': 'onKeydown($event)', 'data-testid': 'ui-context-menu-trigger' },
})
export class UiContextMenuDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly trigger = inject(CdkContextMenuTrigger);
  private readonly document = inject(DOCUMENT);
  private opener: HTMLElement | null = null;

  public constructor() {
    this.trigger.opened.pipe(takeUntilDestroyed()).subscribe(() => (this.opener = this.document.activeElement as HTMLElement | null));
    this.trigger.closed.pipe(takeUntilDestroyed()).subscribe(() => this.returnFocus());
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

  // Escape or a chosen item takes the focused menu item away with the menu, so hand focus back to where it was. A click that already moved focus elsewhere stays.
  private returnFocus(): void {
    if (this.opener && this.document.activeElement?.closest('[role="menu"]')) this.opener.focus();
  }
}
