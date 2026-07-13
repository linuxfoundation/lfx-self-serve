// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_GROUPS_ROLLUP_TYPE_BADGES } from '../constants';
import type {
  GroupType,
  OrgGroup,
  OrgGroupsPrivacySplit,
  OrgPrivateGroupsRollupBucket,
  OrgPrivateGroupsRollupTypeBadgeVm,
  OrgPrivateGroupsRollupVm,
} from '../interfaces';

/**
 * Deterministic UI-only placeholder for "is the viewer a member of this private group".
 * Org Lens Groups is scoped to UI only — the real membership check lands in a follow-up ticket.
 */
export function deriveDemoViewerIsGroupMember(groupId: string): boolean {
  let hash = 0;
  for (const char of groupId) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return hash % 3 !== 0;
}

function groupTypeRollupBucket(type: GroupType): OrgPrivateGroupsRollupBucket {
  if (type === 'Board') return 'Board';
  if (type === 'Working Group' || type === 'TAC') return 'Working Group';
  return 'Other';
}

/**
 * Splits groups into those visible to the viewer (public, or private-and-a-member) and a rollup
 * summarizing the rest (private groups the viewer isn't a member of). Mirrors the org-meetings
 * privacy pattern from LFXV2-1901 — "employee affiliated with this company" is assumed already
 * satisfied by every group in the input, since the caller scopes `groups` to the selected account.
 */
export function splitOrgGroupsByPrivacy(groups: readonly OrgGroup[]): OrgGroupsPrivacySplit {
  const visible: OrgGroup[] = [];
  const hidden: OrgGroup[] = [];
  for (const group of groups) {
    if (group.visibility !== 'PRIVATE' || deriveDemoViewerIsGroupMember(group.id)) {
      visible.push(group);
    } else {
      hidden.push(group);
    }
  }
  return { visible, rollup: buildPrivateGroupsRollup(hidden) };
}

function buildPrivateGroupsRollup(hidden: readonly OrgGroup[]): OrgPrivateGroupsRollupVm | null {
  if (hidden.length === 0) return null;

  const bucketCounts = new Map<OrgPrivateGroupsRollupBucket, number>();
  for (const group of hidden) {
    const bucket = groupTypeRollupBucket(group.type);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  }
  const typeBadges: OrgPrivateGroupsRollupTypeBadgeVm[] = [...bucketCounts.entries()].map(([bucket, count]) => ({
    bucket,
    count,
    badge: ORG_GROUPS_ROLLUP_TYPE_BADGES[bucket],
  }));

  return {
    totalCount: hidden.length,
    typeBadges,
    projectCount: new Set(hidden.map((g) => g.parentProject)).size,
    foundationCount: new Set(hidden.map((g) => g.foundation)).size,
    memberCount: hidden.reduce((sum, g) => sum + g.memberCount, 0),
  };
}
