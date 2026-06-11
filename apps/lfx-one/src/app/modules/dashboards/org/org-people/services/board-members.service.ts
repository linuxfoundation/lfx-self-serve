// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import type {
  OrgLensEmployeesResponse,
  OrgPeopleBoardMembersResponse,
  ReassignCommitteeMemberBody,
  ReassignCommitteeMemberResponse,
} from '@lfx-one/shared/interfaces';

/** HTTP client for the Org Lens → People → Board tab. Read + single-seat reassign + the reused org-wide employee picker. */
@Injectable({ providedIn: 'root' })
export class BoardMembersService {
  private readonly http = inject(HttpClient);

  /** Org-wide Board roster + filter-independent stats. */
  public getBoardMembers(orgUid: string): Observable<OrgPeopleBoardMembersResponse> {
    return this.http.get<OrgPeopleBoardMembersResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/people/board-members`);
  }

  /** Reassign one Membership-Entitlement board seat (used by both the bulk fan-out and the single-edit modal). */
  public reassignSeat(orgUid: string, seatId: string, body: ReassignCommitteeMemberBody): Observable<ReassignCommitteeMemberResponse> {
    return this.http.patch<ReassignCommitteeMemberResponse>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/people/board-members/${encodeURIComponent(seatId)}/reassign`,
      body
    );
  }

  /** Reused spec-026 org-wide people picker (key contacts ∪ committee members, deduped) for the modal typeahead. */
  public getEmployees(orgUid: string): Observable<OrgLensEmployeesResponse> {
    return this.http.get<OrgLensEmployeesResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/employees`);
  }
}
