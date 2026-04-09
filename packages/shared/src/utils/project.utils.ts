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
 * Determine if a project is a foundation (top-level) within a given set of projects.
 * A project is a foundation if its parentProjectUid is absent or not in the set.
 */
export function isFoundationProject(project: EnrichedPersonaProject, validProjectIds: Set<string>): boolean {
  return !project.parentProjectUid || project.parentProjectUid === '' || !validProjectIds.has(project.parentProjectUid);
}
