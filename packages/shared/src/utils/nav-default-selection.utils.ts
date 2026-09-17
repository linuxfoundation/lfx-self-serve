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
 * Order matters:
 *  1. Existing context already in this page — keep it (`selected_uid` injection).
 *  2. URL already has `?project=` — `projectQueryParamGuard` is authoritative (#2697).
 *  3. Entity pages without `?project=` — keep `syncEntityProjectContext` (#960).
 */
export function shouldSkipNavDefaultSelection(urlHasProjectParam: boolean, existingUid: string | null | undefined, pageContainsExisting: boolean): boolean {
  if (existingUid && pageContainsExisting) {
    return true;
  }
  if (urlHasProjectParam) {
    return true;
  }
  return Boolean(existingUid);
}
