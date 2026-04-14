// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { CreateVoteRequest, PaginatedResponse, QueryServiceCountResponse, UpdateVoteRequest, Vote, VoteResultsResponse } from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of, take, tap } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class VoteService {
  public vote: WritableSignal<Vote | null> = signal(null);

  private readonly http = inject(HttpClient);

  public getVotes(params?: HttpParams): Observable<PaginatedResponse<Vote>> {
    return this.http.get<PaginatedResponse<Vote>>('/api/votes', { params }).pipe(
      catchError(() => {
        return of({ data: [] as Vote[], page_token: undefined });
      })
    );
  }

  public getMyVotes(projectUid?: string, foundationUid?: string): Observable<Vote[]> {
    let params = new HttpParams();
    if (projectUid) {
      params = params.set('project_uid', projectUid);
    }
    if (foundationUid) {
      params = params.set('foundation_uid', foundationUid);
    }
    return this.http.get<Vote[]>('/api/votes/my-votes', { params }).pipe(catchError(() => of([])));
  }

  public getVotesByProject(projectUid: string, pageSize?: number, orderBy?: string): Observable<Vote[]> {
    let params = new HttpParams().set('parent', `project:${projectUid}`);

    if (pageSize) {
      params = params.set('page_size', pageSize.toString());
    }

    if (orderBy) {
      params = params.set('order', orderBy);
    }

    return this.getVotes(params).pipe(map((response) => response.data));
  }

  public getVotesByProjectPaginated(
    projectUid: string,
    pageSize?: number,
    pageToken?: string,
    searchName?: string,
    filters?: string[]
  ): Observable<PaginatedResponse<Vote>> {
    let params = new HttpParams().set('parent', `project:${projectUid}`);

    if (pageSize) {
      params = params.set('page_size', pageSize.toString());
    }

    if (pageToken) {
      params = params.set('page_token', pageToken);
    }

    if (searchName) {
      params = params.set('name', searchName);
    }

    if (filters?.length) {
      for (const filter of filters) {
        params = params.append('filters', filter);
      }
    }

    return this.getVotes(params);
  }

  public getVotesCountByProject(projectUid: string, searchName?: string, filters?: string[]): Observable<number> {
    let params = new HttpParams().set('parent', `project:${projectUid}`);

    if (searchName) {
      params = params.set('name', searchName);
    }

    if (filters?.length) {
      for (const filter of filters) {
        params = params.append('filters', filter);
      }
    }

    return this.http.get<QueryServiceCountResponse>('/api/votes/count', { params }).pipe(
      catchError(() => of({ count: 0 })),
      map((response) => response.count)
    );
  }

  /** Fetches votes scoped to a committee via `tags=committee_uid:{uid}` query parameter. */
  public getVotesByCommittee(committeeUid: string, orderBy?: string, pageSize: number = 1000): Observable<Vote[]> {
    let params = new HttpParams().set('tags', `committee_uid:${committeeUid}`).set('page_size', pageSize.toString());

    if (orderBy) {
      params = params.set('order', orderBy);
    }

    return this.http.get<PaginatedResponse<Vote>>('/api/votes', { params }).pipe(map((response) => response.data));
  }

  public getRecentVotesByProject(projectUid: string, pageSize: number = 3): Observable<Vote[]> {
    return this.getVotesByProject(projectUid, pageSize, 'updated_at.desc');
  }

  public getVote(voteUid: string): Observable<Vote> {
    return this.http.get<Vote>(`/api/votes/${voteUid}`).pipe(tap((vote) => this.vote.set(vote)));
  }

  public createVote(voteData: CreateVoteRequest): Observable<Vote> {
    return this.http.post<Vote>('/api/votes', voteData).pipe(take(1));
  }

  public updateVote(voteUid: string, voteData: UpdateVoteRequest): Observable<Vote> {
    return this.http.put<Vote>(`/api/votes/${voteUid}`, voteData).pipe(take(1));
  }

  public deleteVote(voteUid: string): Observable<void> {
    return this.http.delete<void>(`/api/votes/${voteUid}`).pipe(take(1));
  }

  public getVoteResults(voteUid: string): Observable<VoteResultsResponse> {
    return this.http.get<VoteResultsResponse>(`/api/votes/${voteUid}/results`);
  }

  public enableVote(voteUid: string): Observable<Vote> {
    return this.http.put<Vote>(`/api/votes/${voteUid}/enable`, {}).pipe(take(1));
  }
}
