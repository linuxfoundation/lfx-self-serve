// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Meeting, Project } from '@lfx-one/shared/interfaces';

// Single definition of the meetings write predicate: when writerGuard and the two reactive
// access signals each carried their own copy, drift denied or evicted meeting coordinators.
export function hasMeetingWriteAccess(project: Project | null): boolean {
  return project?.writer === true || project?.meetingCoordinator === true;
}

// Prefers the BFF-enriched slug, falling back to the uid — `GET /api/projects/:slug` sniffs UUIDs,
// so either resolves. `fallback` covers a meeting carrying neither.
export function resolveMeetingWriteSlug(meeting: Pick<Meeting, 'project_slug' | 'project_uid'> | null, fallback: string | null): string | null {
  return meeting?.project_slug ?? meeting?.project_uid ?? fallback;
}
