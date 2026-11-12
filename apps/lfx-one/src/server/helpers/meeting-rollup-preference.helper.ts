// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Deep import: the utils barrel pulls Angular-only code that server unit specs cannot load.
import { isFilterSafeIdentifier } from '@lfx-one/shared/utils/org-selector.utils';
import {
  MEETING_ROLLUP_MAX_PROJECTS,
  MEETING_ROLLUP_PROJECTS_PREFERENCE_MAX_ROOTS,
  MEETING_ROLLUP_PROJECTS_PREFERENCE_VALUE_MAX_LENGTH,
} from '@lfx-one/shared/constants';
import type { MeetingRollupProjectsPreferenceRequest } from '@lfx-one/shared/interfaces';

import { ServiceValidationError } from '../errors';

/**
 * Parses the stored roll-up project preference (GH-5566): a map of root project UID to selected project
 * UIDs, oldest-saved root first. A root with no entry has no saved choice (the page then shows only the
 * root's own meetings); an empty list is a saved choice of all projects. A missing, malformed or partly invalid value degrades to what is valid,
 * so a bad stored value can never break the meetings page.
 */
export function parseRollupProjectsPreference(raw: string | null): Record<string, string[]> {
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const map: Record<string, string[]> = {};
  for (const [root, uids] of Object.entries(parsed as Record<string, unknown>)) {
    if (isFilterSafeIdentifier(root) && Array.isArray(uids)) {
      map[root] = uids.filter((uid): uid is string => typeof uid === 'string' && isFilterSafeIdentifier(uid));
    }
  }
  return map;
}

/** Validates a save request body: one filter-safe root and at most the roll-up's project cap of filter-safe UIDs. */
export function readRollupProjectsPreferenceRequest(body: unknown, operation: string): MeetingRollupProjectsPreferenceRequest {
  const request = body as Partial<MeetingRollupProjectsPreferenceRequest> | undefined;
  if (typeof request?.root_project_uid !== 'string' || !isFilterSafeIdentifier(request.root_project_uid)) {
    throw ServiceValidationError.forField('root_project_uid', 'root_project_uid must be a single project identifier', { operation });
  }
  const uids = request.project_uids;
  if (!Array.isArray(uids) || uids.length > MEETING_ROLLUP_MAX_PROJECTS || !uids.every((uid) => typeof uid === 'string' && isFilterSafeIdentifier(uid))) {
    throw ServiceValidationError.forField('project_uids', 'project_uids must be a list of project identifiers', { operation });
  }
  return { root_project_uid: request.root_project_uid, project_uids: [...new Set(uids)] };
}

/**
 * Returns the preference map with `rootUid` set to `projectUids` as the most recently saved root (an empty
 * list is kept: it records a choice of all projects), keeping at most the root cap and the stored-size
 * budget by dropping the oldest roots.
 */
export function setRollupProjectsPreference(map: Record<string, string[]>, rootUid: string, projectUids: string[]): Record<string, string[]> {
  const entries = Object.entries(map).filter(([root]) => root !== rootUid);
  entries.push([rootUid, projectUids]);
  let kept = entries.slice(-MEETING_ROLLUP_PROJECTS_PREFERENCE_MAX_ROOTS);
  while (kept.length > 1 && JSON.stringify(Object.fromEntries(kept)).length > MEETING_ROLLUP_PROJECTS_PREFERENCE_VALUE_MAX_LENGTH) {
    kept = kept.slice(1);
  }
  return Object.fromEntries(kept);
}
