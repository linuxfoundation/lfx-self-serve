// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgMembershipBoardSeatsResponse, OrgMembershipCommitteeSeatsResponse, OrgMembershipVotingHistoryResponse } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

/**
 * Angular client service for the three Board & Committee SSR endpoints (spec 016
 * FR-011). Parallel sibling to `OrgLensMembershipsService`. NO custom headers,
 * NO caching layer — caching is the consuming component's responsibility per
 * FR-011d (session-cached signals in `BoardCommitteeCardComponent`).
 */
@Injectable({
  providedIn: 'root',
})
export class OrgLensBoardCommitteeService {
  private readonly http = inject(HttpClient);

  public getBoardSeats(orgUid: string, foundationId: string): Observable<OrgMembershipBoardSeatsResponse> {
    return this.http.get<OrgMembershipBoardSeatsResponse>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/${encodeURIComponent(foundationId)}/board-seats`
    );
  }

  public getCommitteeSeats(orgUid: string, foundationId: string): Observable<OrgMembershipCommitteeSeatsResponse> {
    return this.http.get<OrgMembershipCommitteeSeatsResponse>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/${encodeURIComponent(foundationId)}/committee-seats`
    );
  }

  public getVotingHistory(orgUid: string, foundationId: string): Observable<OrgMembershipVotingHistoryResponse> {
    return this.http.get<OrgMembershipVotingHistoryResponse>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/${encodeURIComponent(foundationId)}/voting-history`
    );
  }
}
