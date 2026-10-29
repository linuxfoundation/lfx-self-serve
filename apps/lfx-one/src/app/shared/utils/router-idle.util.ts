// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationCancel, NavigationEnd, NavigationError, Router } from '@angular/router';
import { filter, take } from 'rxjs';

/**
 * Runs `write` (a page's own URL write) now, or once the in-flight navigation settles. A relative `navigate([])`
 * builds on the page's route snapshot, so issued during an org-switch navigation it would supersede the switch and
 * re-address the previous organization. A wait still pending when `destroyRef` is destroyed (the navigation left the
 * page) is dropped.
 */
export function runWhenRouterIdle(router: Router, destroyRef: DestroyRef, write: () => void): void {
  if (!router.getCurrentNavigation()) {
    write();
    return;
  }
  router.events
    .pipe(
      filter((e) => e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError),
      take(1),
      takeUntilDestroyed(destroyRef)
    )
    // currentNavigation clears only after the end event's subscribers run, so retry on a microtask.
    .subscribe(() =>
      queueMicrotask(() => {
        if (!destroyRef.destroyed) runWhenRouterIdle(router, destroyRef, write);
      })
    );
}
