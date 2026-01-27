// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { CreateVoteRequest, UpdateVoteRequest, Vote } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, take, tap, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class VoteService {
  public vote: WritableSignal<Vote | null> = signal(null);

  private readonly http = inject(HttpClient);

  public getVotes(params?: HttpParams): Observable<Vote[]> {
    return this.http.get<Vote[]>('/api/votes', { params }).pipe(
      catchError((error) => {
        console.error('Failed to load votes:', error);
        return of([]);
      })
    );
  }

  public getVotesByProject(projectUid: string, limit?: number, orderBy?: string): Observable<Vote[]> {
    let params = new HttpParams().set('parent', `project:${projectUid}`);

    if (limit) {
      params = params.set('limit', limit.toString());
    }

    if (orderBy) {
      params = params.set('order', orderBy);
    }

    return this.getVotes(params);
  }

  public getRecentVotesByProject(projectUid: string, limit: number = 3): Observable<Vote[]> {
    return this.getVotesByProject(projectUid, limit, 'updated_at.desc');
  }

  public getVote(voteUid: string): Observable<Vote> {
    return this.http.get<Vote>(`/api/votes/${voteUid}`).pipe(
      catchError((error) => {
        console.error(`Failed to load vote ${voteUid}:`, error);
        return throwError(() => error);
      }),
      tap((vote) => this.vote.set(vote))
    );
  }

  public createVote(voteData: CreateVoteRequest): Observable<Vote> {
    return this.http.post<Vote>('/api/votes', voteData).pipe(
      take(1),
      catchError((error) => {
        console.error('Failed to create vote:', error);
        return throwError(() => error);
      })
    );
  }

  public updateVote(voteUid: string, voteData: UpdateVoteRequest): Observable<Vote> {
    return this.http.put<Vote>(`/api/votes/${voteUid}`, voteData).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to update vote ${voteUid}:`, error);
        return throwError(() => error);
      })
    );
  }

  public deleteVote(voteUid: string): Observable<void> {
    return this.http.delete<void>(`/api/votes/${voteUid}`).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to delete vote ${voteUid}:`, error);
        return throwError(() => error);
      })
    );
  }
}
