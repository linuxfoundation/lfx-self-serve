// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, inject, PLATFORM_ID, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { DynamicDialogConfig } from 'primeng/dynamicdialog';

/**
 * Keeps the host DynamicDialog open while `busy` is true. Call from an injection context.
 *
 * Toggling `closable` only hides the header X: PrimeNG 20.4.0 binds its Escape listeners once, when the
 * dialog opens. Escape is therefore swallowed by a capture-phase document listener, which runs before
 * PrimeNG's bubble-phase ones.
 */
export function lockDynamicDialogWhile(busy: Signal<boolean>): void {
  const config = inject(DynamicDialogConfig);
  const destroyRef = inject(DestroyRef);

  toObservable(busy)
    .pipe(takeUntilDestroyed(destroyRef))
    .subscribe((isBusy) => {
      config.closable = !isBusy;
    });

  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return;
  }

  const document = inject(DOCUMENT);
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && busy()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  document.addEventListener('keydown', onKeydown, true);
  destroyRef.onDestroy(() => document.removeEventListener('keydown', onKeydown, true));
}
