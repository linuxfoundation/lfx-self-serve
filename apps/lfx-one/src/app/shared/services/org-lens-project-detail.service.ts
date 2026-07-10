// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgLensLeaderboardTimeRange, OrgLensProjectDetailResponse } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, throwError } from 'rxjs';

/**
 * Client-side proxy for GET /api/orgs/:orgUid/lens/projects/:projectSlug?range=.
 * Returns `null` when the server responds with 404 (unknown project slug) so the
 * page can render its not-found state. The `range` toggle is forwarded to the
 * server so the card headlines, leaderboard scores, and activity totals all
 * re-scope with the selected time range.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgLensProjectDetailService {
  private readonly http = inject(HttpClient);

  public getProjectDetail(
    orgUid: string,
    orgName: string,
    projectSlug: string,
    range: OrgLensLeaderboardTimeRange
  ): Observable<OrgLensProjectDetailResponse | null> {
    const url = `/api/orgs/${encodeURIComponent(orgUid)}/lens/projects/${encodeURIComponent(projectSlug)}`;
    return this.http
      .get<OrgLensProjectDetailResponse>(url, { params: { orgName, range } })
      .pipe(catchError((err: HttpErrorResponse) => (err.status === 404 ? of(null) : throwError(() => err))));
  }
}
