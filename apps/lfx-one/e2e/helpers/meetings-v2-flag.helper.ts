// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Pins the meetings v2 flags for a page, so a spec states which branch it is testing.
 *
 * `MEETING_V2_ENABLED_FLAG` decides, at every entry point, whether a create or edit action raises
 * the v2 composer or the pre-v2 wizard; `MEETING_DETAILS_V2_FLAG` decides which `/meetings/:id`
 * page renders. It defaults to `false` and its real value comes from
 * LaunchDarkly targeting, so a spec that asserts either surface has to pin it rather than inherit
 * whatever the test account happens to be targeted for.
 */

import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MEETING_DETAILS_V2_FLAG, MEETING_V2_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { Page } from '@playwright/test';

/**
 * Seeds the flag override before the flag provider bootstraps.
 *
 * `addInitScript`, not a post-load write: `FeatureFlagService.getBooleanFlag` consults the
 * override ahead of its own readiness check, so a value present at document start is what the
 * very first read returns — no window in which the other branch renders. Mirrors
 * `stubFormationFlag` in `formation-checklist.helper.ts`.
 */
export async function stubMeetingsV2Flag(page: Page, enabled = true): Promise<void> {
  await pinFlagOverride(page, MEETING_V2_ENABLED_FLAG, enabled);
}

/**
 * Pins the meeting details V2 page flag (`MEETING_DETAILS_V2_FLAG`, #3576), which gates
 * `/meetings/:id` on its own, apart from the composer's flag.
 */
export async function stubMeetingDetailsV2Flag(page: Page, enabled = true): Promise<void> {
  await pinFlagOverride(page, MEETING_DETAILS_V2_FLAG, enabled);
}

/**
 * Sets one flag in the override object, keeping any flag another helper already pinned, so the two
 * helpers above can be called in either order on the same page.
 */
async function pinFlagOverride(page: Page, flagKey: string, enabled: boolean): Promise<void> {
  await page.addInitScript(
    ([storageKey, key, value]) => {
      let overrides: Record<string, unknown> = {};
      try {
        overrides = JSON.parse(window.localStorage.getItem(storageKey as string) ?? '{}') ?? {};
      } catch {
        overrides = {};
      }
      window.localStorage.setItem(storageKey as string, JSON.stringify({ ...overrides, [key as string]: value }));
    },
    [FEATURE_FLAG_OVERRIDE_STORAGE_KEY, flagKey, enabled] as const
  );
}
