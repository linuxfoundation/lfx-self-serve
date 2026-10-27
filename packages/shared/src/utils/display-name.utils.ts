// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Joins a first and last name into the single display name used by the navbar and account menu.
 * Parts are trimmed; empty or missing parts are dropped, so the result is '' when both are empty.
 */
export function buildDisplayName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  return [firstName, lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
}
