// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ORG_LENS_TIME_RANGE_QUERY_PARAM, ORG_TRAINING_FILTER_KEYS, ORG_TRAINING_VIEW_QUERY_PARAMS } from '@lfx-one/shared/constants';
import type {
  OrgLensTimeRange,
  OrgTrainingFilterOptions,
  OrgTrainingGroupEmployeesParams,
  OrgTrainingGroupEmployeesResponse,
  OrgTrainingGroupsParams,
  OrgTrainingGroupsResponse,
  OrgTrainingStats,
  OrgTrainingStatsQuery,
} from '@lfx-one/shared/interfaces';
import { strictHttpParams } from '@shared/utils/http-params.utils';
import { Observable } from 'rxjs';

/** HTTP client of the shared Training / Trainees view: one stats call, one filter-options call and the group-by table. */
@Injectable({
  providedIn: 'root',
})
export class OrgLensTrainingService {
  private readonly http = inject(HttpClient);

  public getTrainingStats(orgUid: string, query: OrgTrainingStatsQuery): Observable<OrgTrainingStats> {
    return this.http.get<OrgTrainingStats>(`${this.baseUrl(orgUid)}/stats`, { params: this.queryParams(query) });
  }

  public getFilterOptions(orgUid: string, range: OrgLensTimeRange): Observable<OrgTrainingFilterOptions> {
    return this.http.get<OrgTrainingFilterOptions>(`${this.baseUrl(orgUid)}/filter-options`, {
      params: strictHttpParams().set(ORG_LENS_TIME_RANGE_QUERY_PARAM, range),
    });
  }

  public getGroups(orgUid: string, query: OrgTrainingStatsQuery, params: OrgTrainingGroupsParams): Observable<OrgTrainingGroupsResponse> {
    let httpParams = this.queryParams(query).set('groupBy', params.groupBy).set('tab', params.tab);
    if (params.searchQuery) httpParams = httpParams.set('search', params.searchQuery);
    if (params.sortField) httpParams = httpParams.set('sortField', params.sortField);
    if (params.sortOrder) httpParams = httpParams.set('sortOrder', params.sortOrder);
    if (params.pageSize) httpParams = httpParams.set('pageSize', String(params.pageSize));
    if (params.offset !== undefined) httpParams = httpParams.set('offset', String(params.offset));

    return this.http.get<OrgTrainingGroupsResponse>(`${this.baseUrl(orgUid)}/groups`, { params: httpParams });
  }

  public getGroupEmployees(
    orgUid: string,
    query: OrgTrainingStatsQuery,
    params: OrgTrainingGroupEmployeesParams
  ): Observable<OrgTrainingGroupEmployeesResponse> {
    const httpParams = this.queryParams(query)
      .set('groupBy', params.groupBy)
      .set('groupValue', params.groupValue)
      .set('tab', params.tab)
      .set('status', params.status);

    return this.http.get<OrgTrainingGroupEmployeesResponse>(`${this.baseUrl(orgUid)}/groups/employees`, { params: httpParams });
  }

  private baseUrl(orgUid: string): string {
    return `/api/orgs/${encodeURIComponent(orgUid)}/lens/training`;
  }

  /** Range plus every filter that is set; an unset filter is left off the URL. */
  private queryParams(query: OrgTrainingStatsQuery): HttpParams {
    let httpParams = strictHttpParams().set(ORG_LENS_TIME_RANGE_QUERY_PARAM, query.range);
    for (const key of ORG_TRAINING_FILTER_KEYS) {
      const value = query[key];
      if (value !== null) httpParams = httpParams.set(ORG_TRAINING_VIEW_QUERY_PARAMS[key], value);
    }
    return httpParams;
  }
}
