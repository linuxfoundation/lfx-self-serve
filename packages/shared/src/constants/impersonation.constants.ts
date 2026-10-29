// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ImpersonationTransition } from '../interfaces/impersonation.interface';

export const RECENT_IMPERSONATIONS_STORAGE_KEY = 'lfx:recent-impersonations';
export const MAX_RECENT_IMPERSONATIONS = 5;

/** Error code for a CTE / auth-service rejection that we treat as "target not found". */
export const IMPERSONATION_TARGET_USER_NOT_FOUND_CODE = 'TARGET_USER_NOT_FOUND';

export const IMPERSONATION_USER_NOT_FOUND_MESSAGE =
  'We were unable to locate the user to impersonate. Please double-check the username or email address and try again.';

export const IMPERSONATION_START_FAILED_MESSAGE = 'We could not start impersonation. Please try again.';

/** Error code for a switch request that names the user already being impersonated. */
export const IMPERSONATION_ALREADY_TARGET_CODE = 'ALREADY_IMPERSONATING_TARGET';

export const IMPERSONATION_ALREADY_TARGET_MESSAGE = 'You are already impersonating this user. Choose a different user to switch to.';

export const IMPERSONATION_SELF_MESSAGE = 'You cannot impersonate yourself. Enter a different username or email address.';

/** Copy shown by the page-level overlay while an impersonation change is in flight, keyed by transition. */
export const IMPERSONATION_TRANSITION_MESSAGES: Record<ImpersonationTransition, string> = {
  starting: 'Starting impersonation...',
  switching: 'Switching user...',
  stopping: 'Stopping impersonation...',
};

/**
 * Rendered height of the fixed impersonation banner. The banner is a fixed single-line `h-[36px]`
 * (px, not rem, because `styles.scss` sets a 14px root — see `.claude/rules/styling.md`), and every
 * layout offset under it (`top-[36px]` / `pt-[36px]`, the `_navbar.scss` banner-offset popover)
 * must match this value.
 */
export const IMPERSONATION_BANNER_HEIGHT_PX = 36;
