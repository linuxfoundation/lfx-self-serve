// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { GetMyMeetupsParams, MeetupFilterOptionsResponse, MyMeetupsResponse } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class MeetupsService {
  private readonly http = inject(HttpClient);

  public getMyMeetups(params: GetMyMeetupsParams = {}): Observable<MyMeetupsResponse> {
    let httpParams = new HttpParams();

    if (params.isPast !== undefined) httpParams = httpParams.set('isPast', String(params.isPast));
    if (params.searchQuery) httpParams = httpParams.set('searchQuery', params.searchQuery);
    if (params.community) httpParams = httpParams.set('community', params.community);
    if (params.role) httpParams = httpParams.set('role', params.role);
    if (params.status) httpParams = httpParams.set('status', params.status);
    if (params.sortField) httpParams = httpParams.set('sortField', params.sortField);
    if (params.pageSize) httpParams = httpParams.set('pageSize', String(params.pageSize));
    if (params.offset !== undefined) httpParams = httpParams.set('offset', String(params.offset));
    if (params.sortOrder) httpParams = httpParams.set('sortOrder', params.sortOrder);

    return this.http.get<MyMeetupsResponse>('/api/meetups', { params: httpParams });
  }

  public getMeetupFilters(): Observable<MeetupFilterOptionsResponse> {
    return this.http.get<MeetupFilterOptionsResponse>('/api/meetups/filters');
  }
}
