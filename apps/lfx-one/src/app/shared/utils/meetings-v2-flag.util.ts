// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Signal } from '@angular/core';
import { MEETING_V2_ENABLED_DEFAULT, MEETING_V2_ENABLED_FLAG, MEETINGS_REDESIGN_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * The meetings v2 gate read by every entry point: on when `MEETING_V2_ENABLED_FLAG` or
 * `MEETINGS_REDESIGN_FLAG` is on, so the redesigned page's edit actions raise the composer.
 */
export function meetingsV2EnabledSignal(featureFlagService: FeatureFlagService): Signal<boolean> {
  const v2 = featureFlagService.getBooleanFlag(MEETING_V2_ENABLED_FLAG, MEETING_V2_ENABLED_DEFAULT);
  const redesign = featureFlagService.getBooleanFlag(MEETINGS_REDESIGN_FLAG, false);
  return computed(() => v2() || redesign());
}

/**
 * Resolves {@link meetingsV2EnabledSignal} for a route guard. Pinned overrides decide first (a pinned
 * `true` on either flag, or `false` on both); otherwise waits for the provider and falls back to
 * {@link MEETING_V2_ENABLED_DEFAULT} when it never answers. Takes the service as a parameter so it can
 * be awaited outside the injection context.
 */
export async function resolveMeetingsV2Enabled(featureFlagService: FeatureFlagService, guard: string): Promise<boolean> {
  const overrides = [MEETING_V2_ENABLED_FLAG, MEETINGS_REDESIGN_FLAG].map((flag) => featureFlagService.getFlagOverride(flag));
  if (overrides.includes(true)) {
    return true;
  }
  if (overrides.every((override) => override === false)) {
    return false;
  }

  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard, flag: MEETING_V2_ENABLED_FLAG });
    if (!ready) {
      return MEETING_V2_ENABLED_DEFAULT;
    }
  }

  return meetingsV2EnabledSignal(featureFlagService)();
}
