// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import type {
  OrgLensEmployeesResponse,
  OrgPeopleCommitteeMembersResponse,
  ReassignCommitteeMemberBody,
  ReassignCommitteeMemberResponse,
} from '@lfx-one/shared/interfaces';

/** HTTP client for the Org Lens → People → Committee tab (spec 027). Read + single-seat reassign + the reused org-wide employee picker. */
@Injectable({ providedIn: 'root' })
export class CommitteeMembersService {
  private readonly http = inject(HttpClient);

  /** Org-wide non-Board committee-member roster + filter-independent stats. */
  public getCommitteeMembers(orgUid: string): Observable<OrgPeopleCommitteeMembersResponse> {
    return this.http.get<OrgPeopleCommitteeMembersResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/people/committee-members`);
  }

  /** Reassign one Membership-Entitlement seat (used by both the bulk fan-out and the single-edit modal). */
  public reassignSeat(orgUid: string, seatId: string, body: ReassignCommitteeMemberBody): Observable<ReassignCommitteeMemberResponse> {
    return this.http.patch<ReassignCommitteeMemberResponse>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/people/committee-members/${encodeURIComponent(seatId)}/reassign`,
      body
    );
  }

  /** Reused spec-026 org-wide people picker (key contacts ∪ committee members, deduped) for the modal typeahead. */
  public getEmployees(orgUid: string): Observable<OrgLensEmployeesResponse> {
    return this.http.get<OrgLensEmployeesResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/employees`);
  }
}
