// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AppendFoundationAuditorItemsResult, FoundationAuditorOrgEntry, OrgItem } from '../interfaces/org-selector.interface';

/**
 * Append foundation-auditor member orgs (LFXV2-2750) to the caller's grants-derived selector rows.
 *
 * Rules:
 * - A grants-derived row for the same org always wins — an org already present is skipped, so a direct or
 *   inherited grant keeps its stronger persona (and its Edit affordance) instead of being downgraded to view-only.
 * - Appended rows are marked `roleSource: 'foundation-auditor'` so the client renders them view-only without
 *   needing a precomputed uid set (these rows are resolved per-search, not from the cached grants resolution).
 * - Appended rows are capped at `cap`; grants-derived rows are never dropped to make room. `truncated` signals
 *   the cap was hit.
 * - Input order is preserved so the cap is deterministic.
 */
export function appendFoundationAuditorItems(
  baseItems: readonly OrgItem[],
  foundationAuditorOrgs: readonly FoundationAuditorOrgEntry[],
  cap: number
): AppendFoundationAuditorItemsResult {
  const items: OrgItem[] = [...baseItems];
  const seen = new Set<string>(baseItems.map((item) => item.uid));
  let truncated = false;
  let addedCount = 0;

  for (const entry of foundationAuditorOrgs) {
    if (!entry?.uid) continue;
    // A grants-derived row (or an earlier duplicate) already covers this org.
    if (seen.has(entry.uid)) continue;
    if (addedCount >= cap) {
      truncated = true;
      break;
    }

    seen.add(entry.uid);
    items.push({
      // Spec 002: the b2b_org uid IS the 18-char SFID, so it doubles as the account id.
      uid: entry.uid,
      accountId: entry.uid,
      name: entry.doc.name ?? '',
      logoUrl: entry.doc.logo_url ?? null,
      primaryDomain: entry.doc.primary_domain ?? null,
      isMember: entry.doc.is_member ?? false,
      parentName: null,
      roleSource: 'foundation-auditor',
    });
    addedCount += 1;
  }

  return { items, truncated, addedCount };
}
