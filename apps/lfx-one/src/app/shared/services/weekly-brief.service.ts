// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  GenerateWeeklyBriefRequest,
  GenerateWeeklyBriefResponse,
  GetWeeklyBriefActionItemsResponse,
  PaginatedResponse,
  RateWeeklyBriefRequest,
  RateWeeklyBriefResponse,
  SaveWeeklyBriefRequest,
  ShareWeeklyBriefResult,
  ShareWeeklyBriefToSlackResult,
  WeeklyBrief,
  WeeklyBriefCurrentResponse,
  WeeklyBriefRating,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, take } from 'rxjs';

/**
 * Angular client for the WG Weekly Brief BFF (`/api/committees/:id/weekly-briefs/*`).
 *
 * Mirrors the backend `WeeklyBriefService`'s mock/live split transparently — this
 * client only talks to the BFF and doesn't need to know which mode is active.
 */
@Injectable({
  providedIn: 'root',
})
export class WeeklyBriefService {
  private readonly http = inject(HttpClient);

  /**
   * GET /api/committees/:committeeId/weekly-briefs/current
   *
   * No `catchError` — a failed read must reach the caller so it can be classified as a
   * real error, distinct from the server's own 200-with-null-brief "no brief yet" state.
   * A blanket fallback here would render a misconfigured deploy or a 404 identically to
   * "no brief yet, 2 generates available" — see LFXV2-2175 full-branch review.
   *
   * `includeCurrentActivity: false` (GH-1922) opts out of the current_activity tally on this
   * read — see the BFF's `WeeklyBriefService#getCurrentBrief` doc comment for the upstream-cost
   * rationale. Two independent callers opt out, each on its own signal:
   * `weekly-brief-card.component.ts`'s `initBriefResponseSubscription` opts out on every
   * non-poll load (see that method's `combineLatest` sources for what triggers one — not
   * re-listed here, since it's exactly the kind of detail that drifts stale as those sources
   * change) whenever its own `isGoverningBoardCommittee()` is false — the template gates the
   * whole tally section on that same signal regardless of what current_activity holds, so a
   * non-governance committee never needs the fan-out on any of those loads. Its `pollUntilTerminal`
   * opts out on top of that (also gated on `isGoverningBoardCommittee()`, so it never mistakes
   * that deliberate non-poll-load opt-out for a transient degrade) once the current_activity KEY
   * is present on what it already holds — `null` counts as present (a settled "doesn't apply"
   * answer for a non-governance committee) and stops the asking just as a real value (possibly
   * `truncated: true`) would; only a genuinely absent key on a governance committee
   * keeps the poll asking, up to its own attempt cap — see
   * `WeeklyBriefCurrentResponse.current_activity`'s doc comment for the three-state
   * absent/null/present contract this depends on.
   */
  public getWeeklyBrief(committeeId: string, options: { includeCurrentActivity?: boolean } = {}): Observable<WeeklyBriefCurrentResponse> {
    const params = options.includeCurrentActivity === false ? { includeCurrentActivity: 'false' } : undefined;
    return this.http.get<WeeklyBriefCurrentResponse>(`/api/committees/${encodeURIComponent(committeeId)}/weekly-briefs/current`, { params });
  }

  /**
   * GET /api/committees/:committeeId/weekly-briefs/action-items
   *
   * The BFF already degrades extraction failures to an empty list (LFXV2-3043) — this
   * `catchError` is defense in depth against a transport-level failure (network error, 5xx)
   * reaching the widget, which per the ticket must never surface as an error on the page.
   * Still logged (not silently swallowed) so a broken deploy is distinguishable from a
   * genuinely quiet week in the browser console.
   */
  public getActionItems(committeeId: string): Observable<GetWeeklyBriefActionItemsResponse> {
    return this.http.get<GetWeeklyBriefActionItemsResponse>(`/api/committees/${encodeURIComponent(committeeId)}/weekly-briefs/action-items`).pipe(
      catchError((err) => {
        console.error('Failed to load weekly-brief action items', err);
        return of({ items: [] });
      })
    );
  }

  /**
   * POST /api/committees/:committeeId/weekly-briefs/generate
   *
   * No `catchError` — the caller handles 429 (throttle exceeded) and 409
   * (edited brief exists) by classifying the error itself.
   */
  public generateWeeklyBrief(committeeId: string, body: GenerateWeeklyBriefRequest = {}): Observable<GenerateWeeklyBriefResponse> {
    return this.http.post<GenerateWeeklyBriefResponse>(`/api/committees/${encodeURIComponent(committeeId)}/weekly-briefs/generate`, body).pipe(take(1));
  }

