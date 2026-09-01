// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanMatchFn, Router } from '@angular/router';
import { catchError, filter, firstValueFrom, of, timeout } from 'rxjs';

import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * Builds a `CanMatchFn` for the common "fail closed to a fixed redirect" flag-guard shape: SSR
 * defers to the browser, the browser waits up to 5s for the flag provider to be READY, and denies
 * the route (redirecting to `redirectTo`) if the provider never becomes ready or the flag is off.
 *
 * `akrites-enabled.guard.ts` and `org-lens-enabled.guard.ts` predate this factory and still
 * inline the same logic — collapsing them onto it is a follow-up, not done here to keep this
 * change scoped to the new guard it was extracted for. Guards with different semantics (a local
 * override, a fail-OPEN default, or a computed rather than fixed redirect — see
 * `my-clas-enabled.guard.ts`, `org-lens-roi-enabled.guard.ts`, `mktg-os-agents-enabled.guard.ts`)
 * don't fit this factory and should stay hand-written.
 */
export function createFlagGuard(flag: string, redirectTo = '/'): CanMatchFn {
  return async () => {
    const platformId = inject(PLATFORM_ID);

    // On the server LaunchDarkly is unavailable — let the route match and let the
    // browser-side run of this guard make the real decision after hydration.
    if (!isPlatformBrowser(platformId)) {
      return true;
    }

    const featureFlagService = inject(FeatureFlagService);
    const router = inject(Router);

    if (!featureFlagService.providerReady()) {
      const ready = await firstValueFrom(
        toObservable(featureFlagService.providerReady).pipe(
          filter((isReady): isReady is true => isReady === true),
          timeout(5000),
          catchError(() => of(false))
        )
      );
      // Provider never became ready (no client id / LD unreachable) → fail closed.
      if (!ready) {
        return router.parseUrl(redirectTo);
      }
    }

    return featureFlagService.getBooleanFlag(flag, false)() ? true : router.parseUrl(redirectTo);
  };
}
