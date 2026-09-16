// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ClaGroupSearchResponse,
  OrgClaApprovalList,
  OrgClaApprovalListUpdate,
  OrgClaGroupList,
  OrgClaSignRequest,
  OrgClaSignResponse,
  PdfUrlResponse,
} from '@lfx-one/shared/interfaces';
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

  /**
   * Watermarked corporate template for the unsigned signing overview (#2317).
   * Distinct from `getPdfUrl`, which is the signed agreement.
   */
  public getCclaPreview(orgUid: string, claGroupId: string): Observable<Blob> {
    return this.http.get(`/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups/${encodeURIComponent(claGroupId)}/ccla-preview`, {
      responseType: 'blob',
    });
  }

  /** CLA Groups the organization could sign a corporate CLA for (#1983). One call per typed term. */
  public getSignOptions(orgUid: string, searchTerm: string): Observable<ClaGroupSearchResponse> {
    const params = new HttpParams().set('search', searchTerm);
    return this.http.get<ClaGroupSearchResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups/sign-options`, { params });
  }

  /**
   * Opens the corporate signing session (#1983 / #2365).
   *
   * Self-sign carries the two attestations as they actually stood when Continue was pressed.
   * Send-by-email carries the named signatory and `sendAsEmail: true` — never a hardcoded ack.
   */
  public requestCorporateSignature(orgUid: string, request: OrgClaSignRequest): Observable<OrgClaSignResponse> {
    return this.http.post<OrgClaSignResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups/sign`, request);
  }

  /** The approval list of one agreement — the rules deciding who it covers (#1985). */
  public getApprovalList(orgUid: string, signatureId: string): Observable<OrgClaApprovalList> {
    return this.http.get<OrgClaApprovalList>(this.approvalListUrl(orgUid, signatureId));
  }

  /**
   * Applies a delta to the approval list and returns the list as it now stands.
   *
   * The response is the whole list, not just the change, so the caller replaces its state rather
   * than patching it. That matters because the producer appends and de-duplicates on its side:
   * adding a rule that already exists changes nothing, and a locally patched list would show it
   * twice.
   */
  public updateApprovalList(orgUid: string, signatureId: string, update: OrgClaApprovalListUpdate): Observable<OrgClaApprovalList> {
    return this.http.put<OrgClaApprovalList>(this.approvalListUrl(orgUid, signatureId), update);
  }

  private approvalListUrl(orgUid: string, signatureId: string): string {
    return `/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups/${encodeURIComponent(signatureId)}/approval-list`;
  }
}
