// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgContributionsQuery, OrgContributionsResponse } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

/** HTTP client for the Org Lens → Code Contributions page (LFXV2-1894). Server-paginated; all filters compose server-side. */
@Injectable({ providedIn: 'root' })
export class ContributionsService {
  private readonly http = inject(HttpClient);

  /** KPI strip + repositories table + filter options for the list page. */
  public getContributions(orgUid: string, query: OrgContributionsQuery): Observable<OrgContributionsResponse> {
    return this.http.get<OrgContributionsResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/contributions`, {
      params: buildQueryParams(query),
    });
  }
}

/** Serialize the composed filter/pagination state to URL query params. Empty multi-selects are omitted. */
function buildQueryParams(query: OrgContributionsQuery): HttpParams {
  let params = new HttpParams()
    .set('view', query.view)
    .set('range', query.dateRange)
    .set('sort', query.sort)
    .set('dir', query.dir === 1 ? 'asc' : 'desc')
    .set('commitSort', query.commitSort)
    .set('commitDir', query.commitDir === 1 ? 'asc' : 'desc')
    .set('page', String(query.page))
    .set('size', String(query.size));
  if (query.search) {
    params = params.set('q', query.search);
  }
  if (query.projects.length) {
    params = params.set('projects', query.projects.join(','));
  }
  if (query.employees.length) {
    params = params.set('employees', query.employees.join(','));
  }
  return params;
}
