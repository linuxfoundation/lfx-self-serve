// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, catchError, take, map } from 'rxjs';
import {
  AkritesActorInput,
  AkritesActivityResponse,
  AkritesAssignStewardRequest,
  AkritesAssignStewardResponse,
  AkritesEscalateRequest,
  AkritesListParams,
  AkritesMetrics,
  AkritesPackage,
  AkritesPackagesResponse,
  AkritesScatterResponse,
  AkritesSearchStewardResult,
  AkritesStatus,
  AkritesStewardshipResponse,
  AkritesUpdateStatusRequest,
  CommitteeMember,
} from '@lfx-one/shared/interfaces';
import { AKRITES_STEWARD_COMMITTEE_UID } from '@lfx-one/shared/constants';
import { UserService } from './user.service';

@Injectable({
  providedIn: 'root',
})
export class AkritesService {
  private readonly http = inject(HttpClient);
  private readonly userService = inject(UserService);

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

  public getScatterData(statuses?: AkritesStatus[]): Observable<AkritesScatterResponse> {
    let params = new HttpParams();
    if (statuses?.length) {
      params = params.set('status', statuses.join(','));
    }
    return this.http.get<AkritesScatterResponse>('/api/akrites/packages/scatter', { params });
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
    return this.http.post<AkritesStewardshipResponse>('/api/akrites/stewardships', { purl, actor: this.buildActor() }).pipe(take(1));
  }

  public assignSteward(stewardshipId: number, body: AkritesAssignStewardRequest): Observable<AkritesAssignStewardResponse> {
    return this.http
      .put<AkritesAssignStewardResponse>(`/api/akrites/stewardships/${stewardshipId}/steward`, { ...body, actor: this.buildActor() })
      .pipe(take(1));
  }

  public escalateStewardship(stewardshipId: number, body: AkritesEscalateRequest): Observable<AkritesStewardshipResponse> {
    return this.http
      .put<AkritesStewardshipResponse>(`/api/akrites/stewardships/${stewardshipId}/escalate`, { ...body, actor: this.buildActor() })
      .pipe(take(1));
  }

  public updateStewardshipStatus(stewardshipId: number, body: AkritesUpdateStatusRequest): Observable<AkritesStewardshipResponse> {
    return this.http.put<AkritesStewardshipResponse>(`/api/akrites/stewardships/${stewardshipId}/status`, { ...body, actor: this.buildActor() }).pipe(take(1));
  }

  public searchStewards(): Observable<AkritesSearchStewardResult[]> {
    return this.http.get<CommitteeMember[]>(`/api/committees/${AKRITES_STEWARD_COMMITTEE_UID}/members`).pipe(
      map((members) =>
        members
          .filter((m): m is CommitteeMember & { username: string } => !!m.username) // Filter out members without username to prevent assign failures
          .map((m) => {
            const initials = `${m.first_name?.[0] ?? ''}${m.last_name?.[0] ?? ''}`.toUpperCase() || (m.username?.[0] ?? 'U').toUpperCase();
            return {
              userId: m.uid,
              username: m.username,
              displayName: `${m.first_name} ${m.last_name}`.trim(),
              organization: m.organization?.name ?? null,
              status: m.status ?? '',
              initials,
            };
          })
      ),
      catchError((err) => {
        console.error('Failed to load stewards:', err);
        return of([] as AkritesSearchStewardResult[]);
      })
    );
  }

  private buildActor(): AkritesActorInput {
    const user = this.userService.user();
    return {
      userId: user?.sub ?? '',
      username: user?.nickname || user?.username || user?.['https://sso.linuxfoundation.org/claims/username'] || null,
      displayName: user?.name || null,
      avatarUrl: user?.picture || null,
    };
  }
}
