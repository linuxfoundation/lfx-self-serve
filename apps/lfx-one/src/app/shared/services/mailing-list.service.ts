// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  CreateGroupsIOServiceRequest,
  CreateMailingListRequest,
  GroupsIOMailingList,
  GroupsIOService,
  QueryServiceCountResponse,
} from '@lfx-one/shared/interfaces';
import { map, Observable } from 'rxjs';

/**
 * Service for managing mailing list data
 * @description Fetches mailing list data from the API
 */
@Injectable({
  providedIn: 'root',
})
export class MailingListService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/mailing-lists';

  /**
   * Get mailing lists for a project
   * @param projectUid - The project UID to filter by
   * @returns Observable of mailing list details array
   */
  public getMailingListsByProject(projectUid: string): Observable<GroupsIOMailingList[]> {
    const params = new HttpParams().set('tags', `project_uid:${projectUid}`);
    return this.http.get<GroupsIOMailingList[]>(this.baseUrl, { params });
  }

  /**
   * Get all mailing lists (admin/PMO view)
   * @returns Observable of mailing list details array
   */
  public getMailingLists(): Observable<GroupsIOMailingList[]> {
    return this.http.get<GroupsIOMailingList[]>(this.baseUrl);
  }

  /**
   * Get a single mailing list by ID
   * @param uid - The mailing list UID
   * @returns Observable of mailing list details
   */
  public getMailingList(uid: string): Observable<GroupsIOMailingList> {
    return this.http.get<GroupsIOMailingList>(`${this.baseUrl}/${uid}`);
  }

  public getMailingListsCount(query?: Record<string, string>): Observable<number> {
    let params = new HttpParams();
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        params = params.set(key, value);
      });
    }
    return this.http.get<QueryServiceCountResponse>(`${this.baseUrl}/count`, { params }).pipe(map((response) => response.count));
  }

  public createMailingList(data: CreateMailingListRequest): Observable<GroupsIOMailingList> {
    return this.http.post<GroupsIOMailingList>(this.baseUrl, data);
  }

  public updateMailingList(uid: string, data: Partial<CreateMailingListRequest>): Observable<GroupsIOMailingList> {
    return this.http.put<GroupsIOMailingList>(`${this.baseUrl}/${uid}`, data);
  }

  public getServicesByProject(projectUid: string): Observable<GroupsIOService[]> {
    const params = new HttpParams().set('tags', `project_uid:${projectUid}`);

    return this.http.get<GroupsIOService[]>(`${this.baseUrl}/services`, { params });
  }

  /**
   * Create a new Groups.io service
   * @param data - The service creation request data
   * @returns Observable of the created service
   */
  public createService(data: CreateGroupsIOServiceRequest): Observable<GroupsIOService> {
    return this.http.post<GroupsIOService>(`${this.baseUrl}/services`, data);
  }
}
