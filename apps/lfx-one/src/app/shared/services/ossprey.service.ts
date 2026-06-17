// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, catchError, take } from 'rxjs';
import {
  OsspreyAssignStewardRequest,
  OsspreyAssignStewardResponse,
  OsspreyEscalateRequest,
  OsspreyListParams,
  OsspreyMetrics,
  OsspreyPackage,
  OsspreyPackagesResponse,
  OsspreyStewardshipResponse,
  OsspreyUpdateStatusRequest,
} from '@lfx-one/shared/interfaces';

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
      if (params.search) httpParams = httpParams.set('search', params.search);
      if (params.ecosystem) httpParams = httpParams.set('ecosystem', params.ecosystem);
      if (params.lifecycle) httpParams = httpParams.set('lifecycle', params.lifecycle);
      if (params.status && params.status !== 'all') httpParams = httpParams.set('status', params.status);
      if (params.healthBand) httpParams = httpParams.set('healthBand', params.healthBand);
      if (params.vulnFilter) httpParams = httpParams.set('vulnFilter', params.vulnFilter);
      if (params.busFactor1Only) httpParams = httpParams.set('busFactor1Only', 'true');
      if (params.staleOnly) httpParams = httpParams.set('staleOnly', 'true');
      if (params.unstewardedOnly) httpParams = httpParams.set('unstewardedOnly', 'true');
      if (params.sortBy) httpParams = httpParams.set('sortBy', params.sortBy);
    }
    return this.http.get<OsspreyPackagesResponse>('/api/akrites/packages', { params: httpParams });
  }

  public getMetrics(): Observable<OsspreyMetrics> {
    return this.http.get<OsspreyMetrics>('/api/akrites/packages/metrics');
  }

  public getPackage(purl: string): Observable<OsspreyPackage | null> {
    return this.http.get<OsspreyPackage>(`/api/akrites/packages/${encodeURIComponent(purl)}`).pipe(
      catchError((err) => {
        if (err.status === 404) return of(null);
        throw err;
      })
    );
  }

  /** Open a package for stewardship; the response carries the integer stewardship id. */
  public openStewardship(purl: string): Observable<OsspreyStewardshipResponse> {
    return this.http.post<OsspreyStewardshipResponse>('/api/akrites/stewardships', { purl }).pipe(take(1));
  }

  public assignSteward(stewardshipId: number, body: OsspreyAssignStewardRequest): Observable<OsspreyAssignStewardResponse> {
    return this.http.put<OsspreyAssignStewardResponse>(`/api/akrites/stewardships/${stewardshipId}/steward`, body).pipe(take(1));
  }

  public escalateStewardship(stewardshipId: number, body: OsspreyEscalateRequest): Observable<OsspreyStewardshipResponse> {
    return this.http.put<OsspreyStewardshipResponse>(`/api/akrites/stewardships/${stewardshipId}/escalate`, body).pipe(take(1));
  }

  public updateStewardshipStatus(stewardshipId: number, body: OsspreyUpdateStatusRequest): Observable<OsspreyStewardshipResponse> {
    return this.http.put<OsspreyStewardshipResponse>(`/api/akrites/stewardships/${stewardshipId}/status`, body).pipe(take(1));
  }
}
