// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import type { OrgAllEmployeeDetail, OrgAllEmployeesResponse } from '@lfx-one/shared/interfaces';

/** HTTP client for the Org Lens "All Employees" BFF endpoints. Errors propagate to the component, which owns loading/error state and retry — mirrors OrgLensMembershipsService. */
@Injectable({ providedIn: 'root' })
export class AllEmployeesService {
  private readonly http = inject(HttpClient);

  public getAllEmployees(accountId: string): Observable<OrgAllEmployeesResponse> {
    return this.http.get<OrgAllEmployeesResponse>(`/api/orgs/${encodeURIComponent(accountId)}/lens/people/all`);
  }

  public getEmployeeDetail(accountId: string, personKey: string): Observable<OrgAllEmployeeDetail> {
    return this.http.get<OrgAllEmployeeDetail>(`/api/orgs/${encodeURIComponent(accountId)}/lens/people/${encodeURIComponent(personKey)}/detail`);
  }
}
