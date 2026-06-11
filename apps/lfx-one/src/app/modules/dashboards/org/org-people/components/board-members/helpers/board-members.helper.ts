// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EDIT_TOOLTIP_DEFAULT,
  EDIT_TOOLTIP_NOT_ORG_EDITABLE,
  isVotingStatus,
  REASSIGN_TOOLTIP_DEFAULT,
  REASSIGN_TOOLTIP_NO_EDITABLE_SEATS,
  votingStatusPillClass,
} from '@lfx-one/shared/constants';
import type {
  BoardMemberPersonGroup,
  BoardMemberPersonGroupVm,
  BoardVotingPill,
  CommitteeMemberAssignment,
  CommitteeMemberAssignmentVm,
  CommitteeMembersDecorateOptions,
} from '@lfx-one/shared/interfaces';

/** Group org-wide Board seats by person (email key, first-wins) → foundation labels + voting/non-voting + editable counts. */
export function buildBoardPersonGroups(assignments: CommitteeMemberAssignment[]): BoardMemberPersonGroup[] {
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
    const votingCount = group.filter((a) => isVotingStatus(a.votingStatus)).length;
    const nonVotingCount = group.length - votingCount;
    const editableCount = group.filter((a) => a.isOrgEditable).length;
    return {
      email: first.person.email || first.memberUid,
      displayName: first.person.fullName,
      jobTitle: first.person.jobTitle,
      initials: first.person.initials,
      foundationLabels,
      votingCount,
      nonVotingCount,
      editableCount,
      assignments: group,
    };
  });
}

/** Sub-table rows: sort foundation→committee, attach pill class, flag first-of-foundation (FR-008), precompute each Edit tooltip. */
export function decorateBoardAssignments(group: BoardMemberPersonGroup, opts: CommitteeMembersDecorateOptions): CommitteeMemberAssignmentVm[] {
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

/** Full main-row + sub-row view-model in one place (sub-rows, main-row voting pills, Reassign tooltip) so templates stay flat. */
export function decorateBoardPersonGroup(group: BoardMemberPersonGroup, opts: CommitteeMembersDecorateOptions): BoardMemberPersonGroupVm {
  return {
    ...group,
    sortedAssignments: decorateBoardAssignments(group, opts),
    votingPills: buildVotingPills(group),
    reassignTooltip: buildReassignTooltip(group, opts),
  };
}

/** Main-row Voting Status cell: one verbatim pill for a single-seat person, else aggregate "X Voting"/"Y Non-voting" pills (omit zero) (FR-002). */
function buildVotingPills(group: BoardMemberPersonGroup): BoardVotingPill[] {
  if (group.assignments.length === 1) {
    const status = group.assignments[0].votingStatus;
    return [{ label: status || 'Non-voting', pillClass: votingStatusPillClass(status) }];
  }
  const pills: BoardVotingPill[] = [];
  if (group.votingCount > 0) {
    pills.push({ label: `${group.votingCount} Voting`, pillClass: votingStatusPillClass('Voting') });
  }
  if (group.nonVotingCount > 0) {
    pills.push({ label: `${group.nonVotingCount} Non-voting`, pillClass: votingStatusPillClass('Non-voting') });
  }
  return pills;
}

function buildReassignTooltip(group: BoardMemberPersonGroup, opts: CommitteeMembersDecorateOptions): string {
  if (!opts.canEdit) return opts.editDisabledTooltip;
  return group.editableCount === 0 ? REASSIGN_TOOLTIP_NO_EDITABLE_SEATS : REASSIGN_TOOLTIP_DEFAULT;
}

function buildEditTooltip(assignment: CommitteeMemberAssignment, opts: CommitteeMembersDecorateOptions): string {
  if (!opts.canEdit) return opts.editDisabledTooltip;
  if (assignment.isOrgEditable) return EDIT_TOOLTIP_DEFAULT;
  return assignment.reason ?? EDIT_TOOLTIP_NOT_ORG_EDITABLE;
}
