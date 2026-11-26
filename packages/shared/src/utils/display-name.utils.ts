// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLACEHOLDER_NAME_PATTERN } from '../constants/org-people.constants';

/** True when a name, or one part of it, is an upstream placeholder such as "[[unknown]]" rather than a real name. */
export function isPlaceholderName(value: string | null | undefined): boolean {
  return !!value && PLACEHOLDER_NAME_PATTERN.test(value);
}

/**
 * Trims a first or last name, returning '' when it is missing, blank or a placeholder, so the caller's
 * usual no-name fallback (email, username, "Unknown member") applies instead of showing the placeholder.
 */
export function cleanNamePart(value: string | null | undefined): string {
  const part = (value ?? '').trim();
  return isPlaceholderName(part) ? '' : part;
}

/**
 * Joins a first and last name into the single display name used by the navbar and account menu.
 * Parts are trimmed; empty, missing or placeholder parts are dropped, so the result is '' when neither is a real name.
 */
export function buildDisplayName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  return [firstName, lastName].map(cleanNamePart).filter(Boolean).join(' ');
}
