// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router } from '@angular/router';
import { LensService } from '@services/lens.service';
import { filter } from 'rxjs';

/**
 * Restores the Me lens when the user leaves an entity detail page via the browser back button.
 *
 * Detail pages opened from a Me lens list switch the active lens to the entity's owning project or
 * foundation, and the flat list route (e.g. `/groups`) renders whichever lens is active. The in-app
 * back button restores the Me lens in `goBack()`, but a browser back (popstate) bypasses it and lands
 * on the project lens list. Call once from the detail component constructor; it is a no-op unless
 * `fromMeLens` is true, and only acts on popstate navigations to the list route.
 */
export function restoreMeLensOnBrowserBack(router: Router, lensService: LensService, destroyRef: DestroyRef, fromMeLens: boolean, listPath: string): void {
  if (!fromMeLens) {
    return;
  }
  router.events
    .pipe(
      filter((event): event is NavigationStart => event instanceof NavigationStart),
      filter((event) => event.navigationTrigger === 'popstate' && event.url.split(/[?#]/)[0] === listPath),
      takeUntilDestroyed(destroyRef)
    )
    .subscribe(() => lensService.setLens('me'));
}
