// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgClaGroupList, OrgClaManager, OrgClaManagerAddRequest, OrgClaManagerList, PdfUrlResponse } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

/**
 * Client for the Org Lens EasyCLA list (#1978).
 *
 * No transformation here: the server already shapes the row, including the status the card
 * renders. Searching and paging are done in the page component over the fetched set, so this
 * is called once per selected organization — on load, and again whenever the selection
 * changes — and never for a search term or a page turn.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgLensClaService {
  private readonly http = inject(HttpClient);

  public getClaGroups(orgUid: string): Observable<OrgClaGroupList> {
    return this.http.get<OrgClaGroupList>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups`);
  }

  public getPdfUrl(orgUid: string, signatureId: string): Observable<PdfUrlResponse> {
    return this.http.get<PdfUrlResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups/${encodeURIComponent(signatureId)}/pdf-url`);
  }

  public getManagers(orgUid: string, signatureId: string): Observable<OrgClaManagerList> {
    return this.http.get<OrgClaManagerList>(`${this.managersUrl(orgUid, signatureId)}`);
  }

  public addManager(orgUid: string, signatureId: string, request: OrgClaManagerAddRequest): Observable<OrgClaManager> {
    return this.http.post<OrgClaManager>(`${this.managersUrl(orgUid, signatureId)}`, request);
  }

  public removeManager(orgUid: string, signatureId: string, lfUsername: string): Observable<void> {
    return this.http.delete<void>(`${this.managersUrl(orgUid, signatureId)}/${encodeURIComponent(lfUsername)}`);
  }

  private managersUrl(orgUid: string, signatureId: string): string {
    return `/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups/${encodeURIComponent(signatureId)}/managers`;
  }
}
