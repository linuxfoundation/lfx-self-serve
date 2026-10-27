// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_ORG_COMMIT_FILTERS,
  ORG_CODE_METRIC_OPTIONS,
  ORG_COMMIT_SCOPE_OPTIONS,
  ORG_PEOPLE_TIME_RANGE_OPTIONS,
  ORG_PROJECT_SCOPE_OPTIONS,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import type { OrgCommitFilters, OrgPeopleTimeRange } from '@lfx-one/shared/interfaces';

/**
 * Per-user People directory cache namespace for one scope: `org-people-dir:v5:roster` for the unranged
 * roster (the commit filters do not apply to it), else `org-people-dir:v5:{range}:{projectScope}:{commitScope}:{metric}`.
 * Every segment is an allow-listed token.
 */
export function orgPeopleDirectoryNamespace(range: OrgPeopleTimeRange | null, filters: OrgCommitFilters): string {
  if (!range) {
    return `${VALKEY_CACHE.ORG_PEOPLE_DIRECTORY_NAMESPACE}:roster`;
  }
  return `${VALKEY_CACHE.ORG_PEOPLE_DIRECTORY_NAMESPACE}:${range}:${filters.projectScope}:${filters.commitScope}:${filters.metric}`;
}

/** Every directory namespace a caller can have filled — what a write that changes the roster (a seat reassign) has to clear. */
export function allOrgPeopleDirectoryNamespaces(): string[] {
  const namespaces = [orgPeopleDirectoryNamespace(null, DEFAULT_ORG_COMMIT_FILTERS)];
  for (const { value: range } of ORG_PEOPLE_TIME_RANGE_OPTIONS) {
    for (const { value: projectScope } of ORG_PROJECT_SCOPE_OPTIONS) {
      for (const { value: commitScope } of ORG_COMMIT_SCOPE_OPTIONS) {
        for (const { value: metric } of ORG_CODE_METRIC_OPTIONS) {
          namespaces.push(orgPeopleDirectoryNamespace(range, { projectScope, commitScope, metric }));
        }
      }
    }
  }
  return namespaces;
}
