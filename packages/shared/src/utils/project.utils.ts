// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { EnrichedPersonaProject, Project, ProjectContext } from '../interfaces';

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

/**
 * Determine if a raw Project from the upstream API is a foundation (top-level entity).
 * A foundation project is Active, not an Internal Allocation, and funded by Membership.
 */
export function computeIsFoundation(project: Project | null): boolean {
  if (!project) {
    return false;
  }

  return (
    project.stage === 'Active' &&
    project.legal_entity_type !== 'Internal Allocation' &&
    Array.isArray(project.funding_model) &&
    project.funding_model.includes('Membership')
  );
}
