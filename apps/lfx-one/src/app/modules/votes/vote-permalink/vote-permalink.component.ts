// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformServer } from '@angular/common';
import { Component, inject, PLATFORM_ID, REQUEST_CONTEXT, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { IndexedVoteResponseStatus, PollStatus } from '@lfx-one/shared/enums';
import { MyVoteResponse, ServerRequestContext, Vote, VotePermalinkState, VotePermalinkTarget } from '@lfx-one/shared/interfaces';
import { normalizePollStatus } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { ProjectService } from '@services/project.service';
import { VoteService } from '@services/vote.service';
import { probeCommitteeWriters, resolveEntityWriteSlug } from '@shared/utils/write-access.util';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, combineLatest, filter, map, Observable, of, startWith, switchMap, tap, throwError } from 'rxjs';

import { NotFoundComponent } from '../../not-found/not-found.component';
import { VotesDashboardComponent } from '../votes-dashboard/votes-dashboard.component';

/**
 * Shareable vote permalink page (#3659). Route: /votes/:id (Me lens).
 *
 * Opens the vote in the drawer the My Votes dashboard already uses: the cast drawer for a voter
 * awaiting their ballot on an active vote, otherwise the results drawer — as `creator` for a
 * project or committee writer, as `voter` for everyone else. A vote the user can't view (400/403/404)
 * renders the shared not-found page in place, and SSR returns HTTP 404, so a missing vote and a
 * forbidden one look identical. Any other failure is transient: a retry card, HTTP 200. SSR stops
 * after the vote fetch (it renders the skeleton); the drawer target is resolved in the browser.
 */
@Component({
  selector: 'lfx-vote-permalink',
  imports: [ButtonComponent, NotFoundComponent, SkeletonModule, VotesDashboardComponent],
  templateUrl: './vote-permalink.component.html',
})
export class VotePermalinkComponent {
  // === Services ===
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly voteService = inject(VoteService);
  private readonly projectService = inject(ProjectService);
  private readonly committeeService = inject(CommitteeService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly reqContext = inject(REQUEST_CONTEXT, { optional: true }) as ServerRequestContext | null;

  /** Re-runs the load after a transient failure. */
  private readonly retry$ = new BehaviorSubject<void>(undefined);

  // === Route Params (toSignal) ===
  protected readonly voteId: Signal<string | null> = toSignal(this.route.paramMap.pipe(map((m) => m.get('id'))), { initialValue: null });

  // === Data Signals (Complex — init via private functions) ===
  /** Single load-state stream: loading, not-found, transient error and the drawer target all derive from one emission. */
  protected readonly state: Signal<VotePermalinkState> = this.initState();

  // === Protected Methods ===
  protected retry(): void {
    this.retry$.next();
  }

  /** The drawer closed — drop the vote from the address bar so it never names a vote that isn't open. */
  protected onPermalinkClosed(): void {
    void this.router.navigate(['/votes'], { replaceUrl: true });
  }

  // === Private Initializers ===
  private initState(): Signal<VotePermalinkState> {
    const loadingState: VotePermalinkState = { loading: true, notFound: false, error: false, target: null };
    const notFoundState: VotePermalinkState = { loading: false, notFound: true, error: false, target: null };
    const errorState: VotePermalinkState = { loading: false, notFound: false, error: true, target: null };

    return toSignal(
      combineLatest([toObservable(this.voteId), this.retry$]).pipe(
        map(([id]) => id),
        filter((id): id is string => !!id),
        switchMap((id) =>
          this.voteService.fetchVote(id).pipe(
            // Only the vote fetch decides not-found: 400/403/404 means "no such vote, or not yours to
            // see" — never confirm which. Anything else (gateway 5xx, network) is transient and must
            // not masquerade as a permanent 404.
            catchError((err) => (this.isNotFoundStatus(err?.status) ? of(null) : throwError(() => err))),
            switchMap((vote) => {
              if (!vote) return of(notFoundState);
              // SSR only needs the vote fetch to decide the HTTP status. Resolving the drawer here
              // would also mount the dashboard on the server and hold the response until its My
              // Votes feed, the writer checks and the drawer's own fetches all settle — the browser
              // resolves the target after hydration instead.
              if (isPlatformServer(this.platformId)) return of(loadingState);
              return this.resolveTarget(vote).pipe(map((target): VotePermalinkState => ({ loading: false, notFound: false, error: false, target })));
            }),
            catchError((err) => {
              console.error('Failed to load vote for permalink', err);
              return of(errorState);
            }),
            // Emit a real HTTP 404 during SSR for the not-found branch only — same in-place pattern as
            // not-found.component.ts. The error state intentionally stays HTTP 200.
            tap((state) => {
              if (state.notFound && isPlatformServer(this.platformId) && this.reqContext) {
                this.reqContext.notFound = true;
              }
            }),
            // Reset to the skeleton on retry and on a param change between permalinks.
            startWith(loadingState)
          )
        )
      ),
      { initialValue: loadingState }
    );
  }

  // === Private Helpers ===
  /** The viewer's response row decides the cast drawer; the writer check runs only when it doesn't apply. */
  private resolveTarget(vote: Vote): Observable<VotePermalinkTarget> {
    return this.voteService.getMyVoteResponse(vote.uid).pipe(
      switchMap((myResponse) => {
        const canManage$ = this.isAwaitingBallot(vote, myResponse) ? of(false) : this.resolveCanManage(vote);
        return canManage$.pipe(map((canManage) => this.toTarget(vote, myResponse, canManage)));
      })
    );
  }

  /**
   * Project writer, then committee writer — the same order writerGuard uses. A failed check is "not a
   * writer" (the voter view), never not-found: the vote itself already loaded.
   */
  private resolveCanManage(vote: Vote): Observable<boolean> {
    const projectSlugOrUid = resolveEntityWriteSlug(vote, null);
    const isProjectWriter$ = projectSlugOrUid
      ? this.projectService.getProjectStrict(projectSlugOrUid).pipe(
          map((project) => project.writer === true),
          catchError((error) => {
            console.error('Failed to check project write access for vote permalink', error);
            return of(false);
          })
        )
      : of(false);

    return isProjectWriter$.pipe(
      switchMap((isProjectWriter) => {
        if (isProjectWriter) return of(true);
        // probeCommitteeWriters catches per-committee failures, so this never errors.
        return probeCommitteeWriters(vote.committee_uid ? [vote.committee_uid] : [], (uid) => this.committeeService.fetchCommittee(uid)).pipe(
          map((result) => result.writer)
        );
      })
    );
  }

  /** Voting is the point of a reminder link, so an awaited ballot wins over write access. */
  private toTarget(vote: Vote, myResponse: MyVoteResponse | null, canManage: boolean): VotePermalinkTarget {
    if (this.isAwaitingBallot(vote, myResponse)) {
      return { uid: vote.uid, drawer: 'cast', audience: 'voter' };
    }
    if (canManage) {
      return { uid: vote.uid, drawer: 'results', audience: 'creator' };
    }
    return { uid: vote.uid, drawer: 'results', audience: 'voter' };
  }

  private isAwaitingBallot(vote: Vote, myResponse: MyVoteResponse | null): boolean {
    return (
      normalizePollStatus(vote.status) === PollStatus.ACTIVE &&
      myResponse?.vote_status === IndexedVoteResponseStatus.AWAITING_RESPONSE &&
      !myResponse.voter_removed
    );
  }

  private isNotFoundStatus(status: unknown): boolean {
    return typeof status === 'number' && [400, 403, 404].includes(status);
  }
}
