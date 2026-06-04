// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import type { OrgLensFoundationsAndProjectsResponse } from '@lfx-one/shared/interfaces';

/**
 * Client-side proxy for GET /api/orgs/:orgUid/lens/foundations-and-projects.
 * Backs the Org Lens "Foundations and Projects" section on /org/overview.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgLensFoundationsService {
  private readonly http = inject(HttpClient);

  public getFoundationsAndProjects(orgUid: string): Observable<OrgLensFoundationsAndProjectsResponse> {
    return this.http.get<OrgLensFoundationsAndProjectsResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/foundations-and-projects`);
  }
}
