// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { INVITATION_NOT_FOUND, RECENTLY_OPENED_VOTE_TTL_MS, VOTE_DETAIL_CACHE_TTL_MS } from '@lfx-one/shared/constants';
import { PollStatus } from '@lfx-one/shared/enums';
import {
  CommentResponseInput,
  CreateVoteRequest,
  CreateVoteResponseRequest,
  EnableVoteResponse,
  MyVoteResponse,
  PaginatedResponse,
  QueryServiceCountResponse,
  UpdateVoteRequest,
  Vote,
  VoteAnswerInput,
  VoteResultsResponse,
} from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of, shareReplay, switchMap, take, tap, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class VoteService {
  public vote: WritableSignal<Vote | null> = signal(null);

  private readonly http = inject(HttpClient);
  private readonly voteDetailCache = new Map<string, { observable: Observable<Vote>; cachedAt: number }>();
  private readonly recentlyOpenedVotes: WritableSignal<Map<string, number>> = signal(new Map());

  public getVotes(params?: HttpParams): Observable<PaginatedResponse<Vote>> {
    return this.http.get<PaginatedResponse<Vote>>('/api/votes', { params }).pipe(
      catchError(() => {
        return of({ data: [] as Vote[], page_token: undefined });
      })
    );
  }

  public getMyVotes(): Observable<Vote[]> {
    return this.http.get<Vote[]>('/api/votes/my-votes').pipe(catchError(() => of([])));
  }

  public getVotesByProject(projectUid: string, pageSize?: number, orderBy?: string): Observable<Vote[]> {
    let params = new HttpParams().set('parent', `project:${projectUid}`);

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

    // Deliberately bypasses getVotes' catchError fallback: the votes dashboard's cursor walk must distinguish a
    // failed request from cursor exhaustion (empty result with no token), so HTTP errors propagate to the caller.
    return this.http.get<PaginatedResponse<Vote>>('/api/votes', { params });
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
  public getVotesByCommittee(committeeUid: string, orderBy?: string): Observable<Vote[]> {
    // page_size=100 keeps the drain-all UX after VoteService.getVotes switched to single-page; committees over 100 are out of scope (LFXV2-1969).
    let params = new HttpParams().set('tags', `committee_uid:${committeeUid}`).set('page_size', '100');

    if (orderBy) {
      params = params.set('order', orderBy);
    }

    return this.http.get<PaginatedResponse<Vote>>('/api/votes', { params }).pipe(map((response) => response.data));
  }

  public getRecentVotesByProject(projectUid: string, pageSize: number = 3): Observable<Vote[]> {
    return this.getVotesByProject(projectUid, pageSize, 'updated_at.desc');
  }

  public getVote(voteUid: string): Observable<Vote> {
    return this.getVoteDetail(voteUid).pipe(tap((vote) => this.vote.set(vote)));
  }

  /** Tap-free vote fetch for writerGuard's entity probe and vote-manage's context fallback (getVote's signal write would leak state). */
  public fetchVote(voteUid: string, options?: { skipCache?: boolean }): Observable<Vote> {
    return this.getVoteDetail(voteUid, options);
  }

  /**
   * Short-TTL cached vote detail shared by the writerGuard probe and manage-page init — one request per edit navigation
   * instead of two (the detail endpoint's project enrichment included). Evicts on error and on write; `skipCache` forces a fresh read.
   */
  public getVoteDetail(voteUid: string, options?: { skipCache?: boolean }): Observable<Vote> {
    const cached = this.voteDetailCache.get(voteUid);
    if (!options?.skipCache && cached && Date.now() - cached.cachedAt < VOTE_DETAIL_CACHE_TTL_MS) {
      return cached.observable;
    }
    if (cached) {
      this.voteDetailCache.delete(voteUid);
    }
    const request$ = this.http
      .get<Vote>(`/api/votes/${encodeURIComponent(voteUid)}`)
      .pipe(tap({ error: () => this.voteDetailCache.delete(voteUid) }), shareReplay(1));
    this.pruneExpiredVoteDetailCache();
    this.voteDetailCache.set(voteUid, { observable: request$, cachedAt: Date.now() });
    return request$;
  }

  public createVote(voteData: CreateVoteRequest, options?: { open?: boolean }): Observable<Vote> {
    // ?open=true fuses create+open into one BFF operation (GH-2731); the response carries the vote
    // in its real status ('active' only when the inline enable succeeded) — callers branch on it.
    const params = options?.open ? new HttpParams().set('open', 'true') : undefined;
    return this.http.post<Vote>('/api/votes', voteData, { params }).pipe(take(1));
  }

  public updateVote(voteUid: string, voteData: UpdateVoteRequest): Observable<Vote> {
    return this.http.put<Vote>(`/api/votes/${encodeURIComponent(voteUid)}`, voteData).pipe(
      take(1),
      tap(() => this.voteDetailCache.delete(voteUid))
    );
  }

  public deleteVote(voteUid: string): Observable<void> {
    return this.http.delete<void>(`/api/votes/${encodeURIComponent(voteUid)}`).pipe(
      take(1),
      tap(() => this.voteDetailCache.delete(voteUid))
    );
  }

  public getVoteResults(voteUid: string): Observable<VoteResultsResponse> {
    return this.http.get<VoteResultsResponse>(`/api/votes/${encodeURIComponent(voteUid)}/results`);
  }

  public enableVote(voteUid: string): Observable<EnableVoteResponse> {
    return this.http.put<EnableVoteResponse>(`/api/votes/${encodeURIComponent(voteUid)}/enable`, {}).pipe(
      take(1),
      tap(() => this.voteDetailCache.delete(voteUid))
    );
  }

  /**
   * Records a just-opened vote (GH-2730) so the votes list can merge the known-open status over
   * stale index rows while the search index catches up — the BFF enable endpoint returns
   * immediately after the PUT instead of waiting on index visibility.
   */
  public markVoteOpened(voteUid: string): void {
    this.recentlyOpenedVotes.update((opened) => new Map(opened).set(voteUid, Date.now()));
  }

  /**
   * Returns the live recently-opened map (uid → epoch-ms marked at), pruning entries older than
   * RECENTLY_OPENED_VOTE_TTL_MS. Display-only: the fetched server value wins once the index converges.
   */
  public getLiveRecentlyOpenedVotes(): Map<string, number> {
    const now = Date.now();
    const current = this.recentlyOpenedVotes();
    const live = new Map<string, number>();
    for (const [uid, markedAt] of current) {
      if (now - markedAt < RECENTLY_OPENED_VOTE_TTL_MS) {
        live.set(uid, markedAt);
      }
    }
    if (live.size !== current.size) {
      this.recentlyOpenedVotes.set(live);
    }
    return live;
  }

  /** Evicts a carried uid once a fetched row already shows it open — the server value has converged. */
  public evictRecentlyOpenedVote(voteUid: string): void {
    this.recentlyOpenedVotes.update((opened) => {
      if (!opened.has(voteUid)) return opened;
      const next = new Map(opened);
      next.delete(voteUid);
      return next;
    });
  }

  /**
   * Merges the recently-opened carrier over a fetched votes page (GH-2730): only rows still
   * showing a carried vote as `disabled` get the known-open status substituted; rows that came
   * back with any other status have converged — the server's value wins and the entry is evicted
   * (a just-opened vote can end early inside the TTL via ITX's `EndPollIfAllResponded`, so
   * non-disabled ≠ active). Self-healing — once the index catches up, the fetched value flows
   * through unchanged and the carrier empties.
   */
  public mergeRecentlyOpenedVotes(votes: Vote[]): Vote[] {
    const recentlyOpened = this.getLiveRecentlyOpenedVotes();
    if (recentlyOpened.size === 0) {
      return votes;
    }

    return votes.map((vote) => {
      if (!recentlyOpened.has(vote.uid)) {
        return vote;
      }
      if (vote.status !== PollStatus.DISABLED) {
        this.evictRecentlyOpenedVote(vote.uid);
        return vote;
      }
      return { ...vote, status: PollStatus.ACTIVE };
    });
  }

  public createVoteResponse(payload: CreateVoteResponseRequest): Observable<void> {
    return this.http.post<void>('/api/votes/responses', payload).pipe(take(1));
  }

  /** Wraps getMyVoteResponse + createVoteResponse; throws INVITATION_NOT_FOUND if no row exists. */
  public submitMyResponse(
    voteUid: string,
    params: { abstain: boolean; userVoteContent: VoteAnswerInput[] | undefined; commentResponses?: CommentResponseInput[] }
  ): Observable<void> {
    return this.getMyVoteResponse(voteUid).pipe(
      take(1),
      switchMap((myResponse) => {
        if (!myResponse?.uid) return throwError(() => new Error(INVITATION_NOT_FOUND));
        const payload: CreateVoteResponseRequest = {
          vote_response_uid: myResponse.uid,
          vote_uid: voteUid,
          abstain: params.abstain,
          user_vote_content: params.userVoteContent,
          comment_responses: params.commentResponses,
        };
        return this.createVoteResponse(payload);
      })
    );
  }

  public getMyVoteResponse(voteUid: string): Observable<MyVoteResponse | null> {
    return this.http.get<MyVoteResponse | null>(`/api/votes/${encodeURIComponent(voteUid)}/my-response`).pipe(
      catchError((err: HttpErrorResponse) => {
        // 404 = the user genuinely has no invitation row for this vote — return null so
        // callers can surface the "no invitation" UX. Any other error (500, network, etc.)
        // is rethrown so the submit flow can show a generic "Unable to submit" toast
        // instead of misreporting it as "Unable to find your invitation".
        if (err?.status === 404) return of(null);
        console.error(`Failed to load my-response for vote ${voteUid}:`, err);
        return throwError(() => err);
      })
    );
  }

  private pruneExpiredVoteDetailCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.voteDetailCache) {
      if (now - entry.cachedAt >= VOTE_DETAIL_CACHE_TTL_MS) {
        this.voteDetailCache.delete(key);
      }
    }
  }
}
