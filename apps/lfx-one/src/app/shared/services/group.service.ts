// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { PublicGroupDetail } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class GroupService {
  private readonly http = inject(HttpClient);

  public getPublicGroup(groupUid: string): Observable<PublicGroupDetail> {
    return this.http.get<PublicGroupDetail>(`/public/api/groups/${groupUid}`);
  }
}
