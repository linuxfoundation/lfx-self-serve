// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, catchError, take } from 'rxjs';
import {
  AkritesActivityResponse,
  AkritesAssignStewardRequest,
  AkritesAssignStewardResponse,
  AkritesEscalateRequest,
  AkritesListParams,
  AkritesMetrics,
  AkritesPackage,
  AkritesPackagesResponse,
  AkritesScatterResponse,
  AkritesStewardshipResponse,
  AkritesUpdateStatusRequest,
} from '@lfx-one/shared/interfaces';

@Injectable({
  providedIn: 'root',
})
export class AkritesService {
  private readonly http = inject(HttpClient);

  public getPackages(params?: AkritesListParams): Observable<AkritesPackagesResponse> {
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
    return this.http.get<AkritesPackagesResponse>('/api/akrites/packages', { params: httpParams });
  }

  public getMetrics(): Observable<AkritesMetrics> {
    return this.http.get<AkritesMetrics>('/api/akrites/packages/metrics');
  }

  public getScatterData(): Observable<AkritesScatterResponse> {
    return this.http.get<AkritesScatterResponse>('/api/akrites/packages/scatter');
  }

  public getActivityFeed(page = 1, pageSize = 25): Observable<AkritesActivityResponse> {
    const params = new HttpParams().set('page', String(page)).set('pageSize', String(pageSize));
    return this.http.get<AkritesActivityResponse>('/api/akrites/activity', { params });
  }

  public getPackage(purl: string): Observable<AkritesPackage | null> {
    return this.http.get<AkritesPackage>(`/api/akrites/packages/${encodeURIComponent(purl)}`).pipe(
      catchError((err) => {
        if (err.status === 404) return of(null);
        throw err;
      })
    );
  }

  /** Open a package for stewardship; the response carries the integer stewardship id. */
  public openStewardship(purl: string): Observable<AkritesStewardshipResponse> {
    return this.http.post<AkritesStewardshipResponse>('/api/akrites/stewardships', { purl }).pipe(take(1));
  }

  public assignSteward(stewardshipId: number, body: AkritesAssignStewardRequest): Observable<AkritesAssignStewardResponse> {
    return this.http.put<AkritesAssignStewardResponse>(`/api/akrites/stewardships/${stewardshipId}/steward`, body).pipe(take(1));
  }

  public escalateStewardship(stewardshipId: number, body: AkritesEscalateRequest): Observable<AkritesStewardshipResponse> {
    return this.http.put<AkritesStewardshipResponse>(`/api/akrites/stewardships/${stewardshipId}/escalate`, body).pipe(take(1));
  }

  public updateStewardshipStatus(stewardshipId: number, body: AkritesUpdateStatusRequest): Observable<AkritesStewardshipResponse> {
    return this.http.put<AkritesStewardshipResponse>(`/api/akrites/stewardships/${stewardshipId}/status`, body).pipe(take(1));
  }
}
