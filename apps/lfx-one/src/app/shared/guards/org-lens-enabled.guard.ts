// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanMatchFn, Router } from '@angular/router';
import { ORG_LENS_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { catchError, filter, firstValueFrom, of, timeout } from 'rxjs';

import { FeatureFlagService } from '../services/feature-flag.service';

/** CanMatch guard for /org/* — waits for the feature-flag client to initialise so deep links don't race the async init. */
export const orgLensEnabledGuard: CanMatchFn = async () => {
  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);

  if (!featureFlagService.initialized()) {
    const ready = await firstValueFrom(
      toObservable(featureFlagService.initialized).pipe(
        filter((init): init is true => init === true),
        timeout(5000),
        catchError(() => of(false))
      )
    );
    if (!ready) {
      return router.parseUrl('/');
    }
  }

  return featureFlagService.getBooleanFlag(ORG_LENS_ENABLED_FLAG, false)() ? true : router.parseUrl('/');
};
