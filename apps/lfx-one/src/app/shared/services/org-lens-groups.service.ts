// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgLensGroupsResponse } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

/** Client for the Org Lens Groups endpoint (LFXV2-2014). */
@Injectable({
  providedIn: 'root',
})
export class OrgLensGroupsService {
  private readonly http = inject(HttpClient);

  public getGroups(orgUid: string): Observable<OrgLensGroupsResponse> {
    return this.http.get<OrgLensGroupsResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/groups`);
  }
}
