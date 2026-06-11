// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { votingStatusPillClass } from '@lfx-one/shared/constants';
import type { CommitteeMemberAssignment, CommitteeMemberAssignmentVm, CommitteeMemberPersonGroup } from '@lfx-one/shared/interfaces';

// Re-exported so the component template + modals import the pill helper from one place (spec 027).
export { votingStatusPillClass };

/**
 * Group org-wide seats by person (lowercased email; first-wins for display fields). Computes the
 * distinct-foundation labels, the distinct-committee count, and the editable-seat count that drive
 * the main-row cells + the Reassign-pencil enable gate. Data-model §6 invariants.
 */
export function buildPersonGroups(assignments: CommitteeMemberAssignment[]): CommitteeMemberPersonGroup[] {
  const byEmail = new Map<string, CommitteeMemberAssignment[]>();
  for (const a of assignments) {
    // Fall back to the seat uid when email is blank so an email-less member still groups into its own row.
    const key = a.person.email || a.memberUid;
    const list = byEmail.get(key) ?? [];
    list.push(a);
    byEmail.set(key, list);
  }

  return [...byEmail.values()].map((group) => {
    const first = group[0];
    const foundationLabels = [...new Set(group.map((a) => a.foundationName).filter(Boolean))].sort((x, y) => x.localeCompare(y));
    const committeeCount = new Set(group.map((a) => a.committeeUid)).size;
    const editableCount = group.filter((a) => a.isOrgEditable).length;
    return {
      email: first.person.email || first.memberUid,
      displayName: first.person.fullName,
      jobTitle: first.person.jobTitle,
      initials: first.person.initials,
      foundationLabels,
      committeeCount,
      editableCount,
      assignments: group,
    };
  });
}

/**
 * Decorate a person's seats for the expanded sub-table: order by foundation A→Z then committee A→Z,
 * attach the voting-status pill class, and flag `showFoundationLabel` on the first sub-row of each
 * foundation block so the foundation name renders once per group (FR-008).
 */
export function decorateAssignments(group: CommitteeMemberPersonGroup): CommitteeMemberAssignmentVm[] {
  const sorted = [...group.assignments].sort((a, b) => {
    const f = a.foundationName.localeCompare(b.foundationName, undefined, { sensitivity: 'base' });
    if (f !== 0) return f;
    return a.committeeName.localeCompare(b.committeeName, undefined, { sensitivity: 'base' });
  });
  return sorted.map((a, idx) => ({
    ...a,
    votingStatusPillClass: votingStatusPillClass(a.votingStatus),
    showFoundationLabel: idx === 0 || sorted[idx - 1].foundationName !== a.foundationName,
  }));
}
