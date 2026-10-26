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
import { PollStatus, VoteRowParticipationState } from '@lfx-one/shared/enums';
import {
  CommentResponseInput,
  CreateVoteRequest,
  CreateVoteResponseRequest,
  EnableVoteRequest,
  EnableVoteResponse,
  ExtendVoteRequest,
  MyVoteResponse,
  MyVotesApiResponse,
  MyVotesResponse,
  PaginatedResponse,
  QueryServiceCountResponse,
  SendVoteReminderRequest,
  SendVoteReminderResponse,
  UpdateVoteRequest,
  Vote,
  VoteAnswerInput,
  VoteParticipationVoter,
  VoteReminderRecipient,
  VoteResultsResponse,
  VoteListResponse,
  VoteStatusCounts,
  VoteSummary,
  VoteVoter,
} from '@lfx-one/shared/interfaces';
import { computeVoteRowParticipation, isVoteClosingSoon } from '@lfx-one/shared/utils';
import { catchError, map, Observable, of, retry, shareReplay, switchMap, take, tap, throwError, timer } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class VoteService {
  public vote: WritableSignal<Vote | null> = signal(null);

  private readonly http = inject(HttpClient);
  private readonly voteDetailCache = new Map<string, { observable: Observable<Vote>; cachedAt: number }>();
  private readonly recentlyOpenedVotes: WritableSignal<Map<string, number>> = signal(new Map());
  // Status a fetched row already confirmed past Draft for a just-opened vote still awaiting its invitation count
  // (GH-4078), so a later stale Draft row is overlaid with it (e.g. Ended) instead of being reopened as Active.
  private readonly recentlyOpenedConfirmedStatus = new Map<string, PollStatus>();
  private readonly recentlyCreatedVotes: WritableSignal<Map<string, { vote: Vote; markedAt: number }>> = signal(new Map());

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

  public getMyVotes(): Observable<MyVotesResponse> {
    const params = new HttpParams().set('include_status', 'true');
    return this.http.get<MyVotesApiResponse>('/api/votes/my-votes', { params }).pipe(
      // A legacy server's array carries no completeness proof; keep its rows but withhold totals.
      map((response) => (Array.isArray(response) ? { votes: response, complete: false } : response)),
      catchError((error: unknown) => {
        console.error('Failed to load personal votes', {
          status: error instanceof HttpErrorResponse ? error.status : undefined,
        });
        return throwError(() => error);
      })
    );
  }

  public getVotesByProjectPaginated(
    projectUid: string,
    pageSize?: number,
    pageToken?: string,
    searchName?: string,
    filters?: string[],
    closingOnly?: boolean
  ): Observable<VoteListResponse> {
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

    if (closingOnly !== undefined) params = params.set('closing_soon', String(closingOnly));

    // Deliberately carries no catchError fallback: the votes dashboard's cursor walk must distinguish a
    // failed request from cursor exhaustion (empty result with no token), so HTTP errors propagate to the caller.
    return this.http.get<VoteListResponse>('/api/votes', { params });
  }

  /** Summary failures propagate: unavailable totals must never appear as confirmed zeros. */
  public getVotesSummaryByProject(projectUid: string, group?: string): Observable<VoteSummary> {
    let params = new HttpParams().set('parent', `project:${projectUid}`);
    if (group) params = params.set('group', group);
    return this.http.get<VoteSummary>('/api/votes/summary', { params }).pipe(
      catchError((error: unknown) => {
        console.error('Failed to load vote summary', {
          status: error instanceof HttpErrorResponse ? error.status : undefined,
        });
        return throwError(() => error);
      })
    );
  }

  /** Status-tab count failures propagate: unavailable counts must never appear as confirmed zeros. */
  public getVoteStatusCountsByProject(projectUid: string, searchName?: string, group?: string): Observable<VoteStatusCounts> {
    let params = new HttpParams().set('parent', `project:${projectUid}`);
    const name = searchName?.trim();
    if (name) params = params.set('name', name);
    const groupName = group?.trim();
    if (groupName) params = params.set('group', groupName);
    return this.http.get<VoteStatusCounts>('/api/votes/status-counts', { params }).pipe(
      catchError((error: unknown) => {
        console.error('Failed to load vote status counts', {
          status: error instanceof HttpErrorResponse ? error.status : undefined,
        });
        return throwError(() => error);
      })
    );
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

    // Errors propagate (GH-4078): the dashboard decides whether a failure reads as zero (foreground) or
    // keeps the last confirmed total (silent invitation-count poll).
    return this.http.get<QueryServiceCountResponse>('/api/votes/count', { params }).pipe(map((response) => response.count));
  }

  /** Fetches votes scoped to a committee via `tags=committee_uid:{uid}` query parameter. */
  public getVotesByCommittee(committeeUid: string): Observable<Vote[]> {
    // page_size=100 caps the committee list at the first 100 rows of the canonically sorted set; committees over 100 are out of scope (LFXV2-1969).
    const params = new HttpParams().set('tags', `committee_uid:${committeeUid}`).set('page_size', '100');

    return this.http.get<PaginatedResponse<Vote>>('/api/votes', { params }).pipe(map((response) => response.data));
  }

  public getVote(voteUid: string, options?: { skipCache?: boolean }): Observable<Vote> {
    return this.getVoteDetail(voteUid, options).pipe(tap((vote) => this.vote.set(vote)));
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
          // Service-subscribed (see confirm$.subscribe below) so this survives navigation away from
          // the dialog, same reasoning as markVoteOpened above (GH-4007 dealako/cursor[bot]: marking
          // from the component's own `next` handler under takeUntilDestroyed drops the carrier if the
          // user navigates away before this settles).
          this.markVoteCreated(vote, opened);
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
      tap(() => {
        this.voteDetailCache.delete(voteUid);
        // Otherwise a deleted synthesized draft (GH-4007) keeps reappearing in the list until its TTL expires.
        this.evictRecentlyCreatedVote(voteUid);
      })
    );
  }

  /**
   * Extends an active vote's deadline via the dedicated extend_vote upstream endpoint — unlike
   * `updateVote`, this is permitted while the vote is active (see `ExtendVoteRequest`).
   */
  public extendVote(voteUid: string, data: ExtendVoteRequest): Observable<Vote> {
    return this.http.post<Vote>(`/api/votes/${encodeURIComponent(voteUid)}/extend`, data).pipe(
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

  /** Eligible voters who have not voted yet — vote managers only (#3769). */
  public getReminderRecipients(voteUid: string): Observable<VoteReminderRecipient[]> {
    return this.http.get<VoteReminderRecipient[]>(`/api/votes/${encodeURIComponent(voteUid)}/reminder-recipients`).pipe(take(1));
  }

  /**
   * Every invited voter — vote managers only. Named votes return each voter's status and current ballot (#3911);
   * pseudo-anonymous votes return participation-only rows (#3916).
   */
  public getVoteVoters(voteUid: string): Observable<VoteVoter[] | VoteParticipationVoter[]> {
    return this.http.get<VoteVoter[] | VoteParticipationVoter[]>(`/api/votes/${encodeURIComponent(voteUid)}/voters`).pipe(take(1));
  }

  /** Resends the vote email to the given recipients (#3769). */
  public sendReminders(voteUid: string, recipientIds: string[]): Observable<SendVoteReminderResponse> {
    const body: SendVoteReminderRequest = { recipient_ids: recipientIds };
    return this.http.post<SendVoteReminderResponse>(`/api/votes/${encodeURIComponent(voteUid)}/reminders`, body).pipe(take(1));
  }

  /**
   * Records a just-opened vote (GH-2730) so the votes list can merge the known-open status over
   * stale index rows while the search index catches up — the BFF enable endpoint returns
   * immediately after the PUT instead of waiting on index visibility.
   */
  public markVoteOpened(voteUid: string): void {
    this.recentlyOpenedConfirmedStatus.delete(voteUid);
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
      } else {
        this.recentlyOpenedConfirmedStatus.delete(uid);
      }
    }
    if (live.size !== current.size) {
      this.recentlyOpenedVotes.set(live);
    }
    return live;
  }

  /** Evicts a carried uid once a fetched row shows it open with a positive invitation count — the server value has converged. */
  public evictRecentlyOpenedVote(voteUid: string): void {
    this.recentlyOpenedConfirmedStatus.delete(voteUid);
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
   * through unchanged and the carrier empties. Eviction also waits for a positive invitation count
   * (GH-4078): the index can report the open status before the electorate, and evicting early would
   * flip the row back to "No one invited"; the TTL still ends the carrier if the count never arrives.
   * While it waits, the status that row confirmed is remembered, so a later stale `disabled` row is
   * overlaid with it (e.g. Ended) rather than reopened as Active.
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
        if ((vote.total_voting_request_invitations ?? 0) > 0) this.evictRecentlyOpenedVote(vote.uid);
        else this.recentlyOpenedConfirmedStatus.set(vote.uid, vote.status);
        return vote;
      }
      return { ...vote, status: this.recentlyOpenedConfirmedStatus.get(vote.uid) ?? PollStatus.ACTIVE };
    });
  }

  /**
   * True while a vote sits in the live just-opened or just-created carrier window (GH-4078) — its
   * index row (or synthesized row) can't be trusted to report the invited electorate yet, so the
   * votes table shows "Counting invitations…" instead of "No one invited". Read-only: unlike the
   * getLive* helpers this never prunes, so it is safe to call from a computed.
   */
  public isAwaitingInvitationCount(voteUid: string): boolean {
    const now = Date.now();
    const openedAt = this.recentlyOpenedVotes().get(voteUid);
    if (openedAt !== undefined && now - openedAt < RECENTLY_OPENED_VOTE_TTL_MS) return true;
    const created = this.recentlyCreatedVotes().get(voteUid);
    return created !== undefined && created.vote.status !== PollStatus.DISABLED && now - created.markedAt < RECENTLY_OPENED_VOTE_TTL_MS;
  }

  /**
   * True when any row in a rendered votes list would show "Counting invitations…" (GH-4078) — derived from the same
   * computeVoteRowParticipation state the votes table renders, so polling and the label cannot drift apart.
   */
  public hasVotesAwaitingInvitationCount(votes: Vote[]): boolean {
    return votes.some((vote) => computeVoteRowParticipation(vote, this.isAwaitingInvitationCount(vote.uid)).state === VoteRowParticipationState.COUNTING);
  }

  /**
   * Records a just-created vote, including a clone (GH-4007), so the votes list can synthesize
   * its row until the search index catches up. `mergeRecentlyOpenedVotes` only patches a row
   * already present in a fetched page, but a brand-new vote can be missing from every page for a
   * short window — the full Vote is carried so the synthesized row renders correctly, not a
   * status-only stub. Reuses RECENTLY_OPENED_VOTE_TTL_MS: same "search index hasn't caught up yet"
   * window the just-opened carrier already assumes.
   *
   * `opened` normalizes the stored status: `confirmSpeculativeVote()`'s `vote` field is always the
   * pre-`enableVote()` create-response snapshot (still Draft/Disabled) regardless of whether the
   * follow-up enable call succeeded, so a caller passing `opened: true` gets a synthesized row that
   * already shows Active instead of a stale Draft badge until the index converges.
   */
  public markVoteCreated(vote: Vote, opened: boolean): void {
    const carried = opened ? { ...vote, status: PollStatus.ACTIVE } : vote;
    this.recentlyCreatedVotes.update((created) => new Map(created).set(vote.uid, { vote: carried, markedAt: Date.now() }));
  }

  /** Evicts a carried uid once a fetched row carries it with a positive invitation count — the server row is now the source of truth. */
  public evictRecentlyCreatedVote(voteUid: string): void {
    this.recentlyCreatedVotes.update((created) => {
      if (!created.has(voteUid)) return created;
      const next = new Map(created);
      next.delete(voteUid);
      return next;
    });
  }

  /**
   * Inserts any still-live recently-created vote (GH-4007) that is missing from a fetched page —
   * prepended so a just-created or cloned vote appears in the list immediately instead of only
   * after the search index converges. Self-healing: once a fetched page contains the uid with a
   * positive invitation count, the carried entry is evicted and the server row is used instead.
   *
   * `options` scope the insertion to the list actually being rendered:
   * - `projectUid`/`committeeUid` keep a vote created in one project/committee from leaking into
   *   another's list — a carried vote only inserts into a page whose scope it matches.
   * - `statusFilter` keeps a carried vote out of a page filtered to a status it doesn't match
   *   (e.g. a newly-opened vote must not appear under the Disabled tab).
   * - `closingOnly`/`nowMs` keep a carried vote out of the Closing Soon quick filter unless it
   *   actually falls inside that rolling window (same `isVoteClosingSoon` check the fetched rows
   *   are already subject to server-side).
   * - `searchName`/`group` mirror the same free-text search and Group dropdown the fetch itself is
   *   scoped to (dealako, GH-4007 round 2) — without these a carried vote would insert into a page
   *   the user has filtered to a different search term or committee, one the fetched rows all honor.
   * - `isFirstPage` (default `true`) limits insertion to the first page of a paginated fetch so the
   *   same optimistic row isn't prepended to every page.
   *
   * A row present in the fetched page is handled the same way `mergeRecentlyOpenedVotes` handles
   * GH-2730's carrier: a fetched row still reporting `disabled` hasn't converged yet (this can
   * happen on a *different* tab/page than the one the vote was created from, e.g. Active →
   * Draft → Active before the index catches up) so the carried status is kept instead of
   * discarding the synthesized vote; only a fetched row reporting any other status is treated as
   * real convergence and evicts the carrier — once it also reports a positive invitation count
   * (GH-4078, same reasoning as `mergeRecentlyOpenedVotes`). Until then the carrier adopts the
   * fetched status, so a vote fetched as Ended isn't later re-inserted as Active.
   */
  public mergeRecentlyCreatedVotes(
    votes: Vote[],
    options: {
      projectUid?: string;
      committeeUid?: string;
      statusFilter?: PollStatus | null;
      closingOnly?: boolean;
      nowMs?: number;
      searchName?: string;
      group?: string;
      isFirstPage?: boolean;
    } = {}
  ): Vote[] {
    const { projectUid, committeeUid, statusFilter, closingOnly, nowMs = Date.now(), searchName, group, isFirstPage = true } = options;
    const recentlyCreated = this.getLiveRecentlyCreatedVotes();
    if (recentlyCreated.size === 0) {
      return votes;
    }

    const present = new Set<string>();
    const merged = votes.map((vote) => {
      const carried = recentlyCreated.get(vote.uid);
      if (!carried) return vote;
      present.add(vote.uid);
      if (vote.status !== PollStatus.DISABLED) {
        if ((vote.total_voting_request_invitations ?? 0) > 0) this.evictRecentlyCreatedVote(vote.uid);
        else this.updateRecentlyCreatedVoteStatus(vote.uid, vote.status);
        return vote;
      }
      // Don't re-badge a stale Disabled row outside the tab its carried status actually belongs to
      // (Copilot/dealako/greptile/cursor[bot], GH-4007 round 3): a Draft-tab fetch (statusFilter:
      // DISABLED) can still return this uid's stale index row, and the lazy table never re-filters
      // returned rows, so overlaying Active here would violate the Draft filter the user selected.
      if (statusFilter != null && statusFilter !== carried.status) return vote;
      return carried.status !== PollStatus.DISABLED ? { ...vote, status: carried.status } : vote;
    });

    if (!isFirstPage) {
      return merged;
    }

    const missing: Vote[] = [];
    for (const [uid, vote] of recentlyCreated) {
      if (present.has(uid)) continue;
      if (projectUid !== undefined && vote.project_uid !== projectUid) continue;
      if (committeeUid !== undefined && vote.committee_uid !== committeeUid) continue;
      if (statusFilter != null && vote.status !== statusFilter) continue;
      if (closingOnly && !isVoteClosingSoon(vote, nowMs)) continue;
      if (searchName && !vote.name.toLowerCase().includes(searchName.toLowerCase())) continue;
      if (group && vote.committee_name !== group) continue;
      missing.push(vote);
    }

    return missing.length > 0 ? [...missing, ...merged] : merged;
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

  /** Returns the live recently-created map (uid → Vote), pruning entries older than RECENTLY_OPENED_VOTE_TTL_MS. */
  private getLiveRecentlyCreatedVotes(): Map<string, Vote> {
    const now = Date.now();
    const current = this.recentlyCreatedVotes();
    const live = new Map<string, { vote: Vote; markedAt: number }>();
    const liveVotes = new Map<string, Vote>();
    for (const [uid, entry] of current) {
      if (now - entry.markedAt < RECENTLY_OPENED_VOTE_TTL_MS) {
        live.set(uid, entry);
        liveVotes.set(uid, entry.vote);
      }
    }
    if (live.size !== current.size) {
      this.recentlyCreatedVotes.set(live);
    }
    return liveVotes;
  }

  /**
   * Adopts a fetched row's status for a carried vote still waiting on its invitation count (GH-4078) — keeps
   * `markedAt` so the window doesn't restart, and stops a vote fetched as Ended from being re-inserted as
   * Active under a tab whose page no longer returns it.
   */
  private updateRecentlyCreatedVoteStatus(voteUid: string, status: PollStatus): void {
    this.recentlyCreatedVotes.update((created) => {
      const entry = created.get(voteUid);
      if (!entry || entry.vote.status === status) return created;
      return new Map(created).set(voteUid, { ...entry, vote: { ...entry.vote, status } });
    });
  }
}
