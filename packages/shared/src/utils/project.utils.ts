// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { EnrichedPersonaProject, LensItem, Project, ProjectContext } from '../interfaces';

export function toProjectContext(project: EnrichedPersonaProject): ProjectContext {
  return {
    uid: project.projectUid,
    name: project.projectName || project.projectSlug,
    slug: project.projectSlug,
    logoUrl: project.logoUrl ?? undefined,
  };
}

export function lensItemToProjectContext(item: LensItem): ProjectContext {
  return {
    uid: item.uid,
    name: item.name || item.slug,
    slug: item.slug,
    logoUrl: item.logoUrl ?? undefined,
  };
}

export function isSameProjectContext(a: ProjectContext | null, b: ProjectContext | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.uid === b.uid && a.name === b.name && a.slug === b.slug && (a.logoUrl ?? null) === (b.logoUrl ?? null);
}

export function isFoundationProject(project: EnrichedPersonaProject): boolean {
  return project.isFoundation;
}

/** Active, membership-funded, not an Internal Allocation. */
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
