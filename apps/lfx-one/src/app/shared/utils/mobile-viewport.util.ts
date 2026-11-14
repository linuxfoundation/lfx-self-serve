// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BreakpointObserver } from '@angular/cdk/layout';
import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VOTES_MOBILE_MEDIA_QUERY } from '@lfx-one/shared/constants';

/**
 * Whether the viewport is below the phone breakpoint, safe to drive a structural template swap under SSR.
 *
 * The signal is `false` through the first render on every platform and only follows the media query once
 * `afterNextRender` has run, which is browser-only (guarded explicitly with `isPlatformBrowser`). SSR therefore renders the desktop shape and
 * the client's first render matches it (no NG0500 hydration mismatch); a phone then swaps to its layout on
 * the next render. Reading `BreakpointObserver.isMatched` up front would make the first client render
 * differ from the server HTML on a phone.
 *
 * Call from an injection context (a field initializer).
 */
export function injectIsMobileViewport(query: string = VOTES_MOBILE_MEDIA_QUERY): Signal<boolean> {
  const isMobile = signal(false);
  const breakpointObserver = inject(BreakpointObserver);
  const destroyRef = inject(DestroyRef);
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return isMobile.asReadonly();

  afterNextRender(() => {
    breakpointObserver
      .observe(query)
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((state) => isMobile.set(state.matches));
  });

  return isMobile.asReadonly();
}
