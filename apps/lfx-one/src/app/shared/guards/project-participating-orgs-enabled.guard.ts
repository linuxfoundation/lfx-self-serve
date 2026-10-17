// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { PROJECT_LENS_PARTICIPATING_ORGS_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';
import { deniedOverview } from './mktg-os-agents-enabled.guard';

/**
 * CanMatch guard gating the Project Lens Participating Organizations route (#2091) behind the
 * `project-lens-participating-orgs` flag, paired with the server gate on its BFF routes. SSR defers to the
 * browser, a local override decides before the provider is consulted, and an unready provider fails closed.
 * A denial lands on the project overview with `?project=` kept.
 */
export const projectParticipatingOrgsEnabledGuard: CanMatchFn = async (route) => {
  const platformId = inject(PLATFORM_ID);

  // LaunchDarkly is unavailable during SSR, so the browser run of this guard makes the real decision.
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);

  // A locally pinned value decides on its own; see `FEATURE_FLAG_OVERRIDE_STORAGE_KEY`.
  const override = featureFlagService.getFlagOverride(PROJECT_LENS_PARTICIPATING_ORGS_FLAG);
  if (override !== undefined) {
    return override ? true : deniedOverview(router, route);
  }

  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'projectParticipatingOrgsEnabledGuard', flag: PROJECT_LENS_PARTICIPATING_ORGS_FLAG });
    // Rollout gate: fail CLOSED when LaunchDarkly never becomes ready. waitForReady() reports the timeout to RUM.
    if (!ready) {
      return deniedOverview(router, route);
    }
  }

  return featureFlagService.getBooleanFlag(PROJECT_LENS_PARTICIPATING_ORGS_FLAG, false)() ? true : deniedOverview(router, route);
};
