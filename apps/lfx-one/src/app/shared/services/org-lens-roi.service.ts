// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  OrgLensRoiAnnual,
  OrgLensRoiCoverage,
  OrgLensRoiInvestmentBreakdown,
  OrgLensRoiMethod,
  OrgLensRoiProjectAnnual,
  OrgLensRoiProjectDetail,
  OrgLensRoiProjects,
  OrgLensRoiSummary,
} from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class OrgLensRoiService {
  private readonly http = inject(HttpClient);

  public getSummary(orgUid: string, method: OrgLensRoiMethod): Observable<OrgLensRoiSummary> {
    return this.http.get<OrgLensRoiSummary>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/roi/summary`, {
      params: new HttpParams().set('method', method),
    });
  }

  public getCoverage(orgUid: string, method: OrgLensRoiMethod): Observable<OrgLensRoiCoverage> {
    return this.http.get<OrgLensRoiCoverage>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/roi/coverage`, {
      params: new HttpParams().set('method', method),
    });
  }

  public getAnnual(orgUid: string, method: OrgLensRoiMethod): Observable<OrgLensRoiAnnual> {
    return this.http.get<OrgLensRoiAnnual>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/roi/annual`, {
      params: new HttpParams().set('method', method),
    });
  }

  /**
   * No `method` parameter, unlike every other read here: category investment has no
   * `MARKUP_METHOD` in the warehouse, so the response is identical whichever method is selected and
   * sending one would only invite a pointless refetch when the viewer switches.
   */
  public getInvestmentBreakdown(orgUid: string): Observable<OrgLensRoiInvestmentBreakdown> {
    return this.http.get<OrgLensRoiInvestmentBreakdown>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/roi/investment-breakdown`);
  }

  /**
   * Two surfaces read this — the leading-projects donut and the projects section — so a page load
   * issues it twice. Deliberate rather than overlooked, and cheaper than it looks: on hydration
   * both are served from Angular's HTTP transfer cache, which serves a key repeatedly rather than
   * consuming it, and after that the second is a BFF round-trip answered by the shared server-side
   * cache rather than the warehouse. De-duplicating it client-side needs memoisation whose
   * interaction with synchronous cache replay, subscription cancellation and completion semantics
   * costs more in subtlety than the request it saves. The structural fix, if this ever becomes a
   * real cost, is to fetch once in the page and pass the rows into both surfaces as inputs.
   */
  public getProjects(orgUid: string, method: OrgLensRoiMethod): Observable<OrgLensRoiProjects> {
    return this.http.get<OrgLensRoiProjects>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/roi/projects`, {
      params: new HttpParams().set('method', method),
    });
  }

  /** 404s when the slug names no project of this organization — never an empty 200. */
  public getProjectDetail(orgUid: string, projectSlug: string, method: OrgLensRoiMethod): Observable<OrgLensRoiProjectDetail> {
    return this.http.get<OrgLensRoiProjectDetail>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/roi/projects/${encodeURIComponent(projectSlug)}`, {
      params: new HttpParams().set('method', method),
    });
  }

  public getProjectAnnual(orgUid: string, projectSlug: string, method: OrgLensRoiMethod): Observable<OrgLensRoiProjectAnnual> {
    return this.http.get<OrgLensRoiProjectAnnual>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/roi/projects/${encodeURIComponent(projectSlug)}/annual`, {
      params: new HttpParams().set('method', method),
    });
  }
}
