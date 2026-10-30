// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, inject, signal, Signal } from '@angular/core';
import type { Confirmation, ConfirmationService } from 'primeng/api';

/** A PrimeNG confirmation without its `accept`, which the controller supplies so it can be guarded by key. */
export type GuardedConfirmOptions = Omit<Confirmation, 'accept'>;

export interface GuardedConfirmConfig {
  confirmation: ConfirmationService;
  doc: Document;
  /** The key the page is on right now; an accept for any other key is dropped. */
  currentKey: Signal<string | null>;
  /** Where focus goes when the opener is disabled or gone; null leaves focus where the browser put it. */
  fallbackFocus: () => HTMLElement | null;
}

export interface GuardedConfirm {
  /** Opens the confirmation for `key`; `action(key)` runs on accept only if `currentKey()` is still `key`. */
  open: (options: GuardedConfirmOptions, key: string, action: (key: string) => void) => void;
  /** True from open until a tick after the dialog hides, so the Esc that closed it is still read as "dialog open". */
  isOpen: Signal<boolean>;
  /** Wire to the dialog's `onHide`: clears `isOpen` one tick later and restores focus. */
  onHidden: () => void;
}

/**
 * Confirm dialog plumbing shared by presenter-style pages: captured key, focus restore, Esc cooperation.
 * @description Must be called in an injection context (it clears its timer on destroy). The element focused when the
 * dialog opens is remembered; once the dialog hides, focus returns to it, or to `fallbackFocus()` when it is disabled or
 * no longer connected (for example Close while the request is in flight, or the phase changed under the dialog).
 * `isOpen` resets a tick after the hide so a page-level Esc handler that sees the keydown that closed the dialog still
 * reads it as open and does not start another action. Browser-only in practice: nothing runs until `open` is called.
 */
export function createGuardedConfirm(config: GuardedConfirmConfig): GuardedConfirm {
  const { confirmation, doc, currentKey, fallbackFocus } = config;
  const isOpen = signal(false);
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  let returnFocusTo: HTMLElement | null = null;

  inject(DestroyRef).onDestroy(() => {
    if (hiddenTimer) clearTimeout(hiddenTimer);
  });

  const restoreFocus = (): void => {
    const target = returnFocusTo;
    returnFocusTo = null;
    if (target?.isConnected && !(target as HTMLButtonElement).disabled) {
      target.focus();
      return;
    }
    fallbackFocus()?.focus();
  };

  return {
    isOpen: isOpen.asReadonly(),
    open: (options, key, action) => {
      const active = doc.activeElement;
      returnFocusTo = active instanceof HTMLElement ? active : null;
      isOpen.set(true);
      confirmation.confirm({
        ...options,
        accept: () => {
          if (key === currentKey()) action(key);
        },
      });
    },
    onHidden: () => {
      if (hiddenTimer) clearTimeout(hiddenTimer);
      hiddenTimer = setTimeout(() => {
        isOpen.set(false);
        restoreFocus();
      });
    },
  };
}
