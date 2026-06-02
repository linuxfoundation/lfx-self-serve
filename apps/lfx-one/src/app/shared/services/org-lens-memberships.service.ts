// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  AddKeyContactRequest,
  KeyContactEmployeesResponse,
  KeyContactMutationResponse,
  OrgActiveMembershipsResponse,
  OrgDiscoverOpportunitiesResponse,
  OrgExpiredMembershipsResponse,
  OrgMembershipDetailResponse,
  OrgMembershipDocumentsResponse,
  ReplaceKeyContactRequest,
} from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class OrgLensMembershipsService {
  private readonly http = inject(HttpClient);

  public getActiveMemberships(orgUid: string, filters?: { search?: string; tier?: string; renewal?: string }): Observable<OrgActiveMembershipsResponse> {
    let params = new HttpParams();
    if (filters?.search) params = params.set('search', filters.search);
    if (filters?.tier) params = params.set('tier', filters.tier);
    if (filters?.renewal) params = params.set('renewal', filters.renewal);
    return this.http.get<OrgActiveMembershipsResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/active`, { params });
  }

  public getExpiredMemberships(orgUid: string, search?: string): Observable<OrgExpiredMembershipsResponse> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    return this.http.get<OrgExpiredMembershipsResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/expired`, { params });
  }

  public getDiscoverOpportunities(orgUid: string): Observable<OrgDiscoverOpportunitiesResponse> {
    return this.http.get<OrgDiscoverOpportunitiesResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/discover`);
  }

  public getMembershipDetail(orgUid: string, foundationSlug: string): Observable<OrgMembershipDetailResponse> {
    return this.http.get<OrgMembershipDetailResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/${encodeURIComponent(foundationSlug)}`);
  }

  public getMembershipDocuments(orgUid: string, foundationId: string): Observable<OrgMembershipDocumentsResponse> {
    return this.http.get<OrgMembershipDocumentsResponse>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/${encodeURIComponent(foundationId)}/documents`
    );
  }

  // Spec 024 — key-contact employee search (org-wide) + write proxy (pessimistic save).

  public getKeyContactEmployees(orgUid: string): Observable<KeyContactEmployeesResponse> {
    return this.http.get<KeyContactEmployeesResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/key-contacts/employees`);
  }

  public addKeyContact(orgUid: string, foundationId: string, body: AddKeyContactRequest): Observable<KeyContactMutationResponse> {
    return this.http.post<KeyContactMutationResponse>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/${encodeURIComponent(foundationId)}/key-contacts`,
      body
    );
  }

  public replaceKeyContact(orgUid: string, foundationId: string, contactUid: string, body: ReplaceKeyContactRequest): Observable<KeyContactMutationResponse> {
    return this.http.put<KeyContactMutationResponse>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/${encodeURIComponent(foundationId)}/key-contacts/${encodeURIComponent(contactUid)}`,
      body
    );
  }

  public removeKeyContact(orgUid: string, foundationId: string, contactUid: string): Observable<KeyContactMutationResponse> {
    return this.http.delete<KeyContactMutationResponse>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/${encodeURIComponent(foundationId)}/key-contacts/${encodeURIComponent(contactUid)}`
    );
  }
}
