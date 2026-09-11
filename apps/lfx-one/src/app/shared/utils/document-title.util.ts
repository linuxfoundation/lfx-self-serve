// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, inject, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { formatLfxDocumentTitle } from '@lfx-one/shared/utils';

/**
 * Keeps `document.title` in sync with a loaded entity name. Call from an injection context
 * (constructor / field initializer). Empty emissions are ignored so the route-level title
 * from `LfxTitleStrategy` stays in place until the name arrives.
 */
export function bindLfxDocumentTitle(page: Signal<string | null | undefined>): void {
  const title = inject(Title);
  const destroyRef = inject(DestroyRef);
  toObservable(page)
    .pipe(takeUntilDestroyed(destroyRef))
    .subscribe((value) => {
      const next = value?.trim();
      if (next) {
        title.setTitle(formatLfxDocumentTitle(next));
      }
    });
}
