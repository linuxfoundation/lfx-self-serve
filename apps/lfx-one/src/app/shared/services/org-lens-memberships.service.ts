// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  AddKeyContactRequest,
  KeyContactCatalogResponse,
  KeyContactEmployeesResponse,
  KeyContactMutationResponse,
  OrgActiveMembershipsResponse,
  OrgDiscoverOpportunitiesResponse,
  OrgExpiredMembershipsResponse,
  OrgMembershipDetailResponse,
  OrgMembershipDocumentsResponse,
  OrgMembershipProjectsResponse,
  ReplaceKeyContactRequest,
} from '@lfx-one/shared/interfaces';
import { Observable, tap } from 'rxjs';

import { OrgPeopleDirectoryStateService } from './org-people-directory-state.service';

@Injectable({
  providedIn: 'root',
})
export class OrgLensMembershipsService {
  private readonly http = inject(HttpClient);
  private readonly directory = inject(OrgPeopleDirectoryStateService);

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

  /** Projects the org is involved in for one foundation — backs the Org Projects side panel on the memberships table. */
  public getFoundationProjects(orgUid: string, foundationId: string): Observable<OrgMembershipProjectsResponse> {
    return this.http.get<OrgMembershipProjectsResponse>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/${encodeURIComponent(foundationId)}/projects`
    );
  }

  // Spec 024 — key-contact employee search (org-wide) + write proxy (pessimistic save).

  public getKeyContactEmployees(orgUid: string): Observable<KeyContactEmployeesResponse> {
    return this.http.get<KeyContactEmployeesResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/key-contacts/employees`);
  }

  public addKeyContact(orgUid: string, foundationId: string, body: AddKeyContactRequest): Observable<KeyContactMutationResponse> {
    return this.http
      .post<KeyContactMutationResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/${encodeURIComponent(foundationId)}/key-contacts`, body)
      .pipe(this.dropCachedRoster(orgUid));
  }

  public replaceKeyContact(orgUid: string, foundationId: string, contactUid: string, body: ReplaceKeyContactRequest): Observable<KeyContactMutationResponse> {
    return this.http
      .put<KeyContactMutationResponse>(
        `/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/${encodeURIComponent(foundationId)}/key-contacts/${encodeURIComponent(contactUid)}`,
        body
      )
      .pipe(this.dropCachedRoster(orgUid));
  }

  public removeKeyContact(orgUid: string, foundationId: string, contactUid: string): Observable<KeyContactMutationResponse> {
    return this.http
      .delete<KeyContactMutationResponse>(
        `/api/orgs/${encodeURIComponent(orgUid)}/lens/memberships/${encodeURIComponent(foundationId)}/key-contacts/${encodeURIComponent(contactUid)}`
      )
      .pipe(this.dropCachedRoster(orgUid));
  }

  // LFXV2-2067 — slug-keyed catalog GET + write proxies, used by the People → Key Contacts tab.
  // The id-keyed write methods above route through the org sfid → foundation_id bridge that the
  // membership-detail page needs; the People tab already has the slug per assignment row, so these
  // methods skip the bridge and let the BFF call member-service directly.

  public getKeyContactCatalogBySlug(orgUid: string, foundationSlug: string): Observable<KeyContactCatalogResponse> {
    return this.http.get<KeyContactCatalogResponse>(
      `/api/orgs/${encodeURIComponent(orgUid)}/lens/key-contacts/membership/${encodeURIComponent(foundationSlug)}`
    );
  }

  public addKeyContactBySlug(orgUid: string, foundationSlug: string, body: AddKeyContactRequest): Observable<KeyContactMutationResponse> {
    return this.http
      .post<KeyContactMutationResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/key-contacts/membership/${encodeURIComponent(foundationSlug)}`, body)
      .pipe(this.dropCachedRoster(orgUid));
  }

  public replaceKeyContactBySlug(
    orgUid: string,
    foundationSlug: string,
    contactUid: string,
    body: ReplaceKeyContactRequest
  ): Observable<KeyContactMutationResponse> {
    return this.http
      .put<KeyContactMutationResponse>(
        `/api/orgs/${encodeURIComponent(orgUid)}/lens/key-contacts/membership/${encodeURIComponent(foundationSlug)}/${encodeURIComponent(contactUid)}`,
        body
      )
      .pipe(this.dropCachedRoster(orgUid));
  }

  public removeKeyContactBySlug(orgUid: string, foundationSlug: string, contactUid: string): Observable<KeyContactMutationResponse> {
    return this.http
      .delete<KeyContactMutationResponse>(
        `/api/orgs/${encodeURIComponent(orgUid)}/lens/key-contacts/membership/${encodeURIComponent(foundationSlug)}/${encodeURIComponent(contactUid)}`
      )
      .pipe(this.dropCachedRoster(orgUid));
  }

  /**
   * Drop the client's cached All Employees roster once a key-contact write settles.
   *
   * It lives here, on all six key-contact mutation methods, rather than at each call site: the
   * membership-detail page writes through the id-keyed trio and People → Key Contacts through the
   * slug-keyed one, and an invalidation remembered per caller is one a later caller forgets. Piping
   * only one trio is the same bug a layer up, so a new write method here needs this pipe too. The
   * server evicts its own entry in OrgLensKeyContactsService for the same reason.
   *
   * On error as well as success, because the client cannot tell a clean failure from a replace whose
   * create landed before its delete failed. A needless drop costs one refetch; a missed one shows a
   * role that has moved.
   */
  private dropCachedRoster<T>(orgUid: string): (source: Observable<T>) => Observable<T> {
    return (source) => source.pipe(tap({ next: () => this.directory.invalidate(orgUid), error: () => this.directory.invalidate(orgUid) }));
  }
}
