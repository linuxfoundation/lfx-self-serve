// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, makeStateKey, Signal, TransferState } from '@angular/core';
import { PROFILE_REDESIGN_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * The server's answer to the profile redesign flag for this visit, set when a redesign guard runs on the server: `/account` and the
 * Profile & Account tabs that move to it. Other renders leave it unset.
 */
export const PROFILE_REDESIGN_KEY = makeStateKey<boolean>('profileRedesign');

/**
 * Whether the profile redesign is on, for chrome outside the guarded routes such as the navbar (#6067). It follows the
 * server's answer when the render made one, so SSR and hydration agree; otherwise the browser's flag once `hydrated` is
 * true, so the first client render still matches a server render that had no answer.
 */
export function injectProfileRedesignEnabled(hydrated: Signal<boolean>): Signal<boolean> {
  const decided = inject(TransferState).get(PROFILE_REDESIGN_KEY, null);
  const flag = inject(FeatureFlagService).getBooleanFlag(PROFILE_REDESIGN_FLAG, false);
  return computed(() => decided ?? (hydrated() && flag()));
}
