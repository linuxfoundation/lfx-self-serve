// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Canonical entity route builder keyed on the ENTITY's own project tier, not the viewer's transient lens.
 * Null on unknown tier (undefined/null) preserves the flat-path `lensRedirectGuard` fallback contract.
 */
export function getEntityCommands(segment: string, id: string, isFoundation: boolean | null | undefined, leaf?: 'edit'): string[] | null {
  if (isFoundation === undefined || isFoundation === null) {
    return null;
  }

  return ['/', isFoundation ? 'foundation' : 'project', segment, id, ...(leaf ? [leaf] : [])];
}
