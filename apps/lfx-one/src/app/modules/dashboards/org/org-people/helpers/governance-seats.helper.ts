// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isVotingStatus } from '@lfx-one/shared/constants';
import type { CommitteeMemberAssignment, OrgAllEmployeeCommitteeMembership } from '@lfx-one/shared/interfaces';

/** Map Board/Committee seat rows into the drawer's Governance shape (no personKey on those tabs). */
export function toDrawerGovernanceSeats(assignments: CommitteeMemberAssignment[]): OrgAllEmployeeCommitteeMembership[] {
  return assignments.map((a) => ({
    committeeId: a.committeeUid,
    committeeName: a.committeeName,
    foundationId: a.projectUid,
    foundationName: a.foundationName,
    committeeRole: a.role,
    votingStatus: isVotingStatus(a.votingStatus) ? 'Voting' : 'Non-voting',
    isBoard: (a.committeeCategory ?? '').toLowerCase() === 'board',
  }));
}
