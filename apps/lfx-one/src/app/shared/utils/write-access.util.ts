// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { EntityWithProject, Project } from '@lfx-one/shared/interfaces';

// Single definition of the meetings write predicate: when writerGuard and the two reactive
// access signals each carried their own copy, drift denied or evicted meeting coordinators.
export function hasMeetingWriteAccess(project: Project | null): boolean {
  return project?.writer === true || project?.meetingCoordinator === true;
}

// Prefers the BFF-enriched slug, falling back to the uid — `GET /api/projects/:slug` sniffs UUIDs,
// so either resolves. `fallback` covers an entity carrying neither. `||` (not `??`) is deliberate:
// `enrichWithProjectData` writes `''` (not null) when the relation-gated project lookup fails, and a
// nullish check would let that empty string short-circuit the uid/fallback fallthrough, wrongly
// denying edit access when the uid (or the `?project=` context) would have resolved.
export function resolveEntityWriteSlug(entity: Pick<EntityWithProject, 'project_slug' | 'project_uid'> | null, fallback: string | null): string | null {
  return entity?.project_slug || entity?.project_uid || fallback;
}
