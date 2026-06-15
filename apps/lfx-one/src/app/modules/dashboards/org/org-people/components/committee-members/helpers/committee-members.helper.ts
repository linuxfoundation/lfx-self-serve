// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EDIT_TOOLTIP_DEFAULT,
  EDIT_TOOLTIP_NOT_ORG_EDITABLE,
  REASSIGN_TOOLTIP_DEFAULT,
  REASSIGN_TOOLTIP_NO_EDITABLE_SEATS,
  votingStatusPillClass,
} from '@lfx-one/shared/constants';
import type {
  CommitteeMemberAssignment,
  CommitteeMemberAssignmentVm,
  CommitteeMemberPersonGroup,
  CommitteeMemberPersonGroupVm,
  CommitteeMembersDecorateOptions,
} from '@lfx-one/shared/interfaces';

/**
 * Group org-wide seats by person (email key, first-wins display); computes the foundation labels,
 * committee count, and editable-seat count that drive the row cells + Reassign gate (data-model §6).
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
 * Decorate a person's seats for the sub-table: sort by foundation→committee, attach the pill class,
 * flag first-of-foundation rows (FR-008), and precompute each Edit tooltip so the template stays flat.
 */
export function decorateAssignments(group: CommitteeMemberPersonGroup, opts: CommitteeMembersDecorateOptions): CommitteeMemberAssignmentVm[] {
  const sorted = [...group.assignments].sort((a, b) => {
    const f = a.foundationName.localeCompare(b.foundationName, undefined, { sensitivity: 'base' });
    if (f !== 0) return f;
    return a.committeeName.localeCompare(b.committeeName, undefined, { sensitivity: 'base' });
  });
  return sorted.map((a, idx) => ({
    ...a,
    votingStatusPillClass: votingStatusPillClass(a.votingStatus),
    showFoundationLabel: idx === 0 || sorted[idx - 1].foundationName !== a.foundationName,
    editTooltip: buildEditTooltip(a, opts),
  }));
}

/**
 * Build the full main-row + sub-row view-model in one place so templates bind flat fields only,
 * keeping tooltip composition (canEdit × editableCount × isOrgEditable × reason) out of the HTML.
 */
export function decoratePersonGroup(group: CommitteeMemberPersonGroup, opts: CommitteeMembersDecorateOptions): CommitteeMemberPersonGroupVm {
  return {
    ...group,
    sortedAssignments: decorateAssignments(group, opts),
    reassignTooltip: buildReassignTooltip(group, opts),
  };
}

function buildReassignTooltip(group: CommitteeMemberPersonGroup, opts: CommitteeMembersDecorateOptions): string {
  if (!opts.canEdit) return opts.editDisabledTooltip;
  return group.editableCount === 0 ? REASSIGN_TOOLTIP_NO_EDITABLE_SEATS : REASSIGN_TOOLTIP_DEFAULT;
}

function buildEditTooltip(assignment: CommitteeMemberAssignment, opts: CommitteeMembersDecorateOptions): string {
  if (!opts.canEdit) return opts.editDisabledTooltip;
  if (assignment.isOrgEditable) return EDIT_TOOLTIP_DEFAULT;
  return assignment.reason ?? EDIT_TOOLTIP_NOT_ORG_EDITABLE;
}
