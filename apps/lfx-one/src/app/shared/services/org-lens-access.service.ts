// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Cursor](https://cursor.com)

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgAccessInviteRequest, OrgAccessListResponse, OrgAccessRole, OrgAccessRoleChangeRequest } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

/** Angular client for the three Org Lens Access SSR endpoints; thin HttpClient wrapper, both mutations return the authoritative refreshed list (spec 025, FR-015a). */
@Injectable({
  providedIn: 'root',
})
export class OrgLensAccessService {
  private readonly http = inject(HttpClient);

  /**
   * Fetches the authoritative Org Lens access list for an organization.
   * @param orgUid Selected organization uid.
   * @returns The list payload (users, summary, canManage).
   */
  public getAccessUsers(orgUid: string): Observable<OrgAccessListResponse> {
    return this.http.get<OrgAccessListResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/access/users`);
  }

  /**
   * Invites a new principal, returning the refreshed authoritative access list.
   * @param orgUid Selected organization uid.
   * @param email Invitee email (identity key).
   * @param role Role to grant (`admin` or `viewer`).
   * @param name Optional display name; `null`/omitted lets member-service derive it.
   * @returns The refreshed list payload reflecting the new pending invite.
   */
  public inviteUser(orgUid: string, email: string, role: OrgAccessRole, name?: string | null): Observable<OrgAccessListResponse> {
    const body: OrgAccessInviteRequest = { email, role, name: name ?? null };
    return this.http.post<OrgAccessListResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/access/users`, body);
  }

  /**
   * Changes a principal's role, returning the refreshed authoritative access list.
   * @param orgUid Selected organization uid.
   * @param email Target principal email (identity key).
   * @param role New role (`admin` or `viewer`).
   * @returns The refreshed list payload reflecting the role change.
   */
  public changeRole(orgUid: string, email: string, role: OrgAccessRole): Observable<OrgAccessListResponse> {
    const body: OrgAccessRoleChangeRequest = { role };
    return this.http.put<OrgAccessListResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/access/users/${encodeURIComponent(email)}`, body);
  }

  /**
   * Removes a principal's access, returning the refreshed authoritative access list.
   * @param orgUid Selected organization uid.
   * @param email Target principal email (identity key).
   * @returns The refreshed list payload with the principal removed.
   */
  public removeUser(orgUid: string, email: string): Observable<OrgAccessListResponse> {
    return this.http.delete<OrgAccessListResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/access/users/${encodeURIComponent(email)}`);
  }
}
