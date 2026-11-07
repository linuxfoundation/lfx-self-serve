// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Pins the Marketing OS feature flags for a page, so every Marketing OS spec states which flags it runs under.
 *
 * The module's own gate (`MKTG_OS_AGENTS_ENABLED_FLAG`) defaults to `false`, its real value coming from LaunchDarkly
 * targeting, so a spec that asserts a Marketing OS page has to pin it rather than inherit whatever the test account is
 * targeted for.
 */

import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MKTG_OS_AGENTS_ENABLED_FLAG } from '@lfx-one/shared/constants/feature-flags.constants';
import { Page } from '@playwright/test';

/** What a Marketing OS page runs under unless a spec says otherwise: the module on. */
export const MKTG_OS_FLAG_DEFAULTS: Readonly<Record<string, boolean>> = {
  [MKTG_OS_AGENTS_ENABLED_FLAG]: true,
};

/**
 * Writes the Marketing OS flags into the override map before the flag provider bootstraps: the defaults fill in
 * whatever is not stored yet, and `overrides` always win.
 *
 * `addInitScript`, not a post-load write: `FeatureFlagService.getBooleanFlag` consults the override ahead of its own
 * readiness check, so a value present at document start is what the very first read returns, with no window in which
 * the other branch renders (mirrors `pinFlag` in `meetings-v2-flag.helper.ts`). Because a stored value outranks the
 * defaults, a spec turns one flag off by calling this with that override *before* its page helper, whose own default
 * pin then leaves the stored value alone; the page helpers navigate by `pushState`, so a pin added after them would
 * wait for a reload.
 */
export async function pinMktgOsFlags(page: Page, overrides: Record<string, boolean> = {}): Promise<void> {
  await page.addInitScript(
    ([storageKey, defaults, pins]) => {
      const current = JSON.parse(window.localStorage.getItem(storageKey as string) ?? '{}') as Record<string, boolean>;
      window.localStorage.setItem(
        storageKey as string,
        JSON.stringify({ ...(defaults as Record<string, boolean>), ...current, ...(pins as Record<string, boolean>) })
      );
    },
    [FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MKTG_OS_FLAG_DEFAULTS, overrides] as const
  );
}
