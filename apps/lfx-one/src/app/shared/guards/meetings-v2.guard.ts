// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { MEETING_V2_ENABLED_DEFAULT, MEETING_V2_ENABLED_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * CanMatch guard choosing between the meetings v2 composer and the pre-v2 wizard for a deep link
 * (`/meetings/create`, `/meetings/:id/edit`).
 * @description Paired routes share a path: the composer entry carries this guard and the wizard entry
 * follows it unguarded, so `false` here simply falls through to the wizard — never a redirect. That
 * keeps both directions of the flag a pure LaunchDarkly change: turning it off sends the same URL back
 * to the wizard with no deploy.
 *
 * SSR always matches the composer entry, like the other flag guards defer to the browser: the composer
 * route does nothing on the server (no drawer, no redirect), so the server paints an empty outlet and
 * the browser run decides. Rendering the wizard on the server instead would put a typeable form on
 * screen that the browser then swaps for the composer, dropping whatever was typed meanwhile.
 *
 * In the browser, a locally pinned override decides first (non-production builds only); with no answer
 * from LaunchDarkly (unready, timed out) this returns {@link MEETING_V2_ENABLED_DEFAULT}, the same
 * fallback every component read of the flag uses, so a deep link and the in-app entry points never
 * disagree.
 */
export const meetingsV2Guard: CanMatchFn = async () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);

  const override = featureFlagService.getFlagOverride(MEETING_V2_ENABLED_FLAG);
  if (override !== undefined) {
    return override;
  }

  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'meetingsV2Guard', flag: MEETING_V2_ENABLED_FLAG });
    if (!ready) {
      return MEETING_V2_ENABLED_DEFAULT;
    }
  }

  return featureFlagService.getBooleanFlag(MEETING_V2_ENABLED_FLAG, MEETING_V2_ENABLED_DEFAULT)();
};
