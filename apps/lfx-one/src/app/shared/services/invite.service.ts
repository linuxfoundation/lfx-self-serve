// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AcceptInviteResponse } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class InviteService {
  private readonly http = inject(HttpClient);

  public acceptInvite(token: string): Observable<AcceptInviteResponse> {
    return this.http.post<AcceptInviteResponse>('/api/invite/accept', { token });
  }
}
