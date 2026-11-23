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

export const IMPERSONATION_EMPTY_TARGET_MESSAGE = 'Enter a name, email, or username to impersonate.';

export const IMPERSONATION_SELF_MESSAGE = 'You cannot impersonate yourself. Enter a different username or email address.';

/** Shortest typed text worth searching: the auth-service ignores shorter terms, so a query of only those is refused. */
export const IMPERSONATION_SEARCH_MIN_LENGTH = 3;

/** Longest search text accepted; the auth-service refuses anything longer. */
export const IMPERSONATION_SEARCH_MAX_LENGTH = 200;

/** How many people the picker asks the auth-service for. */
export const IMPERSONATION_SEARCH_LIMIT = 10;

/** Error codes for `GET /api/impersonate/users`; the response never carries upstream text. */
export const IMPERSONATION_SEARCH_FORBIDDEN_CODE = 'IMPERSONATION_SEARCH_FORBIDDEN';
export const IMPERSONATION_SEARCH_INVALID_CODE = 'IMPERSONATION_SEARCH_INVALID';
export const IMPERSONATION_SEARCH_UNAVAILABLE_CODE = 'IMPERSONATION_SEARCH_UNAVAILABLE';
export const IMPERSONATION_SEARCH_FAILED_CODE = 'IMPERSONATION_SEARCH_FAILED';
/** The search request to auth-service itself failed (no reply), as opposed to auth-service answering with an error. */
export const IMPERSONATION_SEARCH_NATS_ERROR_CODE = 'IMPERSONATION_SEARCH_NATS_ERROR';

export const IMPERSONATION_SEARCH_FORBIDDEN_MESSAGE = 'You are not allowed to search for users to impersonate.';
export const IMPERSONATION_SEARCH_INVALID_MESSAGE = `Enter at least ${IMPERSONATION_SEARCH_MIN_LENGTH} characters to search for a user.`;
export const IMPERSONATION_SEARCH_UNAVAILABLE_MESSAGE = 'User search is unavailable right now. Please try again.';
export const IMPERSONATION_SEARCH_FAILED_MESSAGE = 'We could not search for users. Please try again.';

/**
 * Per-admin budget for the picker's user search. Every call fans out to an Auth0 directory search whose rate limit
 * is shared with login and profile flows, and a typeahead is far below this pace for a person typing.
 */
export const IMPERSONATION_SEARCH_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const IMPERSONATION_SEARCH_RATE_LIMIT_MAX = 60;

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
