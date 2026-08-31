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
  MyMailingList,
  QueryServiceCountResponse,
  UpdateMailingListMemberRequest,
} from '@lfx-one/shared/interfaces';
import { MAILING_LIST_DETAIL_CACHE_TTL_MS } from '@lfx-one/shared/constants';
import { catchError, map, Observable, of, shareReplay, tap } from 'rxjs';

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
  private readonly mailingListDetailCache = new Map<string, { observable: Observable<GroupsIOMailingList>; cachedAt: number }>();

  public getMailingListsByProject(projectUid: string): Observable<GroupsIOMailingList[]> {
    const params = new HttpParams().set('tags', `project_uid:${projectUid}`);
    return this.http.get<GroupsIOMailingList[]>(this.baseUrl, { params });
  }

  public getMailingListsByCommittee(committeeUid: string): Observable<GroupsIOMailingList[]> {
    const params = new HttpParams().set('tags', `committee_uid:${committeeUid}`);
    return this.http.get<GroupsIOMailingList[]>(this.baseUrl, { params });
  }

  public getMailingLists(): Observable<GroupsIOMailingList[]> {
    return this.http.get<GroupsIOMailingList[]>(this.baseUrl);
  }

  public getMyMailingLists(): Observable<MyMailingList[]> {
    return this.http.get<MyMailingList[]>(`${this.baseUrl}/my-mailing-lists`).pipe(catchError(() => of([])));
  }

  /**
   * Mailing-list detail fetch with a short-TTL shared cache: the writerGuard entity probe and
   * MailingListManageComponent's initMailingList both need the same payload within one
   * navigation — sharing the request avoids a duplicate fetch on every edit-page load.
   * Probe-friendly: no side effects. Entries evict on error and on write (updateMailingList).
   * Pass `skipCache` to force a fresh fetch. Mirrors getMeetingDetail / fetchCommittee (GH-1567).
   */
  public getMailingList(uid: string, options?: { skipCache?: boolean }): Observable<GroupsIOMailingList> {
    const cached = this.mailingListDetailCache.get(uid);
    if (!options?.skipCache && cached && Date.now() - cached.cachedAt < MAILING_LIST_DETAIL_CACHE_TTL_MS) {
      return cached.observable;
    }
    if (cached) {
      this.mailingListDetailCache.delete(uid);
    }
    const request$ = this.http.get<GroupsIOMailingList>(`${this.baseUrl}/${uid}`).pipe(
      tap({ error: () => this.mailingListDetailCache.delete(uid) }),
      shareReplay(1)
    );
    this.pruneExpiredMailingListDetailCache();
    this.mailingListDetailCache.set(uid, { observable: request$, cachedAt: Date.now() });
    return request$;
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
    return this.http.put<GroupsIOMailingList>(`${this.baseUrl}/${uid}`, data).pipe(tap(() => this.mailingListDetailCache.delete(uid)));
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

  private pruneExpiredMailingListDetailCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.mailingListDetailCache) {
      if (now - entry.cachedAt >= MAILING_LIST_DETAIL_CACHE_TTL_MS) {
        this.mailingListDetailCache.delete(key);
      }
    }
  }
}
