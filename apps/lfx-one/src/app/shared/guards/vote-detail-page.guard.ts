// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { VOTE_DETAIL_PAGE_DEFAULT, VOTE_DETAIL_PAGE_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * CanMatch guard choosing between the vote detail page (#3913) and the vote permalink for `/votes/:id`.
 * @description Paired routes share the path: the page entry carries this guard and the permalink entry
 * follows it, so `false` simply falls through to the permalink — never a redirect. Both directions of the
 * flag stay a pure LaunchDarkly change, and shared links and reminder emails need no change.
 *
 * SSR always matches the page entry, like the other flag guards defer to the browser: the page renders only
 * the vote fetch outcome on the server (HTTP 404, or the same skeleton the permalink paints), so a flag-off
 * browser falling through to the permalink after hydration looks identical.
 *
 * In the browser, a locally pinned override decides first (non-production builds only); with no answer from
 * LaunchDarkly (unready, timed out) this returns {@link VOTE_DETAIL_PAGE_DEFAULT}, the same fallback the votes
 * dashboard uses, so a deep link and the in-app entry points never disagree.
 */
export const voteDetailPageGuard: CanMatchFn = async () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);

  const override = featureFlagService.getFlagOverride(VOTE_DETAIL_PAGE_FLAG);
  if (override !== undefined) {
    return override;
  }

  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'voteDetailPageGuard', flag: VOTE_DETAIL_PAGE_FLAG });
    if (!ready) {
      return VOTE_DETAIL_PAGE_DEFAULT;
    }
  }

  return featureFlagService.getBooleanFlag(VOTE_DETAIL_PAGE_FLAG, VOTE_DETAIL_PAGE_DEFAULT)();
};
