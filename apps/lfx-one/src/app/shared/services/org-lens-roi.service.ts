// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgLensRoiAnnual, OrgLensRoiCoverage, OrgLensRoiMethod, OrgLensRoiSummary } from '@lfx-one/shared/interfaces';
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
}
