// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn, Router, UrlTree } from '@angular/router';
import { CF_ORG_DONATIONS_FLAG } from '@lfx-one/shared/constants';
import { orgLensPagePath } from '@lfx-one/shared/utils';

import { FeatureFlagService } from '../services/feature-flag.service';
import { OrgLensNavigationService } from '../services/org-lens-navigation.service';

/**
 * Dark-launch CanMatch for an Company Lens page behind a browser-only LaunchDarkly flag. Fails closed to the addressed
 * company's overview when the flag is off or LaunchDarkly never becomes ready.
 */
const orgLensFlagGuard =
  (flag: string, guard: string): CanMatchFn =>
  async () => {
    const platformId = inject(PLATFORM_ID);

    // LaunchDarkly is unavailable during SSR, so the browser run of this guard makes the real decision.
    if (!isPlatformBrowser(platformId)) {
      return true;
    }

    const featureFlagService = inject(FeatureFlagService);
    const router = inject(Router);
    // Injected up front: the fallback also runs after the `await` below, outside the injection context.
    const orgLensNavigation = inject(OrgLensNavigationService);
    // Spec 050: the fallback keeps the company the address names. This CanMatch runs during
    // recognition, before `orgPathParamGuard` has adopted `/company/{segment}/{page}`'s company, so
    // the selection may still be the cookie's — the URL being recognized is the authority
    // (`orgLensPagePath`, as `orgLensLfStaffOnlyGuard` does). Only the legacy `/company/{page}` names no
    // company; there the selected one is the best available (`/company/overview` while none is).
    const fallback = (): UrlTree => {
      const target = router.getCurrentNavigation()?.extractedUrl;
      const segments = target?.root.children['primary']?.segments.map((segment) => segment.path) ?? [];
      const addressed = orgLensPagePath(segments, 'overview');
      return addressed === '/company/overview' ? router.createUrlTree(orgLensNavigation.orgLensLink('overview')) : router.parseUrl(addressed);
    };

    // A locally pinned value decides on its own, before the provider is consulted at all — waiting
    // first would let a readiness timeout answer for it, and a pinned `false` must never be
    // overridden. Non-production builds only; see `FEATURE_FLAG_OVERRIDE_STORAGE_KEY`.
    const override = featureFlagService.getFlagOverride(flag);
    if (override !== undefined) {
      return override ? true : fallback();
    }

    if (!featureFlagService.providerReady()) {
      const ready = await featureFlagService.waitForReady({ guard, flag });
      // Provider never became ready in time (LD slow / unreachable) → fail CLOSED.
      // waitForReady() reports the timeout to RUM.
      if (!ready) {
        return fallback();
      }
    }

    return featureFlagService.getBooleanFlag(flag, false)() ? true : fallback();
  };

export const cfOrgDonationsGuard = orgLensFlagGuard(CF_ORG_DONATIONS_FLAG, 'cfOrgDonationsGuard');
