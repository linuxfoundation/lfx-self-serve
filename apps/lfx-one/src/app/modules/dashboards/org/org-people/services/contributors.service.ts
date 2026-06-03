// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgContributorsResponse, OrgContributorTimeRange } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

/** HTTP client for the Org Lens → People → Contributors tab GET. Re-fetches per time-window selection (A1 architecture per Item 2 lock); search/foundation/project are client-side. */
@Injectable({ providedIn: 'root' })
export class ContributorsService {
  private readonly http = inject(HttpClient);

  public getContributors(orgUid: string, timeRange: OrgContributorTimeRange): Observable<OrgContributorsResponse> {
    const params = new HttpParams().set('timeRange', timeRange);
    return this.http.get<OrgContributorsResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/people/contributors`, { params });
  }
}
