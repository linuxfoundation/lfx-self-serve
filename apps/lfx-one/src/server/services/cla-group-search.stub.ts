// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ############################################################################
// TEMPORARY — DELETE THIS ENTIRE FILE.
//
// Stubbed CLA-Group selection for the Sign CLA hand-off (#1251). The real
// four-source search is #1250; replacing it means deleting this file and
// reimplementing `listClaGroupOptions` against that search. Nothing else in
// the hand-off should have to change — that is the whole point of the file
// boundary, and it is the acceptance criterion for the stub (SC-006).
//
// The file exists so the hand-off could be demonstrated end to end without
// waiting on #1250. It must not survive into the permanent surface (FR-010).
// ############################################################################

import type { ClaGroupOption } from '@lfx-one/shared/interfaces';

/**
 * Development CLA Groups a contributor can pick from.
 *
 * The identifiers are REAL. The Contributor Console fetches the project by the value it is
 * handed, so a synthetic UUID fails at the decision screen exactly as a synthetic user id
 * would — a placeholder here would make the stub untestable against the real Console.
 *
 * Any group listed must also be able to complete a signing leg, or the hand-off dead-ends on a
 * legitimate-looking screen: it must not require an individual CLA alongside the corporate one
 * (that routes the corporate leg into the individual one), and it needs a company holding an
 * approved corporate CLA whose allowlist can match an LFID-keyed record.
 */
const DEV_CLA_GROUPS: ClaGroupOption[] = [{ claGroupId: '032a4e39-c5c9-4653-8bdd-202c7257ed45', projectName: 'Venus test', claGroupName: 'Venus test' }];

/**
 * Returns the CLA Groups matching a query, or all of them when the query is empty.
 *
 * The query parameter exists so the *client* is already written against a search, matching the
 * approved prototype's picker. #1250 swaps this naive substring filter for the real four-source
 * search (project, CLA group, linked organization, pasted repository link) without the caller
 * changing — which is the whole reason the seam is a route rather than a component.
 */
export function listClaGroupOptions(query = ''): ClaGroupOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return DEV_CLA_GROUPS;

  return DEV_CLA_GROUPS.filter((option) => `${option.projectName} ${option.claGroupName ?? ''}`.toLowerCase().includes(q));
}
