// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OrgAddressesResponse, OrgCanonicalRecord, OrgUpdateRequest } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

/** Spec 021 — Client service wrapping the three Org Profile BFF endpoints: GET canonical record, GET addresses (mock in v1), PUT partial-update. */
@Injectable({
  providedIn: 'root',
})
export class OrgProfileService {
  private readonly http = inject(HttpClient);

  public getCanonicalRecord(uid: string): Observable<OrgCanonicalRecord> {
    return this.http.get<OrgCanonicalRecord>(`/api/orgs/uid/${encodeURIComponent(uid)}`);
  }

  public getAddresses(uid: string): Observable<OrgAddressesResponse> {
    return this.http.get<OrgAddressesResponse>(`/api/orgs/uid/${encodeURIComponent(uid)}/addresses`);
  }

  public updateOrg(uid: string, payload: OrgUpdateRequest): Observable<OrgCanonicalRecord> {
    return this.http.put<OrgCanonicalRecord>(`/api/orgs/uid/${encodeURIComponent(uid)}`, payload);
  }
}
