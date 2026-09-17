// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Whether NavigationService.applyDefaultSelection should leave the current
 * project/foundation context alone instead of picking a persona-priority default.
 *
 * Extracted as a pure function so the deep-link vs default-selection policy is
 * unit-testable without the Angular app test runner (same pattern as
 * `deriveAllowedLenses` in lens.utils.ts).
 *
 * Skip when either (including on an empty lens-items page — do not clear context or redirect to Me):
 *  - an existing context is already set (cookie restore, guard, or syncEntityProjectContext — #960)
 *  - the URL carries a non-empty `?project=` slug (`projectQueryParamGuard` is authoritative — #2697)
 *
 * Callers must pass slug *truthiness*, not key presence: an empty `?project=` is treated as
 * absent, matching the guard's `if (!slug) return true`.
 */
export function shouldSkipNavDefaultSelection(hasExplicitProjectSlug: boolean, existingUid: string | null | undefined): boolean {
  return Boolean(existingUid) || hasExplicitProjectSlug;
}
