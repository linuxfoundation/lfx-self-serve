// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import type { OrgAllEmployeeDetail, OrgAllEmployeesResponse, OrgCommitFilters, OrgLensTimeRange } from '@lfx-one/shared/interfaces';

/** HTTP client for the Org Lens "All Employees" BFF endpoints. Errors propagate to the component, which owns loading/error state and retry — mirrors OrgLensMembershipsService. */
@Injectable({ providedIn: 'root' })
export class AllEmployeesService {
  private readonly http = inject(HttpClient);

  public getAllEmployees(orgUid: string, range: OrgLensTimeRange, filters: OrgCommitFilters): Observable<OrgAllEmployeesResponse> {
    return this.http.get<OrgAllEmployeesResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/people/all`, { params: { range, ...filters } });
  }

  public getFormerEmployees(orgUid: string, range: OrgLensTimeRange, filters: OrgCommitFilters): Observable<OrgAllEmployeesResponse> {
    return this.http.get<OrgAllEmployeesResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/people/former`, { params: { range, ...filters } });
  }

  /**
   * The expanded row's detail in the page's view: the Maintainer pills follow `range`, and the code rows count what the
   * row counts — `range` and the commit filters (lfx-self-serve#4404).
   */
  public getEmployeeDetail(orgUid: string, personKey: string, range: OrgLensTimeRange, filters: OrgCommitFilters): Observable<OrgAllEmployeeDetail> {
    return this.http.get<OrgAllEmployeeDetail>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/people/${encodeURIComponent(personKey)}/detail`, {
      params: { range, ...filters },
    });
  }
}
