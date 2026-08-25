// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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

/**
 * Builds the `?project=` query param object for an in-app link (e.g. a
 * back/create navigation) that needs to pin its target project — but only
 * when that target actually diverges from the active context. Written
 * unconditionally, the pin can outlive an in-page project switch:
 * `ProjectContextService.syncProjectQueryParam` rewrites `?project=` via
 * `location.replaceState`, which bypasses the Router entirely, so a
 * route-param read never sees the rewrite. Omitting the param in the common
 * (non-divergent) case preserves normal context-following behavior instead.
 *
 * Pulled out as a pure function — three LFX One newsletter call sites
 * (NewsletterListComponent.goToCreate, NewsletterManageComponent.listQueryParams,
 * NewsletterAnalyticsComponent.goBack) apply this exact rule, and the "only
 * when it diverges" condition is subtle enough that inlined copies could
 * silently drift apart with no test catching it.
 */
export function divergentProjectQueryParam(targetUid: string, activeUid: string): Record<string, string> {
  return targetUid && targetUid !== activeUid ? { project: targetUid } : {};
}
