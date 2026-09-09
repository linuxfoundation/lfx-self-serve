// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgClaApprovalList, OrgClaApprovalListUpdate, OrgClaGroupList, PdfUrlResponse } from '@lfx-one/shared/interfaces';
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
