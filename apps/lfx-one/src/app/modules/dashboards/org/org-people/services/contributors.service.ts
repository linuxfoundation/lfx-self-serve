// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgCommitFilters, OrgContributorsResponse, OrgEmploymentFilter, OrgLensTimeRange, OrgTeamMembersFilter } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

/** HTTP client for the Org Lens → People → Contributors tab GET. Re-fetches per time window, commit filters, employment and team members (A1 architecture per Item 2 lock); search/foundation/project are client-side. */
@Injectable({ providedIn: 'root' })
export class ContributorsService {
  private readonly http = inject(HttpClient);

  public getContributors(
    orgUid: string,
    timeRange: OrgLensTimeRange,
    filters: OrgCommitFilters,
    employment: OrgEmploymentFilter,
    teamMembers: OrgTeamMembersFilter
  ): Observable<OrgContributorsResponse> {
    const params = new HttpParams({ fromObject: { timeRange, ...filters, employment, teamMembers } });
    return this.http.get<OrgContributorsResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/people/contributors`, { params });
  }
}
