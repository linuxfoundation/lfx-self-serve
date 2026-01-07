// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  CreateGroupsIOServiceRequest,
  CreateMailingListMemberRequest,
  CreateMailingListRequest,
  GroupsIOMailingList,
  GroupsIOService,
  MailingListMember,
  QueryServiceCountResponse,
  UpdateMailingListMemberRequest,
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

  public getMailingListsByProject(projectUid: string): Observable<GroupsIOMailingList[]> {
    const params = new HttpParams().set('tags', `project_uid:${projectUid}`);
    return this.http.get<GroupsIOMailingList[]>(this.baseUrl, { params });
  }

  public getMailingLists(): Observable<GroupsIOMailingList[]> {
    return this.http.get<GroupsIOMailingList[]>(this.baseUrl);
  }

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

  public createService(data: CreateGroupsIOServiceRequest): Observable<GroupsIOService> {
    return this.http.post<GroupsIOService>(`${this.baseUrl}/services`, data);
  }

  public getMembers(mailingListId: string): Observable<MailingListMember[]> {
    return this.http.get<MailingListMember[]>(`${this.baseUrl}/${mailingListId}/members`);
  }

  public getMembersCount(mailingListId: string): Observable<number> {
    return this.http.get<QueryServiceCountResponse>(`${this.baseUrl}/${mailingListId}/members/count`).pipe(map((response) => response.count));
  }

  public getMember(mailingListId: string, memberId: string): Observable<MailingListMember> {
    return this.http.get<MailingListMember>(`${this.baseUrl}/${mailingListId}/members/${memberId}`);
  }

  public createMember(mailingListId: string, data: CreateMailingListMemberRequest): Observable<MailingListMember> {
    return this.http.post<MailingListMember>(`${this.baseUrl}/${mailingListId}/members`, data);
  }

  public updateMember(mailingListId: string, memberId: string, data: UpdateMailingListMemberRequest): Observable<MailingListMember> {
    return this.http.put<MailingListMember>(`${this.baseUrl}/${mailingListId}/members/${memberId}`, data);
  }

  public deleteMember(mailingListId: string, memberId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${mailingListId}/members/${memberId}`);
  }
}
