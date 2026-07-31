// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  GenerateWeeklyBriefRequest,
  GenerateWeeklyBriefResponse,
  SaveWeeklyBriefRequest,
  ShareWeeklyBriefResult,
  WeeklyBrief,
  WeeklyBriefCurrentResponse,
} from '@lfx-one/shared/interfaces';
import { Observable, take } from 'rxjs';

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
   */
  public getWeeklyBrief(committeeId: string): Observable<WeeklyBriefCurrentResponse> {
    return this.http.get<WeeklyBriefCurrentResponse>(`/api/committees/${encodeURIComponent(committeeId)}/weekly-briefs/current`);
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

  public shareWeeklyBrief(committeeId: string, revision: number): Observable<ShareWeeklyBriefResult> {
    return this.http.post<ShareWeeklyBriefResult>(`/api/committees/${committeeId}/weekly-briefs/share`, { revision });
    // No catchError — caller handles 404 (no brief) / 409 (no mailing list / stale revision) states
  }
}
