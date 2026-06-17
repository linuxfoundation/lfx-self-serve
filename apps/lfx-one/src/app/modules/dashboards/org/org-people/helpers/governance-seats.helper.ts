// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isVotingStatus } from '@lfx-one/shared/constants';
import type { CommitteeMemberAssignment, OrgAllEmployeeCommitteeMembership, OrgAllEmployeeVotingStatus } from '@lfx-one/shared/interfaces';

// Preserve "Observer" explicitly; isVotingStatus would otherwise fold it into "Voting".
function toDrawerVotingStatus(status: string | null | undefined): OrgAllEmployeeVotingStatus {
  if ((status ?? '').trim().toLowerCase() === 'observer') {
    return 'Observer';
  }
  return isVotingStatus(status) ? 'Voting' : 'Non-voting';
}

/** Map Board/Committee seat rows into the drawer's Governance shape (no personKey on those tabs). */
export function toDrawerGovernanceSeats(assignments: CommitteeMemberAssignment[]): OrgAllEmployeeCommitteeMembership[] {
  return assignments.map((a) => ({
    committeeId: a.committeeUid,
    committeeName: a.committeeName,
    foundationId: a.projectUid,
    foundationName: a.foundationName,
    committeeRole: a.role,
    votingStatus: toDrawerVotingStatus(a.votingStatus),
    isBoard: (a.committeeCategory ?? '').toLowerCase() === 'board',
  }));
}
