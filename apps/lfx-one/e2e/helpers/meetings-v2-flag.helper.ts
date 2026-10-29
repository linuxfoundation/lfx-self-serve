// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Pins the meetings v2 flag for a page, so a spec states which branch it is testing.
 *
 * `MEETING_V2_ENABLED_FLAG` decides, at every entry point, whether a create or edit action raises
 * the v2 composer or the pre-v2 wizard. It defaults to `false` and its real value comes from
 * LaunchDarkly targeting, so a spec that asserts either surface has to pin it rather than inherit
 * whatever the test account happens to be targeted for.
 */

import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MEETING_V2_ENABLED_FLAG, MEETINGS_REDESIGN_FLAG } from '@lfx-one/shared/constants';
import { Page } from '@playwright/test';

/**
 * Merges one flag into the override map before the flag provider bootstraps.
 *
 * `addInitScript`, not a post-load write: `FeatureFlagService.getBooleanFlag` consults the
 * override ahead of its own readiness check, so a value present at document start is what the
 * very first read returns — no window in which the other branch renders. Mirrors
 * `stubFormationFlag` in `formation-checklist.helper.ts`. Merging keeps pins for different flags
 * from overwriting each other.
 */
async function pinFlag(page: Page, flag: string, enabled: boolean): Promise<void> {
  await page.addInitScript(
    ([storageKey, flagKey, value]) => {
      const current = JSON.parse(window.localStorage.getItem(storageKey as string) ?? '{}');
      window.localStorage.setItem(storageKey as string, JSON.stringify({ ...current, [flagKey as string]: value }));
    },
    [FEATURE_FLAG_OVERRIDE_STORAGE_KEY, flag, enabled] as const
  );
}

export async function stubMeetingsV2Flag(page: Page, enabled = true): Promise<void> {
  await pinFlag(page, MEETING_V2_ENABLED_FLAG, enabled);
}

/**
 * Pins the Me lens meetings redesign flag. Defaults to `false`: specs that drive the existing
 * meetings dashboard at `/meetings` must not inherit whatever the test account is targeted for.
 */
export async function stubMeetingsRedesignFlag(page: Page, enabled = false): Promise<void> {
  await pinFlag(page, MEETINGS_REDESIGN_FLAG, enabled);
}
