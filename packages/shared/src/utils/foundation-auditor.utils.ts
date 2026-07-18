// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { B2bOrgIndexedDoc, FoundationAuditorOrgEntry, MergeFoundationAuditorOrgsResult, ResolvedOrgRole } from '../interfaces/org-selector.interface';

/**
 * Fold foundation-auditor member orgs (LFXV2-2750) into the caller's base access-aware resolution.
 *
 * Rules:
 * - A direct or inherited grant on the same org always wins — a `foundation-auditor` entry never
 *   overrides an existing resolved row (keeps the Edit-capability gate and inherited tooltip intact).
 * - The additive `foundation-auditor` rows are capped at `cap`; base (direct/inherited) rows are never
 *   dropped to make room — only the additive rows are bounded. `truncated` signals the cap was hit.
 * - Insertion order of `foundationAuditorOrgs` is preserved so the cap is deterministic.
 */
export function mergeFoundationAuditorOrgs(
  baseResolved: ReadonlyMap<string, ResolvedOrgRole>,
  baseOrgDocByUid: ReadonlyMap<string, B2bOrgIndexedDoc>,
  foundationAuditorOrgs: readonly FoundationAuditorOrgEntry[],
  cap: number
): MergeFoundationAuditorOrgsResult {
  const resolved = new Map<string, ResolvedOrgRole>(baseResolved);
  const orgDocByUid = new Map<string, B2bOrgIndexedDoc>(baseOrgDocByUid);
  let truncated = false;
  let addedCount = 0;

  for (const entry of foundationAuditorOrgs) {
    if (!entry?.uid) continue;
    // Direct/inherited grants always win — never override an existing resolved row.
    if (resolved.has(entry.uid)) continue;
    // Bound only the additive rows; never evict a base row to make room.
    if (resolved.size >= cap) {
      truncated = true;
      break;
    }
    resolved.set(entry.uid, { roleSource: 'foundation-auditor' });
    orgDocByUid.set(entry.uid, entry.doc);
    addedCount += 1;
  }

  return { resolved, orgDocByUid, truncated, addedCount };
}
