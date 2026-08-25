// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Project } from '@lfx-one/shared/interfaces';
import { computeIsFoundation } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { logger } from '../services/logger.service';
import type { ProjectService } from '../services/project.service';

/**
 * Fetches an entity's project for detail enrichment. Returns null on failure so the entity
 * still loads — the frontend falls back to resolving project context from `project_uid`.
 *
 * Uses the query-service metadata lookup (getProjectsByIds) rather than getProjectById: the
 * /projects/:uid endpoint is relation-gated, and an entity writer may lack a project-level
 * viewer relation (the committee-writer case writerGuard handles) — the direct fetch would
 * 403 for exactly those users, and the client fallback hits the same gated endpoint, leaving
 * the edit page in a stale context. The query-service path needs no project relation.
 * Entity access was already checked by the caller, and the exposed fields
 * (slug/name/is_foundation) are non-sensitive.
 */
export async function fetchEntityProject(
  req: Request,
  projectService: ProjectService,
  projectUid: string | undefined,
  logContext: { operation: string; [field: string]: unknown }
): Promise<Project | null> {
  if (!projectUid) {
    return null;
  }

  const { operation, ...metadata } = logContext;
  try {
    const projects = await projectService.getProjectsByIds(req, [projectUid]);
    return projects.get(projectUid) ?? null;
  } catch (error) {
    logger.warning(req, operation, 'Failed to fetch project for entity enrichment; continuing without project fields', {
      ...metadata,
      project_uid: projectUid,
      err: error,
    });
    return null;
  }
}

/**
 * Maps a resolved project to the detail-enrichment fields the client context-sync consumes.
 * `parent_project_uid` is deliberately excluded: nothing in the detail/edit flow consumes it,
 * and it discloses hierarchy the caller may hold no relation to. List payloads still carry it
 * via enrichWithProjectData for the dashboard filters.
 */
export function toEntityProjectFields(project: Project): { project_slug: string; project_name: string; is_foundation: boolean } {
  return {
    project_slug: project.slug,
    project_name: project.name,
    is_foundation: computeIsFoundation(project),
  };
}
