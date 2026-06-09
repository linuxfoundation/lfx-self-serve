// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  OrgLensEmployeesResponse,
  OrgMembershipReassignSeatResponse,
  OrgMembershipSeatsResponse,
  OrgMembershipVotingHistoryResponse,
  ReassignCommitteeSeatRequest,
} from '@lfx-one/shared/interfaces';
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

  /** Combined board + committee seats for one membership (single committee-service read, spec 026 TODO #1). */
  public getSeats(orgUid: string, foundationId: string): Observable<OrgMembershipSeatsResponse> {
    return this.http.get<OrgMembershipSeatsResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/${encodeURIComponent(foundationId)}/seats`);
  }

  public getVotingHistory(orgUid: string, foundationId: string): Observable<OrgMembershipVotingHistoryResponse> {
    return this.http.get<OrgMembershipVotingHistoryResponse>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/${encodeURIComponent(foundationId)}/voting-history`
    );
  }

  public reassignSeat(orgUid: string, foundationId: string, seatId: string, body: ReassignCommitteeSeatRequest): Observable<OrgMembershipReassignSeatResponse> {
    return this.http.patch<OrgMembershipReassignSeatResponse>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/${encodeURIComponent(foundationId)}/committee-seats/${encodeURIComponent(seatId)}/reassign`,
      body
    );
  }

  /** Org-wide people picker (key contacts + committee members) for the Reassign modal (spec 026). */
  public getOrgEmployees(orgUid: string): Observable<OrgLensEmployeesResponse> {
    return this.http.get<OrgLensEmployeesResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/employees`);
  }
}
