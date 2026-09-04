// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DRAFT_STAGE_SENTINEL, PROJECT_FORMATION_STAGE_LABELS } from '../constants/project-formation.constants';
import { ProjectFunding } from '../enums/project-funding.enum';
import { ProjectStage } from '../enums/project-stage.enum';
import type { EnrichedPersonaProject, LensItem, Project, ProjectContext, WriterSummary } from '../interfaces';

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

/**
 * True when `stage` is one of the 5 Formation sub-stages, or the {@link DRAFT_STAGE_SENTINEL}
 * literal (GH-1955 — see that constant's doc comment for why "Draft" is handled at all).
 */
export function isFormationStage(stage: string | undefined | null): boolean {
  return getFormationSubStageLabel(stage) !== null;
}

/**
 * Short display label for a project's Formation sub-stage (e.g. `'Engaged'`), or `null` when
 * `stage` isn't a Formation sub-stage. Single source of truth for every Formation UI surface —
 * the dashboard badge/subtitle, the sidebar Formation card, and the project-selector tag.
 *
 * `Object.hasOwn` (not `stage in PROJECT_FORMATION_STAGE_LABELS` / a bare index) so an upstream
 * stage string that happens to collide with an inherited `Object.prototype` member name
 * (`toString`, `constructor`, ...) can never read a function off the prototype chain instead of
 * `null`.
 */
export function getFormationSubStageLabel(stage: string | undefined | null): string | null {
  if (!stage) {
    return null;
  }
  if (stage === DRAFT_STAGE_SENTINEL) {
    return DRAFT_STAGE_SENTINEL;
  }
  return Object.hasOwn(PROJECT_FORMATION_STAGE_LABELS, stage) ? (PROJECT_FORMATION_STAGE_LABELS[stage as ProjectStage] ?? null) : null;
}

/**
 * Reduces a project list to a {@link WriterSummary} — whether it contains at least one
 * writer-held foundation, and at least one writer-held non-foundation project. Filters to
 * `writer === true` itself so callers can't accidentally widen access by passing an
 * un-access-checked or differently-scoped list (LFXV2-2857): both `WriterGrantsService`'s
 * deferred sweep (client, over the unscoped `getProjects()` result) and
 * `ProjectService.getWriterSummary` (server, over the already writer-filtered
 * `getDirectGrantProjects()` result) call this so the two runtimes can't drift apart.
 */
export function summarizeWriterGrants(projects: Project[]): WriterSummary {
  const writerProjects = projects.filter((project) => project.writer === true);
  return {
    hasWriterFoundation: writerProjects.some((project) => computeIsFoundation(project)),
    hasWriterProject: writerProjects.some((project) => !computeIsFoundation(project)),
  };
}
