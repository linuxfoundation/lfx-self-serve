// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectFunding } from '../enums/project-funding.enum';
import { ProjectStage } from '../enums/project-stage.enum';
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

// PCC test-project override (lfx-pcc helper.ts) — kept in sync with hasHealthMetricDashboard.
const FOUNDATION_NAME_OVERRIDES = new Set(['Test Project Group IT', 'Test Project IT']);

/**
 * Membership-funded foundation (Funding === 'Funded'), not an Internal Allocation.
 * Includes both live (Active) and pre-launch (Formation - Engaged) foundations.
 * PCC test projects also qualify.
 */
export function computeIsFoundation(project: Project | null): boolean {
  if (!project) {
    return false;
  }

  if (FOUNDATION_NAME_OVERRIDES.has(project.name)) {
    return true;
  }

  return (
    (project.stage === ProjectStage.Active || project.stage === ProjectStage.FormationEngaged) &&
    project.legal_entity_type !== 'Internal Allocation' &&
    project.funding === ProjectFunding.Funded &&
    Array.isArray(project.funding_model) &&
    project.funding_model.includes('Membership')
  );
}
