// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Committee, CommitteeWriterProbeResult, EntityWithProject, Project, SurveyCommittee } from '@lfx-one/shared/interfaces';
import { catchError, concatMap, from, map, Observable, of, reduce, takeWhile } from 'rxjs';

import { isTransientHttpError } from './http-error.utils';

// Single definition of the meetings write predicate: when writerGuard and the two reactive
// access signals each carried their own copy, drift denied or evicted meeting coordinators.
export function hasMeetingWriteAccess(project: Project | null): boolean {
  return project?.writer === true || project?.meetingCoordinator === true;
}

/**
 * Tri-state meeting write-access read: true/false are confirmed grant/deny, `undefined` means
 * the check couldn't be confirmed (lookup failed, or the BFF omitted `meetingCoordinator` because
 * its FGA check itself failed — HTTP 200, field absent). Callers that evict on a `false` transition
 * (e.g. evictOnWriteAccessLoss) must treat `undefined` as "keep provisional access", the same
 * unknown-vs-denied distinction writerGuard already makes for the route guard (linuxfoundation/lfx-self-serve-ops#500) — otherwise
 * a transient BFF blip reads as a flat denial and silently evicts a legitimate meeting coordinator.
 */
export function meetingWriteAccessState(project: Project | null): boolean | undefined {
  if (project === null) {
    return undefined;
  }
  if (hasMeetingWriteAccess(project)) {
    return true;
  }
  return project.meetingCoordinator === undefined ? undefined : false;
}

// Prefers the BFF-enriched slug, falling back to the uid — `GET /api/projects/:slug` sniffs UUIDs,
// so either resolves. `fallback` covers an entity carrying neither. `||` (not `??`) is deliberate:
// `enrichWithProjectData` writes `''` (not null) when the relation-gated project lookup fails, and a
// nullish check would let that empty string short-circuit the uid/fallback fallthrough, wrongly
// denying edit access when the uid (or the `?project=` context) would have resolved.
export function resolveEntityWriteSlug(entity: Pick<EntityWithProject, 'project_slug' | 'project_uid'> | null, fallback: string | null): string | null {
  return entity?.project_slug || entity?.project_uid || fallback;
}

/**
 * Returns unique, nonempty survey committee UIDs in payload order, with a matching URL UID first.
 * A URL UID never adds a candidate to a nonempty committee list; only committee-less surveys use it as a fallback.
 */
export function resolveSurveyCommitteeCandidates(
  committees: Pick<SurveyCommittee, 'committee_uid'>[] | null | undefined,
  urlCommitteeUid: string | null
): string[] {
  if (!committees?.length) {
    return urlCommitteeUid ? [urlCommitteeUid] : [];
  }

  // The survey defines the candidates; a URL uid can only reorder them, never add one.
  const candidates = new Set<string>();
  if (urlCommitteeUid && committees.some((committee) => committee.committee_uid === urlCommitteeUid)) {
    candidates.add(urlCommitteeUid);
  }
  for (const committee of committees) {
    if (committee.committee_uid) {
      candidates.add(committee.committee_uid);
    }
  }
  return Array.from(candidates);
}

/**
 * Probes committees sequentially, stopping at the first writer and continuing after denied or failed lookups.
 * `transientFailure` is true only when no writer grants access and at least one lookup fails transiently.
 */
export function probeCommitteeWriters(
  uids: readonly string[],
  fetch: (uid: string) => Observable<Pick<Committee, 'writer'> | null>
): Observable<CommitteeWriterProbeResult> {
  if (!uids.length) {
    return of({ writer: false, transientFailure: false });
  }

  return from(uids).pipe(
    concatMap((uid) =>
      fetch(uid).pipe(
        map((committee) => ({ writer: committee?.writer === true, transientFailure: false })),
        catchError((error: unknown) => of({ writer: false, transientFailure: isTransientHttpError(error) }))
      )
    ),
    takeWhile((result) => !result.writer, true),
    reduce(
      (acc: CommitteeWriterProbeResult, result): CommitteeWriterProbeResult => ({
        writer: acc.writer || result.writer,
        transientFailure: !result.writer && (acc.transientFailure || result.transientFailure),
      }),
      { writer: false, transientFailure: false }
    )
  );
}
