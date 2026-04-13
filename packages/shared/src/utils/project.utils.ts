// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { EnrichedPersonaProject, ProjectContext } from '../interfaces';

/**
 * Convert an EnrichedPersonaProject to a ProjectContext
 */
export function toProjectContext(project: EnrichedPersonaProject): ProjectContext {
  return {
    uid: project.projectUid,
    name: project.projectName || project.projectSlug,
    slug: project.projectSlug,
  };
}

/**
 * Determine if a project should be treated as a foundation (top-level).
 * Uses the computed `isFoundation` flag attached during persona enrichment
 * on `EnrichedPersonaProject`, rather than a raw field from the upstream project model.
 */
export function isFoundationProject(project: EnrichedPersonaProject): boolean {
  return project.isFoundation;
}
