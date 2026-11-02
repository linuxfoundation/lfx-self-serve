// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_LENS_TIME_RANGE_OPTIONS, ORG_PROJECT_SCOPE_OPTIONS, ORG_SCOPE_OPTIONS, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type { OrgLensTimeRange, OrgProjectScope, OrgScopeFilter } from '@lfx-one/shared/interfaces';

/**
 * Per-user People directory cache namespace: `org-people-dir:v6:roster` for the unranged roster (neither the project
 * scope nor the organization scope applies to it), else `org-people-dir:v6:{range}:{projectScope}:{orgScope}`. Only
 * these change who is listed and which code counts the stored rows carry; the commit scope and metric pick a count after
 * the read, so they share the entry. Every segment is an allow-listed token.
 */
export function orgPeopleDirectoryNamespace(range: OrgLensTimeRange | null, projectScope: OrgProjectScope, orgScope: OrgScopeFilter): string {
  if (!range) {
    return `${VALKEY_CACHE.ORG_PEOPLE_DIRECTORY_NAMESPACE}:roster`;
  }
  return `${VALKEY_CACHE.ORG_PEOPLE_DIRECTORY_NAMESPACE}:${range}:${projectScope}:${orgScope}`;
}

/** Every directory namespace a caller can have filled — what a write that changes the roster (a seat reassign) has to clear. */
export function allOrgPeopleDirectoryNamespaces(): string[] {
  const namespaces = [orgPeopleDirectoryNamespace(null, 'all', 'all')];
  for (const { value: range } of ORG_LENS_TIME_RANGE_OPTIONS) {
    for (const { value: projectScope } of ORG_PROJECT_SCOPE_OPTIONS) {
      for (const { value: orgScope } of ORG_SCOPE_OPTIONS) {
        namespaces.push(orgPeopleDirectoryNamespace(range, projectScope, orgScope));
      }
    }
  }
  return namespaces;
}
