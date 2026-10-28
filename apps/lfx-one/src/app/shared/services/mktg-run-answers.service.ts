// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MktgPublicRunAnswersResponse, MktgRunAnswersRequest } from '@lfx-one/shared/interfaces';
import { Observable, take } from 'rxjs';

/** Writer-authorized continuation without a private session or owner token. Never retries a POST. */
@Injectable({ providedIn: 'root' })
export class MktgRunAnswersService {
  private readonly http = inject(HttpClient);

  public answer(runId: string, request: MktgRunAnswersRequest): Observable<MktgPublicRunAnswersResponse> {
    return this.http.post<MktgPublicRunAnswersResponse>(`/api/mktg-agents/runs/${encodeURIComponent(runId)}/answers`, request).pipe(take(1));
  }
}
