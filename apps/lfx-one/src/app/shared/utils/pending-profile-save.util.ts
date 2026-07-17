// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PENDING_PROFILE_SAVE_KEY } from '@lfx-one/shared/constants';

/**
 * Clear any stored profile-edit pending-save.
 *
 * Called before initiating a NON-edit profile-auth flow (e.g. email or password
 * management) so an abandoned edit authorization can't be silently replayed when
 * that unrelated flow returns to the profile shell. SSR-safe: no-ops when
 * sessionStorage is unavailable.
 */
export function clearPendingProfileSave(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(PENDING_PROFILE_SAVE_KEY);
}
