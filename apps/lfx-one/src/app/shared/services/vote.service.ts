// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import {
  INVITATION_NOT_FOUND,
  RECENTLY_OPENED_VOTE_TTL_MS,
  VOTE_CREATE_COMPLETED_AT_HEADER,
  VOTE_DETAIL_CACHE_TTL_MS,
  VOTE_FGA_TUPLE_PROPAGATION_GRACE_MS,
  VOTE_SPECULATIVE_DELETE_RETRY_DELAY_MS,
} from '@lfx-one/shared/constants';
import { PollStatus } from '@lfx-one/shared/enums';
import {
  CommentResponseInput,
  CreateVoteRequest,
  CreateVoteResponseRequest,
  EnableVoteRequest,
  EnableVoteResponse,
  MyVoteResponse,
  PaginatedResponse,
  QueryServiceCountResponse,
  UpdateVoteRequest,
  Vote,
  VoteAnswerInput,
  VoteResultsResponse,
} from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of, retry, shareReplay, switchMap, take, tap, throwError, timer } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class VoteService {
  public vote: WritableSignal<Vote | null> = signal(null);

  private readonly http = inject(HttpClient);
  private readonly voteDetailCache = new Map<string, { observable: Observable<Vote>; cachedAt: number }>();
  private readonly recentlyOpenedVotes: WritableSignal<Map<string, number>> = signal(new Map());

  /**
   * Single active speculative-create slot (GH-2826) — service-owned, not component-owned, so
   * cancel/navigation cleanup and a confirmed open complete even after vote-manage is destroyed.
   */
  private speculativeVote: {
    state: 'pending' | 'confirmed' | 'discarding';
    create$: Observable<Vote>;
    confirm$: Observable<{ vote: Vote; opened: boolean }> | null;
    result: { vote: Vote; createCompletedAt: number | null } | null;
    error: unknown;
  } | null = null;

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

  public createVote(voteData: CreateVoteRequest): Observable<Vote> {
    return this.http.post<Vote>('/api/votes', voteData).pipe(take(1));
  }

  /**
   * Fires the plain create the moment the confirmation dialog opens (GH-2826 Design A), hiding the ~3 s
   * create behind reading time; a still-pending prior speculation is discarded first (single slot).
   */
  public beginSpeculativeCreate(voteData: CreateVoteRequest): Observable<Vote> {
    return this.startSpeculativeRecord(voteData).create$;
  }

  /**
   * Accept path: chains onto the speculative create (or begins fresh from `fallbackRequest`), then enables with
   * the grace-hint echo — service-subscribed so the open survives navigation. `opened: false` = enable failed, draft kept.
   */
  public confirmSpeculativeVote(fallbackRequest: CreateVoteRequest): Observable<{ vote: Vote; opened: boolean }> {
    const existing = this.speculativeVote;
    if (existing?.state === 'confirmed' && existing.confirm$) {
      return existing.confirm$; // defensive double-confirm: one chain, one enable
    }

    const record = existing?.state === 'pending' ? existing : this.startSpeculativeRecord(fallbackRequest);
    record.state = 'confirmed';

    // Stored terminal state, not shareReplay's error replay: a create that already failed
    // rethrows deterministically for every subscriber.
    const create$ = record.error ? throwError(() => record.error) : record.create$;
    const confirm$ = create$.pipe(
      take(1),
      switchMap((vote) =>
        this.enableVote(vote.uid, { createCompletedAt: record.result?.createCompletedAt ?? undefined }).pipe(
          map((): { vote: Vote; opened: boolean } => ({ vote, opened: true })),
          catchError((): Observable<{ vote: Vote; opened: boolean }> => of({ vote, opened: false }))
        )
      ),
      tap({
        next: ({ vote, opened }) => {
          if (opened) {
            this.markVoteOpened(vote.uid);
          }
          this.clearSpeculativeVote(record);
        },
        error: () => this.clearSpeculativeVote(record),
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    record.confirm$ = confirm$;
    // Service-owned subscription: the open (and its cleanup) completes after navigation away.
    confirm$.subscribe({ error: () => undefined });
    return confirm$;
  }

  /**
   * Cancels a pending speculation (dismiss or destroy before accept): the compensating DELETE fires once
   * the uid is known. State-guarded to 'pending' — safe to call unconditionally from DestroyRef (no-op after confirm).
   */
  public discardSpeculativeVote(): void {
    const record = this.speculativeVote;
    if (!record || record.state !== 'pending') {
      return;
    }
    record.state = 'discarding';
    if (record.error) {
      this.clearSpeculativeVote(record); // the create failed — nothing was created
      return;
    }
    if (record.result) {
      this.deleteSpeculativeVote(record, record.result.vote.uid);
    }
    // Still in flight: the service-side subscription deletes once the uid lands.
  }

  public hasPendingSpeculativeCreate(): boolean {
    return this.speculativeVote?.state === 'pending';
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

  /**
   * Enables a vote. `options.createCompletedAt` echoes the create response's completion stamp (GH-2826) so the
   * BFF sleeps the remaining FGA-propagation grace before attempt 1; absent → no grace (edit flow's tuples are long past).
   */
  public enableVote(voteUid: string, options: { createCompletedAt?: number } = {}): Observable<EnableVoteResponse> {
    const body: EnableVoteRequest = {};
    if (options.createCompletedAt !== undefined) {
      body.create_completed_at = options.createCompletedAt;
    }
    return this.http.put<EnableVoteResponse>(`/api/votes/${encodeURIComponent(voteUid)}/enable`, body).pipe(
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

  /**
   * Creates the speculative record: POST with `observe: 'response'` captures the completion stamp; the
   * service-side subscription survives component teardown and owns the compensating delete once the uid lands.
   */
  private startSpeculativeRecord(voteData: CreateVoteRequest): NonNullable<VoteService['speculativeVote']> {
    this.discardSpeculativeVote();

    const record: NonNullable<VoteService['speculativeVote']> = {
      state: 'pending',
      // Placeholder replaced with the live POST below in the same synchronous block — the
      // pipeline's closures write result/error back onto this record, so it must exist first.
      create$: throwError(() => new Error('Speculative create pipeline not yet wired')),
      confirm$: null,
      result: null,
      error: null,
    };
    record.create$ = this.http.post<Vote>('/api/votes', voteData, { observe: 'response' }).pipe(
      take(1),
      map((response) => {
        if (!response.body) {
          throw new Error('Create vote response body was empty');
        }
        const stamp = response.headers.get(VOTE_CREATE_COMPLETED_AT_HEADER);
        const parsed = stamp === null ? Number.NaN : Number(stamp);
        record.result = { vote: response.body, createCompletedAt: Number.isFinite(parsed) ? parsed : null };
        return response.body;
      }),
      catchError((error) => {
        record.error = error;
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.speculativeVote = record;

    record.create$.subscribe({
      next: (vote) => {
        if (record.state === 'discarding') {
          this.deleteSpeculativeVote(record, vote.uid);
        }
      },
      error: () => {
        if (record.state === 'discarding') {
          this.clearSpeculativeVote(record); // the create failed — nothing was created
        }
        // State 'pending' keeps the errored record so confirmSpeculativeVote rethrows it.
      },
    });

    return record;
  }

  /**
   * Compensating delete for a discarded speculation: waits out the FGA tuple-propagation grace so
   * attempt 1 isn't a cached pre-tuple 403; one retry past the check-cache TTL, then warn-only — the orphan draft is accepted, clutter-only residue (spec).
   */
  private deleteSpeculativeVote(record: NonNullable<VoteService['speculativeVote']>, voteUid: string): void {
    // No stamp means the create just resolved in this tab, so the full grace is owed.
    const completedAt = record.result?.createCompletedAt;
    const remainingGraceMs =
      completedAt == null ? VOTE_FGA_TUPLE_PROPAGATION_GRACE_MS : Math.max(0, completedAt + VOTE_FGA_TUPLE_PROPAGATION_GRACE_MS - Date.now());
    const trigger$: Observable<unknown> = remainingGraceMs > 0 ? timer(remainingGraceMs) : of(null);
    trigger$
      .pipe(
        switchMap(() => this.deleteVote(voteUid).pipe(retry({ count: 1, delay: VOTE_SPECULATIVE_DELETE_RETRY_DELAY_MS }))),
        catchError(() => {
          console.warn(`Speculative vote cleanup failed; orphan draft may remain: ${voteUid}`);
          return of(null);
        })
      )
      .subscribe(() => this.clearSpeculativeVote(record));
  }

  private clearSpeculativeVote(record: NonNullable<VoteService['speculativeVote']>): void {
    if (this.speculativeVote === record) {
      this.speculativeVote = null;
    }
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
