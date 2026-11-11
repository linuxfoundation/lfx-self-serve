// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Deep import: the utils barrel pulls Angular-only code that server unit specs cannot load.
import { isFilterSafeIdentifier } from '@lfx-one/shared/utils/org-selector.utils';

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
  return value;
}

/**
 * Rewrites a meetings query so it scopes to every UID in `scopeUids` (OR'd on `data.project_uid`)
 * instead of the roll-up root alone. The roll-up param is dropped, and so is any caller-supplied
 * `project_uid` tag, so a client can never widen the scope beyond the resolved project tree.
 * Every other param (`filters`, `name`, `page_token`, `sort`, ...) passes through unchanged, so
 * pagination stays a single upstream cursor.
 */
export function buildRollupScopedQuery(query: Record<string, unknown>, scopeUids: readonly string[]): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { root_project_uid: _root, tags, ...rest } = query;
  const keptTags = toArray(tags).filter((tag) => !tag.startsWith('project_uid:'));

  return {
    ...rest,
    ...(keptTags.length > 0 && { tags: keptTags }),
    filters_or: scopeUids.map((uid) => `project_uid:${uid}`),
  };
}

/** Accepts a cached roll-up scope only when it is still a list of project UIDs; anything else is refetched. */
export function isRollupScope(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((uid) => typeof uid === 'string');
}

function toArray(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  return (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string');
}
