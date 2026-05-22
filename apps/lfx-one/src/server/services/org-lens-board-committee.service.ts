// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  BoardSeat,
  CommitteeSeat,
  OrgMembershipBoardSeatsResponse,
  OrgMembershipCommitteeSeatsResponse,
  OrgMembershipVotingHistoryResponse,
  VotingRecord,
} from '@lfx-one/shared/interfaces';

import sharedFixture from './fixtures/org-membership-board-committee.mock.json';

/**
 * Shared mock Board & Committee payload for all three SSR endpoints (spec 016
 * FR-009a / FR-009c / FR-010 / FR-010a). Loaded once at module-load via
 * TypeScript JSON module import — every call returns the same arrays for any
 * requested `foundationId` in v1. Only the `accountId` and `foundationId`
 * envelope fields adapt per-request.
 *
 * FR-009e (future): the three GETs will eventually proxy to:
 *   - GET /memberships/{uid}/board_seats?v=1     on lfx-v2-member-service
 *   - GET /memberships/{uid}/committee_seats?v=1 on lfx-v2-member-service
 *   - GET /memberships/{uid}/voting_history?v=1  on lfx-v2-vote-service (TBD)
 * The SSR boundary transformation step (FR-009e2) will convert flat snake_case
 * arrays to the camelCase shapes this service returns today.
 *
 * FR-009-mock-realism: this file MUST NOT contain (and currently does not):
 *   - mock M2M JWT acquisition or getM2mToken() stub
 *   - synthesized per-call latency (setTimeout/delay/Promise(resolve))
 *   - would-be upstream URL logging
 *   - Server-Timing response header
 *   - retry-with-backoff stub
 *   - mock-mode flag / if (mockMode) branch
 * Also no SnowflakeService import, no HTTP egress, no network I/O of any kind.
 */
const SHARED_FIXTURE = sharedFixture as {
  sharedBoardSeats: BoardSeat[];
  sharedCommitteeSeats: CommitteeSeat[];
  sharedVotingHistory: VotingRecord[];
};

/** Three-method service for the Board & Committee tab on the Org Membership Detail page. */
export class OrgLensBoardCommitteeService {
  /**
   * Returns the board seats for the given foundation. In v1 mock, returns the
   * same shared fixture regardless of `foundationId` (FR-009c). `accountId`
   * and `foundationId` are echoed back in the envelope per FR-009d.
   */
  public getBoardSeats(accountId: string, foundationId: string): OrgMembershipBoardSeatsResponse {
    return {
      accountId,
      foundationId,
      boardSeats: structuredClone(SHARED_FIXTURE.sharedBoardSeats),
    };
  }

  /** Same v1-mock semantics as `getBoardSeats` for committee seats. */
  public getCommitteeSeats(accountId: string, foundationId: string): OrgMembershipCommitteeSeatsResponse {
    return {
      accountId,
      foundationId,
      committeeSeats: structuredClone(SHARED_FIXTURE.sharedCommitteeSeats),
    };
  }

  /** Same v1-mock semantics; voting history is read-only and never refetched after a Reassign (FR-008j). */
  public getVotingHistory(accountId: string, foundationId: string): OrgMembershipVotingHistoryResponse {
    return {
      accountId,
      foundationId,
      votingHistory: structuredClone(SHARED_FIXTURE.sharedVotingHistory),
    };
  }
}
