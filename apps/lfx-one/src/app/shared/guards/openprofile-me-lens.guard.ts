// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { OPENPROFILE_REDIRECT_MARKER } from '@lfx-one/shared/constants';

import { LensService } from '../services/lens.service';

/**
 * Forces the `me` lens for an old openprofile.dev personal link (ID-1147), recognised by the redirect's
 * `from=openprofile` marker. Runs before `lensRedirectGuard` so the link lands on the personal page, not
 * the foundation/project variant of a saved lens. `setLens('me')` applies the switch without navigating.
 */
export const openprofileMeLensGuard: CanActivateFn = (route) => {
  if (route.queryParams[OPENPROFILE_REDIRECT_MARKER.key] === OPENPROFILE_REDIRECT_MARKER.value) {
    inject(LensService).setLens('me');
  }

  return true;
};
