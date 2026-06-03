// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import type { OrgTraineesResponse } from '@lfx-one/shared/interfaces';

/** HTTP client for the Org Lens → People → Trainees tab GET. Single bundled fetch — filter, sort, pagination, and expansion are all client-side. */
@Injectable({ providedIn: 'root' })
export class TraineesService {
  private readonly http = inject(HttpClient);

  public getTrainees(orgUid: string): Observable<OrgTraineesResponse> {
    return this.http.get<OrgTraineesResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/people/trainees`);
  }
}
