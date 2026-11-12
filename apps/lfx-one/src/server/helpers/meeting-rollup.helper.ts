// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Deep import: the utils barrel pulls Angular-only code that server unit specs cannot load.
import { isFilterSafeIdentifier } from '@lfx-one/shared/utils/org-selector.utils';

import { MEETING_ROLLUP_MAX_PROJECTS } from '@lfx-one/shared/constants';
import type { MeetingRollupFilters, MeetingRollupGroupOption } from '@lfx-one/shared/interfaces';

import { ServiceValidationError } from '../errors';

/**
 * Reads the optional `root_project_uid` roll-up param from a meetings list/count query. When set,
 * the caller asks for the meetings of that project and every project beneath it (GH-5566), instead
 * of the single project a `tags=project_uid:` filter selects.
 *
 * Rejects a repeated or non filter-safe value: the UID is interpolated into query-service filters,
 * so it must never carry a separator or wildcard.
 */
export function readRollupRootUid(query: Record<string, unknown>, operation: string): string | undefined {
  const value = query['root_project_uid'];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !isFilterSafeIdentifier(value)) {
    throw ServiceValidationError.forField('root_project_uid', 'root_project_uid must be a single project identifier', { operation });
  }
  // The roll-up owns `filters_or` (the project scope), and query-service has one OR group per request:
  // merging a caller's clauses in would widen the scope, and replacing them would silently drop a filter.
  if (query['filters_or'] !== undefined) {
    throw ServiceValidationError.forField('filters_or', 'filters_or cannot be combined with root_project_uid; use filters', { operation });
  }
  return value;
}

/**
 * Reads the roll-up filters (GH-5566) from a meetings query: `project_uids` (comma-separated project
 * UIDs inside the tree), `committee_uid` (one group) and `group_type` (a group category). Each is a
 * single string; UIDs must be filter-safe because they are interpolated into query-service clauses.
 * The category is only ever compared in memory, so it is just length-checked.
 */
export function readRollupFilters(query: Record<string, unknown>, operation: string): MeetingRollupFilters {
  const filters: MeetingRollupFilters = {};

  const projectUids = readSingle(query, 'project_uids', operation);
  if (projectUids !== undefined) {
    const uids = [...new Set(projectUids.split(',').map((uid) => uid.trim()))];
    if (uids.length > MEETING_ROLLUP_MAX_PROJECTS || !uids.every(isFilterSafeIdentifier)) {
      throw ServiceValidationError.forField('project_uids', 'project_uids must be a comma-separated list of project identifiers', { operation });
    }
    filters.projectUids = uids;
  }

  const committeeUid = readSingle(query, 'committee_uid', operation);
  if (committeeUid !== undefined) {
    if (!isFilterSafeIdentifier(committeeUid)) {
      throw ServiceValidationError.forField('committee_uid', 'committee_uid must be a single group identifier', { operation });
    }
    filters.committeeUid = committeeUid;
  }

  const groupType = readSingle(query, 'group_type', operation);
  if (groupType !== undefined) {
    if (!groupType.trim() || groupType.length > 128) {
      throw ServiceValidationError.forField('group_type', 'group_type must be a group category', { operation });
    }
    filters.groupType = groupType;
  }

  return filters;
}

/** The roll-up's project scope narrowed to the selected projects; UIDs outside the tree are ignored. */
export function narrowRollupScope(scopeUids: readonly string[], projectUids?: readonly string[]): string[] {
  if (!projectUids) {
    return [...scopeUids];
  }
  const selected = new Set(projectUids);
  return scopeUids.filter((uid) => selected.has(uid));
}

/**
 * Rewrites a meetings query so it scopes to every UID in `scopeUids` (OR'd on `data.project_uid`)
 * instead of the roll-up root alone. The roll-up params are dropped, and so is any caller-supplied
 * `project_uid` tag, so a client can never widen the scope beyond the resolved project tree.
 * `committeeUids`, when given, become OR'd `committee_uid` tags; query-service ANDs that tag group
 * with the project scope. Every other param (`filters`, `name`, `page_token`, `sort`, ...) passes
 * through unchanged, so pagination stays a single upstream cursor.
 */
export function buildRollupScopedQuery(
  query: Record<string, unknown>,
  scopeUids: readonly string[],
  committeeUids?: readonly string[]
): Record<string, unknown> {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const { root_project_uid: _root, project_uids: _projects, committee_uid: _committee, group_type: _groupType, tags, ...rest } = query;
  /* eslint-enable @typescript-eslint/no-unused-vars */
  // Tags are one OR group: with a group filter in play, any tag of the caller's would widen it, so the
  // group tags replace them all.
  const keptTags = committeeUids ? committeeUids.map((uid) => `committee_uid:${uid}`) : toArray(tags).filter((tag) => !tag.startsWith('project_uid:'));

  return {
    ...rest,
    ...(keptTags.length > 0 && { tags: keptTags }),
    filters_or: scopeUids.map((uid) => `project_uid:${uid}`),
  };
}

/** Accepts cached roll-up groups only when they still have the option shape; anything else is refetched. */
export function isRollupGroups(value: unknown): value is MeetingRollupGroupOption[] {
  return (
    Array.isArray(value) && value.every((group) => typeof group?.uid === 'string' && typeof group?.name === 'string' && typeof group?.project_uid === 'string')
  );
}

/** Accepts a cached roll-up scope only when it is still a list of project UIDs; anything else is refetched. */
export function isRollupScope(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((uid) => typeof uid === 'string');
}

function readSingle(query: Record<string, unknown>, name: string, operation: string): string | undefined {
  const value = query[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw ServiceValidationError.forField(name, `${name} must be provided once, as a single string value`, { operation });
  }
  return value;
}

function toArray(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  return (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string');
}