  /**
   * PUT /api/committees/:committeeId/weekly-briefs/current
   *
   * No `catchError` — the caller handles 409 (revision conflict) by prompting
   * the user to reload the latest server copy before retrying their edit.
   */
  public saveWeeklyBrief(committeeId: string, body: SaveWeeklyBriefRequest): Observable<WeeklyBrief> {
    return this.http.put<WeeklyBrief>(`/api/committees/${encodeURIComponent(committeeId)}/weekly-briefs/current`, body).pipe(take(1));
  }

  /**
   * POST /api/committees/:committeeId/weekly-briefs/share
   *
   * No `catchError` — the caller handles 404 (no brief) / 409 (no mailing list / stale
   * revision) states by classifying the error itself.
   */
  public shareWeeklyBrief(committeeId: string, revision: number): Observable<ShareWeeklyBriefResult> {
    return this.http.post<ShareWeeklyBriefResult>(`/api/committees/${encodeURIComponent(committeeId)}/weekly-briefs/share`, { revision }).pipe(take(1));
  }

  /**
   * POST /api/committees/:committeeId/weekly-briefs/share-slack
   *
   * No `catchError` — the caller handles 404 (no brief) / 409 (no Slack webhook configured /
   * stale revision / backend not live) / 502 (Slack rejected the message or was unreachable)
   * states by classifying the error itself, same as `shareWeeklyBrief`.
   */
  public shareWeeklyBriefToSlack(committeeId: string, revision: number): Observable<ShareWeeklyBriefToSlackResult> {
    return this.http
      .post<ShareWeeklyBriefToSlackResult>(`/api/committees/${encodeURIComponent(committeeId)}/weekly-briefs/share-slack`, { revision })
      .pipe(take(1));
  }

  /**
   * POST /api/committees/:committeeId/weekly-briefs/:briefUid/rating
   *
   * Upserts the caller's rating on the brief's current revision (also handles switching
   * up↔down — same request, new value). `revision` is the revision the caller actually saw when
   * they tapped — the BFF rejects with a 409 when it no longer matches the server-resolved current
   * revision (a co-chair's edit/regenerate landed in between), so the caller must handle that
   * status and refresh rather than retry blindly. No `catchError` — the caller classifies the
   * error itself.
   */
  public rateWeeklyBrief(committeeId: string, briefUid: string, rating: WeeklyBriefRating, revision: number): Observable<RateWeeklyBriefResponse> {
    const body: RateWeeklyBriefRequest = { rating, revision };
    return this.http
      .post<RateWeeklyBriefResponse>(`/api/committees/${encodeURIComponent(committeeId)}/weekly-briefs/${encodeURIComponent(briefUid)}/rating`, body)
      .pipe(take(1));
  }

  /**
   * DELETE /api/committees/:committeeId/weekly-briefs/:briefUid/rating
   *
   * Clears the caller's rating on the brief's current revision. `revision` is required and
   * enforced the same way `rateWeeklyBrief` enforces it (409 on drift) — without it, a stale tab's
   * clear could silently delete an unrelated (currently-current) revision's rating instead of the
   * one the user saw as rated. No `catchError` — the caller classifies the error itself.
   */
  public clearWeeklyBriefRating(committeeId: string, briefUid: string, revision: number): Observable<void> {
    return this.http
      .delete<void>(`/api/committees/${encodeURIComponent(committeeId)}/weekly-briefs/${encodeURIComponent(briefUid)}/rating`, { body: { revision } })
      .pipe(take(1));
  }

  /**
   * GET /api/committees/:committeeId/weekly-briefs
   *
   * Paginated archive list of past briefs for the committee, sourced from the
   * query-service `group_weekly_brief` index. No `catchError` — the drawer classifies
   * errors itself and surfaces a retry affordance.
   */
  public listWeeklyBriefs(committeeId: string, params?: { limit?: number; page_token?: string }): Observable<PaginatedResponse<WeeklyBrief>> {
    return this.http
      .get<PaginatedResponse<WeeklyBrief>>(`/api/committees/${encodeURIComponent(committeeId)}/weekly-briefs`, { params: { ...(params ?? {}) } })
      .pipe(take(1));
  }
}
