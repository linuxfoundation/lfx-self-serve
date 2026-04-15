// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ImpersonationStartResponse, ImpersonationStatusResponse } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ImpersonationService {
  private readonly http = inject(HttpClient);

  public startImpersonation(targetUser: string): Observable<ImpersonationStartResponse> {
    return this.http.post<ImpersonationStartResponse>('/api/impersonate', { targetUser });
  }

  public stopImpersonation(): Observable<{ impersonating: false }> {
    return this.http.post<{ impersonating: false }>('/api/impersonate/stop', {});
  }

  public getStatus(): Observable<ImpersonationStatusResponse> {
    return this.http
      .get<ImpersonationStatusResponse>('/api/impersonate/status')
      .pipe(catchError(() => of({ impersonating: false } as ImpersonationStatusResponse)));
  }
}
