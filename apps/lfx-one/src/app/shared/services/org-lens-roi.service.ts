// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  OrgLensRoiAnnual,
  OrgLensRoiCoverage,
  OrgLensRoiInvestmentBreakdown,
  OrgLensRoiMethod,
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

  public getProjects(orgUid: string, method: OrgLensRoiMethod): Observable<OrgLensRoiProjects> {
    return this.http.get<OrgLensRoiProjects>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/roi/projects`, {
      params: new HttpParams().set('method', method),
    });
  }
}
