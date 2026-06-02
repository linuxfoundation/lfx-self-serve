// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import type { OrgKeyContactsResponse } from '@lfx-one/shared/interfaces';

/** HTTP client for the Org Lens → People → Key Contacts tab GET. V1 is read-only; edit affordances reuse the spec-024 `OrgLensKeyContactsController` writes when LFXV2-1677 lands. */
@Injectable({ providedIn: 'root' })
export class KeyContactsService {
  private readonly http = inject(HttpClient);

  public getKeyContacts(orgUid: string): Observable<OrgKeyContactsResponse> {
    return this.http.get<OrgKeyContactsResponse>(`/api/orgs/${encodeURIComponent(orgUid)}/lens/people/key-contacts`);
  }
}
