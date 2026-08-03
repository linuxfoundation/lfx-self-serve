// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgInfluenceRow, OrgMeetingsKpiSummary, OrgMeetingsSpendBreakdown, OrgMeetingsSupportedTimeRange } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

/** Client for the Org Lens Meetings insights endpoints (LFXV2-2735). */
@Injectable({
  providedIn: 'root',
})
export class OrgLensMeetingsService {
  private readonly http = inject(HttpClient);

  public getKpiSummary(orgUid: string, range: OrgMeetingsSupportedTimeRange): Observable<OrgMeetingsKpiSummary> {
    return this.http.get<OrgMeetingsKpiSummary>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/meetings/kpi`, {
      params: new HttpParams().set('range', range),
    });
  }

  public getSpendBreakdown(orgUid: string, range: OrgMeetingsSupportedTimeRange): Observable<OrgMeetingsSpendBreakdown> {
    return this.http.get<OrgMeetingsSpendBreakdown>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/meetings/spend`, {
      params: new HttpParams().set('range', range),
    });
  }

  public getInfluenceRows(orgUid: string, range: OrgMeetingsSupportedTimeRange): Observable<OrgInfluenceRow[]> {
    return this.http.get<OrgInfluenceRow[]>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/meetings/influence`, {
      params: new HttpParams().set('range', range),
    });
  }
}
