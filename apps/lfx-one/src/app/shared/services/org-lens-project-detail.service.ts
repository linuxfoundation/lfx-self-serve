// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgLensProjectDetailResponse } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, throwError } from 'rxjs';

/**
 * Client-side proxy for GET /api/orgs/:orgUid/lens/projects/:projectSlug.
 * Returns `null` when the server responds with 404 (unknown project slug) so the
 * page can render its not-found state. Wiring the real Snowflake / LFX Insights
 * backend (a separate story) only requires updating the server service — the
 * response shape and every consumer stay the same.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgLensProjectDetailService {
  private readonly http = inject(HttpClient);

  public getProjectDetail(orgUid: string, orgName: string, projectSlug: string): Observable<OrgLensProjectDetailResponse | null> {
    const url = `/api/orgs/${encodeURIComponent(orgUid)}/lens/projects/${encodeURIComponent(projectSlug)}`;
    return this.http.get<OrgLensProjectDetailResponse>(url, { params: { orgName } }).pipe(
      catchError((err: HttpErrorResponse) => (err.status === 404 ? of(null) : throwError(() => err)))
    );
  }
}
