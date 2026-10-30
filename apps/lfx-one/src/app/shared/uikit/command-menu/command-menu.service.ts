// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { UiCommandItem, UiCommandMenuConfig } from '@lfx-one/shared/interfaces';

import { UiModalService } from '../modal/modal.service';
import { UiCommandMenuComponent } from './command-menu.component';

/**
 * Opens the command palette in a modal. `open` resolves, through `ref.closed`, with the chosen `UiCommandItem`, or with nothing when
 * the user dismisses it. Only one palette is open at a time: calling `open` again returns the one on screen.
 *
 * Nothing is bound to the keyboard until you ask. The library opens the palette with ⌘K or Ctrl K from anywhere; `bindShortcut` does that
 * (⌘K on Apple platforms, Ctrl K elsewhere), and you call it once from the app shell with the commands that exist at that moment.
 */
@Injectable({ providedIn: 'root' })
export class UiCommandMenuService {
  private readonly modal = inject(UiModalService);
  private readonly document = inject(DOCUMENT);
  private ref: DialogRef<UiCommandItem | undefined, UiCommandMenuComponent> | null = null;

  /** Opens the palette, or returns the one already open. `ref.closed` emits the chosen item. */
  public open(config: UiCommandMenuConfig): DialogRef<UiCommandItem | undefined, UiCommandMenuComponent> {
    if (this.ref?.overlayRef.hasAttached()) return this.ref;
    // The content is created by the CDK, so its inputs are set on the component afterwards, before its first render.
    const ref = this.modal.open<UiCommandItem | undefined, unknown, UiCommandMenuComponent>(UiCommandMenuComponent);
    ref.componentRef?.setInput('groups', config.groups);
    if (config.label) ref.componentRef?.setInput('label', config.label);
    if (config.placeholder) ref.componentRef?.setInput('placeholder', config.placeholder);
    this.ref = ref;
    return ref;
  }

  /**
   * Opens the palette with ⌘K on Apple platforms or Ctrl K elsewhere, and closes it with the same key. Ctrl K stays free on macOS, where it deletes
   * to the end of the line. Holding the key down does not toggle it again. Returns a function that removes the listener.
   */
  public bindShortcut(getConfig: () => UiCommandMenuConfig): () => void {
    const onKeydown = (event: KeyboardEvent): void => {
      const apple = /mac|iphone|ipad|ipod/i.test(this.document.defaultView?.navigator.platform ?? '');
      const modifier = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!modifier || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      if (event.repeat) return;
      if (this.ref?.overlayRef.hasAttached()) this.ref.close();
      else this.open(getConfig());
    };
    this.document.addEventListener('keydown', onKeydown);
    return () => this.document.removeEventListener('keydown', onKeydown);
  }
}
