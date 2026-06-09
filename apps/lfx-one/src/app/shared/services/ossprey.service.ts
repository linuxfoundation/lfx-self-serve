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
      if (params.sort) httpParams = httpParams.set('sort', params.sort);
      if (params.status) httpParams = httpParams.set('status', params.status);
      if (params.ecosystem) httpParams = httpParams.set('ecosystem', params.ecosystem);
      if (params.lifecycle) httpParams = httpParams.set('lifecycle', params.lifecycle);
      if (params.healthBand) httpParams = httpParams.set('healthBand', params.healthBand);
      if (params.vulnFilter) httpParams = httpParams.set('vulnFilter', params.vulnFilter);
      if (params.search) httpParams = httpParams.set('search', params.search);
      if (params.cursor) httpParams = httpParams.set('cursor', params.cursor);
      if (params.limit) httpParams = httpParams.set('limit', String(params.limit));
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
