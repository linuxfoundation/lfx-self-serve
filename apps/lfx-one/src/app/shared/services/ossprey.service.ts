// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, catchError } from 'rxjs';
import { OsspreyListParams, OsspreyPackage, OsspreyPackagesResponse } from '@lfx-one/shared/interfaces';

@Injectable({
  providedIn: 'root',
})
export class OsspreyService {
  private readonly http = inject(HttpClient);

  public getPackages(params?: OsspreyListParams): Observable<OsspreyPackagesResponse> {
    let httpParams = new HttpParams();
    if (params) {
      if (params.page) httpParams = httpParams.set('page', String(params.page));
      if (params.pageSize) httpParams = httpParams.set('pageSize', String(params.pageSize));
      if (params.ecosystem) httpParams = httpParams.set('ecosystem', params.ecosystem);
      if (params.lifecycle) httpParams = httpParams.set('lifecycle', params.lifecycle);
      if (params.busFactor1Only) httpParams = httpParams.set('busFactor1Only', 'true');
      if (params.staleOnly) httpParams = httpParams.set('staleOnly', 'true');
      if (params.unstewardedOnly) httpParams = httpParams.set('unstewardedOnly', 'true');
      if (params.sortBy) httpParams = httpParams.set('sortBy', params.sortBy);
      if (params.sortDir) httpParams = httpParams.set('sortDir', params.sortDir);
    }
    return this.http.get<OsspreyPackagesResponse>('/api/ossprey/packages', { params: httpParams });
  }

  public getStewardName(id: string): string {
    return id;
  }

  public getPackage(purl: string): Observable<OsspreyPackage | null> {
    return this.http.get<OsspreyPackage>(`/api/ossprey/packages/${encodeURIComponent(purl)}`).pipe(
      catchError((err) => {
        if (err.status === 404) return of(null);
        throw err;
      })
    );
  }
}
