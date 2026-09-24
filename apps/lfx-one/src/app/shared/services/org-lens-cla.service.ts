// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ClaGroupSearchResponse,
  OrgClaActivityLogPage,
  OrgClaApprovalList,
  OrgClaApprovalListUpdate,
  OrgClaContributorAcknowledgmentList,
  OrgClaDesigneeNominationRequest,
  OrgClaDesigneeNominationResponse,
  OrgClaDesigneeRequest,
  OrgClaDesigneeResponse,
  OrgClaEclaAutoCreateResponse,
  OrgClaGroupList,
  OrgClaInvalidateAcknowledgmentRequest,
  OrgClaInvalidateAcknowledgmentResult,
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
import { strictHttpParams } from '@shared/utils/http-params.utils';
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

  /**
   * Turns Auto ECLA on or off for one signed CCLA (#1988).
   *
   * The server echoes the just-written state so the caller can trust the new value without a
   * re-read of the whole CLA list. Refusals arrive as HTTP errors — a 403 body carries the
   * producer's own sentence on `error` (sanctions, ACL) and the toggle uses that verbatim.
   */
  public setAutoCreateEcla(orgUid: string, signatureId: string, autoCreateEcla: boolean): Observable<OrgClaEclaAutoCreateResponse> {
    return this.http.put<OrgClaEclaAutoCreateResponse>(this.eclaAutoCreateUrl(orgUid, signatureId), { autoCreateEcla });
  }

  /**
   * Yes on the manager question (#2780): makes the viewer the initial CLA Manager designee for the
   * agreement's signing project. The server takes the address from the session.
   */
  public assignDesignee(orgUid: string, projectSfid: string): Observable<OrgClaDesigneeResponse> {
    const body: OrgClaDesigneeRequest = { projectSfid };
    return this.http.post<OrgClaDesigneeResponse>(this.designeeUrl(orgUid), body);
  }

  /** No on the manager question: names the person who should become the initial CLA Manager designee. */
  public nominateDesignee(orgUid: string, request: OrgClaDesigneeNominationRequest): Observable<OrgClaDesigneeNominationResponse> {
    return this.http.post<OrgClaDesigneeNominationResponse>(`${this.designeeUrl(orgUid)}/nominations`, request);
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

  /**
   * Paginated contributor acknowledgments (ECLA signatures) for one CCLA (#1986).
   *
   * The `search` term is forwarded to the server as a query parameter and applied by the producer
   * — filtering is not scoped to the rows already loaded. `nextKey`-driven Load-more fetches the
   * next page. `pageSize` is clamped server-side, so passing an out-of-range value is a hint the
   * server rewrites rather than an error the client has to handle.
   */
  public getContributorAcknowledgments(
    orgUid: string,
    signatureId: string,
    options: { search?: string; pageSize?: number; nextKey?: string | null } = {}
  ): Observable<OrgClaContributorAcknowledgmentList> {
    let params = strictHttpParams();
    if (options.search) params = params.set('search', options.search);
    if (typeof options.pageSize === 'number' && Number.isFinite(options.pageSize)) params = params.set('pageSize', String(options.pageSize));
    if (options.nextKey) params = params.set('nextKey', options.nextKey);
    return this.http.get<OrgClaContributorAcknowledgmentList>(this.acknowledgmentsUrl(orgUid, signatureId), { params });
  }

  /**
   * Invalidates one acknowledgment on this CCLA (#2807).
   *
   * Refused server-side while impersonating, before the org-lens grant check runs. The response is
   * a receipt carrying only the acknowledgment id — the producer stamps the invalidation
   * timestamp and actor and reports neither — so the caller refetches rather than deriving the
   * row's new state from it.
   */
  public invalidateAcknowledgment(
    orgUid: string,
    signatureId: string,
    acknowledgmentSignatureId: string,
    request: OrgClaInvalidateAcknowledgmentRequest
  ): Observable<OrgClaInvalidateAcknowledgmentResult> {
    return this.http.post<OrgClaInvalidateAcknowledgmentResult>(
      `${this.acknowledgmentsUrl(orgUid, signatureId)}/${encodeURIComponent(acknowledgmentSignatureId)}/invalidate`,
      request
    );
  }

  /**
   * Paginated activity log for one CCLA (#1987).
   *
   * `nextKey`-driven Load-more fetches the next page. `pageSize` is clamped server-side, so
   * passing an out-of-range value is a hint the server rewrites rather than an error the client
   * has to handle. There is no `search` on the wire — client-side filtering only.
   */
  public getActivityLog(orgUid: string, signatureId: string, options: { pageSize?: number; nextKey?: string | null } = {}): Observable<OrgClaActivityLogPage> {
    let params = strictHttpParams();
    if (typeof options.pageSize === 'number' && Number.isFinite(options.pageSize)) params = params.set('pageSize', String(options.pageSize));
    if (options.nextKey) params = params.set('nextKey', options.nextKey);
    return this.http.get<OrgClaActivityLogPage>(this.activityLogUrl(orgUid, signatureId), { params });
  }

  private designeeUrl(orgUid: string): string {
    return `/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups/designee`;
  }

  private approvalListUrl(orgUid: string, signatureId: string): string {
    return `/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups/${encodeURIComponent(signatureId)}/approval-list`;
  }

  private eclaAutoCreateUrl(orgUid: string, signatureId: string): string {
    return `/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups/${encodeURIComponent(signatureId)}/ecla-auto-create`;
  }

  private managersUrl(orgUid: string, signatureId: string): string {
    return `/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups/${encodeURIComponent(signatureId)}/managers`;
  }

  private acknowledgmentsUrl(orgUid: string, signatureId: string): string {
    return `/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups/${encodeURIComponent(signatureId)}/acknowledgments`;
  }

  private activityLogUrl(orgUid: string, signatureId: string): string {
    return `/api/orgs/${encodeURIComponent(orgUid)}/lens/cla-groups/${encodeURIComponent(signatureId)}/activity`;
  }
}
