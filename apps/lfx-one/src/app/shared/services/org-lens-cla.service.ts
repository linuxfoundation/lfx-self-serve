// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ClaGroupSearchResponse,
  OrgClaApprovalList,
  OrgClaApprovalListUpdate,
  OrgClaGroupList,
  OrgClaManager,
  OrgClaManagerAddRequest,
  OrgClaManagerList,
  OrgClaPermissionAction,
  OrgClaPermissionCheckRequest,
  OrgClaPermissionCheckResponse,
  OrgClaSignRequest,
  OrgClaSignResponse,
  PdfUrlResponse,
} from '@lfx-one/shared/interfaces';
import { Observable, catchError, map, of } from 'rxjs';

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

  /**
   * Whether ACS allows this viewer the typed write for this organization and pair.
   *
   * Fail closed: a missing body, a non-boolean, or an HTTP error is `false`, so a timeout cannot
   * continue Sign. The server interpolates the ACS string; this posts only the typed action.
   */
  public checkPermission(orgUid: string, action: OrgClaPermissionAction, projectSfid: string): Observable<boolean> {
    const body: OrgClaPermissionCheckRequest = {
      action,
      ...(projectSfid ? { projectSfid } : {}),
    };
    return this.http.post<OrgClaPermissionCheckResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups/permissions/checks`, body).pipe(
      map((response) => response?.allowed === true),
      catchError((error: unknown) => {
        console.error('Organization Lens CLA permission check failed', error);
        return of(false);
      })
    );
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

  public getManagers(orgUid: string, signatureId: string): Observable<OrgClaManagerList> {
    return this.http.get<OrgClaManagerList>(`${this.managersUrl(orgUid, signatureId)}`);
  }

  public addManager(orgUid: string, signatureId: string, request: OrgClaManagerAddRequest): Observable<OrgClaManager> {
    return this.http.post<OrgClaManager>(`${this.managersUrl(orgUid, signatureId)}`, request);
  }

  public removeManager(orgUid: string, signatureId: string, lfUsername: string): Observable<void> {
    return this.http.delete<void>(`${this.managersUrl(orgUid, signatureId)}/${encodeURIComponent(lfUsername)}`);
  }

  private approvalListUrl(orgUid: string, signatureId: string): string {
    return `/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups/${encodeURIComponent(signatureId)}/approval-list`;
  }

  private managersUrl(orgUid: string, signatureId: string): string {
    return `/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups/${encodeURIComponent(signatureId)}/managers`;
  }
}
