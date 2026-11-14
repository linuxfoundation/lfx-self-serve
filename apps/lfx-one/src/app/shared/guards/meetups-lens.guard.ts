// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';

import { LensService } from '../services/lens.service';

/** Aligns My Meetups with Me without navigating, while preserving Org behavior. */
export const meetupsLensGuard: CanActivateFn = () => {
  const lensService = inject(LensService);

  if (lensService.activeLens() !== 'org') {
    // Reassert Me even when delayed writer grants clamp a stored Foundation/Project selection
    // to Me. setLens corrects that persisted selection and no-ops when already selected.
    lensService.setLens('me');
  }

  return true;
};
