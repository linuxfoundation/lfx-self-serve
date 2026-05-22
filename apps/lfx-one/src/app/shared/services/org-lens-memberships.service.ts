// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  OrgActiveMembershipsResponse,
  OrgDiscoverOpportunitiesResponse,
  OrgExpiredMembershipsResponse,
  OrgMembershipDetailResponse,
  OrgMembershipDocumentsResponse,
} from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class OrgLensMembershipsService {
  private readonly http = inject(HttpClient);

  public getActiveMemberships(accountId: string, filters?: { search?: string; tier?: string; renewal?: string }): Observable<OrgActiveMembershipsResponse> {
    let params = new HttpParams();
    if (filters?.search) params = params.set('search', filters.search);
    if (filters?.tier) params = params.set('tier', filters.tier);
    if (filters?.renewal) params = params.set('renewal', filters.renewal);
    return this.http.get<OrgActiveMembershipsResponse>(`/api/orgs/${encodeURIComponent(accountId)}/lens/memberships/active`, { params });
  }

  public getExpiredMemberships(accountId: string, search?: string): Observable<OrgExpiredMembershipsResponse> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    return this.http.get<OrgExpiredMembershipsResponse>(`/api/orgs/${encodeURIComponent(accountId)}/lens/memberships/expired`, { params });
  }

  public getDiscoverOpportunities(accountId: string): Observable<OrgDiscoverOpportunitiesResponse> {
    return this.http.get<OrgDiscoverOpportunitiesResponse>(`/api/orgs/${encodeURIComponent(accountId)}/lens/memberships/discover`);
  }

  public getMembershipDetail(accountId: string, foundationId: string): Observable<OrgMembershipDetailResponse> {
    return this.http.get<OrgMembershipDetailResponse>(`/api/orgs/${encodeURIComponent(accountId)}/lens/memberships/${encodeURIComponent(foundationId)}`);
  }

  public getMembershipDocuments(accountId: string, foundationId: string): Observable<OrgMembershipDocumentsResponse> {
    return this.http.get<OrgMembershipDocumentsResponse>(
      `/api/orgs/${encodeURIComponent(accountId)}/lens/memberships/${encodeURIComponent(foundationId)}/documents`
    );
  }
}
